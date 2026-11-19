import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/sms_composer.dart';
import '../../address/presentation/phone_number_formatter.dart';
import '../domain/phone_verification.dart';
import '../domain/profile.dart';
import 'profile_controller.dart';

enum _Step { input, send, done }

/// 휴대폰 번호 확인(customer 0.9.0 — OCTOMO). 레퍼런스 13(연령확인) 모양: 위 X·가운데 제목, 큰 두 줄 질문,
/// 테두리 위 이름이 붙는 칸, 아래 고정 버튼. 단계: 번호 입력 → 문자 보내기("보냈어요") → 확인 완료.
/// 고객이 대표번호로 숫자를 **직접 문자로 보낸다**(우리가 보내지 않음). "보냈어요"는 누를 때만 서버에 묻는다
/// (자동 반복 금지 — OCTOMO 월 한도). 번호 소유만 확인한다.
class PhoneVerificationScreen extends ConsumerStatefulWidget {
  const PhoneVerificationScreen({super.key});

  @override
  ConsumerState<PhoneVerificationScreen> createState() =>
      _PhoneVerificationScreenState();
}

class _PhoneVerificationScreenState
    extends ConsumerState<PhoneVerificationScreen> {
  final _phone = TextEditingController();
  _Step _step = _Step.input;
  PhoneVerificationStart? _started;
  String? _error;
  String? _info;
  bool _filled = false;
  Timer? _tick;
  String? _verifiedPhone;

  /// 010 11자리만 확인할 수 있다(서버 PHONE_NOT_SUPPORTED 와 같게).
  static final _mobile010 = RegExp(r'^010\d{8}$');

  @override
  void dispose() {
    _phone.dispose();
    _tick?.cancel();
    super.dispose();
  }

  String get _digits => PhoneInput.normalize(_phone.text);

  Future<void> _next() async {
    final l10n = AppLocalizations.of(context);
    if (!_mobile010.hasMatch(_digits)) {
      setState(() => _error = l10n.pvPhoneInvalid);
      return;
    }
    setState(() {
      _error = null;
      _info = null;
    });
    // 번호가 프로필과 다르면 먼저 저장(BR-32 — 확인 안 된 번호로).
    final profile = ref.read(profileProvider).value;
    if (profile?.phone != _digits) {
      final saved = await ref
          .read(profileProvider.notifier)
          .changeProfile(phone: _digits);
      if (!mounted) return;
      if (saved is! ProfileChangeApplied) {
        setState(
          () => _error = switch (saved) {
            ProfileChangeRejected(:final code)
                when code == ProblemCode.validationFailed =>
              l10n.pvPhoneInvalid,
            ProfileChangePending() ||
            ProfileChangeUnknown() => l10n.contactSaveUnknown,
            _ => l10n.contactSaveFailed,
          },
        );
        return;
      }
    }
    await _start();
  }

  Future<void> _start() async {
    final l10n = AppLocalizations.of(context);
    final repo = ref.read(phoneVerificationRepositoryProvider);
    final key = IdempotencyKey.generate();
    try {
      PhoneVerificationStart started;
      try {
        started = await repo.start(key: key);
      } on UnknownResultFailure {
        started = await repo.start(key: key); // 같은 키 — 같은 본문
      }
      if (!mounted) return;
      _tick?.cancel();
      _tick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() {});
      });
      setState(() {
        _started = started;
        _step = _Step.send;
        _error = null;
        _info = null;
      });
    } on ProblemFailure catch (f) {
      if (!mounted) return;
      final code = f.problem.code;
      if (code == ProblemCode.invalidState) {
        // 이미 확인된 번호.
        ref.invalidate(profileProvider);
        setState(() {
          _verifiedPhone = PhoneNumberFormatter.format(_digits);
          _step = _Step.done;
        });
        return;
      }
      setState(
        () => _error = switch (code) {
          PhoneVerificationCode.phoneNotSupported ||
          PhoneVerificationCode.phoneRequired => l10n.pvPhoneInvalid,
          PhoneVerificationCode.tooManyVerifications => l10n.pvTooMany,
          'CONFIG_REQUIRED' => l10n.pvUnavailable,
          _ => l10n.pvStartFailed,
        },
      );
    } on PmartFailure {
      if (mounted) setState(() => _error = l10n.pvStartFailed);
    }
  }

  /// 앞 화면이 있으면 돌아가고(확인했으면 true), 이 화면만 열려 있으면(링크로 들어옴) 내 정보로.
  void _leave() {
    if (context.canPop()) {
      context.pop(_step == _Step.done);
    } else {
      context.go('/me/info');
    }
  }

  Future<void> _openSms() async {
    final s = _started;
    if (s == null) return;
    final opened = await ref.read(smsComposerProvider)(s.sendTo, s.text);
    if (!opened && mounted) {
      setState(() => _info = AppLocalizations.of(context).pvNoSmsApp);
    }
  }

  Future<void> _copy() async {
    final s = _started;
    if (s == null) return;
    await Clipboard.setData(ClipboardData(text: s.text));
    if (mounted) {
      setState(() => _info = AppLocalizations.of(context).pvCopied);
    }
  }

  Future<void> _sent() async {
    final s = _started;
    if (s == null) return;
    final l10n = AppLocalizations.of(context);
    final repo = ref.read(phoneVerificationRepositoryProvider);
    final key = IdempotencyKey.generate();
    try {
      PhoneVerificationStatus status;
      try {
        status = await repo.confirm(s.verificationId, key: key);
      } on UnknownResultFailure catch (f) {
        // 503(OCTOMO 장애·한도) — 횟수 줄지 않음, 잠시 뒤 다시. 그 밖 결과 불명은 같은 키로 한 번 더.
        if (f.httpStatus == 503) {
          if (mounted) setState(() => _error = l10n.pvCheckLater);
          return;
        }
        status = await repo.confirm(s.verificationId, key: key);
      }
      if (!mounted) return;
      switch (status.state) {
        case PhoneVerificationState.verified:
          _tick?.cancel();
          ref.invalidate(profileProvider);
          setState(() {
            _verifiedPhone = s.phoneMasked;
            _step = _Step.done;
            _error = null;
          });
        case PhoneVerificationState.pending:
          setState(() {
            _error = l10n.pvNotArrived(status.remainingAttempts);
            _info = null;
          });
        case PhoneVerificationState.expired:
          _restart(l10n.pvExpired);
        case PhoneVerificationState.failed:
          _restart(
            status.failureReason == PhoneVerificationFailure.phoneChanged
                ? l10n.pvPhoneChanged
                : l10n.pvTooManyAttempts,
          );
      }
    } on PmartFailure {
      if (mounted) setState(() => _error = l10n.pvCheckLater);
    }
  }

  void _restart(String why) {
    _tick?.cancel();
    setState(() {
      _started = null;
      _step = _Step.input;
      _error = why.isEmpty ? null : why;
      _info = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final profile = ref.watch(profileProvider).value;
    if (!_filled && profile?.phone != null) {
      _filled = true;
      _phone.text = PhoneNumberFormatter.format(profile!.phone!);
    }
    final (headline, body, button) = switch (_step) {
      _Step.input => (l10n.pvInputTitle, _inputBody(l10n), _nextButton(l10n)),
      _Step.send => (l10n.pvSendTitle, _sendBody(l10n), _sentButton(l10n)),
      _Step.done => (l10n.pvDoneTitle, _doneBody(l10n), _doneButton(l10n)),
    };
    return Scaffold(
      key: const ValueKey('pv-screen'),
      appBar: AppBar(
        centerTitle: true,
        title: Text(l10n.pvTitle),
        leading: IconButton(
          key: const ValueKey('pv-close'),
          icon: const Icon(Icons.close),
          tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
          onPressed: _leave,
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 48, 20, 24),
        children: [
          Text(
            headline,
            key: ValueKey('pv-title-${_step.name}'),
            style: theme.textTheme.headlineSmall?.copyWith(
              fontSize: 26,
              height: 1.35,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 40),
          ...body,
          if (_error case final e?)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                e,
                key: const ValueKey('pv-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ),
          if (_info case final i?)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                i,
                key: const ValueKey('pv-info'),
                style: theme.textTheme.bodyMedium,
              ),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: button,
        ),
      ),
    );
  }

  /// 레퍼런스 칸: 테두리 위에 이름이 붙고 오른쪽에 지우기.
  InputDecoration _decoration(String label, {String? hint, Widget? suffix}) =>
      InputDecoration(
        labelText: label,
        hintText: hint,
        floatingLabelBehavior: FloatingLabelBehavior.always,
        suffixIcon: suffix,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 20,
        ),
      );

  List<Widget> _inputBody(AppLocalizations l10n) => [
    TextField(
      key: const ValueKey('pv-phone'),
      controller: _phone,
      autofocus: true,
      keyboardType: TextInputType.phone,
      inputFormatters: const [PhoneNumberFormatter()],
      style: const TextStyle(fontSize: 18),
      decoration: _decoration(
        l10n.pvPhoneLabel,
        hint: l10n.pvPhoneHint,
        suffix: IconButton(
          key: const ValueKey('pv-phone-clear'),
          icon: const Icon(Icons.cancel),
          color: Theme.of(context).colorScheme.outline,
          onPressed: () => setState(_phone.clear),
        ),
      ),
      onChanged: (_) => setState(() => _error = null),
    ),
    const SizedBox(height: 12),
    Text(
      l10n.pvInputGuide,
      style: Theme.of(context).textTheme.bodySmall
          ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
    ),
  ];

  List<Widget> _sendBody(AppLocalizations l10n) {
    final s = _started!;
    final theme = Theme.of(context);
    final left = s.expiresAt.difference(DateTime.now().toUtc());
    final leftText = left.isNegative
        ? l10n.pvTimeOver
        : l10n.pvTimeLeft(
            '${left.inMinutes}:${(left.inSeconds % 60).toString().padLeft(2, '0')}',
          );
    Widget row(String label, String value, {String? key, double size = 17}) =>
        InputDecorator(
          decoration: _decoration(label),
          child: Text(
            value,
            key: key == null ? null : ValueKey(key),
            style: TextStyle(
              fontSize: size,
              fontWeight: FontWeight.w700,
              letterSpacing: size > 20 ? 6 : 0,
            ),
          ),
        );
    return [
      row(l10n.pvSendTo, s.sendTo, key: 'pv-send-to'),
      const SizedBox(height: 16),
      row(l10n.pvSendText, s.text, key: 'pv-send-text', size: 26),
      const SizedBox(height: 10),
      Text(
        l10n.pvSendGuide,
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
      const SizedBox(height: 4),
      Text(
        leftText,
        key: const ValueKey('pv-time-left'),
        style: theme.textTheme.bodySmall?.copyWith(
          color: left.isNegative
              ? theme.colorScheme.error
              : theme.colorScheme.primary,
          fontWeight: FontWeight.w700,
        ),
      ),
      const SizedBox(height: 20),
      Row(
        children: [
          Expanded(
            child: OutlinedButton(
              key: const ValueKey('pv-open-sms'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: _openSms,
              child: Text(l10n.pvOpenSms),
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton(
            key: const ValueKey('pv-copy'),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
            onPressed: _copy,
            child: Text(l10n.pvCopy),
          ),
        ],
      ),
      const SizedBox(height: 8),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton(
          key: const ValueKey('pv-restart'),
          onPressed: () => _restart(''),
          child: Text(l10n.pvChangeNumber),
        ),
      ),
    ];
  }

  List<Widget> _doneBody(AppLocalizations l10n) => [
    InputDecorator(
      decoration: _decoration(l10n.pvPhoneLabel),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _verifiedPhone ?? '',
              style: const TextStyle(fontSize: 18),
            ),
          ),
          Icon(
            Icons.check_circle,
            key: const ValueKey('pv-verified'),
            color: Theme.of(context).colorScheme.primary,
          ),
        ],
      ),
    ),
  ];

  Widget _nextButton(AppLocalizations l10n) => CommandButton(
    key: const ValueKey('pv-next'),
    label: l10n.pvNext,
    onPressed: _digits.length == 11 ? _next : null,
  );

  Widget _sentButton(AppLocalizations l10n) => CommandButton(
    key: const ValueKey('pv-sent'),
    label: l10n.pvSent,
    onPressed: _sent,
  );

  Widget _doneButton(AppLocalizations l10n) => CommandButton(
    key: const ValueKey('pv-done'),
    label: l10n.pvDone,
    onPressed: () async => _leave(),
  );
}
