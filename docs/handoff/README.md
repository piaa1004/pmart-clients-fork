# handoff — 백엔드로 보내는 요청·질문·회신

pmart-clients 와 pmart-backend 는 서로의 저장소에 쓰지 않는다. 각자 자기 `docs/handoff/` 에만 쓰고 상대 것은 읽기만 한다.
백엔드가 보낸 것은 `../pmart-backend/docs/handoff/clients/` 에서 읽는다.

## 폴더 — 앱 영역별 (2026-11-13 사용자 결정)

| 폴더 | 무엇 |
|---|---|
| `customer-app/` `mfc-app/` `rider-app/` `backoffice/` `hr-backoffice/` `mfc-backoffice/` `rider-backoffice/` `web-common/` | 그 앱 영역이 보내는 문서 — **자기 영역 폴더에만 쓴다** |
| `all/` | 여러 앱 영역에 걸친 문서 |
| `archive/` | 처리가 끝난 문서(양쪽 할 일이 끝났거나 뒤 문서가 대체). 2026-11-13 폴더를 나눌 때 그때까지의 문서 35개를 옮겼다(이름 그대로) |

- 폴더는 첫 문서를 쓸 때 만든다(빈 폴더는 git 에 없다).
- 파일 이름: **`YYYY-MM-DD-backend-<주제>.md`**(폴더가 앱 영역을 말한다). `archive/` 의 옛 파일은 옛 이름 그대로다.
- 첫머리에 `보낸 앱: <앱 영역>`, `받는 백엔드 영역: platform|mfc|delivery`, 회신이면 원 문서 경로를 적는다.
- 끝난 문서는 `archive/` 로 옮긴다(`git mv`, 이름 그대로). 이 저장소 문서가 그 경로를 가리키면 같은 커밋에서 고친다. 옮기는 것은 그 영역 담당 — 다른 영역 폴더의 문서는 옮기지 않는다.
- 항목 번호(BR-xx)는 양쪽이 그대로 쓴다. 상태표는 `docs/backend-requests.md`.
- 규칙 정본: `docs/operations/pc-split.md` §5.

## 지금 열려 있는 문서 (2026-11-16)

| 문서 | 기다리는 것 |
|---|---|
| `web-common/2026-11-18-backend-csrf-cookie-pileup.md` | 백오피스 CSRF 쿠키(`__Secure-pmart_ea_csrf_{sessionId}`, Path=/·만료 없음)가 같은 호스트에 쌓여 431 — C1 Max-Age 반영 회신(employee-auth 0.12.1, 앱 변경 없음). **남은 것: LAN 배포 뒤 백오피스 사이트 데이터 한 번 지우기 안내, 확인되면 archive** |
| `mfc-app/2026-11-10-backend-pda-work-areas.md` | BR-52·BR-53 회신(R1~R4 일부·R8~R11·R19-1 은 받음 — 나머지. 다음 차례 R12 → R20) |
| `mfc-app/2026-11-17-backend-pda-stock-check.md` | PDA 재고 확인 — 작업자 토큰으로 센터 재고·바코드 조회 되는지(Q1·Q2), 상품명(Q4) |
| `mfc-app/2026-11-17-backend-my-work-history.md` | 작업자 본인 오늘 업무 내역 — 기간 거르기·completedAt(R1·R2), 입고·검사·이동·실사 내 내역(R3) |
| `mfc-app/2026-11-17-backend-pick-to-cart.md` | P1~P4 모두 수용 회신(`clients/mfc-app/2026-11-17-reply-pick-to-cart.md`, fulfillment 0.8.0·inventory 0.19.0). PDA 반영 #57(main `c6f4930`, 백엔드 반영 전에 먼저 합침 — 사용자 2026-11-17). 백엔드 #91(`d5386b2f`) main·배포됨, PC 1 이 클라이언트 재생성·contracts.lock(백엔드 `2d64e515`). **남은 것: PC 3 실서버 피킹(장바구니) → 포장(패킹대) → 출하대기 확인** |
| `mfc-app/2026-11-17-backend-pick-reject-reason.md` | 실적 거절 사유(`rejectCode`·`rejectReason`)를 실행 조회·응답에(E1~E3) — 지금은 PDA 가 거절 이유를 못 보인다 |
| `mfc-app/2026-11-17-backend-lot-label.md` | LOT 라벨(QR·자체 스티커) 형식·발급·재출력·해석(L1~L6) — 피킹에서 LOT 를 찍어 선입선출 확인 |
| `mfc-app/2026-11-17-backend-shipment-ready-at-npe.md` | **버그(급함)** 출고 조회 `GET /shipments/{id}` 가 READY 전(`ready_at` NULL)이면 500 — `TaskStore.shipmentReadyAt` NPE, 패킹 화면이 안 열림(S1·S2) |
| `mfc-app/2026-11-18-backend-pick-then-pack-same-worker.md` | **급함** 피킹을 끝낸 사람에게 그 주문 PACK 을 먼저(R1~R3) — 지금은 다음 작업이 다른 주문 PICK 이라 한 주문 피패킹을 이어 갈 수 없다 |
| `mfc-app/2026-11-18-backend-break-supervisor-pin.md` | 휴게 관리자 번호(B1·B2)·근무 휴게 구간 자동 휴게(B3) — **모두 수용 회신**(`clients/mfc-app/2026-11-18-reply-break-supervisor-pin.md`, mfc-capacity 0.20.0). PDA(#136)·mfc-backoffice(#141) 반영, 게이트웨이 `break-pin` 라우트 있음(백엔드 PR #196). 남은 것: LAN 에서 센터 번호 정하고 PDA 실기기 확인 |
| `mfc-app/2026-11-18-rider-app-return-handover-screen.md` | (rider-app PC 5 → mfc-app) PDA 반납 인증번호 화면 — 요청 1·2 PDA 반영(`mfc-app/return-handover-code`). 남은 것: 라이더 앱 실기기 확인, PC 1 `return-handover.required` 켜기. 요청 3 mfc-backoffice 목록은 `mfc-backoffice/return-handovers`(2026-11-19) |
| `mfc-backoffice/2026-11-17-backend-lists-and-roles.md` | 회신 `clients/mfc-backoffice/2026-11-18-reply-lists-and-roles.md` — MB-1 목록 9개·MB-3 확인 필요 포장 관리자 **화면 반영**(`mfc-backoffice/mb1-lists`, 2026-11-19). MB-2 는 사용자 답(1~4)과 API 요청을 `mfc-backoffice/2026-11-19-backend-quality-incidents.md` 로 보냄. 남은 것: LAN 확인(`stock-units` 게이트웨이 라우트) |
| `mfc-backoffice/2026-11-19-backend-quality-incidents.md` | 회신 `clients/mfc-backoffice/2026-11-19-reply-quality-incidents.md`(quality 0.6.0·inventory 0.27.0, R6 은 2차) — 화면 반영 `mfc-backoffice/quality-incidents`(2026-11-19). 품질 사고(MB-2) — 사용자 결정(자동+직접 등록, 결품은 파손·변질만, LOT 처리 뒤 관리자가 닫음, 고객 영향이면 case 자동) + R1 조회 구현·R2 직접 등록·R3 자동·R4 상태·R5 닫기·R6 case. 질문 5 상품 취급은 지금대로 + R7 단종은 본사가 전 센터 OFF·R8 신상품은 센터 화면 배너 안내 |
| `mfc-backoffice/2026-11-19-backend-ops-exceptions.md` | 센터 운영판(§4-0) — OE-1 센터 결품 보고 목록(+전체 건수), OE-2 출하 약속 초과·임박 건수·임박 기준. 회신 전에는 결품(SHORT) 행 없이 안내, 약속 건수는 작업 목록 1,000건까지 읽어 셈 |
| `mfc-backoffice/2026-11-19-backend-dispatch-cancel-lines.md` | "배차 불가로 취소"(claim CL-5) — 센터 관리자가 주문 행·미이행 수량을 못 읽음. DC-1 서버가 lines 채우기(추천)·DC-2 order 직원 조회를 MFC_SUPERVISOR 에게. 회신 전에는 단추 막음 |
| `mfc-backoffice/2026-11-19-backend-display-labels.md` | 포장 화면 번호(ADR-0070 덧붙임) — DL-1 인계 판정·확인 필요 포장에 `handoverCode`·`orderNumber`, DL-2 bff 포장 인계 `packages[].handoverCode`. 회신 전에는 포장대 위치·"포장 n" |
| `all/2026-11-19-reply-ui-ux-align-mfc-backoffice.md` | (mfc-backoffice → PC 2) UI·UX 맞추기 지침 회신 — 반영 목록, web-ui 공용 동의·필요 순서. PC 2 가 공용 부품을 올리면 바꿔 끼우고 archive |
| `mfc-backoffice/2026-11-18-backend-my-account.md` | 직원 "내 정보" — 회신 `clients/mfc-backoffice/2026-11-18-reply-my-account.md`: 사용자 정정으로 비밀번호 = 센터 휴게 번호(capacity 0.20.0), 연락처 = 연락 수단 표시용(capacity 0.21.0 `staff-contacts`), EA-3·HR-3 철회. 화면 반영 `mfc-backoffice/my-info-contacts`(2026-11-19). **남은 것: LAN 확인 뒤 archive** |
| `all/2026-11-16-backend-login-code-pc1-only-done.md` | 클라이언트 표(경로 보탬) 확인 |
| `customer-app/2026-11-19-backend-first-run-consents.md` | BR-59 처음 실행 약관 — ①~④ 모두 회신(`clients/customer-app/2026-11-19-reply-br59-first-run-consents.md`, customer 0.6.0~0.6.1) · 고객앱 반영(목 모드). 질문 답은 아래 문서로 보냄. **남은 것: LAN 실서버 확인 뒤 archive** |
| `customer-app/2026-11-19-backend-br59-location-service-answer.md` | BR-59 질문 답(좌표→주소 카카오 로컬 서버 경유, 지도 카카오맵 SDK, 휴대폰 위치 Android geolocator — 사용자 승인·고객앱 반영) + Q1 역지오코딩 좌표가 URL 쿼리로 추적 기록에 남는 문제 |
| `customer-app/2026-11-19-backend-address-receiver-to-checkout.md` | BR-60 — 회신(`clients/customer-app/2026-11-19-reply-br60-address-receiver.md`, customer 0.8.0·order 0.14.0 배포) · 고객앱 반영(목 모드). **남은 것: LAN 에서 주소 저장·주문서 내 연락처 확인 뒤 archive** |
| `customer-app/2026-11-19-backend-phone-verification-signup.md` | BR-64 나머지 — 0.9.0 휴대폰 확인 화면 반영 알림 + 가입 단계 확인(R1)·한 번호 한 계정(R2)·기존 계정 안내(R3)·탈퇴 1달(R4)·기존 회원(R5)·주문 연락처(R6)·처리방침(R7) |
| `customer-app/2026-11-19-backend-naver-oauth-callback-relay.md` | BR-66 네이버 로그인 콜백 중계 — LAN 게이트웨이 공개 경로 → 앱 주소 302(고정 목적지·기록 없음), 콘솔에 넣을 주소·인증서 |
| `customer-app/2026-11-19-backend-social-login-identity.md` | BR-64 가입 즉시 휴대폰 본인 인증(옥토모)·한 번호 한 계정·기존 계정 안내·탈퇴 1달, BR-65 카카오·네이버 로그인 |
| `customer-app/2026-11-19-backend-rating-null-in-cards.md` | BR-63 홈 진열·상세 응답 평점 null(집계는 480) — 사본 채우기 |
| `customer-app/2026-11-19-backend-delivery-status-screen.md` | **급함** 배송 현황 — R1(BR-61) 주문 `shipments[].deliveryId`(없어서 라이더가 지도에 안 뜸), R2(BR-62) 주문한 센터 이름 |
| `customer-app/2026-11-19-backend-order-shipments-empty.md` | **급함** BR-61 고객 주문 조회 `shipments` 가 늘 빈 배열 → 배송 현황·라이더 지도를 열 수 없음(R1 채우기, R2 시점) |
| `customer-app/2026-11-19-backend-live-rider-location-done.md` | (delivery PC 5 요청 회신) 배송 현황 라이더 위치를 SSE 로 — 고객앱 반영(목 모드). **남은 것: 실제 배송으로 PC 5 와 지연 재기 뒤 archive** |
| `customer-app/2026-11-16-backend-review-photos-and-inbox-done.md` | 리뷰 0.2.0(사진)·고객 알림함 0.2.0 반영 확인 — 실서버 확인은 배송 완료·고객 주문 뒤 |
| `customer-app/2026-11-16-backend-review-edit-delete-done.md` | 리뷰 수정·삭제 화면 반영 확인, 빈 글 수정 질문 1개 — 실서버 확인은 배송 완료 뒤 |
| `rider-backoffice/2026-11-17-backend-rider-backoffice-base-done.md` | 라이더 백오피스 뼈대·로그인 회신 — 들어간 커밋 `756db67` 을 그대로 받음(사용자 2026-11-17), 검토·시험 11개·LAN 빌드 이름 확인. **남은 것: 실서버(8446) 로그인을 브라우저로 눌러 보기** |
| `rider-backoffice/2026-11-18-backend-rider-ops-gaps.md` | 라이더 백오피스 직원용 API 공백 7건(PC 5) — 7번 `Evidence.method` 값 목록 먼저, 2~6번 1차 포함 여부·서비스·버전 회신 |
| `customer-app/2026-11-18-backend-gap-a-applied.md` | 고객앱 갭 A 8가지 + CU-1 주문 전 재동의·마케팅 앱 반영(목 모드). R1(알림함 `templateKey`) 답 받아 반영(2026-11-18). **남은 것: 실서버 확인(할 일 43) 뒤 CU-1 스위치 켜기 알림** |
| `customer-app/2026-11-18-backend-customer-push-fcm-reply.md` | 고객앱 휴대폰 푸시 회신 — 앱 반영 끝(토큰 등록 `7cbe1f2`, 누르면 목적지 화면). Q6·Q8 은 11-18 답 받음(앱 고칠 것 없음). **남은 것: 실기기 확인, `pmart-123` json 교체 — 결과 덧붙이면 archive** |
| `customer-app/2026-11-15-backend-support-chat-inquiry.md` | 고객앱 문의·AI 상담 반영 알림 — LAN 고객 토큰으로 실제 확인, 질문 3개 |
