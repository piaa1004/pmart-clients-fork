import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_api_rider_auth/pmart_api_rider_auth.dart' as ra;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';

/// 라이더용 Google 웹 클라이언트 ID(serverClientId). Google 이 주는 ID 토큰의 `aud` 가 이 값이고,
/// rider-auth-service 는 이 값만 받는다(고객용 ID 로는 라이더 로그인이 안 된다). 공개 식별자 — 비밀값 아님
/// (백엔드 `docs/architecture/auth/login-structure-and-flow.md` §2, ADR-0055). client secret 은 쓰지 않는다.
const riderGoogleServerClientId = String.fromEnvironment(
  'PMART_RIDER_GOOGLE_SERVER_CLIENT_ID',
  defaultValue: '293585219605-la3cj13q19oo51p7e4d0rf4ickh3flgu.apps.googleusercontent.com',
);

/// 실서버 로그인 결과(목 모드는 [RiderLogin] 을 거치지 않는다).
sealed class RiderLoginOutcome {
  const RiderLoginOutcome();
}

/// 로그인됨. [registered] = rider-service 프로필이 있음(`GET /riders/me` 404 면 false → 가입 화면).
final class RiderLoggedIn extends RiderLoginOutcome {
  const RiderLoggedIn({required this.riderId, required this.registered});
  final String riderId;
  final bool registered;
}

/// 계정 선택 창을 닫았다(서버를 부르지 않는다).
final class RiderLoginCanceled extends RiderLoginOutcome {
  const RiderLoginCanceled();
}

/// Google 설정 문제(이 앱의 Android 클라이언트 — 패키지·서명 SHA-1 — 가 콘솔에 없음 등, DEVELOPER_ERROR).
final class RiderLoginMisconfigured extends RiderLoginOutcome {
  const RiderLoginMisconfigured();
}

/// 서버가 거절했다(Problem code). 예: PROVIDER_REJECTED·ACCOUNT_NOT_AVAILABLE·AUTH_RESTRICTED.
final class RiderLoginRejected extends RiderLoginOutcome {
  const RiderLoginRejected(this.code);
  final String? code;
}

/// 연결 문제·Google 장애·결과 불명 — 잠시 뒤 다시.
final class RiderLoginUnavailable extends RiderLoginOutcome {
  const RiderLoginUnavailable();
}

/// Google 계정 선택 → ID 토큰. 토큰은 로그·오류 문구에 남기지 않는다.
abstract interface class GoogleIdTokenSource {
  /// 취소면 null. 설정 문제면 [RiderLoginMisconfigured] 를, 장애면 [RiderLoginUnavailable] 를 던진다.
  Future<String?> obtain();

  Future<void> signOut();
}

final class GoogleSignInIdTokenSource implements GoogleIdTokenSource {
  GoogleSignInIdTokenSource({GoogleSignIn? signIn})
    : _signIn = signIn ?? GoogleSignIn.instance;

  final GoogleSignIn _signIn;
  Future<void>? _initialized;

  @override
  Future<String?> obtain() async {
    try {
      await (_initialized ??= _signIn.initialize(
        serverClientId: riderGoogleServerClientId,
      ));
      final account = await _signIn.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw const RiderLoginMisconfigured();
      }
      return idToken;
    } on GoogleSignInException catch (e) {
      return switch (e.code) {
        GoogleSignInExceptionCode.canceled ||
        GoogleSignInExceptionCode.interrupted => null,
        GoogleSignInExceptionCode.clientConfigurationError ||
        GoogleSignInExceptionCode.providerConfigurationError =>
          throw const RiderLoginMisconfigured(),
        _ => throw const RiderLoginUnavailable(),
      };
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await (_initialized ??= _signIn.initialize(
        serverClientId: riderGoogleServerClientId,
      ));
      await _signIn.signOut();
    } on Object {
      // 기기 Google 로그아웃 실패는 무시한다(PMart 토큰은 지웠다).
    }
  }
}

final googleIdTokenSourceProvider = Provider<GoogleIdTokenSource>(
  (_) => GoogleSignInIdTokenSource(),
);

/// rider-auth-service 로그인·로그아웃 + 가입 여부 확인.
final class RiderLogin {
  RiderLogin({
    required Dio dio,
    required this.tokens,
    required this.deviceId,
    required this.google,
  }) : _logins = ra.PmartApiRiderAuth(dio: dio).getLoginsApi(),
       _tokensApi = ra.PmartApiRiderAuth(dio: dio).getTokensApi(),
       _me = rd.PmartApiRider(dio: dio).getMeApi();

  final ra.LoginsApi _logins;
  final ra.TokensApi _tokensApi;
  final rd.MeApi _me;
  final TokenStore tokens;
  final DeviceIdProvider deviceId;
  final GoogleIdTokenSource google;

  Future<RiderLoginOutcome> login() async {
    final String? idToken;
    try {
      idToken = await google.obtain();
    } on RiderLoginOutcome catch (o) {
      return o;
    }
    if (idToken == null) return const RiderLoginCanceled();
    final key = IdempotencyKey.generate();
    final ra.RiderAuthResult result;
    try {
      final res = await pmartGuard(
        () async => _logins.riderSocialLogin(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          xDeviceId: await deviceId.get(),
          riderSocialLoginRequest: ra.RiderSocialLoginRequest(
            provider: ra.Provider.GOOGLE,
            providerToken: idToken!,
          ),
          extra: commandOptions(key).extra,
        ),
      );
      result =
          res.data ??
          (throw const ContractViolationFailure('RiderAuthResult 본문 없음'));
    } on ProblemFailure catch (f) {
      return RiderLoginRejected(f.problem.code);
    } on PmartFailure {
      return const RiderLoginUnavailable();
    }
    final pair = result.tokens;
    if (pair == null) return const RiderLoginUnavailable();
    await tokens.save(
      AuthTokens(
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      ),
    );
    // 가입 여부: GET /riders/me — 404 면 미가입(가입 화면으로).
    var registered = !result.newAccount;
    try {
      await pmartGuard(() => _me.getMyRider());
      registered = true;
    } on ProblemFailure catch (f) {
      if (f.problem.status == 404) registered = false;
    } on PmartFailure {
      // 확인하지 못했다 — 새 계정 여부로 판단한다.
    }
    return RiderLoggedIn(riderId: result.riderId, registered: registered);
  }

  /// 서버 세션을 끝내고(이 기기만) 토큰을 지운다. 서버 호출이 실패해도 기기 토큰은 지운다.
  Future<void> logout() async {
    if (await tokens.readRefreshToken() != null) {
      final key = IdempotencyKey.generate();
      try {
        await pmartGuard(
          () async => _tokensApi.riderLogout(
            idempotencyKey: key.value,
            xSourceSystem: sourceSystem,
            riderLogoutRequest: ra.RiderLogoutRequest(allDevices: false),
            extra: commandOptions(key).extra,
          ),
        );
      } on PmartFailure {
        // 세션은 서버에서 만료로 끝난다.
      }
    }
    await tokens.clear();
    await google.signOut();
  }
}

final riderLoginProvider = Provider<RiderLogin>(
  (ref) => RiderLogin(
    dio: ref.watch(dioProvider),
    tokens: ref.watch(tokenStoreProvider),
    deviceId: ref.watch(deviceIdProvider),
    google: ref.watch(googleIdTokenSourceProvider),
  ),
);

/// `POST /rider-auth/tokens` 로 토큰을 회전한다. 인증 인터셉터를 거치지 않는 별도 Dio(갱신이 다시
/// 갱신을 부르지 않게). 401(TOKEN_INVALID·TOKEN_REUSED)이면 세션 폐기 → null(재로그인).
TokenRefresher riderRefresher({
  required String baseUrl,
  required DeviceIdProvider deviceId,
  HttpClientAdapter? adapter,
}) {
  final dio = Dio(BaseOptions(baseUrl: baseUrl));
  if (adapter != null) dio.httpClientAdapter = adapter;
  final api = ra.PmartApiRiderAuth(dio: dio).getTokensApi();
  return (refreshToken) async {
    try {
      final res = await api.refreshRiderTokens(
        idempotencyKey: IdempotencyKey.generate().value,
        xSourceSystem: sourceSystem,
        xDeviceId: await deviceId.get(),
        refreshRiderTokensRequest: ra.RefreshRiderTokensRequest(
          refreshToken: refreshToken,
        ),
      );
      final pair =
          res.data ?? (throw const ContractViolationFailure('TokenPair 본문 없음'));
      return AuthTokens(
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      );
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) return null;
      throw PmartFailure.fromDioException(e);
    }
  };
}
