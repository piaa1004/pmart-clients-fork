import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_api_delivery_dispatch/pmart_api_delivery_dispatch.dart'
    as dp;
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/delivery_repository.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/data/offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';
import 'package:rider_app/shared/rider_widgets.dart';

/// 회수 배송 한 벌(백엔드 요청 2026-11-17): 회수지에서 받음(사진) → MFC 반납. 반품·오배송은 문구만 다르다.
void main() {
  setUpAll(initPmartFormatting);

  test('계약 → 화면 모델: RETURN 이면 목적, 받을 품목 이름은 서버 값 그대로', () {
    expect(
      recoveryPurposeFrom(type: 'RETURN', purpose: 'CLAIM_RETURN'),
      RecoveryPurpose.claimReturn,
    );
    expect(
      recoveryPurposeFrom(type: 'RETURN', purpose: 'MISDELIVERY_RECOVERY'),
      RecoveryPurpose.misdeliveryRecovery,
    );
    expect(recoveryPurposeFrom(type: 'FORWARD', purpose: 'DELIVERY'), isNull);

    // 반품 회수: 서버가 채운 returnLines 이름을 그대로(순서로 짝짓지 않는다).
    final claim = deliveryFromContract(
      ex.DeliveryExecution.fromJson({
        'deliveryId': 'dlv-r',
        'type': 'RETURN',
        'purpose': 'CLAIM_RETURN',
        'state': 'ASSIGNED',
        'returnLines': [
          {'orderLineId': 'a', 'qty': 1, 'name': '바나나', 'optionLabel': '1송이'},
          {'orderLineId': 'b', 'qty': 2},
        ],
        'orderSummary': {
          'items': [
            {'orderLineId': 'b', 'name': '요거트', 'qty': 2},
            {'orderLineId': 'a', 'name': '바나나', 'qty': 1},
          ],
        },
      }),
    );
    expect(claim.isRecovery, isTrue);
    expect(claim.returnLines.map((l) => (l.name, l.qty)), [
      ('바나나 1송이', 1),
      (null, 2),
    ]);

    // 반품 줄이 없는 회수(오배송): 원래 주문 품목 전부.
    final misdelivery = deliveryFromContract(
      ex.DeliveryExecution.fromJson({
        'deliveryId': 'dlv-m',
        'type': 'RETURN',
        'purpose': 'MISDELIVERY_RECOVERY',
        'state': 'ASSIGNED',
        'orderSummary': {
          'items': [
            {'name': '요거트', 'qty': 3},
          ],
        },
      }),
    );
    expect(misdelivery.returnLines.single, (name: '요거트', qty: 3));
    final offers = offerListFromContract(
      dp.ListMyOffers200Response.fromJson({
        'items': [
          {
            'offerId': 'o1',
            'deliveryType': 'RETURN',
            'purpose': 'MISDELIVERY_RECOVERY',
          },
          {'offerId': 'o2', 'deliveryType': 'FORWARD', 'purpose': 'DELIVERY'},
        ],
      }),
    );
    expect(offers.offers.first.recovery, RecoveryPurpose.misdeliveryRecovery);
    expect(offers.offers.last.recovery, isNull);
  });

  testWidgets('반품 회수: 사진 → 회수했어요 → MFC 반납 → 반납완료, 일반 단계 버튼은 없다', (t) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final repo = MockDeliveryRepository(
      latency: Duration.zero,
      demoBundle: true,
      visible: (id) => id == 'dlv-r1',
    );
    final offers = MockOfferRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          deliveryRepositoryProvider.overrideWithValue(repo),
          handoverRepositoryProvider.overrideWithValue(repo),
          evidenceUploaderProvider.overrideWithValue(repo),
          supportThreadRepositoryProvider.overrideWithValue(repo),
          mockOfferRepositoryProvider.overrideWithValue(offers),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 12; i++) {
        await t.pump(const Duration(milliseconds: 25));
      }
    }

    await settle();
    await t.tap(find.byKey(const ValueKey('delivery-dlv-r1')));
    await settle();

    // 받기 전: 회수지로(반품 회수 — 고객 집 주소가 있다).
    expect(find.text('회수지로 이동해주세요'), findsOneWidget);
    expect(find.byKey(const ValueKey('recovery-purpose')), findsOneWidget);
    expect(find.text('부산 부산진구 가야대로 482 가야 푸른아파트 105동 702호'), findsWidgets);
    expect(find.byKey(const ValueKey('arrive-store')), findsNothing);
    expect(find.byKey(const ValueKey('qr-pickup')), findsNothing);

    // 받기 전 반품 회수는 지원센터에서 "받을 수 없어요" 갈림길이 있다(실패 등록 — 계약 0.10.0).
    await t.tap(find.byKey(const ValueKey('help')));
    await settle();
    await t.tap(find.byKey(const ValueKey('help-customerUnreachable')));
    await settle();
    expect(find.byKey(const ValueKey('failure-fork')), findsOneWidget);
    expect(find.byKey(const ValueKey('cancel-assignment')), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await settle();

    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await settle();
    expect(find.text('그릭요거트 플레인 400g × 1'), findsOneWidget);
    expect(find.text('바나나 1송이 × 2'), findsOneWidget);

    // 사진을 올려야 "회수했어요".
    final pickup = find.byKey(const ValueKey('return-pickup'));
    expect(t.widget<RiderButton>(pickup).onPressed, isNull);
    await t.ensureVisible(find.byKey(const ValueKey('take-photo')));
    await t.tap(find.byKey(const ValueKey('take-photo')));
    await settle();
    expect(t.widget<RiderButton>(pickup).onPressed, isNotNull);
    await t.tap(pickup);
    await settle();
    expect(repo.deliveryJson('dlv-r1')['state'], 'RETURN_PICKED_UP');
    expect(find.text('MFC로 반납하러 가주세요'), findsOneWidget);

    // MFC 반납 → 직원 인증번호(목, 백엔드 요청 중). 틀리면 반납되지 않고 알린다.
    await t.tap(find.byKey(const ValueKey('return-store')));
    await settle();
    await t.enterText(find.byKey(const ValueKey('return-code')), '1111');
    await settle();
    await t.tap(find.byKey(const ValueKey('return-store-confirm')));
    await settle();
    expect(repo.deliveryJson('dlv-r1')['state'], 'RETURN_PICKED_UP');
    expect(find.text('인증번호가 맞지 않아요. MFC 직원에게 번호를 다시 확인해 주세요'), findsOneWidget);
    // 알림이 아래 버튼 위에 떠서 바로 다시 누를 수 있다(가리지 않음).
    await t.tap(find.byKey(const ValueKey('return-store')));
    await settle();
    await t.enterText(
      find.byKey(const ValueKey('return-code')),
      ReturnHandoverCode.mockCode,
    );
    await settle();
    await t.tap(find.byKey(const ValueKey('return-store-confirm')));
    await settle();
    expect(repo.deliveryJson('dlv-r1')['state'], 'RETURNED_TO_STORE');
    expect(find.byKey(const ValueKey('delivery-done')), findsOneWidget);
    expect(find.text('반납완료'), findsOneWidget);
  });

  test('failure.returnBy: OTHER_RIDER 면 다른 라이더 반납, SAME_RIDER·없음이면 아님(execution 0.31.1)', () {
    DeliveryView of(String? returnBy) => deliveryFromContract(
      ex.DeliveryExecution.fromJson({
        'deliveryId': 'dlv-1',
        'state': 'FAILED',
        'failure': {
          'decision': 'CONFIRM',
          'custody': 'RIDER',
          'returnDeliveryId': 'ret-1',
          'returnBy': ?returnBy,
        },
      }),
    );
    expect(of('OTHER_RIDER').returnByOtherRider, isTrue);
    expect(of('SAME_RIDER').returnByOtherRider, isFalse);
    expect(
      of(null).returnByOtherRider,
      isFalse,
      reason: '옛 응답 — 404 확인으로 넘어간다',
    );
  });

  test('확정 필드: decision CONFIRM·custody·returnDeliveryId, purpose FAILED_DELIVERY_RETURN 은 바로 반납', () {
    final failed = deliveryFromContract(
      ex.DeliveryExecution.fromJson({
        'deliveryId': 'dlv-1',
        'state': 'FAILED',
        'failure': {'decision': 'CONFIRM', 'custody': 'STORE'},
      }),
    );
    expect(failed.failureConfirmed, isTrue);
    expect(failed.goodsWithRider, isFalse);
    expect(failed.returnDeliveryId, isNull);
    final ret = deliveryFromContract(
      ex.DeliveryExecution.fromJson({
        'deliveryId': 'ret-1',
        'type': 'RETURN',
        'purpose': 'FAILED_DELIVERY_RETURN',
        'state': 'ASSIGNED',
        'orderSummary': {
          'items': [
            {'name': '요거트', 'qty': 3},
          ],
        },
      }),
    );
    expect(ret.directReturn, isTrue);
    expect(ret.returnLines.single, (name: '요거트', qty: 3));
  });

  testWidgets('전달 불가 확정(상품은 라이더) → 같은 라이더에게 반납 배송 → 받음 없이 MFC 반납', (t) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    var now = DateTime.utc(2026, 11, 17, 10);
    final repo = MockDeliveryRepository(
      latency: Duration.zero,
      clock: () => now,
    );
    // 전달 불가 신고가 접수된 상태(실패 등록이 연 대화 req-f1).
    repo.seedFailureReport('dlv-1', 'req-f1');
    final offers = MockOfferRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          deliveryRepositoryProvider.overrideWithValue(repo),
          handoverRepositoryProvider.overrideWithValue(repo),
          evidenceUploaderProvider.overrideWithValue(repo),
          supportThreadRepositoryProvider.overrideWithValue(repo),
          mockOfferRepositoryProvider.overrideWithValue(offers),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 12; i++) {
        await t.pump(const Duration(milliseconds: 25));
      }
    }

    Future<void> waitToast() async {
      // 안내(SnackBar)가 사라질 때까지 — 한 번에 크게 넘기면 애니메이션이 안 끝난다.
      for (var i = 0; i < 30; i++) {
        await t.pump(const Duration(milliseconds: 250));
      }
    }

    await settle();
    await t.tap(find.byKey(const ValueKey('delivery-dlv-1')));
    await settle();
    expect(find.byKey(const ValueKey('failure-waiting')), findsOneWidget);

    // 지원센터 확정(목: 45초 동안 재개 요청 없음) → 배송 화면이 다시 읽어 안다.
    now = now.add(MockDeliveryRepository.confirmAfter);
    await t.pump(const Duration(seconds: 8));
    await settle();
    expect(repo.deliveryJson('dlv-1')['state'], 'FAILED');
    expect(find.byKey(const ValueKey('failure-confirmed')), findsOneWidget);

    // 몇 초 뒤 반납 배송이 같은 라이더에게 → 그 회수 화면으로 넘어간다.
    now = now.add(MockDeliveryRepository.returnAssignAfter);
    await t.pump(const Duration(seconds: 8));
    await settle();
    expect(find.text('MFC로 반납하러 가주세요'), findsOneWidget);
    expect(find.byKey(const ValueKey('recovery-purpose')), findsOneWidget);
    expect(find.byKey(const ValueKey('return-pickup')), findsNothing);

    await waitToast();
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await settle();
    await t.tap(find.byKey(const ValueKey('return-store')));
    await settle();
    await t.enterText(
      find.byKey(const ValueKey('return-code')),
      ReturnHandoverCode.mockCode,
    );
    await settle();
    await t.tap(find.byKey(const ValueKey('return-store-confirm')));
    await settle();
    expect(repo.deliveryJson('ret-dlv-1')['state'], 'RETURNED_TO_STORE');
    expect(find.text('반납완료'), findsOneWidget);
  });

  testWidgets(
    '다른 라이더가 반납(OTHER_RIDER — 내게 404)이면 넘어가지 않고 이 화면에서 안내한다(사용자 2026-11-19 "다시 시도만 반복")',
    (t) async {
      t.view
        ..physicalSize = const Size(800, 2400)
        ..devicePixelRatio = 1;
      addTearDown(t.view.reset);
      var now = DateTime.utc(2026, 11, 17, 10);
      final repo = MockDeliveryRepository(
        latency: Duration.zero,
        clock: () => now,
      );
      // 전달 불가 신고가 접수된 상태(실패 등록이 연 대화 req-f1).
      repo
        ..seedFailureReport('dlv-1', 'req-f1')
        ..returnByOtherRider = true;
      final offers = MockOfferRepository(latency: Duration.zero);
      await t.pumpWidget(
        ProviderScope(
          retry: (_, _) => null,
          overrides: [
            envProvider.overrideWithValue(PmartEnv.mock),
            secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
            initialSessionProvider.overrideWithValue(
              const RiderSession(riderId: 'rider-mock-1'),
            ),
            deliveryRepositoryProvider.overrideWithValue(repo),
            handoverRepositoryProvider.overrideWithValue(repo),
            evidenceUploaderProvider.overrideWithValue(repo),
            supportThreadRepositoryProvider.overrideWithValue(repo),
            mockOfferRepositoryProvider.overrideWithValue(offers),
            offerRepositoryProvider.overrideWithValue(offers),
            dutyRepositoryProvider.overrideWithValue(offers),
          ],
          child: const RiderApp(),
        ),
      );
      Future<void> settle() async {
        for (var i = 0; i < 12; i++) {
          await t.pump(const Duration(milliseconds: 25));
        }
      }

      await settle();
      await t.tap(find.byKey(const ValueKey('delivery-dlv-1')));
      await settle();
      expect(find.byKey(const ValueKey('failure-waiting')), findsOneWidget);

      // 지원센터 확정(목: 45초 동안 재개 요청 없음) → 배송 화면이 다시 읽어 안다.
      now = now.add(MockDeliveryRepository.confirmAfter);
      await t.pump(const Duration(seconds: 8));
      await settle();
      expect(repo.deliveryJson('dlv-1')['state'], 'FAILED');
      expect(find.byKey(const ValueKey('failure-confirmed')), findsOneWidget);

      now = now.add(MockDeliveryRepository.returnAssignAfter);
      await t.pump(const Duration(seconds: 8));
      await settle();
      // 몇 초 기다려도(막 생긴 배송일 수 있으니) 내 배송이 아니면 넘어가지 않는다 — 오류·다시 시도 화면 없음
      for (var i = 0; i < 12; i++) {
        await t.pump(const Duration(seconds: 1));
      }
      await settle();
      expect(find.text('다시 시도'), findsNothing);
      expect(find.byKey(const ValueKey('failure-confirmed')), findsOneWidget);
      expect(find.textContaining('다른 라이더가 맡았어요'), findsWidgets);
      expect(find.byKey(const ValueKey('go-return')), findsNothing);
      expect(
        find.byKey(const ValueKey('return-elsewhere-help')),
        findsOneWidget,
      );
      for (var i = 0; i < 12; i++) {
        await t.pump(const Duration(milliseconds: 250));
      }
    },
  );
}
