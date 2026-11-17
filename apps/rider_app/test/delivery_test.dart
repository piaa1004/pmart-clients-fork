import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/delivery_repository.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/domain/delivery.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/shared/providers.dart';
import 'package:rider_app/shared/rider_widgets.dart';

void main() {
  setUpAll(initPmartFormatting);

  late MockDeliveryRepository repo;
  late MemoryKeyValueStore store;

  List<Override> overrides() => [
    envProvider.overrideWithValue(PmartEnv.mock),
    deliveryRepositoryProvider.overrideWithValue(repo),
    handoverRepositoryProvider.overrideWithValue(repo),
    evidenceUploaderProvider.overrideWithValue(repo),
    secureStoreProvider.overrideWithValue(store),
    fieldQueueStoreProvider.overrideWithValue(store),
  ];

  setUp(() {
    repo = MockDeliveryRepository(latency: Duration.zero);
    store = MemoryKeyValueStore();
  });

  test('QR 형식(BR-23 목)에서 포장 ID 를 꺼낸다', () {
    expect(packageIdFromQr(MockDeliveryRepository.qrFor('pkg-1')), 'pkg-1');
    expect(packageIdFromQr('garbage'), isNull);
  });

  group('배송 수행', () {
    late ProviderContainer c;
    late DeliveryFlowController flow;

    setUp(() {
      c = ProviderContainer(retry: (_, _) => null, overrides: overrides());
      addTearDown(c.dispose);
      c.listen(deliveryFlowProvider('dlv-1'), (_, _) {});
      flow = c.read(deliveryFlowProvider('dlv-1').notifier);
    });

    Future<DeliveryView> delivery() => repo.get('dlv-1');
    DeliveryFlowState state() => c.read(deliveryFlowProvider('dlv-1'));
    String qr(String p) => MockDeliveryRepository.qrFor(p);

    test('가게 도착 → 포장별 인계 → 전부 인계 뒤 픽업 → 고객 도착 → 사진 업로드 뒤 전달 완료', () async {
      await flow.arriveAtStore();
      var d = await delivery();
      expect(d.state, ExecutionState.arrivedAtStore);

      await flow.scan(d, qr('pkg-1'));
      expect(state().phaseOf('pkg-1').phase, HandoverPhase.handedOver);
      expect(state().handoverIds, ['hof-pkg-1']);

      await flow.scan(d, qr('pkg-2'));
      await flow.pickup();
      d = await delivery();
      expect(d.state, ExecutionState.pickedUp);
      expect(d.handoverIds.toSet(), {'hof-pkg-1', 'hof-pkg-2'});

      await flow.arriveAtCustomer();
      await flow.complete(CompletionMethod.contactless, Placement.frontDoor);
      expect(
        (await delivery()).state,
        ExecutionState.arrivedAtCustomer,
        reason: '사진 없으면 보내지 않는다',
      );

      await flow.uploadPhoto();
      await flow.complete(CompletionMethod.contactless, Placement.frontDoor);
      expect((await delivery()).state, ExecutionState.completed);
    });

    test('부분 인계로 픽업을 보내면 서버가 HANDOVER_NOT_CONFIRMED 로 거절한다', () async {
      await flow.arriveAtStore();
      await flow.scan(await delivery(), qr('pkg-1'));

      await flow.pickup();

      final items = await c.read(riderQueueProvider).items();
      final pickup = items.firstWhere(
        (i) => i.kind == DeliveryCommandKind.pickup,
      );
      expect(pickup.state, QueueItemState.rejected);
      expect(pickup.rejectCode, HandoverProblemCode.handoverNotConfirmed);
      expect((await delivery()).state, ExecutionState.arrivedAtStore);
    });

    test('다른 배송·중복·읽기 실패 QR 은 서버에 보내기 전에 막는다', () async {
      await flow.arriveAtStore();
      final d = await delivery();

      expect(await flow.scan(d, qr('pkg-x')), ScanVerdict.otherDelivery);
      expect(await flow.scan(d, 'abc'), ScanVerdict.unreadable);
      await flow.scan(d, qr('pkg-1'));
      expect(await flow.scan(d, qr('pkg-1')), ScanVerdict.duplicate);
    });

    test('재포장으로 무효가 된 구 라벨은 서버가 거절한다', () async {
      await flow.arriveAtStore();
      repo.invalidatedQrs.add(qr('pkg-1'));

      await flow.scan(await delivery(), qr('pkg-1'));

      expect(state().phaseOf('pkg-1').phase, HandoverPhase.rejected);
      expect(
        state().phaseOf('pkg-1').rejectCode,
        HandoverProblemCode.packageInvalidated,
      );
    });

    test('커밋 응답이 불명이면 판정 조회로 인계 완료를 확인한다(다시 스캔 안 함)', () async {
      await flow.arriveAtStore();
      repo.commitMode = MockCommit.unknownButApplied;

      await flow.scan(await delivery(), qr('pkg-1'));

      expect(state().phaseOf('pkg-1').phase, HandoverPhase.handedOver);
      expect(state().phaseOf('pkg-1').handoverId, 'hof-pkg-1');
    });

    test('fence 불명이 계속되면 확인 중이고, 서버 확정 뒤 다시 확인으로 인계 완료가 된다', () async {
      await flow.arriveAtStore();
      repo.commitMode = MockCommit.unknownStillInProgress;
      await flow.scan(await delivery(), qr('pkg-1'));

      expect(state().phaseOf('pkg-1').phase, HandoverPhase.checking);
      expect(state().handoverIds, isEmpty, reason: '불명은 인계 완료가 아니다');
      final keys = repo.commitKeys.toSet();
      expect(keys, hasLength(1), reason: '불명 재전송은 같은 키');

      repo.settleInProgress();
      await flow.checkAgain('pkg-1');

      expect(state().phaseOf('pkg-1').phase, HandoverPhase.handedOver);
    });

    test('출고가 중지된 포장은 중지로 보인다', () async {
      await flow.arriveAtStore();
      repo.stoppedPackages.add('pkg-2');

      await flow.scan(await delivery(), qr('pkg-2'));
      await flow.resolve('pkg-2');

      expect(state().phaseOf('pkg-2').phase, HandoverPhase.stopped);
    });

    test('오프라인 수행 명령은 저장됐다가 같은 키로 다시 보낸다', () async {
      repo.offline = true;
      await flow.arriveAtStore();
      final saved = await FieldQueue(store, name: 'rider').items();
      expect(saved.single.state, QueueItemState.queued);
      expect((await delivery()).state, ExecutionState.assigned);

      repo.offline = false;
      await flow.sync();

      expect(repo.sentKeys, [saved.single.id, saved.single.id]);
      expect((await delivery()).state, ExecutionState.arrivedAtStore);
      expect(
        (await c.read(riderQueueProvider).items()).single.state,
        QueueItemState.applied,
      );
    });

    test('사진 업로드 실패는 실패로 보이고 전달 완료를 보내지 않는다', () async {
      repo.uploadFails = true;
      await flow.uploadPhoto();
      expect(state().uploadFailed, isTrue);
      expect(state().photoRef, isNull);
    });
  });

  testWidgets('홈에서 배송 → 가게 도착 → QR 2개 인계 → 픽업 → 전달 완료', (t) async {
    t.view
      ..physicalSize = const Size(800, 2000)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          ...overrides(),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 6; i++) {
        await t.pump(const Duration(milliseconds: 20));
      }
    }

    await settle();
    // 다른 제안이 와 있으면 제안 카드 위 '진행 중 배송' 한 줄을 눌러 들어간다.
    await t.tap(find.byKey(const ValueKey('delivery-dlv-1')));
    await settle();
    expect(find.text('픽업지로 이동해주세요'), findsOneWidget);

    // 기본 화면(레퍼런스 image 14): 예정·장소·도움요청|길찾기만. 배달 정보·진행 버튼은 펼쳐야 보인다.
    final screenBottom = t.view.physicalSize.height / t.view.devicePixelRatio;
    expect(find.byKey(const ValueKey('help')).hitTestable(), findsOneWidget);
    expect(
      find.byKey(const ValueKey('navigate')).hitTestable(),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('arrive-store')), findsNothing);
    expect(
      t.getTopLeft(find.byKey(const ValueKey('mart-info'))).dy,
      greaterThanOrEqualTo(screenBottom - 1),
    );

    // 아래 시트: 회색바를 누르면 펼쳐지고(배달 정보), 다시 누르면 접힌다.
    final peek = t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy;
    expect(find.text('누르거나 위로 올려 배달 정보 보기'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400)); // 펼치는 애니메이션
    final opened = t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy;
    expect(opened, lessThan(peek - 100));
    expect(find.text('눌러서 지도 보기'), findsOneWidget);
    // 펼치면 배달 정보와 진행 버튼(가게 도착)이 보인다.
    expect(
      t.getTopLeft(find.byKey(const ValueKey('mart-info'))).dy,
      lessThan(screenBottom - 100),
    );
    expect(find.byKey(const ValueKey('arrive-store')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400)); // 접히는 애니메이션
    expect(
      t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy,
      closeTo(peek, 1),
    );
    // 위로 끌어 올리면 올린 만큼 펼쳐지고 그대로 머문다(되돌아가지 않는다).
    await t.drag(
      find.byKey(const ValueKey('sheet-handle')),
      const Offset(0, -300),
    );
    await settle();
    final dragged = t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy;
    expect(dragged, lessThan(peek - 200));
    // 끝까지 올리면 "눌러서 지도 보기".
    await t.drag(
      find.byKey(const ValueKey('sheet-handle')),
      const Offset(0, -800),
    );
    await settle();
    expect(find.text('눌러서 지도 보기'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    expect(
      t.getTopLeft(find.byKey(const ValueKey('sheet-handle'))).dy,
      closeTo(peek, 1),
    );
    expect(find.byKey(const ValueKey('arrive-store')), findsNothing);

    // 펼쳐서 진행한다(이 화면에 있는 동안 펼친 채로 둔다).
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await t.pump();
    await t.pump(const Duration(milliseconds: 400));
    await t.tap(find.byKey(const ValueKey('arrive-store')));
    await settle();
    // 가게 도착 뒤 배송 화면에는 포장 인계 상자(0 / 2·포장별 QR)를 두지 않는다 — QR 픽업 화면에서 본다.
    expect(find.byKey(const ValueKey('handover-progress')), findsNothing);
    expect(find.byKey(const ValueKey('pkg-pkg-1')), findsNothing);

    // 주문정보: 8자리 주문번호 · 한글 지점명 · 품목 · 요청사항. 거절 코드·전송확인 버튼은 없다.
    expect(find.byKey(const ValueKey('order-info')), findsOneWidget);
    expect(find.text('PMart 부산진구지점'), findsWidgets);
    // 고객앱 목의 진행 중 주문과 같은 품목.
    expect(find.textContaining('그릭요거트 플레인 400g'), findsOneWidget);
    expect(find.textContaining('INVALID_STATE'), findsNothing);
    expect(find.byKey(const ValueKey('sync')), findsNothing);

    // QR코드 픽업 화면(시험에는 카메라가 없어 숫자 입력 칸이 바로 보인다)
    await t.tap(find.byKey(const ValueKey('qr-pickup')));
    await settle();

    Future<void> enterNumber(String digits) async {
      await t.enterText(find.byKey(const ValueKey('qr-number')), digits);
      await t.tap(find.byKey(const ValueKey('qr-number-submit')));
      await settle();
    }

    final pickup = find.byKey(const ValueKey('pickup'));
    await enterNumber('9999');
    expect(find.text('이 배달의 포장 숫자가 아니에요. 다시 확인해 주세요'), findsOneWidget);
    await enterNumber(MockDeliveryRepository.labelNumbers['pkg-1']!);
    expect(find.text('포장 인계 1 / 2'), findsOneWidget);
    expect(find.byKey(const ValueKey('partial-handover')), findsOneWidget);
    expect(t.widget<RiderButton>(pickup).onPressed, isNull);

    await enterNumber(MockDeliveryRepository.labelNumbers['pkg-2']!);
    expect(t.widget<RiderButton>(pickup).onPressed, isNotNull);
    await t.tap(pickup);
    await settle();
    expect(find.text('전달지로 이동해주세요'), findsOneWidget);
    expect(find.text('부산 부산진구 전포대로 210'), findsWidgets);
    expect(find.byKey(const ValueKey('drop-card')), findsOneWidget);
    expect(find.byKey(const ValueKey('request-notes')), findsOneWidget);
    expect(find.byKey(const ValueKey('due-time')), findsOneWidget);
    // 고객도착 단계 버튼 없이 바로 전달완료.
    expect(find.byKey(const ValueKey('arrive-customer')), findsNothing);

    // 사진을 올리기 전에는 전달완료를 누를 수 없다.
    final complete = find.byKey(const ValueKey('complete'));
    expect(t.widget<RiderButton>(complete).onPressed, isNull);

    // "'여기에 두었어요' 알리기" → 촬영하기 창(열 때 고객 도착을 앱이 대신 보낸다) → 올리면 닫힌다.
    expect(find.text('‘여기에 두었어요’ 알리기'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('photo')));
    await settle();
    expect(repo.deliveryJson('dlv-1')['state'], 'ARRIVED_AT_CUSTOMER');
    await t.tap(find.byKey(const ValueKey('upload-photo')));
    await settle();
    await settle();
    expect(find.byKey(const ValueKey('upload-photo')), findsNothing);
    expect(find.text('사진 올리기 완료 (다시 찍기)'), findsOneWidget);

    // 다시 찍으러 들어가면 이전 사진이 크게 보인다.
    await t.tap(find.byKey(const ValueKey('photo')));
    await settle();
    expect(find.byKey(const ValueKey('photo-preview')), findsOneWidget);
    expect(find.text('다시 찍기'), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await settle();

    // 전달완료 → "고객님께 어떻게 전달하셨나요?" → 다음.
    expect(t.widget<RiderButton>(complete).onPressed, isNotNull);
    await t.tap(complete);
    await settle();
    expect(find.text('고객님께 어떻게\n전달하셨나요?'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('complete-confirm')));
    await settle();
    expect(find.byKey(const ValueKey('delivery-done')), findsOneWidget);
  });

  group('배차취소', () {
    test('픽업 전에는 접수되고 진행 목록에서 빠진다', () async {
      expect(
        await repo.cancel('dlv-1', key: IdempotencyKey.generate()),
        CancelOutcome.accepted,
      );
      expect(await repo.myActive(), isEmpty);
    });

    test('픽업 뒤에는 배차취소가 아니라 지원센터 안내다', () async {
      repo.deliveryJson('dlv-1')['state'] = 'PICKED_UP';
      expect(
        await repo.cancel('dlv-1', key: IdempotencyKey.generate()),
        CancelOutcome.pickedUpCaseRequired,
      );
      expect((await repo.get('dlv-1')).state, ExecutionState.pickedUp);
    });
  });

  testWidgets('수행 화면에서 배차취소를 접수하면 홈으로 돌아간다', (t) async {
    t.view
      ..physicalSize = const Size(800, 2000)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final offers = MockOfferRepository(latency: Duration.zero);
    await t.pumpWidget(
      ProviderScope(
        retry: (_, _) => null,
        overrides: [
          ...overrides(),
          assignmentCancelRepositoryProvider.overrideWithValue(repo),
          initialSessionProvider.overrideWithValue(
            const RiderSession(riderId: 'rider-mock-1'),
          ),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
        ],
        child: const RiderApp(),
      ),
    );
    Future<void> settle() async {
      for (var i = 0; i < 6; i++) {
        await t.pump(const Duration(milliseconds: 20));
      }
    }

    await settle();
    // 다른 제안이 와 있으면 제안 카드 위 '진행 중 배송' 한 줄을 눌러 들어간다.
    await t.tap(find.byKey(const ValueKey('delivery-dlv-1')));
    await settle();
    // 배차취소는 도움요청 메뉴 안에 있다.
    await t.tap(find.byKey(const ValueKey('help')));
    await settle();
    await t.tap(find.byKey(const ValueKey('cancel-assignment')));
    await settle();
    // 반복 배차취소 안내는 취소를 고르는 창에 보인다.
    expect(find.byKey(const ValueKey('cancel-penalty-notice')), findsOneWidget);
    expect(find.textContaining('제안 순서가 뒤로 밀리고'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('cancel-assignment-confirm')));
    await settle();

    expect(repo.cancelKeys, hasLength(1));
    expect(find.text('배차취소를 접수했어요'), findsOneWidget);
    expect(find.byKey(const ValueKey('delivery-dlv-1')), findsNothing);
  });
}
