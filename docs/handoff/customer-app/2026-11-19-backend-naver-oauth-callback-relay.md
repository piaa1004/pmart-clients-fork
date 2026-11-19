# 요청 — 네이버 로그인 콜백 중계 주소(LAN 게이트웨이) (BR-66)

- 보낸 앱: customer-app (PC 1)
- 받는 백엔드 영역: platform (api-gateway·auth-service)
- 답하는 것: `../pmart-backend/docs/handoff/clients/customer-app/2026-11-19-request-kakao-naver-login.md`(auth 0.4.0, ADR-0071)
- 계기: 사용자 2026-11-19 "그 url 안되는것같아서 lan 쪽 연결할려면 백엔드 요청서 작성해야할것같은데"

## 상황
- 앱은 auth 0.4.0 대로 네이버를 **OIDC 인가 코드 + PKCE**(scope `openid`, client secret 없음)로 바꿨다(`flutter_appauth`, 로그인 화면은 휴대폰 브라우저 탭). 받은 `id_token` 을 `POST /auth/social-logins` 로 보낸다.
- 네이버는 로그인이 끝나면 **콘솔에 등록된 Callback URL 로만** 인가 코드를 돌려보낸다. 앱 주소 `com.pmart.customer://oauth/naver` 는 네이버 콘솔이 받지 않는다(사용자 확인 2026-11-19). 우리는 **도메인이 없다.**
- 그래서 LAN 서버에 `https://`(또는 `http://`) 주소를 하나 두고, 네이버가 그리로 돌려보내면 **그대로 앱 주소로 넘겨 주는(302) 중계**가 필요하다.

## 요청
- **R1. 중계 경로** — 예: `GET /api/v1/auth/oauth-callbacks/naver/customer`(공개 경로, 인증 없음).
  - 받은 쿼리(`code`·`state`, 또는 `error`·`error_description`)를 **바꾸지 않고** `com.pmart.customer://oauth/naver?<같은 쿼리>` 로 302.
  - 서버는 코드를 **토큰으로 바꾸지 않는다·저장하지 않는다**(바꾸는 것은 앱이 PKCE verifier 로 직접). 경로·이름은 백엔드가 정해 알려 달라.
- **R2. 열린 리다이렉트 금지** — 넘길 곳은 **고정**(위 앱 주소 하나). 쿼리로 목적지를 받지 않는다. 라이더앱(PC 5, rider-auth-service 이어서)이 쓰면 `…/naver/rider` → `com.pmart.rider://oauth/naver` 처럼 앱마다 고정 경로.
- **R3. 기록 금지** — 인가 코드·state 를 로그·추적에 남기지 않는다(게이트웨이 `TraceUriWithoutQuery` 로 http.uri 쿼리는 이미 빠짐 — 이 경로 접근 로그도 같이 확인).
- **R4. 주소 정하기(사용자와)** — 네이버 콘솔 Callback URL 에 넣을 **정확한 주소**를 알려 달라. 확인할 것:
  - `https://192.168.0.40:8443/...` 이면 폰 브라우저가 사설 CA 를 믿어야 한다(앱의 `trustPmartLanRootCa` 는 앱 안 HTTP 에만, 브라우저 탭에는 안 먹음 — 폰에 LAN 루트 CA 설치 필요, `pc-split.md` LAN 루트 CA 줄). 아니면 `http://192.168.0.40:8080/...`.
  - 네이버 콘솔이 IP 주소·사설 주소·포트가 붙은 Callback URL 을 받는지(PC 웹 환경 "서비스 URL" 과 맞아야 하는지).
  - 사내 와이파이에 붙은 폰에서만 된다(LAN 시험용). 운영은 도메인이 생기면 다시.
- **R5. 키** — 서버 허용 aud 는 네이버 Client ID(사용자가 전달). 중계에는 Client Secret 이 필요 없다.

## 앱이 할 것(회신 뒤)
- `naverRedirectUrl` 을 회신 주소(https/http)로 바꾼다. 네이버 인가 요청·토큰 교환의 `redirect_uri` 는 그 주소, 휴대폰은 중계 302 로 `com.pmart.customer://oauth/naver` 를 받아 flutter_appauth 가 이어 간다(앱 매니페스트 scheme 은 이미 `com.pmart.customer`).
- 실기기에서 로그인 → 동의 → 토큰까지 확인하고 결과를 알린다. 안 되면(예: 앱이 돌아온 주소와 요청 주소가 달라 거절) 다시 알린다 — 이 부분은 **실기기 확인 전**.
- 문서 `docs/operations/social-login-kakao-naver.md` 의 redirect 절을 고친다.
