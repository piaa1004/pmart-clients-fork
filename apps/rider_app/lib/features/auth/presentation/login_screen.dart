import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../data/session.dart';

/// 로그인 결과 안내(로그인됨·취소는 안내 없음).
String? loginResultText(AppLocalizations l10n, LoginResult r) => switch (r) {
  LoginResult.loggedIn || LoginResult.canceled => null,
  LoginResult.misconfigured => l10n.loginMisconfigured,
  LoginResult.rejected => l10n.loginRejected,
  LoginResult.unavailable => l10n.loginUnavailable,
};

/// 로그인. 라이더 인증은 Google 로그인 하나다(백엔드 ADR-0054·0055) — 레퍼런스의 아이디·비밀번호 칸은 두지 않는다.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _busy = false;

  Future<void> _login() async {
    final l10n = AppLocalizations.of(context);
    setState(() => _busy = true);
    final result = await ref.read(sessionProvider.notifier).loginWithGoogle();
    if (!mounted) return;
    setState(() => _busy = false);
    if (loginResultText(l10n, result) case final text?) {
      showRiderToast(context, text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 72),
              Text(
                l10n.loginHello,
                style: const TextStyle(
                  fontSize: 28,
                  height: 1.45,
                  color: RiderColors.ink,
                ),
              ),
              const SizedBox(height: 36),
              Text(
                l10n.loginGuide,
                style: const TextStyle(fontSize: 15, color: RiderColors.sub),
              ),
              const SizedBox(height: 20),
              RiderButton(
                key: const ValueKey('login-google'),
                label: l10n.loginGoogle,
                onPressed: _busy ? null : _login,
              ),
              const Spacer(),
              Center(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      l10n.loginNoAccount,
                      style: const TextStyle(
                        fontSize: 15,
                        color: RiderColors.ink,
                      ),
                    ),
                    InkWell(
                      key: const ValueKey('login-apply'),
                      onTap: () => context.push('/signup/intro'),
                      child: Padding(
                        padding: const EdgeInsets.all(6),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              l10n.loginApply,
                              style: const TextStyle(
                                fontSize: 15,
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
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }
}
