# 회신 — 회수 배송 화면 한 벌 반영 + 물음 2개

보낸 앱: rider-app (PC 5)
받는 백엔드 영역: delivery (execution·dispatch)
- 작성: 2026-11-17
- 원 문서: `../pmart-backend/docs/handoff/clients/rider-app/2026-11-17-request-claim-return-pickup.md`
- 생성 클라이언트: execution 0.14.2 · dispatch 0.5.2(백엔드 main `09ef9b3b`)

## 반영함(앱 작업 사본 — 아직 커밋 전)
| 단계 | 앱 |
|---|---|
| 제안 | `deliveryType RETURN` + `purpose` → 카드·상세에 "반품 회수"/"오배송 회수" 표시. 회수지(대략 `dropAreaLabel`) → 반납(MFC, `distanceKm` = 회수지 → MFC). 도착 예상은 보이지 않는다(일반 배송 값이라) |
| 회수지·연락처 | 수락 뒤 `GET /deliveries/{id}/recovery-contact` 하나로(전화 늘, 주소는 있을 때만 — 오배송은 "주소 없음 — 원래 놓은 곳으로"). 좌표는 `GET /deliveries/{id}/dispatch` 의 `recovery.pickup`(못 읽어도 연락처는 보인다). `drop-info` 는 쓰지 않는다 |
| 받을 것 | `returnLines` 수량 + `orderSummary.items` 이름(아래 물음 1). 오배송은 `recoveryOrigin`(놓은 곳·설명) |
| 받음 | 사진 `POST …/evidence-photos` → `POST …/returns/pickups` `{items: [], evidenceRefs: [photoRef]}` → `RETURN_PICKED_UP` 확인 뒤 다음 단계(현장 큐 — 같은 키 재전송) |
| 반납 | MFC 에서 한 번 더 묻고 `POST …/returns/store-deliveries` `{}` → `RETURNED_TO_STORE` 면 "반납완료" |
| 못 받음 | 반품 회수: 받기 전(배정)에 지원센터 → "고객과 연락이 안 돼요/주소 문제" → "전달할 수 없어요" → 일반 실패 등록과 같은 화면(사진·고객 전화 2번 — 전화는 회수지 번호, 걸면 연락 기록). 응답 `resultId` 대화로 간다. 반려되면 배정(받기 전)으로 돌아온 것을 알린다. 오배송 회수: 도움요청만 |
| 막힌 단계 | 가게 도착·QR 픽업·고객 도착·전달 완료 버튼은 회수 배송에서 보이지 않는다 |

- "실패 등록을 받기 전에 여는 것"은 앱 흐름에 맞다 — 일반 배송의 "전달할 수 없어요"와 같은 길(지원센터 갈림길)이라 라이더가 따로 배울 것이 없다.
- 목업: 반품 회수 제안 1건(가야동 → 부산진구지점) — 수락 → 사진 → 회수했어요 → 반납했어요까지 시험(테스트 97 통과).

## 물음
1. **받을 품목 이름** — `returnLines` 에는 이름이 없고(`orderLineId`·`qty`·`sku`), `orderSummary.items` 에는 줄 ID 가 없어 짝을 지을 수 없다. 지금 앱은 **줄 수가 같을 때만 순서대로** 이름을 붙이고, 아니면 "상품 1 × 2"처럼 이름 없이 보인다(추측하지 않음). `returnLines[]` 에 `name`(·`optionLabel`)을 실어 주거나 `orderSummary.items[]` 에 `orderLineId` 를 넣어 줄 수 있는가?
2. **전달 불가 확정(CONFIRM) 뒤 회수** — 상품이 라이더에게 있을 때(custody RIDER) 회수 배송이 같은 라이더에게 바로 배정되는지, 받음을 건너뛰고 바로 반납인지(별도 질문서 — 사용자가 직접 전달).
