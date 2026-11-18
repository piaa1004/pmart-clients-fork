# [pmart-clients → pmart-backend] 요청: 라이더 백오피스 관제 — 라이더 운행 시작 시각·대기 시간 (2026-11-18)

- 보낸 앱: rider-backoffice (PC 5)
- 받는 백엔드 영역: delivery (rider-service 운행 상태, delivery-execution 운행시간, 필요하면 delivery-tracking 관제 응답)
- **회신·반영(2026-11-18)**: 백엔드 `../pmart-backend/docs/handoff/clients/rider-backoffice/2026-11-18-reply-rider-waiting-time.md`(PR #182 — tracking 0.9.0 `onDutySince`·`waitingSince`, execution 0.25.0 `connectedSeconds`·`waitingSeconds`). 사용자 정의: 대기 = 운행 중 + 신규배차 켬 + 맡은 배송 0건, 운행을 켜 둔 전체는 "접속 시간". `changedAt` 은 신규배차 토글에도 바뀜(쓰지 않음). 같은 PR #123 에 반영 — 끝나면 archive 로.
- 근거: 사용자 2026-11-18 "주문번호에 해당하는 라이더를 바로 볼 수 있고, 그 라이더의 위치와 전달 상황과 **대기 및 운영 시간**을 바로 볼 수 있게 — 직관적으로". 관제 오른쪽 "라이더 한눈에"에 위치·전달 상황·오늘 운행시간·대기 시간 네 칸을 둠.
- 지금 클라이언트: "오늘 운행시간"은 execution `GET /rider-operating-time`(배차 수락 ~ 전달 완료 합계)로 보임. **"대기 시간"은 "서버 값 없음 · 백엔드 요청 중"** — 화면에서 계산해 지어내지 않음.

## 지금 계약으로 안 되는 이유
- rider `OperatingState.changedAt` 은 있지만 뜻이 적혀 있지 않음 — 신규배차 켜고 끄기에도 바뀌면 "운행 시작"으로 쓸 수 없음(지금 화면은 "상태 바뀐 때"로만 작게 보임).
- 운행(ON_DUTY) 구간 기록·대기(운행 중인데 진행 중 배송 없음) 시간을 주는 API 가 없음. 운행시간(execution)은 배송 단위 [수락, 완료] 합이라 대기를 뺄 수 없음.

## 요청 (뜻은 제안 — 사용자 확인 필요)
| # | 값 | 제안하는 뜻 | 쓰는 곳 |
|---|---|---|---|
| 1 | `onDutySince` | 지금 운행(ON_DUTY) 구간이 시작된 시각(운행 중이 아니면 null) | "운행 시작 HH:MM · N시간째" |
| 2 | `waitingSince` | 운행 중이고 진행 중 배송이 0건이 된 시각(배송 중이면 null) | "대기 N분째" — 오래 대기 중인 라이더 찾기 |
| 3 | `todayOnDutySeconds`·`todayWaitingSeconds` | 오늘(Asia/Seoul) 운행 구간 합·그중 대기 합(서버 계산) | "오늘 운행 N시간 · 대기 N시간" |

- 어디에: 관제 목록 `GET /rider-locations` 의 `ControlRider` 에 1·2(10초 목록이라 가벼운 값만), 3 은 직원용 라이더 조회(`GET /riders/{riderId}`)나 execution 직원용 운행시간 응답에. 정하는 대로 따름.
- 개인정보 아님(시각·초). 권한은 관제와 같게(RIDER_OPS·OPERATOR_ADMIN, 3 은 CS_AGENT 도 가능하면).
- 질문: (1) `changedAt` 의 뜻(운행 시작·종료만인지, 신규배차 토글도인지). (2) 대기의 뜻이 위와 맞는지 — 원문에 정의가 있으면 그것으로. 회신은 `../pmart-backend/docs/handoff/clients/rider-backoffice/` 에서 읽겠습니다.
