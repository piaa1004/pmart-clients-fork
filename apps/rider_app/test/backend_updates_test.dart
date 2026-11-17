// 백엔드 안내 2026-11-13~14(라이더 앱 배차·수행·BR-23·BR-24·계정 제한) 반영 확인.
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/features/delivery/data/delivery_repository.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/data/profile.dart';
import 'package:rider_app/features/offers/data/delivery_list_repository.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/location.dart';
import 'package:rider_app/shared/location_reporter.dart';
import 'package:rider_app/shared/providers.dart';

void main() {
  setUpAll(initPmartFormatting);

  group('BR-23 포장 QR = PKG:<packageId>:<버전>', () {
    test('마지막 : 로 나눠 packageId 를 꺼낸다', () {
      expect(packageIdFromQr('PKG:pkg-1:1'), 'pkg-1');
      expect(packageIdFromQr('PKG:PKG-a:b:12'), 'PKG-a:b');
      expect(packageIdFromQr(MockDeliveryRepository.qrFor('pkg-2')), 'pkg-2');
    });

    test('옛 목 형식·버전 없는 원문은 읽지 않는다', () {
      expect(packageIdFromQr('PMART-PKG:pkg-1:v1'), isNull);
      expect(packageIdFromQr('PKG:pkg-1:v1'), isNull);
      expect(packageIdFromQr('PKG::1'), isNull);
    });
  });

  group('BR-24 전달지', () {
    test('픽업 전에는 닫혀 있고, 픽업 뒤에 열린다', () async {
      final repo = MockDeliveryRepository(latency: Duration.zero);
      await expectLater(
        repo.dropInfo('dlv-1'),
        throwsA(
          isA<DropInfoUnavailableFailure>().having(
            (f) => f.reason,
            'reason',
            DropInfoUnavailable.closed,
          ),
        ),
      );
      repo.deliveryJson('dlv-1')['state'] = 'PICKED_UP';
      final info = await repo.dropInfo('dlv-1');
      expect(info.roadAddress, isNotEmpty);
      expect(info.receiverPhone, isNotNull);
    });
  });

  group('전달 실패', () {
    late MockDeliveryRepository repo;
    late ProviderContainer c;

    setUp(() {
      repo = MockDeliveryRepository(latency: Duration.zero);
      repo.deliveryJson('dlv-1')['state'] = 'ARRIVED_AT_CUSTOMER';
      c = ProviderContainer(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          deliveryRepositoryProvider.overrideWithValue(repo),
          evidenceUploaderProvider.overrideWithValue(repo),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        ],
      );
      addTearDown(c.dispose);
      c.listen(deliveryFlowProvider('dlv-1'), (_, _) {});
    });

    test('고객 부재는 사진과 연락 2회가 있어야 접수되고, 확정 전까지 진행 중이다', () async {
      final flow = c.read(deliveryFlowProvider('dlv-1').notifier);
      await flow.uploadPhoto((bytes: Uint8List(3), filename: 'a.jpg'));
      flow.recordContact(answered: false);
      await flow.reportFailure(FailureReason.customerAbsent);
      var items = await c.read(riderQueueProvider).items();
      expect(
        items.last.rejectCode,
        HandoverProblemCode.contactAttemptsRequired,
      );

      flow.recordContact(answered: false);
      await flow.reportFailure(FailureReason.customerAbsent);
      expect((await repo.get('dlv-1')).state, ExecutionState.failureReported);
      expect(isActive(ExecutionState.failureReported), isTrue);
      items = await c.read(riderQueueProvider).items();
      expect(items.last.payload['evidenceRefs'], ['photo-1']);
      expect(items.last.payload['contactAttempts'], hasLength(2));
    });
  });

  test('묶음 제안은 한 묶음으로 모이고 방문 순서대로 놓인다', () {
    const a = OfferItem(
      offerId: 'b2',
      remainingSec: 60,
      expiresAt: null,
      bundleId: 'x',
      stopSequence: 2,
    );
    const b = OfferItem(
      offerId: 'b1',
      remainingSec: 60,
      expiresAt: null,
      bundleId: 'x',
      stopSequence: 1,
    );
    const single = OfferItem(offerId: 's', remainingSec: 60, expiresAt: null);
    final groups = groupOffers([a, single, b]);
    expect(groups, hasLength(2));
    expect(groups.first.map((o) => o.offerId), ['b1', 'b2']);
  });

  testWidgets('묶음 하나를 수락하면 묶음의 배송이 모두 내 배송이 된다', (t) async {
    final offers = MockOfferRepository(
      latency: Duration.zero,
      demoBundle: true,
    );
    await t.pumpWidget(
      _app([
        offerRepositoryProvider.overrideWithValue(offers),
        dutyRepositoryProvider.overrideWithValue(offers),
        deliveryRepositoryProvider.overrideWithValue(
          MockDeliveryRepository(
            latency: Duration.zero,
            seeded: false,
            demoBundle: true,
          ),
        ),
      ]),
    );
    await _settle(t);
    // 첫 제안(예약)을 거절할 수 없는 일반 모드라 수락해서 넘긴다.
    await t.tap(find.byKey(const ValueKey('accept-offer-mock-1')));
    await _settle(t);
    expect(find.text('알뜰 2건'), findsOneWidget);

    await t.tap(find.byKey(const ValueKey('accept-offer-bundle-1')));
    await _settle(t);
    expect(offers.assignedDeliveries, containsAll(['dlv-b1', 'dlv-b2']));
    // 다른 제안이 없으면 홈에 배송 시트가 바로 뜬다(레퍼런스 image 14) — 시트가 부르는 조회를 마저 끝낸다.
    expect(find.byKey(const ValueKey('delivery-dlv-b1')), findsOneWidget);
    await t.pump(const Duration(seconds: 2));
  });

  test('배달리스트 수락은 같은 키면 같은 판정, 없는 배송은 늦은 수락', () async {
    final assigned = <String>[];
    final repo = MockDeliveryListRepository(
      latency: Duration.zero,
      onAssigned: assigned.add,
    );
    final key = IdempotencyKey.generate();
    expect(await repo.accept('dlv-l1', key: key), isA<OfferAssigned>());
    expect(await repo.accept('dlv-l1', key: key), isA<OfferAssigned>());
    expect(assigned, ['dlv-l1']);
    expect(
      await repo.accept('dlv-l1', key: IdempotencyKey.generate()),
      isA<OfferLate>(),
    );
    expect((await repo.list()).items.map((i) => i.deliveryId), ['dlv-l2']);
  });

  testWidgets('계정 제한이면 안내 띠가 보이고, 풀리면 해제를 알린다', (t) async {
    final offers = MockOfferRepository(latency: Duration.zero);
    final profile = MockProfileRepository()
      ..restriction = Restriction.dispatchRestricted;
    await t.pumpWidget(
      _app([
        offerRepositoryProvider.overrideWithValue(offers),
        dutyRepositoryProvider.overrideWithValue(offers),
        profileRepositoryProvider.overrideWithValue(profile),
        deliveryRepositoryProvider.overrideWithValue(
          MockDeliveryRepository(latency: Duration.zero, seeded: false),
        ),
      ]),
    );
    await _settle(t);
    expect(find.byKey(const ValueKey('restriction-banner')), findsOneWidget);
    expect(find.textContaining('신규배차 제한'), findsOneWidget);

    profile.restriction = Restriction.normal;
    final container = ProviderScope.containerOf(
      t.element(find.byType(Scaffold).first),
    );
    container.invalidate(profileProvider);
    await _settle(t);

    expect(find.byKey(const ValueKey('restriction-banner')), findsNothing);
    expect(find.text('계정 제한이 해제되었습니다'), findsOneWidget);
  });

  testWidgets('운행 중인데 위치가 항상 허용이 아니면 한 번 안내하고 권한을 묻는다', (t) async {
    final offers = MockOfferRepository(latency: Duration.zero);
    final permission = _FakePermission();
    await t.pumpWidget(
      _app([
        offerRepositoryProvider.overrideWithValue(offers),
        dutyRepositoryProvider.overrideWithValue(offers),
        backgroundLocationPermissionProvider.overrideWithValue(permission),
        deliveryRepositoryProvider.overrideWithValue(
          MockDeliveryRepository(latency: Duration.zero, seeded: false),
        ),
      ]),
    );
    await _settle(t);
    expect(
      find.byKey(const ValueKey('background-location-ask')),
      findsOneWidget,
    );

    await t.tap(find.byKey(const ValueKey('background-location-allow')));
    await _settle(t);
    expect(permission.requests, 1);
    expect(find.byKey(const ValueKey('background-location-ask')), findsNothing);
  });

  test('운전면허는 오토바이·자동차·킥보드만 필수다', () {
    expect(
      {for (final v in Vehicle.values) v: licenseRequired(v)},
      {
        Vehicle.motorcycle: true,
        Vehicle.bicycle: false,
        Vehicle.eBike: false,
        Vehicle.kickboard: true,
        Vehicle.car: true,
        Vehicle.walk: false,
      },
    );
    expect(holderMatchesName('홍 길동', '홍길동'), isTrue);
    expect(holderMatchesName('김다른', '홍길동'), isFalse);
  });

  test('위치는 모아서 보내고, 실패한 묶음은 같은 키로 다시 보낸다', () async {
    final uploader = _FlakyUploader();
    final c = ProviderContainer(
      overrides: [locationUploaderProvider.overrideWithValue(uploader)],
    );
    addTearDown(c.dispose);
    final reporter = c.read(locationReporterProvider.notifier)
      ..addForTest((lat: 37.5, lng: 127.0, recordedAt: DateTime.utc(2026)))
      ..addForTest((lat: 37.5, lng: 127.1, recordedAt: DateTime.utc(2026)));

    uploader.failNext = true;
    await reporter.flush();
    await reporter.flush();

    expect(uploader.keys, hasLength(2));
    expect(uploader.keys.toSet(), hasLength(1), reason: '다시 보내기는 같은 키');
    expect(uploader.points, 2);
  });
}

Widget _app(List<Override> overrides) => ProviderScope(
  retry: (_, _) => null,
  overrides: [
    envProvider.overrideWithValue(PmartEnv.mock),
    initialSessionProvider.overrideWithValue(
      const RiderSession(riderId: 'rider-mock-1'),
    ),
    secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
    ...overrides,
  ],
  child: const RiderApp(),
);

Future<void> _settle(WidgetTester t) async {
  for (var i = 0; i < 6; i++) {
    await t.pump(const Duration(milliseconds: 20));
  }
}

final class _FakePermission implements BackgroundLocationPermission {
  int requests = 0;

  @override
  Future<LocationAccess> check() async => LocationAccess.whileInUse;

  @override
  Future<LocationAccess> request() async {
    requests++;
    return LocationAccess.always;
  }
}

final class _FlakyUploader implements LocationUploader {
  bool failNext = false;
  final keys = <String>[];
  int points = 0;

  @override
  Future<void> upload(
    List<LocationSample> points, {
    required IdempotencyKey key,
  }) async {
    keys.add(key.value);
    if (failNext) {
      failNext = false;
      throw const NetworkFailure(DioExceptionType.connectionError);
    }
    this.points += points.length;
  }
}
