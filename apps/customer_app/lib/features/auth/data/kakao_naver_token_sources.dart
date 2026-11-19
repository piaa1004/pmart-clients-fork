import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:kakao_flutter_sdk_user/kakao_flutter_sdk_user.dart';

import '../domain/auth.dart';
import 'auth_repository.dart';
import 'google_token_source.dart' show SocialProviderMisconfigured;

/// 카카오 로그인(BR-65): 카카오톡이 있으면 카카오톡, 없으면 카카오계정(웹)으로 로그인해 **OIDC ID 토큰**을
/// `providerToken` 으로 넘긴다(서버가 카카오 JWKS 로 검증 — Google 과 같은 방식, ADR-0055). 콘솔에서 OpenID Connect 를
/// 켜야 ID 토큰이 온다(사용자 2026-11-19 활성화). 토큰은 로그에 남기지 않는다.
final class KakaoSocialTokenSource implements SocialTokenSource {
  const KakaoSocialTokenSource();

  @override
  Future<SocialCredential?> obtain(SocialProvider provider) async {
    if (provider != SocialProvider.kakao) throw const SocialProviderDown();
    try {
      final token = await isKakaoTalkInstalled()
          ? await UserApi.instance.loginWithKakaoTalk()
          : await UserApi.instance.loginWithKakaoAccount();
      final idToken = token.idToken;
      // OIDC 가 꺼져 있으면 ID 토큰이 없다 — 서버가 검증할 수 없어 설정 문제로 알린다.
      if (idToken == null || idToken.isEmpty) {
        throw const SocialProviderMisconfigured();
      }
      return SocialCredential(idToken);
    } on KakaoAuthException catch (e) {
      if (e.error == AuthErrorCause.accessDenied) return null; // 동의 화면에서 취소
      throw const SocialProviderDown();
    } on KakaoClientException catch (e) {
      if (e.reason == ClientErrorCause.cancelled) return null;
      throw const SocialProviderDown();
    } on PlatformException catch (e) {
      // 카카오톡 로그인 화면에서 뒤로 — SDK 가 CANCELED 로 준다.
      if (e.code == 'CANCELED') return null;
      throw const SocialProviderDown();
    }
  }

  /// 카카오 SDK 가 저장한 토큰으로 조용한 재로그인은 하지 않는다(ID 토큰은 새로 로그인할 때만 온다) — 다시 로그인 화면으로.
  @override
  Future<SocialCredential?> obtainSilently(SocialProvider provider) async =>
      null;
}

/// 네이버 Client ID(공개 값, 빌드 때 `.secrets` 에서 dart-define 으로). 비면 네이버 버튼은 설정 문제로 알린다.
const naverClientId = String.fromEnvironment('NAVER_CLIENT_ID');

/// 네이버 로그인 뒤 돌아오는 앱 주소 — 네이버 콘솔 Callback URL 과 build.gradle `appAuthRedirectScheme` 와 같아야 한다.
const naverRedirectUrl = 'com.pmart.customer://oauth/naver';

/// 네이버 OIDC 공개 설정(https://nid.naver.com/.well-known/openid-configuration, 2026-11-19 확인).
const _naverOidc = AuthorizationServiceConfiguration(
  authorizationEndpoint: 'https://nid.naver.com/oauth2/authorize',
  tokenEndpoint: 'https://nid.naver.com/oauth2/token',
);

/// 네이버 로그인(BR-65, auth 0.4.0·ADR-0071): OpenID Connect 인가 코드 + PKCE(scope `openid`, client secret 없음 —
/// 토큰 엔드포인트 인증 none)로 받은 **id_token** 을 `providerToken` 으로 넘긴다. 네이버 SDK 는 액세스 토큰만 줘서 쓰지 않는다.
/// 토큰은 로그에 남기지 않는다.
final class NaverSocialTokenSource implements SocialTokenSource {
  const NaverSocialTokenSource({this.clientId = naverClientId});

  static const _appAuth = FlutterAppAuth();
  final String clientId;

  @override
  Future<SocialCredential?> obtain(SocialProvider provider) async {
    if (provider != SocialProvider.naver) throw const SocialProviderDown();
    if (clientId.isEmpty) throw const SocialProviderMisconfigured();
    try {
      final result = await _appAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          clientId,
          naverRedirectUrl,
          scopes: const ['openid'],
          serviceConfiguration: _naverOidc,
        ),
      );
      final idToken = result.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw const SocialProviderMisconfigured();
      }
      return SocialCredential(idToken);
    } on FlutterAppAuthUserCancelledException {
      return null; // 고객이 로그인 화면을 닫음
    } on PlatformException {
      // 콘솔에 Callback URL 이 없거나 네이버가 거절 — 상세는 화면에 쓰지 않는다.
      throw const SocialProviderDown();
    }
  }

  @override
  Future<SocialCredential?> obtainSilently(SocialProvider provider) async =>
      null;
}

/// 제공자마다 맞는 SDK 로 보낸다.
final class RoutingSocialTokenSource implements SocialTokenSource {
  const RoutingSocialTokenSource({
    required this.google,
    this.kakao = const KakaoSocialTokenSource(),
    this.naver = const NaverSocialTokenSource(),
  });

  final SocialTokenSource google;
  final SocialTokenSource kakao;
  final SocialTokenSource naver;

  SocialTokenSource _of(SocialProvider p) => switch (p) {
    SocialProvider.kakao => kakao,
    SocialProvider.naver => naver,
    _ => google,
  };

  @override
  Future<SocialCredential?> obtain(SocialProvider provider) =>
      _of(provider).obtain(provider);

  @override
  Future<SocialCredential?> obtainSilently(SocialProvider provider) =>
      _of(provider).obtainSilently(provider);
}
