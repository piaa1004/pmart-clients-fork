# 카카오·네이버 로그인 붙이는 법 (Flutter 앱 공통 안내)

- 작성: PC 1(customer-app), 2026-11-19. 고객앱에서 붙인 방식을 다른 PC(특히 **PC 5 rider-app** — 백엔드가 rider-auth-service 도 같은 방식으로 이어서 만든다)가 그대로 쓰도록 적는다.
- 서버 정본: `../pmart-backend/contracts/openapi/auth-service.yaml` 0.4.0(ADR-0071), 백엔드 요청 `../pmart-backend/docs/handoff/clients/customer-app/2026-11-19-request-kakao-naver-login.md`. 라이더는 rider-auth-service 계약이 나오면 그 계약을 따른다(아래는 고객 기준).
- 고객앱 코드(2026-11-19 네이버 OIDC 반영): `apps/customer_app/lib/features/auth/data/kakao_naver_token_sources.dart`(`NaverSocialTokenSource`), `android/app/build.gradle.kts`(dart-define → 매니페스트), `AndroidManifest.xml`.

## 1. 서버가 받는 것 — 세 제공자 모두 같다
- `POST /auth/social-logins` 에 `provider`(GOOGLE·KAKAO·NAVER)와 `providerToken` = **제공자 OpenID Connect ID 토큰(JWT)**.
- 서버는 제공자 공개키(JWKS)로 서명·`iss`·`aud`·만료를 검증한다. **access token·인가 코드는 받지 않는다. 서버·앱 모두 client secret 이 필요 없다.**
- `aud`(서버에 등록할 값): 카카오 = SDK 초기화에 쓴 **네이티브 앱 키**, 네이버 = **Client ID**.
- 서버에 그 제공자 설정이 없으면 422 `CONFIG_REQUIRED` → 앱은 "준비 중" 문구. 그 밖 오류는 Google 과 같다(401 PROVIDER_REJECTED, 423 AUTH_RESTRICTED, 503 PROVIDER_UNAVAILABLE).
- 계정은 제공자마다 따로 생긴다(같은 이메일이어도 합치지 않음).

## 2. 카카오
- 패키지 `kakao_flutter_sdk_user`(고객앱 ^2.1.0). `main` 에서 `KakaoSdk.init(nativeAppKey: …)`.
- 로그인: 카카오톡 있으면 `loginWithKakaoTalk()`, 없으면 `loginWithKakaoAccount()` → 결과의 **`idToken`** 을 보낸다(`accessToken` 아님).
- **카카오 개발자 콘솔**: 카카오 로그인 활성화, **OpenID Connect 활성화**(꺼져 있으면 `idToken` 이 null), Android 플랫폼에 패키지명·키 해시 등록.
- 매니페스트: 카카오계정(웹) 로그인 뒤 돌아오는 `kakao{네이티브 앱 키}://oauth` intent-filter(고객앱 `AndroidManifest.xml` 참고).
- 취소: `KakaoAuthException(accessDenied)`·`KakaoClientException(cancelled)`·`PlatformException('CANCELED')` → 조용히 null.

## 3. 네이버 — SDK 가 아니라 OIDC(인가 코드 + PKCE)
- **네이버 로그인 SDK(flutter_naver_login)는 access token 만 준다 → 서버가 못 받는다.** 고객앱은 SDK 를 빼고 `flutter_appauth`(^13.0.0, 사용자 승인 2026-11-19)로 바꿨다.
- 네이버 OIDC 설정(공개 문서 `https://nid.naver.com/.well-known/openid-configuration`, 2026-11-19 확인):
  - authorization `https://nid.naver.com/oauth2/authorize`, token `https://nid.naver.com/oauth2/token`, issuer `https://nid.naver.com`
  - scope `openid`, PKCE `S256`, 토큰 엔드포인트 인증 `none` 허용 → **앱에 Client Secret 을 넣지 않는다.**
- 요청: `AuthorizationTokenRequest(clientId, redirectUrl, scopes: ['openid'], serviceConfiguration: …)` → `authorizeAndExchangeCode` → 결과의 **`idToken`** 을 보낸다. 취소는 `FlutterAppAuthUserCancelledException` → null.

### redirect 주소(= 콜백 주소)란
네이버 로그인 화면(브라우저 탭)에서 고객이 로그인·동의를 마치면, 네이버가 **결과(인가 코드)를 "이 주소로" 돌려보낸다.** 그 주소가 우리 앱을 가리켜야 앱이 결과를 받아 토큰으로 바꿀 수 있다. 네이버는 **콘솔에 등록된 주소로만** 돌려보낸다(아무 데나 보내면 코드를 가로챌 수 있어서).

- 고객앱: `com.pmart.customer://oauth/naver`
  - 앱 쪽: `build.gradle.kts` 에 `manifestPlaceholders["appAuthRedirectScheme"] = "com.pmart.customer"`(flutter_appauth 가 이 scheme 을 받는 화면을 넣는다). 코드의 redirectUrl 도 같은 값.
  - scheme 에 밑줄(`_`)은 못 쓴다(URI 규칙) — 패키지명 `com.pmart.customer_app` 을 그대로 쓰지 않은 이유.
- 라이더앱(제안): `com.pmart.rider://oauth/naver` — 앱마다 다른 scheme 을 써야 결과가 엉뚱한 앱으로 가지 않는다.
- **네이버 개발자 콘솔**: 해당 애플리케이션 → API 설정 → 로그인 오픈 API 서비스 환경에 Callback URL 을 넣는 칸이 있어야 한다. 2026-11-19 사용자 확인으로는 **Android 환경만 고르면 Callback URL 칸이 없었다** — 칸이 나오는 환경(PC 웹 등)을 추가해 위 주소를 넣어야 하는지, 네이버가 `http(s)` 가 아닌 앱 주소를 받아 주는지는 **아직 확인 전**. 확인되면 이 문서를 고친다.
- **2026-11-19 갱신**: 네이버 콘솔이 앱 주소를 받지 않음(사용자 확인), 도메인 없음 → LAN 게이트웨이에 중계 주소를 요청(BR-66, `docs/handoff/customer-app/2026-11-19-backend-naver-oauth-callback-relay.md`). 회신이 오면 Callback URL·앱 redirectUrl 을 그 주소로 바꾼다.

## 4. 키 두는 곳
- 키는 저장소에 넣지 않는다. 고객앱은 `apps/customer_app/.secrets/customer.env`(git 제외)를 `--dart-define-from-file` 로 넣고, `build.gradle.kts` 가 dart-define 을 풀어 매니페스트 값으로 쓴다.
  - `KAKAO_NATIVE_APP_KEY`, `NAVER_CLIENT_ID`(공개 값이지만 저장소에는 넣지 않음). `NAVER_CLIENT_SECRET` 은 OIDC 방식에서 **쓰지 않는다**.
- 백엔드에는 **카카오 네이티브 앱 키·네이버 Client ID** 만 알려 준다(서버 허용 `aud`). 채팅·문서·로그에 키 값을 적지 않는다.
- 같은 카카오·네이버 애플리케이션을 고객·라이더가 같이 쓸지, 따로 만들지는 사용자 결정(따로면 키도 따로).

## 5. 확인 순서
1. 콘솔 설정(카카오 OIDC·키 해시, 네이버 Callback URL) → 2. 백엔드에 키 전달·LAN 배포 확인(배포 전이면 422) → 3. LAN APK(`--dart-define-from-file=.secrets/…`)로 실기기 로그인.
- 시험: 토큰 소스는 목(`SocialTokenSource`)으로 바꿔 위젯 시험, SDK·브라우저 동작은 실기기에서만 확인.
