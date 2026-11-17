import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/data/delivery_list_repository.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/domain/offer_list.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';

void main() {
  setUpAll(initPmartFormatting);

  Future<void> open(WidgetTester t, DispatchMode mode) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(latency: Duration.zero, mode: mode);
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
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
          deliveryListRepositoryProvider.overrideWithValue(
            MockDeliveryListRepository(latency: Duration.zero),
          ),
          deliveryRepositoryProvider.overrideWithValue(deliveries),
          handoverRepositoryProvider.overrideWithValue(deliveries),
          evidenceUploaderProvider.overrideWithValue(deliveries),
          supportThreadRepositoryProvider.overrideWithValue(deliveries),
        ],
        child: const RiderApp(),
      ),
    );
    for (var i = 0; i < 6; i++) {
      await t.pump(const Duration(milliseconds: 20));
    }
    await t.tap(find.byKey(const ValueKey('delivery-list')));
    for (var i = 0; i < 6; i++) {
      await t.pump(const Duration(milliseconds: 20));
    }
  }

  testWidgets('일반 배차모드: 배달리스트는 대기 탭이 먼저(왼쪽) 열린다', (t) async {
    await open(t, DispatchMode.normal);
    final waitingTab = find.byKey(const ValueKey('list-tab-1'));
    final activeTab = find.byKey(const ValueKey('list-tab-0'));
    expect(t.getTopLeft(waitingTab).dx, lessThan(t.getTopLeft(activeTab).dx));
    // 대기 목록이 바로 보인다(진행 목록 안내 띠는 없다).
    expect(
      find.byWidgetPredicate(
        (w) =>
            w.key is ValueKey<String> &&
            (w.key! as ValueKey<String>).value.startsWith('waiting-'),
      ),
      findsWidgets,
    );
    // 수락해도 대기 목록에 머물러 이어서 다른 배송을 수락할 수 있다(진행으로 넘어가지 않는다).
    final activeLabelBefore = t
        .widget<Text>(
          find.descendant(of: activeTab, matching: find.byType(Text)),
        )
        .data;
    await t.tap(find.byKey(const ValueKey('waiting-accept-dlv-l1')));
    for (var i = 0; i < 10; i++) {
      await t.pump(const Duration(milliseconds: 20));
    }
    expect(find.byKey(const ValueKey('waiting-dlv-l1')), findsNothing);
    expect(
      find.byKey(const ValueKey('waiting-accept-dlv-l2')),
      findsOneWidget,
      reason: '대기 탭 그대로 — 다음 배송도 수락할 수 있다',
    );
    final activeLabelAfter = t
        .widget<Text>(
          find.descendant(of: activeTab, matching: find.byType(Text)),
        )
        .data;
    expect(activeLabelAfter, isNot(activeLabelBefore), reason: '진행 수가 늘어난다');

    // 진행 탭을 누르면 진행 목록.
    await t.tap(activeTab);
    for (var i = 0; i < 6; i++) {
      await t.pump(const Duration(milliseconds: 20));
    }
    expect(find.byKey(const ValueKey('waiting-empty')), findsNothing);
    await t.pump(const Duration(seconds: 2));
  });

  testWidgets('AI 추천 배차모드: 대기 탭 없이 진행 목록', (t) async {
    await open(t, DispatchMode.aiRecommended);
    expect(find.byKey(const ValueKey('list-tab-1')), findsNothing);
    await t.pump(const Duration(seconds: 2));
  });
}
