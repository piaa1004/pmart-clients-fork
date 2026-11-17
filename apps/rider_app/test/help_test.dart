import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
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
  late DateTime now;

  List<Override> overrides() => [
    envProvider.overrideWithValue(PmartEnv.mock),
    deliveryRepositoryProvider.overrideWithValue(repo),
    handoverRepositoryProvider.overrideWithValue(repo),
    evidenceUploaderProvider.overrideWithValue(repo),
    supportThreadRepositoryProvider.overrideWithValue(repo),
    secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
  ];

  setUp(() {
    now = DateTime.utc(2026, 11, 16, 10);
    repo = MockDeliveryRepository(latency: Duration.zero, clock: () => now);
  });

  test('도움요청 접수 응답을 잃어도 같은 키로 다시 보내 상태를 확인하고, 상담원과 대화한다', () async {
    final c = ProviderContainer(retry: (_, _) => null, overrides: overrides());
    addTearDown(c.dispose);
    final p = helpFlowProvider('dlv-1');
    c.listen(p, (_, _) {});
    repo.loseNextHelpResponse = true;

    await c.read(p.notifier).send(HelpCategory.customerUnreachable);
    expect(c.read(p).state, HelpState.open, reason: '접수 ≠ 해결');

    // 상담원 배정(목: 10초 뒤) → 처리 중 · 접수번호 · 첫 인사.
    now = now.add(MockDeliveryRepository.assignAfter);
    final id = (deliveryId: 'dlv-1', requestId: c.read(p).key!.value);
    final thread = supportThreadProvider(id);
    c.listen(thread, (_, _) {});
    await c.read(thread.notifier).load();
    expect(c.read(p).state, HelpState.inProgress);
    expect(c.read(p).last!.caseId, startsWith('CS-'));
    expect(c.read(thread).messages.single.sender, SupportSender.agent);

    // 라이더가 말하면 상담원이 답한다. 두 번 주고받으면 처리 완료.
    expect(await c.read(thread.notifier).send('고객이 전화를 안 받아요'), isTrue);
    now = now.add(MockDeliveryRepository.replyAfter);
    await c.read(thread.notifier).load();
    expect(c.read(thread).messages.last.sender, SupportSender.agent);
    expect(c.read(p).state, HelpState.inProgress);
    await c.read(thread.notifier).send('문 앞에 두고 갈까요?');
    now = now.add(MockDeliveryRepository.replyAfter);
    await c.read(thread.notifier).load();
    expect(c.read(thread).messages, hasLength(5));
    expect(c.read(p).state, HelpState.resolved);
  });

  testWidgets('사진 업로드에 실패하면 도움요청에서 "사진을 올릴 수 없어요"가 먼저 나온다', (t) async {
    t.view
      ..physicalSize = const Size(800, 2200)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final d = repo.deliveryJson('dlv-1')..['state'] = 'ARRIVED_AT_CUSTOMER';
    expect(d['state'], 'ARRIVED_AT_CUSTOMER');
    repo.uploadFails = true;
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
    // 아래 시트를 펼쳐야 "'여기에 두었어요' 알리기"가 보인다(레퍼런스 image 17).
    await t.tap(find.byKey(const ValueKey('sheet-handle')));
    await settle();
    await t.tap(find.byKey(const ValueKey('photo')));
    await settle();
    await t.tap(find.byKey(const ValueKey('upload-photo')));
    await settle();
    // 올리기에 실패하면 촬영 창이 닫히지 않고 실패를 알린다.
    expect(find.byKey(const ValueKey('upload-failed')), findsOneWidget);
    // 촬영 창에서 돌아와 도움요청을 연다.
    await t.tap(find.byType(BackButton));
    await settle();

    // 도움요청 → 지원센터 화면.
    await t.tap(find.byKey(const ValueKey('help')));
    await settle();
    expect(find.byKey(const ValueKey('support-center')), findsOneWidget);
    final photo = find.byKey(const ValueKey('help-photoUploadFailed'));
    final other = find.byKey(const ValueKey('help-customerUnreachable'));
    final p = t.getTopLeft(photo);
    final o = t.getTopLeft(other);
    expect(
      p.dy < o.dy || (p.dy == o.dy && p.dx < o.dx),
      isTrue,
      reason: '사진 업로드 실패 유형이 먼저',
    );

    // 유형만 골라서는 보내지 않는다 — 내용을 쓰고 "지원센터에 보내기".
    final send = find.byKey(const ValueKey('support-send'));
    expect(t.widget<RiderButton>(send).onPressed, isNull);
    await t.tap(photo);
    await settle();
    await t.enterText(
      find.byKey(const ValueKey('support-detail')),
      '사진이 계속 안 올라가요',
    );
    await t.tap(send);
    await settle();
    expect(repo.helpDetails.values, contains('사진이 계속 안 올라가요'));

    // 보내면 그 요청의 진행상황·대화 화면으로 간다(접수됨, 상담원 배정 대기).
    expect(find.byKey(const ValueKey('thread-messages')), findsOneWidget);
    expect(find.text('지원센터에 접수했어요'), findsOneWidget);
    expect(find.text('사진이 계속 안 올라가요'), findsOneWidget);
    expect(find.text('상담원이 배정되면 여기로 답장이 와요.'), findsOneWidget);

    // 상담원이 배정되면(목: 10초) 화면이 4초마다 확인해 첫 인사·처리 중·접수번호가 보인다.
    now = now.add(MockDeliveryRepository.assignAfter);
    await t.pump(const Duration(seconds: 4));
    await settle();
    expect(find.text('지원센터가 처리하고 있어요'), findsOneWidget);
    expect(find.textContaining('접수번호 CS-'), findsOneWidget);
    expect(find.textContaining('PMart 지원센터입니다'), findsOneWidget);

    // 라이더 ↔ 상담원 대화.
    await t.enterText(
      find.byKey(const ValueKey('thread-input')),
      '다시 찍어도 업로드가 안 돼요',
    );
    await t.tap(find.byKey(const ValueKey('thread-send')));
    await settle();
    expect(find.text('다시 찍어도 업로드가 안 돼요'), findsOneWidget);
    now = now.add(MockDeliveryRepository.replyAfter);
    await t.pump(const Duration(seconds: 4));
    await settle();
    expect(find.textContaining('매장과 확인해서'), findsOneWidget);

    // 나갔다가 배송 화면에서도 진행상황이 보이고, 누르면 다시 들어간다.
    await t.tap(find.byType(BackButton)); // 대화 → 지원센터
    await settle();
    await t.tap(find.byType(BackButton)); // 지원센터 → 배송
    await settle();
    expect(find.byKey(const ValueKey('help-status')), findsOneWidget);
    expect(find.textContaining('지원센터가 처리하고 있어요'), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('help-status')));
    await settle();
    expect(find.byKey(const ValueKey('support-center')), findsOneWidget);
    final ticket = find.byWidgetPredicate(
      (w) =>
          w.key is ValueKey<String> &&
          (w.key! as ValueKey<String>).value.startsWith('ticket-') &&
          !(w.key! as ValueKey<String>).value.startsWith('ticket-state-'),
    );
    await t.ensureVisible(ticket);
    await settle();
    await t.tap(ticket);
    await settle();
    expect(find.textContaining('매장과 확인해서'), findsOneWidget);
    await t.tap(find.byType(BackButton));
    await settle();

    // 처리 중에도 다른 도움요청을 새로 보낼 수 있다(새 요청 → 목록에 두 건).
    await t.tap(find.byKey(const ValueKey('help-accident')));
    await settle();
    await t.tap(send);
    await settle();
    await t.tap(find.byType(BackButton)); // 새 요청의 대화 → 지원센터
    await settle();
    expect(
      find.byWidgetPredicate(
        (w) =>
            w.key is ValueKey<String> &&
            (w.key! as ValueKey<String>).value.startsWith('ticket-state-'),
      ),
      findsNWidgets(2),
    );
  });

  testWidgets('전달할 수 없어요는 도움요청 메뉴에 있고, 사유·연락 2회·사진이 있어야 보낸다', (t) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    repo.deliveryJson('dlv-1')['state'] = 'PICKED_UP';
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
    // 전달 단계 화면에는 "전달할 수 없어요" 버튼이 따로 없다 — 도움요청 메뉴 안에 있다.
    expect(find.byKey(const ValueKey('help-report-failure')), findsNothing);
    await t.tap(find.byKey(const ValueKey('help')));
    await settle();
    await t.tap(find.byKey(const ValueKey('help-report-failure')));
    await settle();

    final submit = find.byKey(const ValueKey('failure-submit'));
    await t.tap(find.byKey(const ValueKey('failure-customerAbsent')));
    await settle();
    expect(t.widget<RiderButton>(submit).onPressed, isNull);
    for (var i = 0; i < 2; i++) {
      await t.tap(find.byKey(const ValueKey('failure-call-customer')));
      await settle();
      await t.tap(find.byKey(const ValueKey('call-no-answer')));
      await settle();
    }
    await t.tap(find.byKey(const ValueKey('take-photo')));
    await settle();
    expect(find.text('사진 올리기 완료'), findsOneWidget);
    expect(t.widget<RiderButton>(submit).onPressed, isNotNull);
    await t.tap(submit);
    await settle();

    expect(repo.deliveryJson('dlv-1')['state'], 'FAILURE_REPORTED');
    // 알리면 같은 내용으로 지원센터 대화가 열리고 대화 화면으로 바로 간다(도움요청을 다시 쓰지 않는다).
    expect(find.byKey(const ValueKey('thread-messages')), findsOneWidget);
    expect(find.text('전달 불가를 알렸어요 · 사유: 고객 부재'), findsOneWidget);
    expect(find.byKey(const ValueKey('thread-input')), findsOneWidget);
    expect(repo.helpDetails.values, contains('전달 불가를 알렸어요 · 사유: 고객 부재'));

    // 대화에서 나오면 배송 화면: 운영자 확인 대기 + "지원센터와 대화하기"로 다시 들어간다.
    await t.tap(find.byType(BackButton));
    await settle();
    expect(find.byKey(const ValueKey('failure-waiting')), findsOneWidget);
    await t.tap(find.byKey(const ValueKey('failure-talk')));
    await settle();
    expect(find.byKey(const ValueKey('thread-messages')), findsOneWidget);
    // 로그인 화면으로 가지 않는다.
    expect(find.byKey(const ValueKey('login-apply')), findsNothing);
    await t.tap(find.byType(BackButton));
    await settle();

    // 그 뒤 고객에게 연락이 와서 전달할 수 있게 됐다 → "고객과 연락됐어요" → 대화에 알린다.
    // 라이더가 직접 취소하지 않는다 — 운영자가 반려하면 원래 단계로 돌아온다.
    await t.tap(find.byKey(const ValueKey('failure-resume')));
    await settle();
    expect(find.byKey(const ValueKey('thread-messages')), findsOneWidget);
    expect(find.textContaining('고객과 다시 연락이 됐어요'), findsOneWidget);

    // 상담원 배정·답장(목) → 반려.
    now = now.add(
      MockDeliveryRepository.assignAfter + MockDeliveryRepository.replyAfter,
    );
    await t.pump(const Duration(seconds: 4));
    await settle();
    expect(find.textContaining('전달 불가를 반려했으니'), findsOneWidget);
    expect(repo.deliveryJson('dlv-1')['state'], 'PICKED_UP');

    // 배송 화면은 확인해서 전달 단계로 돌아온다.
    await t.tap(find.byType(BackButton));
    await t.pump(const Duration(seconds: 8));
    await settle();
    expect(find.byKey(const ValueKey('failure-waiting')), findsNothing);
    expect(find.byKey(const ValueKey('failure-resume')), findsNothing);
    expect(find.text('전달 불가가 반려됐어요. 고객에게 전달을 계속해 주세요'), findsOneWidget);
  });

  test('앱을 다시 켜도 보낸 도움요청을 서버 목록에서 되찾는다', () async {
    final first = ProviderContainer(
      retry: (_, _) => null,
      overrides: overrides(),
    );
    first.listen(helpFlowProvider('dlv-1'), (_, _) {});
    await first
        .read(helpFlowProvider('dlv-1').notifier)
        .send(HelpCategory.storeWaiting, detail: '포장이 늦어요');
    final key = first.read(helpFlowProvider('dlv-1')).key!.value;
    first.dispose(); // 앱 종료

    final again = ProviderContainer(
      retry: (_, _) => null,
      overrides: overrides(),
    );
    addTearDown(again.dispose);
    final p = helpFlowProvider('dlv-1');
    again.listen(p, (_, _) {});
    expect(again.read(p).tickets, isEmpty);
    await again.read(p.notifier).refresh();
    final t = again.read(p).tickets.single;
    expect(t.key.value, key);
    expect(t.category, HelpCategory.storeWaiting);
    expect(t.detail, '포장이 늦어요');
  });

  test('처리된 도움요청 뒤 새 도움요청은 새 키로 보낸다', () async {
    final c = ProviderContainer(retry: (_, _) => null, overrides: overrides());
    addTearDown(c.dispose);
    final p = helpFlowProvider('dlv-1');
    c.listen(p, (_, _) {});
    await c.read(p.notifier).send(HelpCategory.storeWaiting);
    final first = c.read(p).key;
    await c.read(p.notifier).send(HelpCategory.goodsIssue);
    expect(c.read(p).key, isNot(first));
    expect(c.read(p).sentCount, 2);
  });
}
