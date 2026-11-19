# 요청 — BR-64 나머지: 가입 단계 휴대폰 확인·한 번호 한 계정·기존 계정 안내·탈퇴 1달 (+ 0.9.0 화면 반영 알림)

- 보낸 앱: customer-app (PC 1)
- 받는 백엔드 영역: platform (auth-service·customer-service)
- 답하는 것: `../pmart-backend/docs/handoff/clients/customer-app/2026-11-19-request-phone-verification-octomo.md`(customer 0.9.0 — OCTOMO)
- 원 요청: `docs/handoff/customer-app/2026-11-19-backend-social-login-identity.md`(BR-64 R1~R7)
- 계기: 사용자 2026-11-19 "레퍼런스 참고해서 만들어줄 수 있어? 다 만든 다음에 백엔드쪽한테 보낼 요청서 작성해줘."

## 고객 앱에 반영한 것(0.9.0 그대로, 목 모드 확인)
- 화면 `/me/phone-verification`(레퍼런스 13 연령확인 모양): ① 휴대폰 번호(010 11자리, 다르면 `profile-changes {phone}` 저장) → ② `POST /me/phone-verifications` → 받는 번호·숫자 6자리·남은 시간, **문자 앱을 번호·본문 채워 열기**(Android `ACTION_SENDTO smsto:` — 새 라이브러리 없음)·숫자 복사 → ③ **"보냈어요"를 누를 때만** `…/confirmations`(자동 반복 없음 — OCTOMO 한도) → VERIFIED 완료 / PENDING 남은 횟수 / FAILED·EXPIRED 처음부터 / 503 잠시 뒤 다시(처음으로 돌리지 않음).
- 오류 코드: `PHONE_NOT_SUPPORTED`·`PHONE_REQUIRED`·`TOO_MANY_VERIFICATIONS`·`CONFIG_REQUIRED`·409(이미 확인 → 완료 화면). 결과 불명은 같은 Idempotency-Key 로 한 번 더.
- 내 정보: 번호 옆 "확인됨/확인 안 됨", 확인 안 됐으면 "번호 확인". `GET /me` `phoneVerified` 를 쓴다.
- 실서버(실제 문자) 확인은 아직 — 사용자 폰으로.

## 아직 필요한 것(BR-64 사용자 결정 2026-11-19)
지금 0.9.0 은 **이미 가입한 회원**이 자기 번호를 확인하는 기능이다. 사용자 결정은 "가입하자마자 확인", "한 번호 한 계정", "같은 번호면 기존 계정 안내(제공자·가입일·가린 이메일)", "탈퇴 번호 1달 재가입 금지", "처음 가입한 제공자 하나로만 로그인"이다.

- **R1. 가입 단계에 넣기** — 신규 소셜 로그인은 번호 확인을 마쳐야 가입 완료(토큰 발급).
  - 로그인 결과 `state` 에 예: `AUTH_IDENTITY_REQUIRED`(필수 동의 AUTH_CONSENT 와의 순서도 정해 달라).
  - 그 상태에서 쓸 확인 경로가 필요하다 — 지금 `/me/phone-verifications` 는 CUSTOMER 토큰이 있어야 한다. 예: `authRequestId` 로 묶은 확인(`POST /auth/social-logins/{authRequestId}/phone-verifications`·`…/confirmations`)이나 확인 전용 제한 토큰. 번호 입력(지금은 `profile-changes`)도 같은 단계에서.
- **R2. 한 번호 한 계정** — 확인 성공인데 그 번호가 **다른 계정에서 이미 확인됨**이면 이 계정을 확정하지 않는다(만들었으면 버린다). 0.9.0 이 이것을 막는지 알려 달라(지금 계약 설명에는 없다).
- **R3. 기존 계정 안내** — R2 의 경우 응답에 예: `IDENTITY_ALREADY_REGISTERED` + `{provider, joinedAt, emailMasked}`(본인 확인을 통과한 사람에게만, 계정 ID·전체 번호는 주지 않음). 앱은 "이 번호로 가입한 계정이 있어요 — 카카오로 로그인해 주세요" + 그 제공자 로그인 버튼.
- **R4. 탈퇴 1달 재가입 금지** — 탈퇴한 계정의 확인 번호로 1달 안에 가입하면 막고 `rejoinAvailableAt` 을 알려 달라(예 `IDENTITY_REJOIN_BLOCKED`).
- **R5. 기존 회원** — 이미 가입했지만 확인 안 된 회원(지금 LAN 계정들)은 다음 로그인 때 R1 처럼 막을지, 내 정보에서 스스로 하게 둘지 정해 달라. 앱은 지금 내 정보에서 스스로 하게 해 두었다.
- **R6. 주문 연락처** — 확인된 번호를 주문 받는 분 연락처(BR-60 R2, 프로필 phone)로 그대로 쓰는지 확인. 확인된 번호를 바꾸면 다시 미확인(0.9.0 설명대로)이다.
- **R7. 개인정보 처리방침** — OCTOMO(주식회사 옥토버스) 처리 위탁 문구는 consent-terms 쪽에서(회신 "알아 둘 것") — 언제 반영되는지.

## 앱이 할 것(회신 뒤)
- R1·R3·R4 상태와 응답이 정해지면 가입 흐름(로그인 → 필수 동의 → 휴대폰 확인 → 가입 완료)에 지금 화면을 그대로 붙이고, "이미 가입된 계정이 있어요"·"재가입은 ○월 ○일부터" 화면을 더한다(계약에 없는 필드는 짐작하지 않음).
