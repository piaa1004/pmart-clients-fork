import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/features/auth/presentation/postcode_screen.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';
import 'package:rider_app/shared/rider_widgets.dart';

void main() {
  setUpAll(initPmartFormatting);

  late MockOfferRepository repo;
  late Duration mono;

  setUp(() {
    repo = MockOfferRepository(latency: Duration.zero);
    mono = Duration.zero;
  });

  Widget app() => ProviderScope(
    retry: (_, _) => null,
    overrides: [
      envProvider.overrideWithValue(PmartEnv.mock),
      initialSessionProvider.overrideWithValue(
        const RiderSession(riderId: 'rider-mock-1'),
      ),
      offerRepositoryProvider.overrideWithValue(repo),
      dutyRepositoryProvider.overrideWithValue(repo),
      deliveryRepositoryProvider.overrideWithValue(
        MockDeliveryRepository(latency: Duration.zero, seeded: false),
      ),
      monotonicProvider.overrideWithValue(() => mono),
    ],
    child: const RiderApp(),
  );

  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 5; i++) {
      await t.pump(const Duration(milliseconds: 10));
    }
  }

  Future<void> start(WidgetTester t) async {
    await t.pumpWidget(app());
    await settle(t);
  }

  testWidgets('서버 pollAfterSec 간격으로 다시 조회한다', (t) async {
    await start(t);
    expect(repo.fetches, 1);

    await t.pump(const Duration(seconds: 4));
    expect(repo.fetches, 1);
    await t.pump(const Duration(seconds: 1));
    await t.pump();
    expect(repo.fetches, 2);
  });

  testWidgets('신규배차를 끄면 서버가 null 을 줘서 폴링을 멈춘다. 켜면 즉시 조회한다', (t) async {
    await start(t);
    await t.tap(find.byKey(const ValueKey('new-dispatch')));
    await settle(t);
    final afterOff = repo.fetches;
    expect(find.byKey(const ValueKey('polling-stopped')), findsOneWidget);

    await t.pump(const Duration(seconds: 30));
    expect(repo.fetches, afterOff, reason: 'null 이면 폴링하지 않는다');

    await t.tap(find.byKey(const ValueKey('new-dispatch')));
    await settle(t);
    expect(repo.fetches, afterOff + 1, reason: '신규배차 ON 은 즉시 조회');
    expect(find.byKey(const ValueKey('offer-offer-mock-1')), findsOneWidget);
  });

  testWidgets('조회 실패는 "제안 없음"이 아니라 연결 확인 중이고, 받은 제안을 지우지 않는다', (t) async {
    await start(t);
    repo.failNextFetches = 1;
    await t.pump(const Duration(seconds: 5));
    await settle(t);

    expect(find.byKey(const ValueKey('reconnecting')), findsOneWidget);
    expect(find.byKey(const ValueKey('offers-empty')), findsNothing);
    expect(find.byKey(const ValueKey('offer-offer-mock-1')), findsOneWidget);

    // 지수 백오프(2초) 뒤 재시도해서 회복한다.
    await t.pump(const Duration(seconds: 2));
    await settle(t);
    expect(find.byKey(const ValueKey('reconnecting')), findsNothing);
  });

  testWidgets('남은 시간은 서버 값에서 단조 경과로 줄이고, 다시 조회하면 서버 값으로 맞춘다', (t) async {
    await start(t);
    expect(find.text('42초 남음'), findsOneWidget);

    mono = const Duration(seconds: 3);
    await t.pump(const Duration(seconds: 1));
    expect(find.text('39초 남음'), findsOneWidget);

    mono = const Duration(seconds: 50);
    await t.pump(const Duration(seconds: 1));
    expect(
      find.text('0초 남음'),
      findsOneWidget,
      reason: '0 이어도 만료 확정이 아니라 버튼은 남는다',
    );
    expect(find.byKey(const ValueKey('accept-offer-mock-1')), findsOneWidget);
  });

  testWidgets('수락 응답을 잃어도 같은 키로 판정을 받고 내 배송에 추가된다', (t) async {
    repo.loseNextResponse = true;
    await start(t);

    await t.tap(find.byKey(const ValueKey('accept-offer-mock-1')));
    await settle(t);

    expect(repo.respondKeys, hasLength(2));
    expect(repo.respondKeys.toSet(), hasLength(1));
    expect(find.text('배정됐어요. 배송 정보를 확인해 주세요'), findsOneWidget);
    expect(find.byKey(const ValueKey('delivery-dlv-1')), findsOneWidget);
  });

  testWidgets('늦은 수락은 사유별로 안내한다', (t) async {
    repo.lateNext = LateReason.alreadyAssigned;
    await start(t);

    await t.tap(find.byKey(const ValueKey('accept-offer-mock-1')));
    await settle(t);

    expect(find.text('다른 라이더에게 이미 배정됐어요'), findsOneWidget);
    expect(find.byKey(const ValueKey('delivery-dlv-1')), findsNothing);
  });

  testWidgets('일반 배차 모드는 홈에 AI 제안이 뜨지 않고 배달리스트로 안내한다', (t) async {
    repo = MockOfferRepository(
      latency: Duration.zero,
      mode: DispatchMode.normal,
    );
    await start(t);
    expect(find.byKey(const ValueKey('accept-offer-mock-1')), findsNothing);
    expect(find.byKey(const ValueKey('reject-offer-mock-1')), findsNothing);
    expect(find.byKey(const ValueKey('normal-mode-notice')), findsOneWidget);
  });

  testWidgets('진행 중 배송이 있으면 운행을 끝낼 수 없다(서버 판정)', (t) async {
    await start(t);
    await t.tap(find.byKey(const ValueKey('accept-offer-mock-1')));
    await settle(t);

    // 배정 안내 띠가 내려간 뒤(아래 버튼을 가린다) 마이페이지의 운행종료를 누른다.
    await t.pump(const Duration(seconds: 1)); // 띠가 다 올라온 뒤
    await t.pump(const Duration(seconds: 5)); // 표시 시간이 지나고
    await t.pump(const Duration(seconds: 1)); // 내려간다
    await settle(t);
    await t.tap(find.byKey(const ValueKey('my-page')));
    await t.pumpAndSettle(const Duration(milliseconds: 50));
    await t.tap(find.byKey(const ValueKey('end-duty')));
    await settle(t);
    // 이전 안내를 내리고 새 안내를 띄우는 애니메이션을 기다린다.
    await t.pump(const Duration(seconds: 1));

    expect(find.text('진행 중인 배송이 있어서 운행을 끝낼 수 없어요'), findsOneWidget);
    // 서버가 거절했으니 여전히 운행 중이다(운행종료 버튼이 그대로 켜져 있다).
    expect(
      t.widget<FilledButton>(find.byKey(const ValueKey('end-duty'))).onPressed,
      isNotNull,
    );
  });

  testWidgets('운행 종료에서 시작하면 운행시작 화면이고, 누르면 제안을 받는다', (t) async {
    repo = MockOfferRepository(latency: Duration.zero, startOnDuty: false);
    await start(t);
    expect(find.byKey(const ValueKey('start-duty')), findsOneWidget);
    expect(find.byKey(const ValueKey('offer-offer-mock-1')), findsNothing);
    // 운행 전에는 지도에 픽업·전달 핀이 없다.
    expect(find.text('픽업'), findsNothing);
    expect(find.text('전달'), findsNothing);

    await t.tap(find.byKey(const ValueKey('start-duty')));
    await settle(t);

    expect(find.byKey(const ValueKey('offer-offer-mock-1')), findsOneWidget);
    // 제안이 오면 핀(+ 카드의 픽업 줄)이 보이고, 핀 위에 "도착예상 / 오후 6:48" 이 뜬다.
    expect(find.text('픽업'), findsWidgets);
    expect(find.byKey(const ValueKey('pin-eta-픽업')), findsOneWidget);
    expect(find.byKey(const ValueKey('pin-eta-전달')), findsOneWidget);
    expect(find.textContaining('도착예상'), findsWidgets);
  });

  testWidgets('AI 추천 배차 모드에는 거절 버튼이 있고, 상세 화면에서도 수락할 수 있다', (t) async {
    repo = MockOfferRepository(
      latency: Duration.zero,
      mode: DispatchMode.aiRecommended,
    );
    await start(t);
    expect(find.byKey(const ValueKey('reject-offer-mock-1')), findsOneWidget);

    await t.tap(find.byKey(const ValueKey('offer-detail-offer-mock-1')));
    await t.pumpAndSettle(const Duration(milliseconds: 50));
    // 상세(레퍼런스 image 12): 픽업지 → 전달지 → 주문정보 → 배달정보(맨 아래).
    // 가게전화연결은 픽업지 칸, 고객전화연결은 전달지 칸 안(주소 밑)에 있다.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('pickup-place')),
        matching: find.byKey(const ValueKey('call-store')),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('drop-place')),
        matching: find.byKey(const ValueKey('call-customer-locked')),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('drop-place')),
        matching: find.text('부산진구 전포동'),
      ),
      findsOneWidget,
    );
    // 고객 연락처는 픽업 뒤에 열린다 — 수락 전에는 잠긴 버튼과 안내만.
    expect(find.byKey(const ValueKey('call-customer')), findsNothing);
    expect(find.text('고객 연락처는 픽업한 뒤에 열려요'), findsOneWidget);

    final scroll = find.byType(Scrollable).first;
    final order = find.byKey(const ValueKey('order-info'));
    await t.scrollUntilVisible(order, 300, scrollable: scroll);
    // 주문번호 8자리.
    expect(find.textContaining('48213075'), findsOneWidget);
    expect(
      t.getTopLeft(find.byKey(const ValueKey('drop-place'))).dy,
      lessThan(t.getTopLeft(order).dy),
    );
    final info = find.byKey(const ValueKey('delivery-info'));
    await t.scrollUntilVisible(info, 300, scrollable: scroll);
    expect(t.getTopLeft(order).dy, lessThan(t.getTopLeft(info).dy));

    await t.tap(find.byKey(const ValueKey('accept-offer-mock-1')));
    await t.pumpAndSettle(const Duration(milliseconds: 50));

    expect(find.byKey(const ValueKey('delivery-dlv-1')), findsOneWidget);
  });

  testWidgets('로그인하지 않으면 로그인 화면이고, 목 로그인 뒤 홈으로 간다', (t) async {
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          offerRepositoryProvider.overrideWithValue(repo),
          dutyRepositoryProvider.overrideWithValue(repo),
          deliveryRepositoryProvider.overrideWithValue(
            MockDeliveryRepository(latency: Duration.zero, seeded: false),
          ),
        ],
        child: const RiderApp(),
      ),
    );
    await settle(t);
    expect(find.byKey(const ValueKey('login-google')), findsOneWidget);
    expect(find.byKey(const ValueKey('new-dispatch')), findsNothing);

    await t.tap(find.byKey(const ValueKey('login-google')));
    await settle(t);

    expect(find.byKey(const ValueKey('new-dispatch')), findsOneWidget);
  });

  testWidgets('처음 로그인한 계정은 가입 화면으로 가고, 가입을 마치면 홈으로 간다', (t) async {
    t.view
      ..physicalSize = const Size(800, 2000)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final signups = MockSignupRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          offerRepositoryProvider.overrideWithValue(repo),
          dutyRepositoryProvider.overrideWithValue(repo),
          deliveryRepositoryProvider.overrideWithValue(
            MockDeliveryRepository(latency: Duration.zero, seeded: false),
          ),
          signupRepositoryProvider.overrideWithValue(signups),
          addressSearchProvider.overrideWithValue(
            (_) async => const PickedAddress(
              roadAddress: '부산 부산진구 동천로 109',
              label: '부산 부산진구 동천로 109',
            ),
          ),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> tap(String key) async {
      await t.tap(find.byKey(ValueKey(key)));
      await t.pumpAndSettle(const Duration(milliseconds: 50));
    }

    await t.pumpAndSettle(const Duration(milliseconds: 50));
    await tap('login-apply');
    await tap('signup-start');
    // 미가입 계정은 홈이 아니라 가입 화면이다.
    expect(find.byKey(const ValueKey('new-dispatch')), findsNothing);
    for (final c in SignupOptions.consents.where((c) => c.required)) {
      await t.tap(find.byKey(ValueKey('consent-${c.type}')));
    }
    await t.pump();
    await tap('signup-next');
    // 휴대폰 번호는 "인증하기"(중복 확인)를 통과해야 다음으로 간다.
    bool canNext() =>
        t
            .widget<RiderButton>(find.byKey(const ValueKey('signup-next')))
            .onPressed !=
        null;
    // 이름은 자음·모음만으로는 안 된다(완성된 글자로).
    await t.enterText(find.byKey(const ValueKey('signup-name')), 'ㅎㄱㄷ');
    await t.pump();
    expect(find.text('이름을 다시 확인해주세요'), findsOneWidget);
    await t.enterText(find.byKey(const ValueKey('signup-name')), '홍길동');
    await t.pump();
    expect(find.text('이름을 다시 확인해주세요'), findsNothing);
    await t.enterText(
      find.byKey(const ValueKey('signup-phone')),
      '01011112222', // 이미 가입된 번호(목)
    );
    await t.pump();
    expect(canNext(), isFalse, reason: '인증 전');
    await tap('phone-check');
    expect(find.text('이미 가입된 번호예요. 다른 번호를 입력해 주세요'), findsOneWidget);
    expect(canNext(), isFalse);
    await t.enterText(
      find.byKey(const ValueKey('signup-phone')),
      '01012345678',
    );
    await t.pump();
    expect(
      find.text('인증하기를 눌러 가입할 수 있는 번호인지 확인해 주세요'),
      findsOneWidget,
      reason: '번호를 바꾸면 다시 인증',
    );
    await tap('phone-check');
    expect(find.text('가입할 수 있는 번호예요'), findsOneWidget);
    expect(canNext(), isTrue);
    await tap('signup-next');

    // 예금주가 본인 이름과 다르면 넘어갈 수 없다.
    await tap('signup-bank');
    await tap('bank-국민은행');
    await t.enterText(
      find.byKey(const ValueKey('signup-account')),
      '1111222233', // 이미 등록된 계좌(목)
    );
    await t.enterText(find.byKey(const ValueKey('signup-holder')), '김다른');
    await t.pump();
    final next = find.byKey(const ValueKey('signup-next'));
    expect(t.widget<RiderButton>(next).onPressed, isNull);
    expect(find.text('예금주가 가입자 이름과 같아야 해요'), findsOneWidget);
    await t.enterText(find.byKey(const ValueKey('signup-holder')), '홍 길동');
    await t.pump();
    // 계좌도 "인증하기"(중복 확인)를 통과해야 한다.
    expect(t.widget<RiderButton>(next).onPressed, isNull, reason: '계좌 인증 전');
    await tap('account-check');
    expect(find.text('이미 등록된 계좌예요. 다른 계좌를 입력해 주세요'), findsOneWidget);
    expect(t.widget<RiderButton>(next).onPressed, isNull);
    await t.enterText(
      find.byKey(const ValueKey('signup-account')),
      '1234567890',
    );
    await t.pump();
    expect(
      find.text('인증하기를 눌러 등록할 수 있는 계좌인지 확인해 주세요'),
      findsOneWidget,
      reason: '번호를 바꾸면 다시 인증',
    );
    await tap('account-check');
    expect(find.text('등록할 수 있는 계좌예요'), findsOneWidget);
    expect(t.widget<RiderButton>(next).onPressed, isNotNull);
    await tap('signup-next');

    // 거주지는 주소 검색으로 고른 주소만(직접 입력 칸이 없다).
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('signup-road')),
        matching: find.byType(TextField),
      ),
      findsNothing,
    );
    await tap('signup-road');
    expect(find.text('부산 부산진구 동천로 109'), findsOneWidget);
    await tap('signup-area');
    await tap('area-gyeongsang');
    await tap('area-confirm');
    await tap('area-부산진구지점');
    await tap('area-confirm');
    await tap('signup-vehicle');
    await tap('vehicle-motorcycle');
    // 오토바이는 면허 필수 — 면허 없이 다음으로 갈 수 없다.
    expect(find.text('운전면허 번호 (필수)'), findsOneWidget);
    expect(t.widget<RiderButton>(next).onPressed, isNull);

    // 면허를 넣으면 중복확인을 통과해야 한다.
    await t.enterText(
      find.byKey(const ValueKey('signup-license')),
      '11-22-333333-44',
    );
    await t.pump();
    expect(t.widget<RiderButton>(next).onPressed, isNull);
    await tap('license-check');
    expect(find.text('이미 다른 라이더가 등록한 면허예요'), findsOneWidget);
    expect(t.widget<RiderButton>(next).onPressed, isNull);
    await t.enterText(
      find.byKey(const ValueKey('signup-license')),
      '11-22-333333-55',
    );
    await t.pump();
    await tap('license-check');
    expect(find.text('등록할 수 있는 면허예요'), findsOneWidget);
    // 배달료를 확인하고 동의해야 완료(레퍼런스 image 41).
    expect(t.widget<RiderButton>(next).onPressed, isNull);
    await t.ensureVisible(find.byKey(const ValueKey('fee-guide')));
    await tap('fee-guide');
    expect(find.byKey(const ValueKey('fee-guide-screen')), findsOneWidget);
    expect(find.textContaining('2,600'), findsWidgets);
    await tap('fee-agree');
    expect(t.widget<RiderButton>(next).onPressed, isNotNull);
    await tap('signup-next');

    expect(signups.submitted?.phone, '01012345678');
    expect(signups.submitted?.vehicle, Vehicle.motorcycle);
    expect(signups.submitted?.area?.mfcId, 'MFC-BSJ-01');
    expect(signups.submitted?.roadAddress, '부산 부산진구 동천로 109');
    expect(signups.submitted?.licenseChecked, isTrue);
    expect(find.text('시작하기'), findsOneWidget);

    await tap('signup-finish');
    expect(find.byKey(const ValueKey('new-dispatch')), findsOneWidget);
  });

  testWidgets('제안 상세를 열면 서버에 열람을 알린다', (t) async {
    await start(t);
    await t.tap(find.byKey(const ValueKey('offer-detail-offer-mock-1')));
    await t.pumpAndSettle(const Duration(milliseconds: 50));

    expect(repo.openedOffers, ['offer-mock-1']);
  });
}
