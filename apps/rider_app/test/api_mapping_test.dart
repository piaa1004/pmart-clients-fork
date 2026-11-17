import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_delivery_dispatch/pmart_api_delivery_dispatch.dart'
    as dp;
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_core/pmart_core.dart';

import 'package:rider_app/features/auth/data/pickup_points.dart';
import 'package:rider_app/features/auth/data/rider_auth.dart';
import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/features/inquiries/data/inquiries.dart';
import 'package:rider_app/features/my/data/records.dart';
import 'package:rider_app/features/my/data/withdrawal.dart';
import 'package:rider_app/features/notifications/data/notifications.dart';
import 'package:rider_app/shared/mfc_directory.dart';
import 'package:rider_app/features/delivery/data/delivery_repository.dart';
import 'package:rider_app/features/delivery/data/trip_repository.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';

/// 실서버 연결(백엔드 회신 2026-11-16~17) — 계약 응답을 화면 모델로 바꾸는 부분. 서버는 부르지 않는다
/// (가짜 어댑터가 정해 둔 JSON 을 돌려준다).
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.routes);

  /// "METHOD path" → (상태, 본문). 없으면 연결 실패.
  final Map<String, (int, Object?)> routes;
  final calls = <String>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final key = '${options.method} ${options.uri.path}';
    calls.add(key);
    final r = routes[key];
    if (r == null) {
      throw DioException.connectionError(
        requestOptions: options,
        reason: 'fake',
      );
    }
    return ResponseBody.fromString(
      jsonEncode(r.$2),
      r.$1,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio _dio(_FakeAdapter a) =>
    Dio(BaseOptions(baseUrl: 'http://fake/api/v1'))..httpClientAdapter = a;

void main() {
  test('도움요청 대화: 상담원 ID 없이 "지원센터", 가린 메시지는 본문 없이', () {
    final m = supportMessageFromContract(
      ex.HelpMessage(
        messageId: 'm1',
        seq: 1,
        senderType: ex.HelpMessageSenderTypeEnum.SUPPORT,
        body: '확인했어요',
        createdAt: DateTime.utc(2026, 11, 17),
      ),
    );
    expect(m.sender, SupportSender.agent);
    expect(m.text, '확인했어요');
    expect(m.masked, isFalse);
    final hidden = supportMessageFromContract(
      ex.HelpMessage(
        messageId: 'm2',
        seq: 2,
        senderType: ex.HelpMessageSenderTypeEnum.RIDER,
        body: null,
        masked: true,
        createdAt: DateTime.utc(2026, 11, 17),
      ),
    );
    expect(hidden.sender, SupportSender.rider);
    expect(hidden.masked, isTrue);
  });

  test('도움요청 유형: 서버 값 ↔ 앱 값, 모르는 값은 기타', () {
    for (final c in HelpCategory.values) {
      expect(helpCategoryFromWire(helpCategoryToContract(c).value), c);
    }
    expect(helpCategoryFromWire('NEW_KIND'), HelpCategory.other);
  });

  test('대화 보내기·목록: 계약 경로와 멱등 키', () async {
    final a = _FakeAdapter({
      'GET /api/v1/deliveries/d1/help-requests/r1/messages': (
        200,
        {
          'items': [
            {
              'messageId': 'm1',
              'seq': 1,
              'senderType': 'SUPPORT',
              'body': '안녕하세요',
              'createdAt': '2026-11-17T01:00:00Z',
            },
          ],
          'helpState': 'IN_PROGRESS',
        },
      ),
      'POST /api/v1/deliveries/d1/help-requests/r1/messages': (
        201,
        {
          'messageId': 'm2',
          'seq': 2,
          'senderType': 'RIDER',
          'body': '고객과 연락됐어요',
          'createdAt': '2026-11-17T01:01:00Z',
        },
      ),
    });
    final repo = ApiSupportThreadRepository(_dio(a));
    final list = await repo.threadMessages('d1', 'r1');
    expect(list.single.text, '안녕하세요');
    await repo.sendMessage('d1', 'r1', '고객과 연락됐어요', key: IdempotencyKey('k-1'));
    expect(
      a.calls,
      contains('POST /api/v1/deliveries/d1/help-requests/r1/messages'),
    );
  });

  test('내 도움요청 목록 → 앱을 다시 켜도 보낸 요청이 남는다', () async {
    final a = _FakeAdapter({
      'GET /api/v1/deliveries/d1/help-requests': (
        200,
        {
          'items': [
            {
              'requestId': 'r1',
              'deliveryId': 'd1',
              'caseId': 'CS-1',
              'state': 'IN_PROGRESS',
              'category': 'CUSTOMER_UNREACHABLE',
              'detail': '전화를 안 받아요',
              'createdAt': '2026-11-17T01:00:00Z',
            },
          ],
        },
      ),
    });
    final records = await ApiDeliveryRepository(_dio(a)).helpRequests('d1');
    expect(records.single.requestId, 'r1');
    expect(records.single.category, HelpCategory.customerUnreachable);
    expect(records.single.state, HelpState.inProgress);
    expect(records.single.caseId, 'CS-1');
  });

  test('주문정보: 제안 요약(좌표·소요) + 수락 뒤 배송 조회(orderSummary)', () async {
    final now = DateTime.utc(2026, 11, 17, 10);
    rememberOfferTrip(
      'd9',
      dp.OfferSummary(
        mfcId: 'MFC-BSJ-01',
        dropAreaLabel: '부산진구 전포동',
        pickupEtaSeconds: 300,
        dropEtaSeconds: 600,
        pickupPoint: dp.LatLng(lat: 35.1585, lng: 129.062),
        dropAreaPoint: dp.LatLng(lat: 35.16, lng: 129.07),
        order: dp.OfferOrderInfo(
          orderId: 'ord-1',
          mfcName: 'PMart 부산진구지점',
          mfcAddress: '부산 부산진구 동천로 109',
          itemAmount: 17940,
          deliveryNote: '문 앞',
          items: [
            dp.OfferOrderInfoItemsInner(
              name: '그릭요거트',
              optionLabel: '400g',
              qty: 3,
              lineAmount: 17940,
            ),
          ],
        ),
      ),
      now: now,
    );

    // 배정 전(배송 조회 실패)에는 제안 요약만.
    final before = await ApiTripRepository(_dio(_FakeAdapter(const {})))
        .forDelivery('d9');
    expect(before!.store.name, 'PMart 부산진구지점');
    expect(before.store.phone, isNull, reason: '가게 전화는 서버에 없다');
    expect(before.items.single.name, '그릭요거트 400g');
    expect(before.drop, (lat: 35.16, lng: 129.07));
    expect(before.pickupDueAt, now.add(const Duration(minutes: 5)));
    expect(before.dropDueAt, now.add(const Duration(minutes: 15)));

    // 배정 뒤: 배송 조회의 주문 요약(화면용 주문번호)이 앞선다.
    final after = await ApiTripRepository(
      _dio(
        _FakeAdapter({
          'GET /api/v1/deliveries/d9': (
            200,
            {
              'deliveryId': 'd9',
              'orderId': 'ord-1',
              'mfcId': 'MFC-BSJ-01',
              'state': 'ASSIGNED',
              'version': 1,
              'orderSummary': {
                'orderNumber': '48213075',
                'itemAmount': 17940,
                'deliveryNote': '문 앞에 두세요',
                'items': [
                  {'name': '그릭요거트', 'qty': 3, 'lineAmount': 17940},
                ],
              },
            },
          ),
        }),
      ),
    ).forDelivery('d9');
    expect(after!.orderNo, '48213075');
    expect(after.deliveryRequest, '문 앞에 두세요');
    expect(after.drop, (lat: 35.16, lng: 129.07), reason: '좌표는 제안 때 값');
  });

  test('가입: 수단 6종 → 계약 VehicleType, 면허 중복확인은 서버로', () async {
    expect(vehicleToContract(Vehicle.eBike).value, 'E_BIKE');
    expect(vehicleToContract(Vehicle.kickboard).value, 'KICKBOARD');
    final a = _FakeAdapter({
      'POST /api/v1/riders/license-checks': (200, {'available': false}),
      'POST /api/v1/riders/phone-checks': (200, {'available': true}),
      'POST /api/v1/riders/account-checks': (200, {'available': false}),
      'GET /api/v1/riders/bank-codes': (
        200,
        {
          'items': [
            {'code': '004', 'name': 'KB국민은행'},
            {'code': '090', 'name': '카카오뱅크'},
          ],
        },
      ),
    });
    final repo = ApiSignupRepository(_dio(a));
    expect(await repo.isLicenseAvailable('11-22-333333-44'), isFalse);
    // 휴대폰·계좌 중복 확인(rider 0.7.0). 은행은 금융결제원 코드로 보낸다.
    expect(await repo.isPhoneAvailable('01012345678'), isTrue);
    expect(await repo.isAccountAvailable('004', '1234567890'), isFalse);
    expect((await repo.banks()).map((b) => b.code), ['004', '090']);
  });

  test('가입 확인: 서버에 경로가 아직 없으면(404) 통과가 아니라 "가입 때 확인"(null)', () async {
    const notFound = (
      404,
      {'type': 'about:blank', 'status': 404, 'code': 'NOT_FOUND'},
    );
    final a = _FakeAdapter({
      'POST /api/v1/riders/phone-checks': notFound,
      'POST /api/v1/riders/account-checks': notFound,
      'GET /api/v1/riders/bank-codes': notFound,
    });
    final repo = ApiSignupRepository(_dio(a));
    expect(await repo.isPhoneAvailable('01012345678'), isNull);
    expect(await repo.isAccountAvailable('004', '1234567890'), isNull);
    expect(await repo.banks(), SignupOptions.banks);
    // 연결 실패는 "확인 못 함"으로 던진다(쓸 수 있다고 단정하지 않는다).
    final down = ApiSignupRepository(_dio(_FakeAdapter({})));
    expect(down.isPhoneAvailable('01012345678'), throwsA(isA<PmartFailure>()));
  });

  test('실서버 로그인: Google ID 토큰 → 라이더 토큰 저장 → /riders/me 404 면 미가입', () async {
    final store = MemoryKeyValueStore();
    final tokens = TokenStore(store);
    final a = _FakeAdapter({
      'POST /api/v1/rider-auth/social-logins': (
        200,
        {
          'authRequestId': 'ar-1',
          'state': 'AUTH_MEMBER',
          'riderId': 'RD-1',
          'newAccount': true,
          'occurredAt': '2026-11-17T01:00:00Z',
          'tokens': {
            'accessToken': 'acc',
            'refreshToken': 'ref',
            'accessTokenExpiresAt': '2026-11-17T02:00:00Z',
          },
        },
      ),
      'GET /api/v1/riders/me': (
        404,
        {'type': 'about:blank', 'status': 404, 'code': 'NOT_FOUND'},
      ),
    });
    final login = RiderLogin(
      dio: _dio(a),
      tokens: tokens,
      deviceId: DeviceIdProvider(store),
      google: _FakeGoogle('id-token'),
    );
    final out = await login.login();
    expect(out, isA<RiderLoggedIn>());
    expect((out as RiderLoggedIn).riderId, 'RD-1');
    expect(out.registered, isFalse);
    expect(await tokens.readRefreshToken(), 'ref');

    // 계정 선택 창을 닫으면 서버를 부르지 않는다.
    final canceled = await RiderLogin(
      dio: _dio(_FakeAdapter(const {})),
      tokens: tokens,
      deviceId: DeviceIdProvider(store),
      google: _FakeGoogle(null),
    ).login();
    expect(canceled, isA<RiderLoginCanceled>());
  });

  test('토큰 갱신: 401 이면 세션 끝(null), 성공이면 새 토큰', () async {
    final store = MemoryKeyValueStore();
    final ok = riderRefresher(
      baseUrl: 'http://fake/api/v1',
      deviceId: DeviceIdProvider(store),
      adapter: _FakeAdapter({
        'POST /api/v1/rider-auth/tokens': (
          200,
          {
            'accessToken': 'a2',
            'refreshToken': 'r2',
            'accessTokenExpiresAt': '2026-11-17T02:00:00Z',
          },
        ),
      }),
    );
    expect((await ok('r1'))!.refreshToken, 'r2');
    final gone = riderRefresher(
      baseUrl: 'http://fake/api/v1',
      deviceId: DeviceIdProvider(store),
      adapter: _FakeAdapter({
        'POST /api/v1/rider-auth/tokens': (
          401,
          {'type': 'about:blank', 'status': 401, 'code': 'TOKEN_REUSED'},
        ),
      }),
    );
    expect(await gone('r1'), isNull);
  });

  test('지점 목록: 서버 centerId 로 고르고, 권역은 이름·주소로 나눈다', () async {
    final a = _FakeAdapter({
      'GET /api/v1/mfc-pickup-points': (
        200,
        {
          'items': [
            {
              'centerId': 'CTR-0001',
              'name': '부산진구지점',
              'address': '부산 부산진구 동천로 109',
            },
            {'centerId': 'CTR-0099', 'name': '새지점', 'address': '강원 강릉시 …'},
          ],
        },
      ),
    });
    final areas = await ApiPickupPointRepository(_dio(a)).areas();
    expect(areas[MfcRegion.gyeongsang]!.single.mfcId, 'CTR-0001');
    expect(areas[MfcRegion.gangwon]!.single.name, '새지점');
    expect(areas[MfcRegion.jeolla], isEmpty);
    expect(regionOfPickupPoint('X', '대전 유성구'), MfcRegion.chungcheong);
    expect(regionOfPickupPoint('X', '광주 동구'), MfcRegion.jeolla);
  });

  test('서버 지점 코드(MFC-SEED-01)를 이름으로 보인다', () async {
    final a = _FakeAdapter({
      'GET /api/v1/mfc-pickup-points': (
        200,
        {
          'items': [
            {
              'centerId': 'MFC-SEED-01',
              'name': '부산진구지점',
              'address': '부산 부산진구 동천로 109',
            },
          ],
        },
      ),
    });
    final c = ProviderContainer(
      overrides: [
        pickupPointRepositoryProvider.overrideWithValue(
          ApiPickupPointRepository(_dio(a)),
        ),
      ],
    );
    addTearDown(c.dispose);
    expect(storeNameOf('MFC-SEED-01'), isNull, reason: '읽기 전');
    await c.read(storeNamesProvider.future);
    expect(storeNameOf('MFC-SEED-01'), '부산진구지점');
  });

  test('배송 밖 문의: 정산 유형으로 남기고 답변을 읽는다(목은 15초 뒤 답변)', () async {
    var now = DateTime.utc(2026, 11, 17, 10);
    final repo = MockInquiryRepository(
      latency: Duration.zero,
      clock: () => now,
    );
    final key = IdempotencyKey.generate();
    final created = await repo.create(
      InquiryKind.settlement,
      title: '정산 금액 문의',
      body: '어제 건이 빠졌어요',
      key: key,
    );
    // 같은 키 = 같은 문의.
    final again = await repo.create(
      InquiryKind.settlement,
      title: '정산 금액 문의',
      body: '어제 건이 빠졌어요',
      key: key,
    );
    expect(again.id, created.id);
    expect((await repo.get(created.id)).state, InquiryState.received);
    now = now.add(MockInquiryRepository.answerAfter);
    final answered = await repo.get(created.id);
    expect(answered.state, InquiryState.answered);
    expect(answered.replies, hasLength(1));
    expect(await repo.list(), hasLength(1));

    // 실서버 요청: 정산 유형, orderId 없이.
    final a = _FakeAdapter({
      'POST /api/v1/inquiries': (
        201,
        {
          'inquiryId': 'inq-9',
          'category': 'SETTLEMENT',
          'title': '정산 금액 문의',
          'status': 'RECEIVED',
          'createdAt': '2026-11-17T01:00:00Z',
          'version': 1,
          'caseId': 'CS-9',
          'body': '어제 건이 빠졌어요',
          'replies': <Object>[],
        },
      ),
    });
    final api = await ApiInquiryRepository(_dio(a)).create(
      InquiryKind.settlement,
      title: '정산 금액 문의',
      body: '어제 건이 빠졌어요',
      key: IdempotencyKey('k-inq'),
    );
    expect(api.kind, InquiryKind.settlement);
    expect(api.state, InquiryState.received);
  });

  test('알림: 도움요청 답장은 그 대화로, 문의 답변은 그 문의로', () {
    final help = notificationTarget('HELP_REQUEST', 'dlv-1:req-9');
    expect(help, isA<HelpRequestTarget>());
    expect((help as HelpRequestTarget).deliveryId, 'dlv-1');
    expect(help.requestId, 'req-9');
    expect(notificationTarget('INQUIRY', 'inq-1'), isA<InquiryTarget>());
    expect(notificationTarget('NONE', null), isA<NoTarget>());
    expect(notificationTarget('HELP_REQUEST', 'broken'), isA<NoTarget>());
  });

  test('사진 다시 보기: 도움요청 상세 evidenceRefs → 사진 원본(새 API 없이)', () async {
    final a = _FakeAdapter({
      'GET /api/v1/deliveries/dlv-1/help-requests/req-1': (
        200,
        {
          'requestId': 'req-1',
          'deliveryId': 'dlv-1',
          'evidenceRefs': ['ph-1'],
        },
      ),
      'GET /api/v1/deliveries/dlv-1/evidence-photos/ph-1': (200, 'JPEG'),
    });
    final viewer = ApiEvidencePhotoViewer(_dio(a));
    expect(await viewer.requestPhotoRefs('dlv-1', 'req-1'), ['ph-1']);
    expect(await viewer.photo('dlv-1', 'ph-1'), isNotEmpty);
  });
  test('탈퇴 막힘: 409 INVALID_STATE details[blockers] → 사유 목록', () async {
    final a = _FakeAdapter({
      'POST /api/v1/riders/me/withdrawals': (
        409,
        {
          'type': 'about:blank',
          'status': 409,
          'code': 'INVALID_STATE',
          'details': [
            {'field': 'blockers', 'reason': 'UNCONFIRMED_EARNING'},
            {'field': 'blockers', 'reason': 'OPEN_HELP_REQUEST'},
          ],
        },
      ),
    });
    final repo = ApiWithdrawalRepository(_dio(a));
    await expectLater(
      repo.request(key: IdempotencyKey.generate()),
      throwsA(
        isA<WithdrawalBlockedFailure>().having((f) => f.blockers, 'blockers', [
          WithdrawalBlocker.unconfirmedEarning,
          WithdrawalBlocker.openHelpRequest,
        ]),
      ),
    );
  });

  test('운행시간: 오늘 + 이번 주(월~일) 두 번 묻고 초를 시간으로', () async {
    final a = _FakeAdapter({});
    final dio = _dio(a);
    final calls = <String>[];
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) {
          calls.add(o.uri.query);
          final week = o.uri.queryParameters.containsKey('from');
          h.resolve(
            Response(
              requestOptions: o,
              statusCode: 200,
              data: week
                  ? {
                      'from': '2026-11-16',
                      'to': '2026-11-22',
                      'totalSeconds': 9000,
                      'days': [
                        {'date': '2026-11-16', 'seconds': 3600},
                        {'date': '2026-11-17', 'seconds': 5400},
                        {'date': '2026-11-18', 'seconds': 0},
                      ],
                    }
                  : {
                      'from': '2026-11-18',
                      'to': '2026-11-18',
                      'totalSeconds': 0,
                      'days': [
                        {'date': '2026-11-18', 'seconds': 0},
                      ],
                    },
            ),
          );
        },
      ),
    );
    final t = await ApiRecordsRepository(dio).operatingTime();
    expect(calls.last, 'from=2026-11-16&to=2026-11-22');
    expect(t.today, DateTime(2026, 11, 18));
    expect(t.todayTotal, Duration.zero);
    expect(t.weekTotal, const Duration(hours: 2, minutes: 30));
    expect(t.days.map((d) => d.day.day), [16, 17]);
  });
}

class _FakeGoogle implements GoogleIdTokenSource {
  _FakeGoogle(this.token);
  final String? token;

  @override
  Future<String?> obtain() async => token;

  @override
  Future<void> signOut() async {}
}
