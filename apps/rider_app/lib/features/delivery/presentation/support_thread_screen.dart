import 'dart:async';

import 'package:flutter/foundation.dart' show Uint8List;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/delivery_repository.dart' show LocalPhoto;
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';

/// 도움요청 한 건의 진행상황 + 상담원과 대화.
///
/// 처리 상태·접수번호는 계약(`GET …/help-requests/{requestId}`) 값. 대화는 라이더용 API 가 없어
/// 목에서만 오가고, 실서버는 "준비 중" 안내만 보인다(백엔드 요청 §11). 화면이 열려 있는 동안
/// 4초마다 새 답장을 확인한다(푸시 BR-09 전까지).
class SupportThreadScreen extends ConsumerStatefulWidget {
  const SupportThreadScreen({
    super.key,
    required this.deliveryId,
    required this.requestId,
  });

  final String deliveryId;
  final String requestId;

  @override
  ConsumerState<SupportThreadScreen> createState() =>
      _SupportThreadScreenState();
}

class _SupportThreadScreenState extends ConsumerState<SupportThreadScreen> {
  final _input = TextEditingController();
  Timer? _poll;

  SupportThreadId get _id =>
      (deliveryId: widget.deliveryId, requestId: widget.requestId);

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
    // 접수 상태(접수됨·처리 중·접수번호)를 새로 확인한다 — 전달 불가 신고가 연 대화도 여기서 잡힌다.
    Future.microtask(
      () => ref.read(helpFlowProvider(widget.deliveryId).notifier).refresh(),
    );
    _poll = Timer.periodic(const Duration(seconds: 4), (_) => _load());
  }

  Future<void> _load() async {
    if (!mounted) return;
    await ref.read(supportThreadProvider(_id).notifier).load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final ok = await ref
        .read(supportThreadProvider(_id).notifier)
        .send(_input.text);
    if (ok && mounted) _input.clear();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final thread = ref.watch(supportThreadProvider(_id));
    final ticket = ref
        .watch(helpFlowProvider(widget.deliveryId))
        .tickets
        .where((t) => t.key.value == widget.requestId)
        .firstOrNull;
    final resolved = ticket?.state == HelpState.resolved;
    final canTalk = !thread.unavailable && !resolved;
    return Scaffold(
      backgroundColor: RiderColors.field,
      appBar: riderDarkBar(context, title: l10n.supportThreadTitle),
      body: Column(
        children: [
          if (ticket != null) _TicketHeader(ticket: ticket),
          Expanded(
            child: ListView(
              key: const ValueKey('thread-messages'),
              reverse: true,
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
              children: [
                for (final m in thread.messages.reversed) _Bubble(message: m),
                // 처음 보낸 요청(고른 문제·내용)을 내 첫 말로 보인다 — 다시 쓰지 않아도 된다(사용자 요청 2026-11-17).
                if (ticket != null)
                  _RequestBubble(ticket: ticket, deliveryId: widget.deliveryId),
                _Notice(
                  text: thread.unavailable
                      ? l10n.supportThreadUnavailable
                      : ticket?.state == HelpState.open
                      ? l10n.supportThreadWaiting
                      : l10n.supportThreadIntro,
                ),
              ],
            ),
          ),
          if (thread.failed)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                l10n.supportThreadFailed,
                style: const TextStyle(fontSize: 13, color: RiderColors.danger),
              ),
            ),
          if (resolved)
            Container(
              key: const ValueKey('thread-resolved'),
              width: double.infinity,
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Text(
                l10n.supportThreadClosed,
                style: const TextStyle(fontSize: 14, color: RiderColors.sub),
              ),
            ),
          Material(
            color: Colors.white,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const ValueKey('thread-input'),
                        controller: _input,
                        enabled: canTalk,
                        maxLength: 500,
                        minLines: 1,
                        maxLines: 4,
                        decoration: InputDecoration(
                          hintText: l10n.supportThreadHint,
                          counterText: '',
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    IconButton.filled(
                      key: const ValueKey('thread-send'),
                      style: IconButton.styleFrom(
                        backgroundColor: RiderColors.primary,
                      ),
                      onPressed: canTalk && !thread.sending ? _send : null,
                      icon: const Icon(Icons.send, color: Colors.white),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 요청 요약: 유형 · 보낸 시각 · 처리 상태 · 접수번호(처음 보낸 내용은 대화의 첫 말로).
class _TicketHeader extends StatelessWidget {
  const _TicketHeader({required this.ticket});

  final HelpTicket ticket;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (text, color) = helpStateLook(l10n, ticket.state);
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  helpCategoryText(l10n, ticket.category),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              HelpStateChip(text: text, color: color),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            [
              clockText(ticket.sentAt),
              if (ticket.caseId case final no?) l10n.supportCaseNo(no),
            ].join(' · '),
            style: const TextStyle(fontSize: 13, color: RiderColors.sub),
          ),
        ],
      ),
    );
  }
}

/// 처리 상태 글자·색.
(String, Color) helpStateLook(AppLocalizations l10n, HelpState? s) =>
    switch (s) {
      HelpState.open => (l10n.helpOpen, RiderColors.primary),
      HelpState.inProgress => (l10n.helpInProgress, RiderColors.pickup),
      HelpState.resolved => (l10n.helpResolved, RiderColors.sub),
      HelpState.unknown || null => (l10n.helpUnknown, RiderColors.danger),
    };

class HelpStateChip extends StatelessWidget {
  const HelpStateChip({super.key, required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(
      text,
      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color),
    ),
  );
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final SupportMessage message;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final mine = message.sender == SupportSender.rider;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          crossAxisAlignment: mine
              ? CrossAxisAlignment.end
              : CrossAxisAlignment.start,
          children: [
            if (!mine)
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 2),
                child: Text(
                  l10n.supportAgent,
                  style: const TextStyle(fontSize: 12, color: RiderColors.sub),
                ),
              ),
            ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.sizeOf(context).width * 0.72,
              ),
              child: Container(
                key: ValueKey('msg-${message.id}'),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  color: mine ? RiderColors.primary : Colors.white,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  message.masked
                      ? AppLocalizations.of(context).supportMasked
                      : message.text,
                  style: TextStyle(
                    fontSize: 15,
                    fontStyle: message.masked ? FontStyle.italic : null,
                    height: 1.4,
                    color: mine ? Colors.white : RiderColors.ink,
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 2, left: 4, right: 4),
              child: Text(
                clockText(message.at),
                style: const TextStyle(fontSize: 11, color: RiderColors.hint),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 처음 보낸 요청(내 첫 말): 고른 문제·내용 + 함께 보낸 사진("사진"을 누르면 크게).
/// 이 기기에서 찍은 사진이 메모리에 없으면(앱을 다시 켬) 서버에서 다시 받아 그린다(디스크에 남기지 않는다).
class _RequestBubble extends ConsumerWidget {
  const _RequestBubble({required this.ticket, required this.deliveryId});

  final HelpTicket ticket;
  final String deliveryId;

  void _showPhoto(BuildContext context, {LocalPhoto? local, String? ref}) {
    final l10n = AppLocalizations.of(context);
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('request-photo-view'),
        title: Text(l10n.supportPhotoTitle),
        contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        content: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: local != null
              ? _PhotoBytes(local.bytes)
              : _ServerPhoto(deliveryId: deliveryId, photoRef: ref!),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(l10n.ok),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    // 전달 불가 신고는 내용 첫 줄이 고른 문제다(유형 이름을 또 붙이지 않는다).
    final text = [
      if (ticket.category != HelpCategory.deliveryFailure)
        helpCategoryText(l10n, ticket.category),
      ?ticket.detail,
    ].join('\n');
    final photo = ticket.photo;
    // 메모리 사진이 없으면 서버에 올린 사진 참조를 읽는다(못 읽으면 버튼 없이).
    final refs = photo != null
        ? const <String>[]
        : ref
                  .watch(
                    requestPhotoRefsProvider((
                      deliveryId: deliveryId,
                      requestId: ticket.key.value,
                    )),
                  )
                  .value ??
              const <String>[];
    return Align(
      alignment: Alignment.centerRight,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.sizeOf(context).width * 0.72,
              ),
              child: Container(
                key: const ValueKey('msg-request'),
                padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
                decoration: BoxDecoration(
                  color: RiderColors.primary,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      text,
                      style: const TextStyle(
                        fontSize: 15,
                        height: 1.4,
                        color: Colors.white,
                      ),
                    ),
                    if (photo != null || refs.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      OutlinedButton.icon(
                        key: const ValueKey('request-photo'),
                        onPressed: () => _showPhoto(
                          context,
                          local: photo,
                          ref: refs.firstOrNull,
                        ),
                        icon: const Icon(Icons.photo_outlined, size: 18),
                        label: Text(l10n.supportPhoto),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: Colors.white),
                          visualDensity: VisualDensity.compact,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(top: 2, left: 4, right: 4),
              child: Text(
                clockText(ticket.sentAt),
                style: const TextStyle(fontSize: 11, color: RiderColors.hint),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PhotoBytes extends StatelessWidget {
  const _PhotoBytes(this.bytes);

  final Uint8List bytes;

  @override
  Widget build(BuildContext context) => Image.memory(
    bytes,
    fit: BoxFit.contain,
    gaplessPlayback: true,
    errorBuilder: (_, _, _) => const SizedBox(
      height: 120,
      child: Center(child: Icon(Icons.broken_image_outlined)),
    ),
  );
}

/// 서버에 올린 사진(원본). 읽는 중 · 못 읽음을 구분한다.
class _ServerPhoto extends ConsumerWidget {
  const _ServerPhoto({required this.deliveryId, required this.photoRef});

  final String deliveryId;
  final String photoRef;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final a = ref.watch(
      evidencePhotoProvider((deliveryId: deliveryId, photoRef: photoRef)),
    );
    return switch (a) {
      AsyncData(:final value) => _PhotoBytes(value),
      AsyncError() => SizedBox(
        height: 120,
        child: Center(
          child: Text(
            AppLocalizations.of(context).supportPhotoFailed,
            key: const ValueKey('request-photo-failed'),
            style: const TextStyle(color: RiderColors.sub),
          ),
        ),
      ),
      _ => const SizedBox(
        height: 120,
        child: Center(child: CircularProgressIndicator()),
      ),
    };
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 13, color: RiderColors.sub),
    ),
  );
}
