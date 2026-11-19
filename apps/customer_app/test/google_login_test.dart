import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:customer_app/features/auth/data/auth_repository.dart';
import 'package:customer_app/features/auth/data/google_token_source.dart';
import 'package:customer_app/features/auth/data/mock_auth_repository.dart';
import 'package:customer_app/features/auth/domain/auth.dart';
import 'package:customer_app/features/auth/presentation/auth_controller.dart';
import 'package:customer_app/shared/providers.dart';

import 'support/app_harness.dart';

/// 지정한 코드로만 거절하는 목(로그인 화면 문구 확인용).
base class _RejectingAuth extends MockAuthRepository {
  _RejectingAuth(this.code) : super(latency: Duration.zero);

  final String code;

  @override
  Future<LoginOutcome> login(
    SocialProvider provider,
    String providerToken, {
    required LoginPurpose purpose,
    required IdempotencyKey key,
  }) async => LoginRejected(code);
}

/// 복원 때 서버에 물었는지 센다.
base class _CountingAuth extends MockAuthRepository {
  _CountingAuth()
    : super(latency: Duration.zero, restoredAccountId: 'acct-restored');

  int asked = 0;

  @override
  Future<String?> currentAccountId() {
    asked++;
    return super.currentAccountId();
  }
}

void main() {
  setUpAll(initPmartFormatting);

  group('Google Sign-In 결과 → 앱 처리', () {
    test('취소·중단은 null(서버를 부르지 않는다)', () {
      expect(googleSignInFailure(GoogleSignInExceptionCode.canceled), isNull);
      expect(
        googleSignInFailure(GoogleSignInExceptionCode.interrupted),
        isNull,
      );
    });

    test('설정 오류(DEVELOPER_ERROR 등)는 설정 문제로, 그 밖은 제공자 장애로', () {
      expect(
        () => googleSignInFailure(
          GoogleSignInExceptionCode.clientConfigurationError,
        ),
        throwsA(isA<SocialProviderMisconfigured>()),
      );
      expect(
        () => googleSignInFailure(GoogleSignInExceptionCode.unknownError),
        throwsA(isA<SocialProviderDown>()),
      );
    });

    test('서버 클라이언트 ID 기본값은 백엔드가 허용하는 웹 클라이언트 ID 다', () {
      expect(googleServerClientId, endsWith('.apps.googleusercontent.com'));
      expect(googleServerClientId, startsWith('293585219605-p6ak'));
    });
  });

  group('제공자 버튼', () {
    test('실서버·목 모두 카카오·네이버·구글', () {
      ProviderContainer make(PmartEnv env) {
        final c = ProviderContainer(
          overrides: [envProvider.overrideWithValue(env)],
        );
        addTearDown(c.dispose);
        return c;
      }

      expect(make(PmartEnv.local).read(loginProvidersProvider), loginProviders);
      expect(make(PmartEnv.mock).read(loginProvidersProvider), loginProviders);
    });

    test('501 UNSUPPORTED_ACTION 은 결과 불명이 아니라 거절이다', () {
      final outcome = authFailureToOutcome(
        const UnknownResultFailure(
          problem: Problem(status: 501, code: 'UNSUPPORTED_ACTION', raw: {}),
          httpStatus: 501,
        ),
      );
      expect(outcome, isA<LoginRejected>());
      expect((outcome as LoginRejected).code, AuthProblemCode.unsupported);
    });
  });

  testWidgets('목 모드 로그인 화면은 실제 Google 로그인이 아니라고 알린다', (t) async {
    await t.pumpWidget(testApp(const []));
    await t.pumpAndSettle();
    await t.tap(find.text('마이페이지').last);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('my-login')));
    await t.pumpAndSettle();
    expect(find.byKey(const ValueKey('login-mock-notice')), findsOneWidget);
    // 디버그 띠(DEBUG)도 Banner 라 문구로 고른다.
    expect(
      find.byWidgetPredicate((w) => w is Banner && w.message == '목 데이터'),
      findsOneWidget,
    );
  });

  testWidgets('로그인하면 마이에 제공자와 계정(목은 가짜 계정)이 보인다', (t) async {
    await t.pumpWidget(testApp(const []));
    await t.pumpAndSettle();
    await t.tap(find.text('마이페이지').last);
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('my-login')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('login-kakao')));
    await t.pumpAndSettle();

    final account = find.byKey(const ValueKey('my-account'));
    expect(account, findsOneWidget);
    expect(
      find.descendant(of: account, matching: find.text('카카오로 로그인했어요')),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: account,
        matching: find.text('mock-kakao@pmart.invalid'),
      ),
      findsOneWidget,
    );
  });

  group('거절 사유별 문구', () {
    for (final (code, text) in [
      ('PROVIDER_REJECTED', 'Google 계정을 확인하지 못했어요. 다시 로그인해 주세요'),
      ('ACCOUNT_NOT_AVAILABLE', '지금은 이 계정으로 이용할 수 없어요. 고객센터에 문의해 주세요'),
      ('CONFIG_REQUIRED', '로그인 설정에 문제가 있어요. 잠시 후 다시 시도하거나 고객센터에 알려 주세요'),
      ('SOMETHING_ELSE', '로그인하지 못했어요. 다시 시도해 주세요'),
    ]) {
      testWidgets(code, (t) async {
        await t.pumpWidget(testApp(const [], auth: _RejectingAuth(code)));
        await t.pumpAndSettle();
        await t.tap(find.text('마이페이지').last);
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('my-login')));
        await t.pumpAndSettle();
        await t.tap(find.byKey(const ValueKey('login-google')));
        await t.pumpAndSettle();
        expect(find.text(text), findsOneWidget);
      });
    }
  });

  group('세션 복원', () {
    ProviderContainer make(MockAuthRepository auth, TokenStore tokens) {
      final c = ProviderContainer(
        retry: (_, _) => null,
        overrides: [
          envProvider.overrideWithValue(PmartEnv.mock),
          authRepositoryProvider.overrideWithValue(auth),
          tokenStoreProvider.overrideWithValue(tokens),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    test('저장된 refresh token 이 있으면 서버가 확인한 계정으로 회원이 된다', () async {
      final tokens = TokenStore(MemoryKeyValueStore());
      await tokens.save(const AuthTokens(accessToken: 'a', refreshToken: 'r'));
      final c = make(
        MockAuthRepository(latency: Duration.zero, restoredAccountId: 'acct-9'),
        tokens,
      );

      await c.read(sessionRestoreProvider.future);
      expect(c.read(sessionProvider), isA<MemberSession>());
    });

    test('저장된 토큰이 없으면 서버에 묻지 않고 비회원이다', () async {
      final auth = _CountingAuth();
      final c = make(auth, TokenStore(MemoryKeyValueStore()));

      await c.read(sessionRestoreProvider.future);
      expect(c.read(sessionProvider), isA<GuestSession>());
      expect(auth.asked, 0);
    });

    test('서버가 세션을 확인하지 못하면(만료·오류) 비회원으로 둔다', () async {
      final tokens = TokenStore(MemoryKeyValueStore());
      await tokens.save(const AuthTokens(accessToken: 'a', refreshToken: 'r'));
      final c = make(MockAuthRepository(latency: Duration.zero), tokens);

      await c.read(sessionRestoreProvider.future);
      expect(c.read(sessionProvider), isA<GuestSession>());
    });

    test('서버에 닿지 못하면(다른 망) 토큰을 지우지 않고 "확인 못 함"으로 두며, 다시 시도하면 회원이 된다', () async {
      final tokens = TokenStore(MemoryKeyValueStore());
      await tokens.save(const AuthTokens(accessToken: 'a', refreshToken: 'r'));
      final auth = MockAuthRepository(
        latency: Duration.zero,
        restoredAccountId: 'acct-9',
      )..unreachable = true;
      final c = make(auth, tokens);

      await c.read(sessionRestoreProvider.future);
      expect(c.read(sessionProvider), isA<GuestSession>());
      expect(c.read(sessionUnverifiedProvider), isTrue);
      expect(c.read(sessionNoticeProvider), SessionNotice.unreachable);
      expect(await tokens.readRefreshToken(), 'r');

      // 아직 연결 안 됨: 다시 알리지 않는다
      c.read(sessionNoticeProvider.notifier).clear();
      await c.read(sessionProvider.notifier).retryRestore();
      expect(c.read(sessionUnverifiedProvider), isTrue);
      expect(c.read(sessionNoticeProvider), isNull);

      auth.unreachable = false; // Wi-Fi 로 돌아옴
      await c.read(sessionProvider.notifier).retryRestore();
      expect(c.read(sessionProvider), isA<MemberSession>());
      expect(c.read(sessionUnverifiedProvider), isFalse);
    });

    test('확인 못 함이 아니면 다시 시도해도 서버에 묻지 않는다', () async {
      final auth = _CountingAuth();
      final c = make(auth, TokenStore(MemoryKeyValueStore()));
      await c.read(sessionRestoreProvider.future);
      await c.read(sessionProvider.notifier).retryRestore();
      expect(auth.asked, 0);
    });
  });
}
