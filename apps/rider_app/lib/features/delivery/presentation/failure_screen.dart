import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';
import 'phone_caller.dart';
import 'photo_box.dart';

String failureReasonText(AppLocalizations l10n, FailureReason r) => switch (r) {
  FailureReason.customerAbsent => l10n.frAbsent,
  FailureReason.addressError => l10n.frAddress,
  FailureReason.unreachable => l10n.frUnreachable,
  FailureReason.refused => l10n.frRefused,
  FailureReason.damaged => l10n.frDamaged,
  FailureReason.riderIncident => l10n.frIncident,
  FailureReason.other => l10n.frOther,
};

/// 전달할 수 없어요(도움요청 메뉴에서): 사유 · 고객 연락(고객 사유면 2번 이상) · 증빙 사진 → 알리기.
/// 운영자가 확정하기 전까지 배송은 진행 중(FAILURE_REPORTED)이다. 서버가 최종 판정한다.
class FailureScreen extends ConsumerStatefulWidget {
  const FailureScreen({
    super.key,
    required this.deliveryId,
    this.initialReason,
  });

  final String deliveryId;

  /// 지원센터 갈림길에서 고른 문제에 맞춘 사유(고객 연락 안 됨 → 연락 안 됨, 주소 문제 → 주소 오류).
  final FailureReason? initialReason;

  @override
  ConsumerState<FailureScreen> createState() => _FailureScreenState();
}

class _FailureScreenState extends ConsumerState<FailureScreen> {
  late FailureReason? _reason = widget.initialReason;
  bool _sending = false;

  String get _id => widget.deliveryId;

  /// 전달 불가 알리기 → (등록되면) 같은 내용으로 지원센터 대화를 열고 대화 화면으로 간다.
  /// 전달 불가 등록은 운영자 확인 대기열로만 가고 상담원과 대화할 수 없어서, 라이더가 도움요청을
  /// 따로 다시 보내야 했다(사용자 지적 2026-11-17). 계약상 실패 등록 뒤에도 도움요청을 보낼 수 있다.
  Future<void> _submit(FailureReason reason) async {
    final l10n = AppLocalizations.of(context);
    setState(() => _sending = true);
    final flow = ref.read(deliveryFlowProvider(_id).notifier);
    // 앞에서 고른 문제·사유·연락·사진을 한 글로 — 실패 등록 detail 로 보내고, 대화의 첫 말로도 보인다
    // (라이더가 대화에서 같은 내용을 다시 쓰지 않게, 사용자 요청 2026-11-17).
    final s = ref.read(deliveryFlowProvider(_id));
    // 예: 고객과 연락이 안 돼요 → 전달할 수 없어요 / 사유: 연락 안 됨 / 시도: 전화 2번 (사진은 대화의 "사진" 버튼).
    final summary = [
      switch (widget.initialReason) {
        final r? => l10n.failureFrom(
          helpCategoryText(l10n, helpCategoryForFailure(r)),
        ),
        null => l10n.failureOnly,
      },
      l10n.failureHelpDetail(failureReasonText(l10n, reason)),
      if (s.contacts.isNotEmpty) l10n.failureTries(s.contacts.length),
    ].join('\n');
    final photo = s.photo;
    await flow.reportFailure(reason, detail: summary);
    if (!mounted) return;
    final d = await ref.read(deliveryProvider(_id).future);
    if (!mounted) return;
    if (d.state != ExecutionState.failureReported) {
      setState(() => _sending = false);
      return;
    }
    // 서버가 실패 등록과 함께 대화를 열었다(execution 0.14.0) — 그 대화로 간다.
    // 도움요청을 따로 보내면 운영자 쪽에 두 건이 생긴다(백엔드 회신 2026-11-17 §13).
    final opened = d.failureHelpRequestId;
    if (opened != null) {
      // 배송이 FAILURE_REPORTED 로 바뀐 것 = 서버가 신고를 받았다 → 접수됨으로 넣고 대화로.
      ref
          .read(helpFlowProvider(_id).notifier)
          .adopt(
            HelpTicket(
              key: IdempotencyKey(opened),
              category: HelpCategory.deliveryFailure,
              detail: summary,
              sentAt: DateTime.now(),
              state: HelpState.open,
              photo: photo,
            ),
          );
      context.pushReplacement('/deliveries/$_id/support/$opened');
      return;
    }
    // 그 전 서버: 같은 내용으로 도움요청을 따로 연다.
    final photoRef = ref.read(deliveryFlowProvider(_id)).photoRef;
    await ref
        .read(helpFlowProvider(_id).notifier)
        .send(
          helpCategoryForFailure(reason),
          detail: summary,
          evidenceRefs: [?photoRef],
          photo: photo,
        );
    if (!mounted) return;
    final last = ref.read(helpFlowProvider(_id)).last;
    if (last != null && last.state != null && last.state != HelpState.unknown) {
      context.pushReplacement('/deliveries/$_id/support/${last.key.value}');
    } else {
      // 대화를 못 열었으면 배송 화면으로(지원센터에서 다시 보낼 수 있다).
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final flow = ref.watch(deliveryFlowProvider(_id));
    // 회수 배송은 회수지 전화(전달지는 쓰지 않는다).
    final recovery =
        ref.watch(deliveryProvider(_id)).value?.isRecovery ?? false;
    final phone = recovery
        ? ref.watch(recoveryContactProvider(_id)).value?.receiverPhone
        : ref.watch(dropInfoProvider(_id)).value?.receiverPhone;
    final reason = _reason;
    final needContacts = reason != null && needsContactAttempts(reason);
    final contactsOk = !needContacts || flow.contacts.length >= 2;
    final ready =
        reason != null && flow.photoRef != null && contactsOk && !_sending;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.reportFailure),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 16),
        children: [
          Text(
            l10n.failureTitle,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          for (final r in FailureReason.values) ...[
            PillOption(
              key: ValueKey('failure-${r.name}'),
              label: failureReasonText(l10n, r),
              height: 46,
              showCheck: true,
              selected: _reason == r,
              onTap: () => setState(() => _reason = r),
            ),
            const SizedBox(height: 6),
          ],
          if (needContacts) ...[
            const SizedBox(height: 14),
            Text(
              l10n.failureNeedsContacts(flow.contacts.length),
              key: const ValueKey('contacts-needed'),
              style: TextStyle(
                fontSize: 14,
                color: contactsOk ? RiderColors.sub : RiderColors.danger,
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              key: const ValueKey('failure-call-customer'),
              onPressed: phone == null
                  ? null
                  : () => callCustomerAndRecord(context, ref, _id, phone),
              icon: const Icon(Icons.call_outlined),
              label: Text(l10n.callCustomer),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
              ),
            ),
          ],
          const SizedBox(height: 22),
          Text(
            l10n.failurePhoto,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          EvidencePhotoBox(deliveryId: _id),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: RiderButton(
            key: const ValueKey('failure-submit'),
            label: l10n.failureSubmit,
            onPressed: ready ? () => _submit(reason) : null,
          ),
        ),
      ),
    );
  }
}
