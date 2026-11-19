import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../domain/profile.dart';
import 'profile_avatar.dart';
import 'profile_controller.dart';

/// 마이 목록에 보일 한 줄 요약(이름 · 가린 번호). 번호는 등록된 것이 있을 때만 붙인다
/// (연락처 등록은 서버가 아직 열지 않아 "번호 없음"을 따로 보이지 않는다, 2026-11-03 안내).
String myInfoSummary(AppLocalizations l10n, Profile p) {
  final name = p.nickname?.trim() ?? '';
  if (name.isEmpty && !p.hasPhone) return l10n.infoNotSet;
  return [
    name.isEmpty ? l10n.infoNameNotSet : name,
    if (p.hasPhone) p.phoneMasked!,
  ].join(' · ');
}

/// SCR-ACCOUNT 내 정보: 이름(닉네임). 회원가입 직후([signup])와 마이에서 같은 화면을 쓴다.
/// 저장은 서버 결과(APPLIED)로만 확정한다.
/// 휴대폰 번호는 서버가 연락처 변경을 아직 열지 않아(보내면 400, 2026-11-03 안내) 칸을 잠그고 보내지 않는다.
///
/// 가입 직후에는 저장할 때까지 닫지 않는다. 서버가 저장을 제공하지 않거나(501)
/// 결과를 확인하지 못했을 때만 "나중에 하기"를 연다(가입을 막지 않는다).
class MyInfoScreen extends ConsumerStatefulWidget {
  const MyInfoScreen({super.key, this.signup = false});

  final bool signup;

  @override
  ConsumerState<MyInfoScreen> createState() => _MyInfoScreenState();
}

class _MyInfoScreenState extends ConsumerState<MyInfoScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  bool _filled = false;
  ProfileChangeOutcome? _last;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  bool get _canSkip =>
      _last is ProfileChangeUnsupported || _last is ProfileChangeUnknown;

  Future<void> _save(Profile? current) async {
    if (!(_form.currentState?.validate() ?? false)) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final name = _name.text.trim();
    // 바뀐 항목만 보낸다. 번호는 서버가 아직 받지 않으므로 보내지 않는다.
    final nameChanged = name != (current?.nickname?.trim() ?? '');
    if (!nameChanged) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.infoNothingChanged)));
      return;
    }
    final outcome = await ref
        .read(profileProvider.notifier)
        .changeProfile(name: name);
    if (!mounted) return;
    setState(() => _last = outcome);
    if (outcome is ProfileChangeApplied) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.infoSaved)));
      context.pop(true);
    }
  }

  String? _message(AppLocalizations l10n) => switch (_last) {
    null || ProfileChangeApplied() => null,
    ProfileChangePending() => l10n.infoPending,
    ProfileChangeUnsupported() => l10n.infoUnsupported,
    ProfileChangeRejected() => l10n.infoRejected,
    ProfileChangeUnknown() => l10n.infoUnknown,
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final value = ref.watch(profileProvider);
    final profile = value.value;
    // 서버 값으로 한 번만 채운다(입력 중에 덮어쓰지 않는다).
    if (!_filled && profile != null) {
      _filled = true;
      _name.text = profile.nickname ?? '';
    }
    final hasPhone = profile?.hasPhone ?? false;
    final message = _message(l10n);
    return PopScope(
      canPop: !widget.signup || _canSkip,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.signup ? l10n.infoSignupTitle : l10n.infoTitle),
          automaticallyImplyLeading: !widget.signup,
        ),
        body: switch (value) {
          AsyncError() when profile == null => Center(
            child: Text(l10n.infoLoadFailed),
          ),
          _ when profile == null => const Center(
            child: CircularProgressIndicator(),
          ),
          _ => Form(
            key: _form,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _ProviderProfile(profile: profile),
                const SizedBox(height: 16),
                Text(widget.signup ? l10n.infoSignupGuide : l10n.infoGuide),
                const SizedBox(height: 16),
                TextFormField(
                  key: const ValueKey('info-name'),
                  controller: _name,
                  maxLength: NameInput.maxLength,
                  decoration: InputDecoration(labelText: l10n.infoName),
                  validator: (v) =>
                      NameInput.valid(v ?? '') ? null : l10n.infoNameInvalid,
                ),
                const SizedBox(height: 8),
                // 휴대폰 번호는 "번호 확인"(OCTOMO) 화면에서 넣고 확인한다(customer 0.9.0). 여기서는 보이기만.
                TextFormField(
                  key: ValueKey('info-phone-${profile.phoneMasked}'),
                  enabled: false,
                  initialValue: hasPhone ? profile.phoneMasked : '',
                  decoration: InputDecoration(
                    labelText: l10n.infoPhone,
                    helperText: !hasPhone
                        ? null
                        : profile.phoneVerified
                        ? l10n.infoPhoneVerified
                        : l10n.infoPhoneUnverified,
                  ),
                ),
                if (!profile.phoneVerified)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      key: const ValueKey('info-phone-verify'),
                      onPressed: () => context.push('/me/phone-verification'),
                      child: Text(l10n.infoPhoneVerify),
                    ),
                  ),
                if (message != null) ...[
                  const SizedBox(height: 8),
                  Text(message, key: const ValueKey('info-message')),
                ],
                const SizedBox(height: 16),
                CommandButton(
                  key: const ValueKey('info-save'),
                  label: l10n.infoSave,
                  onPressed: () => _save(profile),
                ),
                if (widget.signup && _canSkip)
                  TextButton(
                    key: const ValueKey('info-later'),
                    onPressed: () => context.pop(false),
                    child: Text(l10n.infoLater),
                  ),
              ],
            ),
          ),
        },
      ),
    );
  }
}

/// 로그인 제공자(Google) 프로필: 사진·이름·이메일. 서버가 로그인마다 최신으로 바꾸고 여기서는 바꿀 수 없다(ADR-0024).
/// 값이 없으면 "정보 없음"으로 둔다(빈칸을 다른 값으로 채우지 않는다).
class _ProviderProfile extends StatelessWidget {
  const _ProviderProfile({required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final emailLine = profile.hasEmail
        ? switch (profile.emailVerified) {
            true => l10n.infoEmailVerified(profile.email!.trim()),
            _ => profile.email!.trim(),
          }
        : l10n.infoGoogleEmailNotSet;
    return Card(
      key: const ValueKey('info-google'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            ProfileAvatar(profile: profile, radius: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    profile.hasProviderName
                        ? profile.name!.trim()
                        : l10n.infoGoogleNameNotSet,
                    style: theme.textTheme.titleMedium,
                  ),
                  Text(emailLine, style: theme.textTheme.bodySmall),
                  const SizedBox(height: 4),
                  Text(
                    l10n.infoGoogleNote,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
