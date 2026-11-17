import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_notification/pmart_api_notification.dart' as nt;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';

/// 알림을 눌렀을 때 갈 곳(백엔드 회신 2026-11-17 — 라이더 알림함).
sealed class NotificationTarget {
  const NotificationTarget();
}

/// 도움요청 대화(ref = `<deliveryId>:<requestId>`).
final class HelpRequestTarget extends NotificationTarget {
  const HelpRequestTarget(this.deliveryId, this.requestId);
  final String deliveryId;
  final String requestId;
}

/// 배송 밖 문의(ref = inquiryId).
final class InquiryTarget extends NotificationTarget {
  const InquiryTarget(this.inquiryId);
  final String inquiryId;
}

/// 갈 곳 없음(계정 제한·해제 등 — 문구만).
final class NoTarget extends NotificationTarget {
  const NoTarget();
}

@immutable
class RiderNotification {
  const RiderNotification({
    required this.id,
    required this.title,
    required this.createdAt,
    required this.read,
    required this.target,
    this.body,
  });

  final String id;
  final String title;
  final String? body;
  final DateTime createdAt;
  final bool read;
  final NotificationTarget target;
}

typedef NotificationInbox = ({List<RiderNotification> items, int unread});

/// `GET /me/notifications`·`POST /me/notifications/{id}/reads`(라이더 토큰). 휴대폰 푸시는 아직 없어
/// 앱이 켜져 있을 때 주기적으로 확인한다.
abstract interface class NotificationRepository {
  Future<NotificationInbox> inbox();
  Future<void> markRead(String id, {required IdempotencyKey key});
}

NotificationTarget notificationTarget(String? type, String? ref) {
  switch (type) {
    case 'HELP_REQUEST':
      final i = ref?.indexOf(':') ?? -1;
      if (i > 0 && i < ref!.length - 1) {
        return HelpRequestTarget(ref.substring(0, i), ref.substring(i + 1));
      }
      return const NoTarget();
    case 'INQUIRY':
      return ref == null || ref.isEmpty ? const NoTarget() : InquiryTarget(ref);
    default:
      return const NoTarget();
  }
}

RiderNotification notificationFromContract(nt.Notification n) =>
    RiderNotification(
      id: n.notificationId,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt,
      read: n.state == nt.NotificationStateEnum.NOTICE_READ,
      target: notificationTarget(
        n.destination?.type?.value,
        n.destination?.ref,
      ),
    );

final class ApiNotificationRepository implements NotificationRepository {
  ApiNotificationRepository(Dio dio)
    : _inbox = nt.PmartApiNotification(dio: dio).getInboxApi();

  final nt.InboxApi _inbox;

  @override
  Future<NotificationInbox> inbox() async {
    final res = await pmartGuard(() => _inbox.listMyNotifications());
    final items = [
      for (final n in res.data?.items ?? const <nt.Notification>[])
        notificationFromContract(n),
    ];
    return (
      items: items,
      unread: res.data?.unreadCount ?? items.where((n) => !n.read).length,
    );
  }

  @override
  Future<void> markRead(String id, {required IdempotencyKey key}) async {
    await pmartGuard(
      () => _inbox.markNotificationRead(
        notificationId: id,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        extra: commandOptions(key).extra,
      ),
    );
  }
}

/// 목: 시연용 알림 2건(가짜 — 지원센터 답장·계정 제한 해제).
final class MockNotificationRepository implements NotificationRepository {
  MockNotificationRepository({this.latency = Duration.zero});

  final Duration latency;
  final _read = <String>{};

  List<RiderNotification> get _all => [
    RiderNotification(
      id: 'ntf-1',
      title: '지원센터 답장이 왔어요',
      createdAt: DateTime.now().subtract(const Duration(minutes: 3)),
      read: _read.contains('ntf-1'),
      target: const NoTarget(),
    ),
    RiderNotification(
      id: 'ntf-2',
      title: '계정 제한이 풀렸어요',
      createdAt: DateTime.now().subtract(const Duration(hours: 2)),
      read: _read.contains('ntf-2'),
      target: const NoTarget(),
    ),
  ];

  @override
  Future<NotificationInbox> inbox() async {
    await Future<void>.delayed(latency);
    final items = _all;
    return (items: items, unread: items.where((n) => !n.read).length);
  }

  @override
  Future<void> markRead(String id, {required IdempotencyKey key}) async {
    await Future<void>.delayed(latency);
    _read.add(id);
  }
}

final _mockNotifications = Provider<MockNotificationRepository>(
  (_) => MockNotificationRepository(),
);

final notificationRepositoryProvider = Provider<NotificationRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockNotifications),
    PmartEnv.local => ApiNotificationRepository(ref.watch(dioProvider)),
  },
);

final notificationInboxProvider = FutureProvider.autoDispose<NotificationInbox>(
  (ref) => ref.watch(notificationRepositoryProvider).inbox(),
);
