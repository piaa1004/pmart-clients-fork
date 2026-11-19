# MFC 백오피스 "배차 불가로 취소" — 센터 관리자가 보낼 주문 행을 못 읽음

보낸 앱: mfc-backoffice (PC 3)
받는 백엔드 영역: platform (claim·order — PC 1), delivery (PC 5) 참고
원 문서: `../pmart-backend/docs/handoff/clients/mfc-backoffice/2026-11-19-request-dispatch-delays.md`, `…/2026-11-19-notice-cl5-dispatch-unavailable-cancel.md`
날짜: 2026-11-19

## 상황
- MFC 백오피스에 "배차 지연" 메뉴를 만들었다. 목록은 dispatch 0.12.0 `GET /dispatch-delays`, 배송 번호는 execution `GET /deliveries?deliveryIds=` 를 쓴다(`docs/apps/mfc-backoffice-web.md` §4-4d).
- 행마다 둘 "배차 불가로 취소"는 claim 0.7.0 `POST /claims`(사유 `DISPATCH_UNAVAILABLE`)다. 본문 `lines` 에 **주문의 모든 행 × 미이행 수량**(`orderLineId`·`qty`)을 넣어야 한다.
- 센터 관리자(`MFC_SUPERVISOR`)가 그 값을 읽을 API 가 없다.
  - order `GET /orders/{orderId}` 는 고객만 부를 수 있다.
  - order `GET /orders/lookups/{orderId}` 는 OPERATOR_ADMIN·CS_AGENT·RIDER_OPS 만 부를 수 있다.
  - fulfillment 작업 줄(`orderLineId`·`plannedQty`)은 주문의 미이행 수량과 다를 수 있어 쓰지 않는다(추측 금지).
- 그래서 단추는 막아 두고 이유를 보인다. "급하면 고객센터에 취소를 부탁"이라고 안내한다.

## 요청 (둘 중 하나 — 추천 DC-1)
- **DC-1(추천)**: claim 이 `DISPATCH_UNAVAILABLE` 전체 취소일 때 `lines` 를 생략하면 서버가 order 에서 "모든 행 × 미이행 수량"을 채운다.
  - 화면이 수량을 들고 있다가 그 사이 바뀌어 422 가 나는 일이 없다.
  - 본문은 `{orderId, type: CANCEL, reason: DISPATCH_UNAVAILABLE, channel: OPERATOR, reasonDetail}` 이다.
- **DC-2**: order `GET /orders/lookups/{orderId}` 를 그 센터 `MFC_SUPERVISOR` 에게도 연다(자기 센터 주문만, 배송지 가림 그대로). 화면이 행·미이행 수량을 읽어 보낸다.

## 회신 받으면
- 단추를 열고 확인 창을 띄운다. 확인 창 문구는 "주문 전체 취소 · 전액 환불"이다. 쿠폰 문구는 promotion 이 생긴 뒤 넣는다.
- 201 클레임은 `GET /claims/{claimId}` 로 진행을 보인다. 결과 불명(503·시간 초과)이면 같은 키로 다시 확인한다.
