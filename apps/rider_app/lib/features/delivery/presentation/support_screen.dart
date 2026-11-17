import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';
import 'support_thread_screen.dart' show HelpStateChip, helpStateLook;

/// 지원센터 화면에서 배송 화면으로 돌려보낼 처리(배송 화면이 실제로 한다).
/// 전달 불가는 고른 문제에 맞춰 사유를 미리 고른다(고객 연락 안 됨 / 주소 문제).
enum SupportAction {
  cancelAssignment,
  reportFailure,
  reportFailureUnreachable,
  reportFailureAddress,
}

/// 전달 불가로 이어질 수 있는 문제(갈림길을 보여 준다 — 사용자 결정 2026-11-17).
const _failureForks = {
  HelpCategory.customerUnreachable,
  HelpCategory.addressIssue,
};

/// 지원센터(도움요청). 보낸 요청은 지원센터 사건함(백오피스)에 "라이더 도움요청"으로 열리고,
/// 상담원이 처리하면 여기 상태가 바뀐다(접수됨 → 처리 중 → 처리 완료, 접수번호).
///
/// 계약상 라이더는 상담원 답변·메모를 받지 못하고(직원에게만), 채팅·내 요청 목록 API 도 없다 —
/// 백엔드 요청 중(`docs/handoff/rider-app/2026-11-16-backend-trip-info-and-signup.md` §11).
class SupportScreen extends ConsumerStatefulWidget {
  const SupportScreen({super.key, required this.deliveryId});

  final String deliveryId;

  @override
  ConsumerState<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends ConsumerState<SupportScreen> {
  final _detail = TextEditingController();
  HelpCategory? _category;

  String get _id => widget.deliveryId;

  @override
  void initState() {
    super.initState();
    // 들어오면 처리 상태를 새로 확인한다.
    Future.microtask(() => ref.read(helpFlowProvider(_id).notifier).refresh());
  }

  @override
  void dispose() {
    _detail.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final category = _category;
    if (category == null) return;
    final l10n = AppLocalizations.of(context);
    await ref
        .read(helpFlowProvider(_id).notifier)
        .send(category, detail: _detail.text);
    if (!mounted) return;
    final last = ref.read(helpFlowProvider(_id)).last;
    if (last != null && last.state != HelpState.unknown) {
      _detail.clear();
      setState(() => _category = null);
      // 보낸 요청의 진행상황·상담원 대화로 바로 간다(그 화면에 "접수됨"이 보인다 — 안내 띠는 띄우지
      // 않는다. 띄우면 대화 입력칸을 가린다). 지원센터 화면을 대화로 바꿔 놓아, 대화에서 뒤로 가면
      // 도움요청을 누른 배송 화면으로 바로 돌아간다(사용자 요청 2026-11-17).
      context.pushReplacement('/deliveries/$_id/support/${last.key.value}');
    } else {
      // 접수됐는지 모른다 — 같은 내용으로 다시 누르면 같은 요청으로 확인한다.
      showRiderToast(context, l10n.helpUnknown);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final d = ref.watch(deliveryProvider(_id)).value;
    final flow = ref.watch(deliveryFlowProvider(_id));
    final help = ref.watch(helpFlowProvider(_id));
    final pickupStage = d != null && isPickupStage(d.state);
    // 전달 불가 신고 접수 뒤에도 갈림길·버튼을 계속 보인다(사용자 요청 2026-11-17) — 접수 상태와 그 대화로.
    final reported = d?.state == ExecutionState.failureReported;
    // 반품 회수는 받기 전(배정)에 "받을 수 없어요"(실패 등록), 오배송 회수는 도움요청만(계약 0.10.0).
    final canFail =
        reported ||
        (d?.recovery == RecoveryPurpose.claimReturn
            ? d?.state == ExecutionState.assigned
            : d?.recovery == null &&
                  (d?.state == ExecutionState.pickedUp ||
                      d?.state == ExecutionState.arrivedAtCustomer));
    final failureTicket = reported
        ? help.tickets
                  .where(
                    (t) =>
                        t.key.value == d?.failureHelpRequestId ||
                        t.category == HelpCategory.deliveryFailure,
                  )
                  .lastOrNull ??
              help.last
        : null;
    final failureThread = d?.failureHelpRequestId ?? failureTicket?.key.value;
    // 전달 불가 신고는 위 접수 카드에만 보인다 — 아래 "보낸 요청"에 또 띄우지 않는다(사용자 요청 2026-11-17).
    final listed = [
      for (final t in help.tickets)
        if (t.key.value != failureThread &&
            t.category != HelpCategory.deliveryFailure)
          t,
    ];
    final suggested = flow.uploadFailed ? HelpCategory.photoUploadFailed : null;
    final categories = [
      ?suggested,
      ...HelpCategory.values.where(
        (v) => v != suggested && v != HelpCategory.deliveryFailure,
      ),
    ];
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.supportTitle),
      body: ListView(
        key: const ValueKey('support-center'),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          // 접수한 건(전달 불가 신고·보낸 도움요청)을 맨 위에 — 상태와 대화를 바로 볼 수 있게(사용자 요청 2026-11-17).
          if (reported) ...[
            _FailureReceived(
              ticket: failureTicket,
              onOpen: failureThread == null
                  ? null
                  : () =>
                        context.push('/deliveries/$_id/support/$failureThread'),
            ),
            const SizedBox(height: 12),
          ],
          if (listed.isNotEmpty) ...[
            Row(
              children: [
                Expanded(
                  child: Text(l10n.supportHistory, style: _sectionTitle),
                ),
                TextButton(
                  key: const ValueKey('support-refresh'),
                  onPressed: help.sending
                      ? null
                      : ref.read(helpFlowProvider(_id).notifier).refresh,
                  child: Text(l10n.checkAgain),
                ),
              ],
            ),
            for (final t in listed.reversed)
              _TicketCard(
                ticket: t,
                onOpen: () =>
                    context.push('/deliveries/$_id/support/${t.key.value}'),
              ),
            const SizedBox(height: 6),
            Text(
              l10n.supportReplyPending,
              style: const TextStyle(fontSize: 12, color: RiderColors.hint),
            ),
            const SizedBox(height: 18),
          ],
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: RiderColors.primaryMist,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.support_agent, color: RiderColors.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.supportIntro,
                    style: const TextStyle(fontSize: 14, height: 1.5),
                  ),
                ),
              ],
            ),
          ),
          // 전달 불가는 따로 두지 않고 아래 "고객 연락 안 됨·주소 문제"의 갈림길에서 고른다
          // (기능이 겹쳐 보인다는 사용자 지적 2026-11-17). 배차취소는 픽업 전에만.
          if (pickupStage) ...[
            const SizedBox(height: 18),
            Text(l10n.supportDeliveryActions, style: _sectionTitle),
            const SizedBox(height: 6),
            if (pickupStage)
              _ActionRow(
                key: const ValueKey('cancel-assignment'),
                icon: Icons.cancel_outlined,
                label: l10n.cancelAssignment,
                onTap: () => context.pop(SupportAction.cancelAssignment),
              ),
          ],
          const SizedBox(height: 22),
          Text(l10n.helpTitle, style: _sectionTitle),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final c in categories)
                ChoiceChip(
                  key: ValueKey('help-${c.name}'),
                  label: Text(helpCategoryText(l10n, c)),
                  selected: _category == c,
                  selectedColor: RiderColors.primarySoft,
                  onSelected: (_) => setState(() => _category = c),
                ),
            ],
          ),
          // 갈림길: 물어보기(아래 보내기) / 전달 포기(전달할 수 없어요 — 사유 미리 고름).
          if (canFail && _failureForks.contains(_category))
            Container(
              key: const ValueKey('failure-fork'),
              margin: const EdgeInsets.only(top: 14),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                border: Border.all(color: RiderColors.line),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.forkTitle,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    reported ? l10n.forkReported : l10n.forkAskNote,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.5,
                      color: RiderColors.sub,
                    ),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    key: const ValueKey('help-report-failure'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: RiderColors.danger,
                      side: const BorderSide(color: RiderColors.danger),
                      minimumSize: const Size.fromHeight(46),
                    ),
                    icon: const Icon(Icons.report_gmailerrorred),
                    label: Text(l10n.forkGiveUp),
                    // 이미 접수됐으면 다시 신고하지 않고(서버가 409) 그 신고의 대화로 간다.
                    onPressed: reported
                        ? (failureThread == null
                              ? null
                              : () => context.push(
                                  '/deliveries/$_id/support/$failureThread',
                                ))
                        : () => context.pop(
                            _category == HelpCategory.addressIssue
                                ? SupportAction.reportFailureAddress
                                : SupportAction.reportFailureUnreachable,
                          ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 14),
          TextField(
            key: const ValueKey('support-detail'),
            controller: _detail,
            maxLength: 500,
            maxLines: 4,
            minLines: 2,
            decoration: InputDecoration(
              hintText: l10n.supportDetailHint,
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 6),
          RiderButton(
            key: const ValueKey('support-send'),
            label: l10n.supportSend,
            onPressed: _category == null || help.sending ? null : _send,
          ),
        ],
      ),
    );
  }
}

const _sectionTitle = TextStyle(fontSize: 16, fontWeight: FontWeight.w800);

/// 전달 불가 신고가 접수됐다(배송이 FAILURE_REPORTED — 서버가 받았다). 지원센터 확인 상태와 대화로 가는 길.
class _FailureReceived extends StatelessWidget {
  const _FailureReceived({required this.ticket, required this.onOpen});

  final HelpTicket? ticket;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final t = ticket;
    final (text, color) = helpStateLook(l10n, t?.state ?? HelpState.open);
    return InkWell(
      key: const ValueKey('failure-received'),
      onTap: onOpen,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: RiderColors.danger.withValues(alpha: 0.10),
          border: Border.all(color: RiderColors.danger),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.check_circle,
                  color: RiderColors.danger,
                  size: 20,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    l10n.failureReceived,
                    style: const TextStyle(
                      fontSize: 15,
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
                if (t != null) clockText(t.sentAt),
                if (t?.caseId case final no?) l10n.supportCaseNo(no),
                l10n.failureReceivedNote,
              ].join(' · '),
              style: const TextStyle(
                fontSize: 13,
                height: 1.4,
                color: RiderColors.sub,
              ),
            ),
            if (onOpen != null)
              Align(
                alignment: Alignment.centerRight,
                child: Text(
                  l10n.supportOpenThread,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: RiderColors.primary,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    contentPadding: EdgeInsets.zero,
    leading: Icon(icon, color: RiderColors.danger),
    title: Text(
      label,
      style: const TextStyle(
        color: RiderColors.danger,
        fontWeight: FontWeight.w700,
      ),
    ),
    trailing: const Icon(Icons.chevron_right, color: RiderColors.sub),
    onTap: onTap,
  );
}

/// 보낸 도움요청 한 건: 유형 · 보낸 시각 · 내용 · 처리 상태 · 접수번호. 누르면 진행상황·대화.
class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.ticket, required this.onOpen});

  final HelpTicket ticket;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (text, color) = helpStateLook(l10n, ticket.state);
    return InkWell(
      key: ValueKey('ticket-${ticket.key.value}'),
      onTap: onOpen,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(12),
        // 보낸 요청이 눈에 띄게 — 위 전달 불가 접수 카드와 같은 주황(사용자 요청 2026-11-17).
        decoration: BoxDecoration(
          color: RiderColors.danger.withValues(alpha: 0.10),
          border: Border.all(color: RiderColors.danger),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    helpCategoryText(l10n, ticket.category),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Text(
                  clockText(ticket.sentAt),
                  style: const TextStyle(fontSize: 13, color: RiderColors.sub),
                ),
              ],
            ),
            if (ticket.detail case final detail?)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  detail,
                  style: const TextStyle(fontSize: 14, color: RiderColors.sub),
                ),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    text,
                    key: ValueKey('ticket-state-${ticket.key.value}'),
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: color,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                if (ticket.caseId case final no?)
                  Text(
                    l10n.supportCaseNo(no),
                    style: const TextStyle(
                      fontSize: 13,
                      color: RiderColors.sub,
                    ),
                  ),
                const Spacer(),
                Text(
                  l10n.supportOpenThread,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: RiderColors.primary,
                  ),
                ),
                const Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: RiderColors.primary,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
