import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
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

/// 요청 요약: 유형 · 보낸 시각 · 처리 상태 · 접수번호 · 처음 보낸 내용.
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
          if (ticket.detail case final detail?)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(detail, style: const TextStyle(fontSize: 14)),
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
