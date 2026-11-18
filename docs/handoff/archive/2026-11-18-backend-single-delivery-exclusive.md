# [pmart-clients → pmart-backend] 요청: 한집배달은 혼자만 — 한집을 맡은 라이더에게 전달 완료까지 새 배차 없음 (2026-11-18)

> **끝남(2026-11-18)** — 백엔드 회신 `pmart-backend/docs/handoff/clients/rider-app/2026-11-18-reply-single-delivery-exclusive.md`(PR #204): **이미 백엔드 PR #190 으로 구현·LAN 배포돼 있었음**(`AcceptRules`·`OfferService`·`DispatchEngine` "한집은 단독"). 아래 "지금 (서버)"의 "배송 방식을 보지 않음"은 **잘못 본 것**(한도 줄만 보고 판단) — 바로잡음.
> - 한집(SINGLE, 회수·반납 아님)을 맡으면 새 고객 배송 제안 없음·배달리스트 빈 목록·수락 INELIGIBLE. `pollAfterSec` 은 null 이 아님(폴링해도 안 올 뿐).
> - 다른 배송을 맡고 있으면 한집은 후보·목록에서 빠짐(수락 INELIGIBLE). 알뜰 최대 3건 그대로.
> - 예약(SCHEDULED)·회수(RETURN)는 한집으로 치지 않음 — 예약은 3건 한도 안에서 함께, 회수(반납)는 한집을 든 라이더도 받음. 예약 단독 여부 → 사용자 결정(2026-11-18) "예약배송은 여러개 가능" — 지금 규칙 그대로.
> - 클라이언트: 목을 서버와 같게 맞춤(PR #150).
- 보낸 앱: rider-app (PC 5)
- 받는 백엔드 영역: delivery (delivery-dispatch 배차 — 제안 후보·`POST /offers/{id}/responses`·`POST /delivery-list/{id}/acceptances`)
- 근거: 사용자 2026-11-18 목업 시험 "하나씩 배달하기 안 키고 하니까 한집배달짜리가 2개 수락됐어." → 질문 "한집배달을 맡고 있는 라이더에게 다른 배송을 더 줄까요?" → 답 **"한집은 혼자만"**.
- 원문: Delivery §5.3 "최대 3개 연속 배차 수락 가능 / 한집·알뜰배달과 바로·구간배달의 적용 범위 확인" — 이 "적용 범위 확인"에 대한 사용자 결정.

## 지금 (서버)
- `DispatchEngine` 한도 = 하나씩 배달하기면 1, 아니면 `maxActiveDeliveries`(3). 배송 방식(deliveryMode)은 보지 않음 → 한집(SINGLE) 2~3건을 한 라이더가 맡을 수 있음.

## 요청
| # | 무엇 |
|---|---|
| 1 | 라이더가 **한집배달(deliveryMode SINGLE, 고객에게 가는 배송)** 을 맡고 있으면 그 배송이 끝날 때까지(COMPLETED·FAILED 확정 등 — 끝 기준은 백엔드가 정함) 새 제안·배달리스트 수락을 하지 않는다(하나씩 배달하기 ON 과 같게 — `GET /offers` 는 받을 수 없는 상태 `pollAfterSec: null`, 응답·수락은 `LATE`·`INELIGIBLE`). |
| 2 | 한집 제안은 맡은 배송이 **하나도 없을 때만** 보낸다(다른 배송을 맡고 있으면 한집 제안 후보에서 뺀다, 수락은 INELIGIBLE). |
| 3 | 알뜰(BUNDLED)은 지금처럼 묶음 포함 최대 3건. |
| 4 | 확인 부탁: **예약(SCHEDULED)** 과 **회수(type RETURN)** 는 어떻게 볼지 — 클라이언트 목은 지금 규칙(최대 3건) 그대로 두었음. 업무 결정이 필요하면 회신에 적어 주시면 사용자에게 묻겠습니다. |

## 클라이언트가 해 둔 것
- 라이더 앱은 서버 판정만 따른다(앱이 막지 않음 — 수락 결과 INELIGIBLE 이면 기존 늦은 수락 안내, 배송이 끝나 서버가 확정하면 제안을 바로 다시 조회 #147).
- 목(MockOfferRepository)에만 위 1·2·3 을 넣어 시험 중.

## 회신 부탁
- 반영 여부·배포 시점, 4번(예약·회수) 답. 회신은 `pmart-backend/docs/handoff/clients/rider-app/` 에.
