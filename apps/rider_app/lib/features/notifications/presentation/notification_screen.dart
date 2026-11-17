import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../delivery/presentation/delivery_texts.dart' show clockText;
import '../data/notifications.dart';

/// 알림함: 지원센터 답장·처리 끝·문의 답변·계정 제한/해제. 누르면 읽음 처리 뒤 그 화면으로.
class NotificationScreen extends ConsumerWidget {
  const NotificationScreen({super.key});

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    RiderNotification n,
  ) async {
    if (!n.read) {
      try {
        await ref
            .read(notificationRepositoryProvider)
            .markRead(n.id, key: IdempotencyKey.generate());
      } on PmartFailure {
        // 읽음 표시 실패는 다음에 다시 — 이동은 한다.
      }
      ref.invalidate(notificationInboxProvider);
    }
    if (!context.mounted) return;
    switch (n.target) {
      case HelpRequestTarget(:final deliveryId, :final requestId):
        unawaited(context.push('/deliveries/$deliveryId/support/$requestId'));
      case InquiryTarget(:final inquiryId):
        unawaited(context.push('/my/inquiries/$inquiryId'));
      case NoTarget():
        break;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final inbox = ref.watch(notificationInboxProvider);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.menuNotifications),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(notificationInboxProvider.future),
        child: switch (inbox) {
          AsyncData(:final value) when value.items.isEmpty => ListView(
            children: [
              Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  l10n.notiEmpty,
                  key: const ValueKey('noti-empty'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: RiderColors.sub),
                ),
              ),
            ],
          ),
          AsyncData(:final value) => ListView(
            key: const ValueKey('noti-list'),
            children: [
              for (final n in value.items)
                ListTile(
                  key: ValueKey('noti-${n.id}'),
                  leading: Icon(
                    n.read
                        ? Icons.notifications_none
                        : Icons.notifications_active,
                    color: n.read ? RiderColors.sub : RiderColors.primary,
                  ),
                  title: Text(
                    n.title,
                    style: TextStyle(
                      fontWeight: n.read ? FontWeight.w400 : FontWeight.w800,
                    ),
                  ),
                  subtitle: Text(clockText(n.createdAt)),
                  trailing: n.target is NoTarget
                      ? null
                      : const Icon(Icons.chevron_right),
                  onTap: () => _open(context, ref, n),
                ),
            ],
          ),
          // 조회 실패를 "알림 없음"으로 보이지 않는다.
          AsyncError() => ListView(
            children: [
              Padding(
                padding: const EdgeInsets.all(24),
                child: Row(
                  key: const ValueKey('noti-error'),
                  children: [
                    Expanded(child: Text(l10n.notiLoadFailed)),
                    TextButton(
                      onPressed: () =>
                          ref.invalidate(notificationInboxProvider),
                      child: Text(l10n.retry),
                    ),
                  ],
                ),
              ),
            ],
          ),
          _ => const Center(child: CircularProgressIndicator()),
        },
      ),
    );
  }
}

/// 홈 위쪽 종 버튼 + 안 읽은 수. 푸시가 없어 30초마다 확인한다(백엔드 회신 2026-11-17 "앱이 할 것").
class NotificationBell extends ConsumerStatefulWidget {
  const NotificationBell({super.key});

  @override
  ConsumerState<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends ConsumerState<NotificationBell> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) ref.invalidate(notificationInboxProvider);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final unread = ref.watch(notificationInboxProvider).value?.unread ?? 0;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        MapCircleButton(
          key: const ValueKey('notifications'),
          icon: Icons.notifications_none,
          onTap: () async {
            await context.push('/notifications');
            ref.invalidate(notificationInboxProvider);
          },
        ),
        if (unread > 0)
          Positioned(
            right: -2,
            top: -2,
            child: Container(
              key: const ValueKey('noti-badge'),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: RiderColors.danger,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                unread > 99 ? '99+' : '$unread',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
