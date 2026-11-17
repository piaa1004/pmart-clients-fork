import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../l10n/gen/app_localizations.dart';
import '../../router.dart';
import '../notifications/data/notifications.dart';
import '../offers/presentation/offer_controllers.dart';
import 'push_tokens.dart';

/// 받은 푸시 한 건(notification-service — 백엔드 회신 2026-11-17 `reply-rider-push-send`).
///
/// - 알림함 알림: data `notificationId`·`templateKey`·`type`·`ref`(HELP_REQUEST · INQUIRY · NONE).
/// - 새 배차 제안: data `type: DISPATCH_OFFER`·`offerId`·`deliveryId`·`expiresAt`(알림함에는 없음).
/// 푸시 내용으로 상태를 확정하지 않는다 — 화면을 열 때 서버에서 다시 읽는다.
@immutable
class PushMessage {
  const PushMessage({
    this.type,
    this.ref,
    this.notificationId,
    this.offerId,
    this.title,
    this.body,
  });

  factory PushMessage.fromData(
    Map<String, dynamic> data, {
    String? title,
    String? body,
  }) {
    String? s(String k) => switch (data[k]) {
      final String v when v.isNotEmpty => v,
      _ => null,
    };
    return PushMessage(
      type: s('type') ?? s('destinationType'),
      ref: s('ref') ?? s('destinationRef'),
      notificationId: s('notificationId'),
      offerId: s('offerId'),
      title: title,
      body: body,
    );
  }

  static const dispatchOffer = 'DISPATCH_OFFER';

  final String? type;
  final String? ref;
  final String? notificationId;
  final String? offerId;
  final String? title;
  final String? body;

  bool get isOffer => type == dispatchOffer;
}

/// 누르면 갈 곳. 배차 제안은 홈(제안 카드 — 다시 읽는다), 알림함 알림은 알림함과 같은 곳,
/// 목적지가 없으면 알림함. 모르는 것은 null(그대로 둔다).
String? pushRoute(PushMessage m) {
  if (m.isOffer) return '/';
  return switch (notificationTarget(m.type, m.ref)) {
    HelpRequestTarget(:final deliveryId, :final requestId) =>
      '/deliveries/$deliveryId/support/$requestId',
    InquiryTarget(:final inquiryId) => '/my/inquiries/$inquiryId',
    NoTarget() => m.notificationId == null ? null : '/notifications',
  };
}

/// 앱을 보고 있을 때 받은 푸시를 띄울 곳(시스템은 포그라운드에서 띄우지 않는다 — 앱이 직접).
final riderMessengerKeyProvider = Provider<GlobalKey<ScaffoldMessengerState>>(
  (_) => GlobalKey<ScaffoldMessengerState>(),
);

/// 받은 푸시 처리: 누름 → 화면 이동, 앱을 보고 있을 때 → 짧은 배너 + 목록 새로 읽기.
class PushHandler {
  PushHandler(this._ref);

  final Ref _ref;
  final _subs = <StreamSubscription<PushMessage>>[];

  void start() {
    final source = _ref.read(pushTokenSourceProvider);
    _subs
      ..add(source.onOpened.listen(open))
      ..add(source.onForeground.listen(foreground));
    // 앱이 꺼져 있을 때 알림을 눌러 켰다 — 첫 화면이 그려진 뒤 옮긴다.
    unawaited(
      source.initialMessage().then((m) {
        if (m != null) {
          WidgetsBinding.instance.addPostFrameCallback((_) => open(m));
        }
      }),
    );
  }

  void _refresh(PushMessage m) {
    if (m.isOffer) {
      unawaited(_ref.read(offerPollerProvider.notifier).refreshNow());
    } else {
      _ref.invalidate(notificationInboxProvider);
    }
  }

  /// 알림을 눌렀다.
  void open(PushMessage m) {
    _refresh(m);
    // 알림함 알림은 눌렀으니 읽음(실패해도 이동은 한다).
    final id = m.notificationId;
    if (id != null && !m.isOffer) {
      unawaited(
        _ref
            .read(notificationRepositoryProvider)
            .markRead(id, key: IdempotencyKey.generate())
            .catchError((Object _) {}),
      );
    }
    final route = pushRoute(m);
    if (route == null) return;
    final router = _ref.read(routerProvider);
    if (route == '/') {
      router.go(route);
    } else {
      unawaited(router.push(route));
    }
  }

  /// 앱을 보고 있을 때 받았다.
  void foreground(PushMessage m) {
    _refresh(m);
    final messenger = _ref.read(riderMessengerKeyProvider).currentState;
    final title = m.title;
    if (messenger == null || title == null) return;
    final route = pushRoute(m);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          key: const ValueKey('push-banner'),
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: m.isOffer ? 6 : 4),
          content: Text(
            [title, ?m.body].join('\n'),
            style: const TextStyle(fontSize: 14, height: 1.4),
          ),
          action: route == null || (m.isOffer && _onHome())
              ? null
              : SnackBarAction(
                  label: lookupAppLocalizations(const Locale('ko')).pushView,
                  onPressed: () => open(m),
                ),
        ),
      );
  }

  bool _onHome() =>
      _ref.read(routerProvider).routeInformationProvider.value.uri.path == '/';

  void dispose() {
    for (final s in _subs) {
      unawaited(s.cancel());
    }
  }
}

final pushHandlerProvider = Provider<PushHandler>((ref) {
  final h = PushHandler(ref)..start();
  ref.onDispose(h.dispose);
  return h;
});
