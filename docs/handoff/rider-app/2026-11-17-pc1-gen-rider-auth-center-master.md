# 알림: 생성기에 rider-auth·center-master 추가, case 를 rider 에도 — PC 5 가 고침

- 보낸 앱: rider-app (PC 5)
- 받는 곳: PC 1 (공유 파일 `tools/gen_api.dart`·`contracts.lock` 담당). 백엔드 변경 없음.
- 작성: 2026-11-17
- 계기: 사용자 지시 2026-11-17 "전부 이어서 해". 라이더 실서버 로그인·지점 목록·배송 밖 문의를 붙이려고 공유 파일을 PC 5 가 직접 고쳤다(PC 1 에 미리 묻지 못함).

## 고친 것
`tools/gen_api.dart` 서비스 표:
- `'rider-auth-service': ['rider']` 새로. 라이더 Google 로그인(`POST /rider-auth/social-logins`), 토큰 갱신, 로그아웃.
- `'center-master-service': ['rider']` 새로. 라이더 지점 목록(`GET /mfc-pickup-points`).
- `'case-service': ['customer', 'rider']`: 라이더 배송 밖 문의(`/inquiries`, 라이더 토큰)에 쓴다.

라이더앱 `pubspec.yaml` 에 다음을 더했다.
- `pmart_api_rider_auth`·`pmart_api_center_master`·`pmart_api_case`·`pmart_api_notification`
- `google_sign_in: ^7.2.0`(고객앱과 같은 버전)

## PC 1 이 할 일
- `contracts.lock` 은 고치지 않았다. 생성기가 바꾼 것을 되돌렸다. 합칠 때 PC 1 이 다시 생성해 lock 을 맞춰 달라.
  - 이번에 다시 만든 서비스: delivery-execution·delivery-dispatch·rider·rider-auth·center-master·case·notification.
  - 백엔드 커밋은 생성기 기준 a07c594·22be83f.
- case·notification 을 다시 생성해서 고객앱이 쓰는 생성 코드도 최신 계약으로 바뀌었다. 생성물은 커밋하지 않는다. 고객앱이 깨지는지는 PC 1 에서 다시 생성한 뒤 확인해 달라. PC 5 는 고객앱을 돌려 보지 않았다.

## 남은 외부 작업 — Google 콘솔
라이더 실서버 로그인에는 Google Cloud 콘솔(프로젝트 293585219605)에 **라이더앱 Android OAuth 클라이언트**가 있어야 한다.
- 패키지 이름: `com.pmart.rider_app`
- 서명 SHA-1: 기기마다 debug 키가 다르다. PC 5 debug 키는 `F1:2C:3A:99:FD:88:48:6A:76:34:57:FF:49:A3:CE:31:BD:0C:66:1A`.
- 웹 클라이언트 ID(serverClientId·aud): `293585219605-la3cj13q…` 는 백엔드 `rider-auth-service.yml` 과 같다. 앱 기본값으로 넣었다(공개 식별자).

없으면 앱에서 "Google 로그인 설정이 아직 끝나지 않았어요"가 뜬다(DEVELOPER_ERROR).
