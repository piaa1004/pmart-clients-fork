import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../auth/data/session.dart';
import '../data/withdrawal.dart';

String blockerText(AppLocalizations l10n, WithdrawalBlocker b) => switch (b) {
  WithdrawalBlocker.activeDelivery => l10n.wdBlockDelivery,
  WithdrawalBlocker.unsettled => l10n.wdBlockSettle,
  WithdrawalBlocker.restrictionReview => l10n.wdBlockReview,
  WithdrawalBlocker.other => l10n.wdBlockOther,
};

/// 계정 탈퇴: 안내 확인 → (사유, 선택) → 탈퇴하기 → 한 번 더 확인 → 신청 → 결과 확인.
/// 완료(서버 확정)된 뒤에만 로그아웃한다. 접수(202)만으로 탈퇴됐다고 보이지 않는다.
class WithdrawScreen extends ConsumerStatefulWidget {
  const WithdrawScreen({super.key});

  @override
  ConsumerState<WithdrawScreen> createState() => _WithdrawScreenState();
}

class _WithdrawScreenState extends ConsumerState<WithdrawScreen> {
  final _reason = TextEditingController();
  bool _agreed = false;
  bool _busy = false;
  IdempotencyKey? _key;
  String? _requestId;

  /// 화면 아래 결과 안내(거절 사유·처리 중 등).
  String? _note;
  List<WithdrawalBlocker> _blockers = const [];

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _withdraw() async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.wdConfirmTitle),
        content: Text(l10n.wdConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.wdCancel),
          ),
          TextButton(
            key: const ValueKey('withdraw-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              l10n.withdraw,
              style: const TextStyle(color: RiderColors.danger),
            ),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() {
      _busy = true;
      _note = null;
      _blockers = const [];
    });
    final repo = ref.read(withdrawalRepositoryProvider);
    try {
      // 결과를 모르는 신청은 같은 키로 다시 보낸다.
      final key = _key ??= IdempotencyKey.generate();
      _requestId ??= await repo.request(reason: _reason.text, key: key);
      await _check();
    } on UnknownResultFailure catch (f) {
      if (!mounted) return;
      // 501 = 서버에 아직 탈퇴 기능이 없다(계약만 있음). 결과 불명이 아니다 — 다시 눌러도 같다.
      final notReady = (f.problem?.status ?? f.httpStatus) == 501;
      setState(() {
        _busy = false;
        if (notReady) _key = null;
        _note = notReady ? l10n.wdNotReady : l10n.wdUnknown;
      });
    } on ProblemFailure catch (f) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _key = null;
        _note = f.problem.code == ProblemCode.invalidState
            ? l10n.wdBlocked
            : l10n.wdFailed;
      });
    } on PmartFailure {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _note = l10n.wdUnknown;
      });
    }
  }

  /// 신청 결과를 몇 번 확인한다. 완료면 로그아웃, 거절이면 사유, 처리 중이면 안내.
  Future<void> _check() async {
    final l10n = AppLocalizations.of(context);
    final repo = ref.read(withdrawalRepositoryProvider);
    for (var i = 0; i < 5; i++) {
      final s = await repo.status(_requestId!);
      if (!mounted) return;
      switch (s.state) {
        case WithdrawalState.completed:
          showRiderToast(context, l10n.wdDone);
          ref.read(sessionProvider.notifier).logout();
          return;
        case WithdrawalState.rejected:
          setState(() {
            _busy = false;
            _key = null;
            _requestId = null;
            _blockers = s.blockers;
            _note = l10n.wdBlocked;
          });
          return;
        case WithdrawalState.pending || WithdrawalState.unknown:
          await Future<void>.delayed(const Duration(seconds: 2));
          if (!mounted) return;
      }
    }
    setState(() {
      _busy = false;
      _note = l10n.wdPending;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.withdraw),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
        children: [
          Text(
            l10n.wdTitle,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 14),
          for (final line in [l10n.wdNote1, l10n.wdNote2, l10n.wdNote3])
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('•  '),
                  Expanded(
                    child: Text(
                      line,
                      style: const TextStyle(fontSize: 14, height: 1.5),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('withdraw-reason'),
            controller: _reason,
            maxLength: 300,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: l10n.wdReason,
              border: const OutlineInputBorder(),
            ),
          ),
          CheckboxListTile(
            key: const ValueKey('withdraw-agree'),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _agreed,
            onChanged: _busy
                ? null
                : (v) => setState(() => _agreed = v ?? false),
            title: Text(l10n.wdAgree, style: const TextStyle(fontSize: 14)),
          ),
          if (_note case final note?) ...[
            const SizedBox(height: 8),
            Container(
              key: const ValueKey('withdraw-note'),
              padding: const EdgeInsets.all(12),
              color: RiderColors.field,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(note, style: const TextStyle(fontSize: 14, height: 1.5)),
                  for (final b in _blockers)
                    Text(
                      '•  ${blockerText(l10n, b)}',
                      style: const TextStyle(fontSize: 14, height: 1.5),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: RiderButton(
            key: const ValueKey('withdraw-submit'),
            label: l10n.withdraw,
            onPressed: _agreed && !_busy ? _withdraw : null,
          ),
        ),
      ),
    );
  }
}
