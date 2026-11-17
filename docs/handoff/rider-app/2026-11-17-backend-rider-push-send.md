# 요청 — 라이더 앱 푸시 발송(FCM)

보낸 앱: rider-app (PC 5)
받는 백엔드 영역: platform (notification-service) — 배차 제안 알림은 delivery(dispatch)와 함께
- 작성: 2026-11-17
- 사용자 요청: "응 요청서 써줘"(푸시가 폰에 안 뜨는 이유를 확인한 뒤)

## 지금 상태
- 앱: Firebase 메시징을 붙였다(firebase_messaging 17.1.0, Android 만). 가입한 라이더가 로그인하면 알림 권한을 받고
  `PUT /me/push-tokens/{deviceId}`(notification 0.3.0)로 **FCM 등록 토큰**을 보낸다. 토큰이 바뀌면 다시, 로그아웃하면 `DELETE`.
  LAN 실기기 확인: PUT 200 · DELETE 204 · 다시 로그인 PUT 200(2026-11-17, deviceId 는 설치 ID).
- 서버: 계약 설명대로 "토큰만 저장한다 — 푸시 발송(FCM)은 아직 없다(자격증명·발송 정책 미정)". 그래서 폰에 알림이 하나도 오지 않는다.
  라이더는 앱을 열어 둔 동안의 조회·알림함(`GET /me/notifications`, 0.4.0)으로만 소식을 본다.

## 요청 P1 — 라이더 알림함에 넣는 알림을 앱 푸시로도 보내기
라이더 알림함(0.4.0)에 이미 들어가는 것부터 같은 내용을 단말 토큰으로 보내 주세요.
- 도움요청 지원센터 답장(HelpRequestReplied) — `type: HELP_REQUEST`, `ref: <deliveryId>:<requestId>`
- 도움요청 처리 끝(CaseClosed RIDER_HELP)
- 배송 밖 문의 답변(INQUIRY, `ref: <inquiryId>`)
- 수행료 조정(RIDER_EARNING_ADJUSTED, execution 0.13.0)

앱이 받는 값(바라는 것 — 정해 주시면 그대로 맞춘다):
- 표시용 `title`·`body`(알림함과 같은 글) + 데이터 `notificationId`·`type`·`ref`.
  앱은 알림을 누르면 알림함과 같은 규칙으로 화면을 연다(HELP_REQUEST → 그 대화, INQUIRY → 그 문의). 화면을 열 때 서버에서 다시 읽는다 — 푸시 내용으로 상태를 확정하지 않는다.
- 개인정보(고객 주소·전화·출입 비밀번호)는 푸시에 넣지 않는다(잠금 화면에 보인다).

## 요청 P2 — 새 배차 제안 알림 (가장 필요)
라이더가 앱을 내려 두면 새 배차 제안을 모른다(지금은 앱이 켜져 있을 때 조회로만 본다). 제안이 오면 그 라이더 단말로 바로 보내 주세요.
- 데이터: `type: DISPATCH_OFFER`(이름은 정해 주세요)·`offerId`. 앱은 누르면 제안 화면을 열고 `GET /offers` 로 다시 읽는다(수락 가능 여부·금액은 서버 값).
- 제안이 만료되면 늦게 도착한 알림은 의미가 없다 — 만료 시각에 맞춘 TTL(또는 만료 뒤 앱이 "이미 끝난 제안"으로 보이게 하면 된다는 결정).
- 계약에 이미 있는 `/internal/dispatch-notification-records`(배차 제안 알림 전송 기록)와 어떻게 이어지는지 알려 주세요.

## 정해 주셔야 할 것(앱이 추측하지 않는다)
1. **FCM 자격증명**(서비스 계정)과 Firebase 프로젝트 — 라이더 앱 `google-services.json` 은 사용자가 이 PC 에 넣었다(패키지 `com.pmart.rider_app`). 서버가 같은 프로젝트로 보내야 한다.
2. **토큰 종류** — 지금 앱은 FCM 등록 토큰(`getToken`)을 보낸다. firebase_messaging 17 은 이 방식을 deprecated 로 두고 `register()/onRegistered`(Firebase 설치 ID 직접 발송)를 권한다. 서버 발송 방식에 맞춰 바꿀지 알려 주세요.
3. **알림 메시지 vs 데이터 메시지** — notification(시스템이 띄움) + data 인지, data 만(앱이 띄움)인지. 앱이 켜져 있을 때 띄울지(지금은 앱이 켜져 있으면 시스템이 띄우지 않는다)도.
4. **우선순위·묶음** — 배차 제안은 high, 나머지는 normal 인지. Android 알림 채널 이름(예: 배차·지원센터·정산)을 서버가 정하는지 앱이 정하는지.
5. **보내지 않는 조건** — 운행 꺼짐(오프라인)·알림 설정 끔(`/riders/me/settings`)·계정 정지 때 배차 제안 푸시를 막는지, 발송 실패 토큰(UNREGISTERED)을 서버가 지우는지.

## 앱이 할 일(발송이 생긴 뒤)
- 알림 누름 → 화면 이동(type·ref), 앱이 켜져 있을 때 표시, 채널 만들기 — 정해진 형식으로 붙이고 실기기로 확인해 이 문서에 적는다.
- 그 전까지는 지금처럼 알림함·조회로 본다.

## 회신 반영 (2026-11-17, 앱)
- 회신 `../pmart-backend/docs/handoff/clients/rider-app/2026-11-17-reply-rider-push-send.md` 그대로 반영: 채널 4개(dispatch_offer·support·account·settlement), data type·ref → 화면 이동, 앱을 보고 있을 때 배너, 등록 토큰(getToken) 유지.
- 남은 것: 서버 FCM 서비스 계정 키(사용자 → PC 1 설정) 뒤 실기기에서 배차 제안·지원센터 답장 푸시 확인.