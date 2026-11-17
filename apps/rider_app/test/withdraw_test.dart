import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/my/data/withdrawal.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';
import 'package:rider_app/shared/rider_widgets.dart';

/// 계정 탈퇴: 진행 중 배송이 있으면 서버가 거절(409), 없으면 완료 뒤 로그아웃 → 로그인 화면.
void main() {
  setUpAll(initPmartFormatting);

  Future<void> run(
    WidgetTester t, {
    required bool busy,
    bool notImplemented = false,
  }) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: false,
    );
    if (busy) offers.assignedDeliveries.add('dlv-1');
    final deliveries = MockDeliveryRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          mockOfferRepositoryProvider.overrideWithValue(offers),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
          deliveryRepositoryProvider.overrideWithValue(deliveries),
          handoverRepositoryProvider.overrideWithValue(deliveries),
          evidenceUploaderProvider.overrideWithValue(deliveries),
          supportThreadRepositoryProvider.overrideWithValue(deliveries),
          if (notImplemented)
            withdrawalRepositoryProvider.overrideWithValue(
              MockWithdrawalRepository(busy: () => false, notImplemented: true),
            ),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 8; i++) {
        await t.pump(const Duration(milliseconds: 50));
      }
    }

    await settle();
    await t.tap(find.byKey(const ValueKey('my-page')));
    await settle();
    await t.tap(find.byKey(const ValueKey('settings'))); // 마이페이지 → 설정 → 계정탈퇴
    await settle();
    await t.ensureVisible(find.byKey(const ValueKey('withdraw')));
    await settle();
    await t.tap(find.byKey(const ValueKey('withdraw')));
    await settle();

    // 안내를 확인해야 누를 수 있다.
    final submit = find.byKey(const ValueKey('withdraw-submit'));
    expect(t.widget<RiderButton>(submit).onPressed, isNull);
    await t.tap(find.byKey(const ValueKey('withdraw-agree')));
    await settle();
    await t.tap(submit);
    await settle();
    await t.tap(find.byKey(const ValueKey('withdraw-confirm')));
    await settle();
  }

  testWidgets('진행 중 배송이 있으면 탈퇴할 수 없다', (t) async {
    await run(t, busy: true);
    expect(find.byKey(const ValueKey('withdraw-note')), findsOneWidget);
    expect(find.textContaining('지금은 탈퇴할 수 없어요'), findsOneWidget);
    expect(find.byKey(const ValueKey('login-apply')), findsNothing);
  });

  testWidgets('없으면 탈퇴가 완료되고 로그인 화면으로 간다', (t) async {
    await run(t, busy: false);
    expect(find.byKey(const ValueKey('login-apply')), findsOneWidget);
  });

  testWidgets('서버에 탈퇴 기능이 없으면(501) "다시 눌러"가 아니라 준비 중으로 안내한다', (t) async {
    await run(t, busy: false, notImplemented: true);
    expect(find.textContaining('서버 준비 중'), findsOneWidget);
    expect(find.textContaining('다시 눌러 주세요'), findsNothing);
    expect(find.byKey(const ValueKey('login-apply')), findsNothing);
  });

  test('거절 사유 글자 → 화면 문구 분류', () {
    expect(
      blockerFromWire('ACTIVE_DELIVERY'),
      WithdrawalBlocker.activeDelivery,
    );
    expect(blockerFromWire('UNSETTLED_EARNINGS'), WithdrawalBlocker.unsettled);
    expect(
      blockerFromWire('RESTRICTION_REVIEW'),
      WithdrawalBlocker.restrictionReview,
    );
    expect(blockerFromWire('SOMETHING'), WithdrawalBlocker.other);
  });
}
