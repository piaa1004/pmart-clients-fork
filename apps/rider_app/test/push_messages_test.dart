import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:rider_app/app.dart';
import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/delivery/data/mock_delivery_repository.dart';
import 'package:rider_app/features/delivery/presentation/delivery_controller.dart';
import 'package:rider_app/features/notifications/presentation/notification_screen.dart';
import 'package:rider_app/features/offers/data/mock_offer_repository.dart';
import 'package:rider_app/features/offers/presentation/offer_controllers.dart';
import 'package:rider_app/features/push/push_messages.dart';
import 'package:rider_app/features/push/push_tokens.dart';
import 'package:rider_app/shared/providers.dart';

final class _Source implements PushTokenSource {
  final fg = StreamController<PushMessage>.broadcast();
  final opened = StreamController<PushMessage>.broadcast();

  @override
  Future<void> requestPermission() async {}

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get onTokenRefresh => const Stream.empty();

  @override
  Stream<PushMessage> get onForeground => fg.stream;

  @override
  Stream<PushMessage> get onOpened => opened.stream;

  @override
  Future<PushMessage?> initialMessage() async => null;
}

/// 서버 푸시(백엔드 회신 2026-11-17): data type·ref → 갈 곳, 앱을 보고 있으면 배너, 누르면 그 화면.
void main() {
  setUpAll(initPmartFormatting);

  test('data → 갈 곳: 배차 제안은 홈, 도움요청 답장은 그 대화, 문의는 그 문의, 목적지 없으면 알림함', () {
    final offer = PushMessage.fromData({
      'type': 'DISPATCH_OFFER',
      'offerId': 'off-1',
      'deliveryId': 'dlv-1',
      'expiresAt': '2026-11-17T10:00:00Z',
    });
    expect(offer.isOffer, isTrue);
    expect(pushRoute(offer), '/');
    expect(
      pushRoute(
        PushMessage.fromData({
          'notificationId': 'n1',
          'type': 'HELP_REQUEST',
          'ref': 'dlv-1:req-9',
        }),
      ),
      '/deliveries/dlv-1/support/req-9',
    );
    // type·ref 가 없으면 destinationType·destinationRef 를 쓴다(같은 값).
    expect(
      pushRoute(
        PushMessage.fromData({
          'notificationId': 'n2',
          'destinationType': 'INQUIRY',
          'destinationRef': 'inq-3',
        }),
      ),
      '/my/inquiries/inq-3',
    );
    expect(
      pushRoute(PushMessage.fromData({'notificationId': 'n3', 'type': 'NONE'})),
      '/notifications',
    );
    expect(pushRoute(PushMessage.fromData({})), isNull);
  });

  testWidgets('앱을 보고 있으면 배너, 알림을 누르면 그 화면으로', (t) async {
    t.view
      ..physicalSize = const Size(800, 2400)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    final source = _Source();
    final offers = MockOfferRepository(
      latency: Duration.zero,
      startOnDuty: false,
    );
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
          pushTokenSourceProvider.overrideWithValue(source),
          mockOfferRepositoryProvider.overrideWithValue(offers),
          offerRepositoryProvider.overrideWithValue(offers),
          dutyRepositoryProvider.overrideWithValue(offers),
          deliveryRepositoryProvider.overrideWithValue(deliveries),
          handoverRepositoryProvider.overrideWithValue(deliveries),
          evidenceUploaderProvider.overrideWithValue(deliveries),
          supportThreadRepositoryProvider.overrideWithValue(deliveries),
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
    source.fg.add(
      const PushMessage(
        notificationId: 'n1',
        type: 'NONE',
        title: '수행료가 조정되었어요',
        body: '지급 예정일에 함께 지급돼요',
      ),
    );
    await settle();
    expect(find.byKey(const ValueKey('push-banner')), findsOneWidget);
    expect(find.text('수행료가 조정되었어요\n지급 예정일에 함께 지급돼요'), findsOneWidget);

    // 알림을 눌러 앱이 앞으로 왔다 → 알림함.
    source.opened.add(const PushMessage(notificationId: 'n1', type: 'NONE'));
    await settle();
    expect(find.byType(NotificationScreen), findsOneWidget);
  });
}
