# MFC 백오피스 웹 (`web/mfc-backoffice`)

담당: **PC 3**(2026-11-17 사용자 "MFC 백오피스를 PC2에서 PC3로" — 화면과 MFC API 가 같은 PC). 2026-11-16~17 은 PC 2 가 맡아 메뉴 11개 화면을 만들었다(백엔드 알림 `../pmart-backend/docs/handoff/clients/all/2026-11-16-notice-mfc-backoffice-owner-pc2.md`). 웹 공통(`web/core`·`web/ui`)은 PC 2 그대로 — 고칠 일은 PC 2 에 요청. 로그인·센터 고르기 뼈대와 로그인·세션·토큰 코드는 PC 1. 화면이 부를 MFC API(MB-1~3)도 백엔드 PC 3 — 더 필요하면 백엔드 `docs/architecture/service-requests/mfc-backoffice-staff-apis.md` 로 요청.

- 사용자: 센터 관리자(`MFC_SUPERVISOR`) — 자기 센터(`centers`)만. 현장 작업자(`MFC_WORKER`)는 PDA 앱(`apps/mfc_app`)을 쓴다.
- 근거: 백엔드 요청 `../pmart-backend/docs/handoff/clients/mfc-backoffice/2026-11-15-request-mfc-backoffice.md`. 메뉴·API 정본은 `pmart-backend/docs/architecture/backoffice-role-menus.md` §3, 계약 `contracts/openapi/mfc-*.yaml`.
- 기본 백오피스(`web/backoffice`)에는 MFC 메뉴를 넣지 않는다(백엔드 요청 2026-11-15 cs-rider-menus §0).
- 상태(2026-11-15): **기반만**(앱 뼈대·로그인·센터 고르기·메뉴 자리). 메뉴 화면은 모두 "준비 중". 목 모드로 확인, LAN 배포·실서버 확인은 아직.
- 2026-11-16(PC 2): **위치(칸)**(§4-1)·**이동·보충**(§4-2)·**작업자**(§4-3)·**배송 현황·배차 실패**(§4-4)·**작업 현황**(§4-5)·**배정**(§4-6)·**입고**(§4-7)·**재고**(§4-8)·**품질**(§4-9)·**운영 제한**(§4-10) — **메뉴 11개 모두 화면**("준비 중" 화면 부품은 앞으로 생길 메뉴용으로 남김). **LAN 확인(2026-11-16 17:45, 센터 관리자 claude-mfc-sup, MFC-SEED-01 — 조회만)**: 작업자 71명, 배정 진행 중 102건(경고 0), 작업 현황 0건, 입고 대기 0건, 재고 출하 부적격 LOT 250건·보충 기준 0건, 운영 제한 0건, 배송 현황·배차 실패 0건 — 모두 200, 오류 없음. 품질은 목록 API 없어(MB-1) 번호로 여는 화면만, 상품별 재고는 실서버 상품 코드를 몰라 미확인. 배정 102건 대부분은 11-08 E2E 시험 작업의 배정이 진행 중으로 남은 것, 부적격 LOT 250건도 시험 데이터로 보임(정리는 PC 3 판단).

## 1. 앱과 로그인

| 항목 | 값 |
|---|---|
| 스택 | 다른 두 백오피스와 같다(Vite + TS 7, React Router, TanStack Query, openapi-fetch, MSW, daisyUI) |
| 로그인 | employee-auth-service, `app=mfc-backoffice`, SSO — `@pmart/web-core` 직원 로그인(세션별 HttpOnly refresh 쿠키·CSRF, 탭이 다시 보일 때 세션 확인). 비밀번호는 받지 않는다 |
| 주소 | 개발 `http://localhost:5175`(`npm run dev -w web/mfc-backoffice`), LAN `https://192.168.0.40:8445`(빌드 `npm run build:lan -w web/mfc-backoffice` → PC 1 백엔드가 `lan.sh publish-mfc-backoffice <dist>`) |
| `X-Source-System` | `mfc-backoffice-web` |
| 생성 타입 | `src/api/generated/`(커밋 안 함): center-master, mfc-capacity·fulfillment·inbound·inventory·location·quality — `npm run gen:api -w web/mfc-backoffice`(백오피스 생성물에서 복사) |

## 2. 센터
- 고를 수 있는 센터 = `GET /employee-auth/sessions/current` 응답의 `centers`(employee-auth 0.6.0, 2026-11-16 — 토큰을 풀지 않는다. 승인·회수 직후 토큰과 다르면 응답을 따른다).
- 주소에 센터를 넣는다: `/c/<mfcId>/<메뉴>`. 첫 화면은 맡은 첫 센터의 첫 메뉴(작업자).
- 센터가 하나면 고르지 않고 이름만 보인다. 둘 이상이면 위에서 고르고, 바꾸면 같은 메뉴의 다른 센터로 간다.
- 이름은 같은 세션 응답의 `centerDetails`(employee-auth 0.9.0, 2026-11-16)에서 — "이름 (코드)". 서버가 이름을 못 읽은 센터(`name: null`)는 코드로만 보이고 안내한다(센터 목록은 비지 않는다). `GET /centers` 는 부르지 않는다.
- 주소의 센터가 세션 centers 에 없으면 "이 센터 권한이 없습니다" + 맡은 센터 링크. 맡은 센터가 없으면(예: 센터 없는 `OPERATOR_ADMIN`) 안내만, 메뉴 없음.

## 3. 역할
- `MFC_WORKER` 만 있는 계정: "센터 관리자만 쓰는 화면입니다"(메뉴 없음).
- `MFC_SUPERVISOR` 가 없는 그 밖 역할 + 센터: 막지 않고 안내만. 판정은 서버가 API 마다(403 → "이 센터 권한이 없습니다"). mfc API 는 `OPERATOR_ADMIN` 을 따로 통과시키지 않는다(백엔드 §2-1).

## 4. 메뉴 (`src/app/nav.ts`)

화면 틀(2026-11-19, 사용자 "다른 통합 백오피스 앱 참조" — `App.tsx` `Layout`·`groupIcons.tsx`·`index.css`): 통합 백오피스(`web/backoffice`)와 같은 모양 — 왼쪽 진한 남색 메뉴(앱 이름 · 홈 · 묶음 아이콘+이름 · 하위 메뉴 왼쪽 띠, 지금 메뉴 민트), 위 머리줄(묶음 › 메뉴 · 역할 칩 · 센터 표시/고르기 · 목 · 내 정보·내 세션), 본문 최대 폭. 테마는 통합 백오피스 값 사본(파랑 동작·민트 강조·연회색 바탕), 상태 배지는 옅은 바탕·진한 글자. 홈은 통합 백오피스 대시보드 짜임(제목·기준 줄 → "내 할 일" 숫자 칸 → "이상 N" 한 줄 → 예외 처리함 밑줄 탭).

| 묶음 | 메뉴 | 경로 | 화면 | 서버 API 가 아직 없는 것(백엔드 §2-1) |
|---|---|---|---|---|
| (맨 위) | 홈 | `ops` | **됨**(§4-0, 센터 첫 화면 "오늘 센터 현황") | 결품(SHORT) 건별 센터 목록, 출하 약속 초과·임박 서버 건수(요청 `mfc-backoffice/2026-11-19-backend-ops-exceptions.md`) |
| 작업자 관리 | 작업자 | `workers` | **됨**(§4-3) | — |
|  | 배정 | `assignments` | **됨**(§4-6) — 지난 추천은 ID 로만 | 배정 추천 계획 목록 |
| 작업 | 작업 현황 | `tasks` | **됨**(§4-5) — 확인 필요 포장은 안내만 | 확인 필요 포장 목록·확인(지금은 작업자만 — 백엔드 결정 대기) |
|  | 이동·보충 | `moves` | **됨**(§4-2) | — |
|  | 입고 | `inbound` | **됨**(§4-7) — 목록 없는 것은 ID 로, TRF 는 안내만 | 입고 예정(TRF, 계약만), 초기 보유 센터별 수령 대기 목록, 회수품·공급 요청 목록 |
| 배송 | 배송 현황 | `deliveries` | **됨**(§4-4) | — |
|  | 배차 실패 | `dispatch-failures` | **됨**(§4-4, 보기만) | — (센터 정보 DD-MFC 배포됨 2026-11-16 — 그 뒤 생긴 배차 실패부터) |
| 재고·품질 | 재고 | `inventory` | **됨**(§4-8) — 상품 코드로·실사는 ID 로 | 센터 전체 재고 목록(상품 코드 없이), 실사 세션 목록 |
|  | 품질 | `quality` | **됨**(§4-9) — 목록 없는 것은 번호로, 사고는 안내만 | 해제 승인 대기·폐기·검수 목록, 품질 사고(계약만) |
| 센터 | 위치(칸) | `locations` | **됨**(§4-1) | — |
|  | 운영 제한 | `restrictions` | **됨**(§4-10) | — |

- "준비 중" 화면은 그 메뉴에서 서버 API 가 있는 기능과 없는 기능을 나눠 보인다. 화면을 만들면 `nav.ts` 의 `ready` 를 true 로 바꾸고 이 표를 고친다.
- 기존 화면 요청서는 그대로 쓴다: 입고 B1~B4, 피킹·포장, 근무 기본값·배정 계획(백엔드 handoff `archive/2026-11-07-clients-request-mfc-*`, `backoffice/2026-11-09-clients-notice-*`).
- 메뉴 아래 화면(목록·상세·등록)은 라우트 `c/:mfcId/<메뉴>/*` 아래에서 메뉴 화면이 자기 `<Routes>` 로 나눈다(`App.tsx` `menuPages`).

### 4-0. 홈(오늘 센터 현황)·예외 처리함 (`features/ops/OpsBoard.tsx`·`opsRules.ts`, 2026-11-19 PC 3)
센터 관리자의 센터 첫 화면(`/` → `/c/<첫 센터>/ops`, 왼쪽 메뉴 맨 위 "홈"). 요약 카드 3장 + 같은 화면 예외 처리함. 카드의 "목록 보기"·처리함 단추가 유형 필터(URL `?type=promise|picking|handover`).
새 계약 없이 기존 API 만 쓴다. 원천마다 따로 읽어 하나가 실패해도 나머지는 보이고, 실패는 "조회 실패"(0건 아님). 1분마다 다시 읽는다. 쿼리 키에 센터가 있고 센터가 바뀌면 화면을 새로 그려 이전 센터 값을 보이지 않는다.
- **출하 약속 초과·임박**: fulfillment `GET /tasks?mfcId=&state=WAITING,READY,ASSIGNED,IN_PROGRESS,BLOCKED&size=200`을 커서로 끝까지(최대 5쪽 = 1,000건, 넘으면 "N건 이상"과 안내). PICK·PACK 만 출고(shipmentId)로 묶어 `promisedReadyAt`(서버 약속 시각) 가장 이른 값을 응답 `asOf` 와 비교 — 지났으면 초과, **15분 안이면 임박**(`DUE_SOON_MINUTES` — 업무 원문에 출하 임박 기준이 없어 화면 기준, 카드에 표시). 약속 시각이 없는 출고는 세지 않고 수를 따로 보인다. 행 → 지금 단계 작업 상세(출고·포장·작업 풀기). 재배정은 배정 메뉴.
- **피킹 결품·파손**: 카드 = fulfillment `GET /metrics/picking-lines?from=오늘&to=오늘&mfcId=`(0.19.0) 의 사유별 줄 수(SHORT·DAMAGED, 서버가 센 값 — 그날 줄이 없으면 0). 건별 행 = mfc-quality `GET /quality-incidents?mfcId=&kind=DAMAGE`(열림·판정됨) 중 `sourceEvent = LineShortageReported`(피킹 파손으로 자동으로 열린 사고) → 품질 › 품질 사고 상세. **결품(SHORT) 건별 센터 목록은 계약이 없어** 안내만(작업 BLOCKED·수량 차이를 결품으로 추정하지 않는다).
- **인계 확인 필요**: fulfillment `GET /packages?mfcId=&checkRequired=true`(전체 목록이라 건수 정확) → 작업 현황의 "확인 필요 포장"(`#handover-checks`). 확인 버튼은 그 화면에만.
- 처리함 칸: 유형 · 주문(화면 번호, 없으면 "정보 없음")·작업·포장·사고 ID · 막힌 이유 · 경과(초과는 지난 시간, 임박은 남은 시간, 인계는 허가 만료부터, 사고는 열린 때부터) · 담당자(작업 배정 — 사고·인계는 담당이 없어 "정보 없음") · 다음 조치 링크. 순서: 많이 지난 약속 초과 → 인계 확인 → 파손 → 임박.
- 권한: 다른 메뉴와 같은 `CenterScope`(작업자 전용 계정 차단, 맡지 않은 센터 차단, 센터 관리자 아니면 안내).

### 4-1. 위치(칸) — mfc-location-service 0.7.1 (`features/locations/LocationPages.tsx`)
| 화면 | API | 규칙 |
|---|---|---|
| 목록 `locations` | `GET /locations?mfcId=&zone=&temperatureZone=&state=` | 거르기는 URL 쿼리. 커서 "더 보기"(50개씩). 조회 실패는 오류(빈 목록 아님), 다음 쪽 실패는 받은 것까지 + 안내 |
| 등록 `locations/new` | `POST /locations` → 201 Location | 칸 코드 문법은 안내만(검사는 서버 — 400 `LOCATION_CODE_INVALID`), 409 `LOCATION_CODE_DUPLICATE`. 만든 뒤 상세로 |
| 상세 `locations/<locationId>` | `GET /locations/{id}` | 속성·상태·버전 |
| 속성 고치기 | `PUT /locations/{id}` + `X-Expected-Version` | 전체 교체 — 지금 값을 모두 다시 보낸다(도면 좌표를 빼면 지워진다). 코드는 못 바꿈. 도면 x·z 는 둘 다 넣거나 둘 다 비움 |
| 닫기·다시 열기 | `POST /locations/{id}/state-changes` {targetState, reason} + 버전 | 사유 필수(200자). ACCEPTED·결과 불명은 짝 조회 `GET …/state-changes/{requestId}`, 끝까지 모르면 "같은 요청으로 결과 확인"(같은 키) |
| 폐지 | `DELETE /locations/{id}` + 버전 | 닫힌 칸에만 버튼, 확인 표시를 해야 누를 수 있다. 재고가 있으면 서버 409 `INVALID_STATE`. 짝 조회 API 가 없어 결과가 확정되지 않으면 칸을 다시 읽어 RETIRED 일 때만 완료 |
- 실사 잠금(`COUNT_LOCKED`)은 실사 세션이 건다 — 이 화면에서 걸거나 풀지 않는다. 폐지된 칸은 고칠 수 없다.
- 완료 문구는 상세 화면 위에(성공 뒤 칸을 다시 읽으면 양식이 새 버전으로 다시 그려지므로).
- 실서버 확인 전(서버는 상태 변경·폐지를 바로 APPLIED 로 돌려준다 — `LocationService`).

### 4-2. 이동·보충 — mfc-inbound-service 0.9.0 `/move-orders*` (`features/moves/MovePages.tsx`)
| 화면 | API | 규칙 |
|---|---|---|
| 목록 `moves` | `GET /move-orders?mfcId=&state=` | 상태를 비우면 서버 기본(진행 중 = ACTIVE·CANCEL_PENDING). 상태 거르기는 URL 쿼리. 쪽 나누기 없음(계약). 종류(재배치·자동 보충)·긴급·진행(집음/내려놓음/카트)·담당 |
| 이동 지시 `moves/new` | `POST /move-orders` → 201 MoveOrder | MFC_SUPERVISOR. 같은 키 = 같은 이동(서버) — 결과 불명(503 등)은 "같은 요청으로 결과 확인". 거절 코드는 inventory 이동 배정 그대로(CATEGORY_MISMATCH·SKU_ALREADY_SHELVED·SKU_SPLIT_NOT_ALLOWED·LOCATION_CAPACITY_EXCEEDED·LOT_NOT_SHIPPABLE·CONFIG_REQUIRED 문구) |
| 고르기 도움 | `GET /mfcs/{id}/stock?sku=`(inventory), `GET /putaway-candidates?mfcId=&sku=`(location) | 누를 때만 부른다. 위치·LOT·품질·업무 상태를 보이고 고르면 칸에 채운다 — 걸러 내지 않는다(판정은 서버). 남은 공간 null = "모름" |
| 상세 `moves/<moveId>` | `GET /move-orders/{id}` | 지시한 사람 `SYSTEM` = "시스템". 카트 정리 대기는 안내만 |
| 취소 | `POST /move-orders/{id}/cancellations` {reason} | 진행 중(ACTIVE)에만. 사유 필수. 서버가 돌려준 상태로 문구(CANCELLED = 취소, CANCEL_PENDING = 카트 되돌려 놓으면 끝남) |
- 집어 올리기·내려놓기는 현장(PDA) 일 — 이 화면에 없다.

### 4-3. 작업자 — mfc-capacity-service 0.14.0 `/mfcs/{mfcId}/workers*` (`features/workers/WorkerPages.tsx`)
| 화면·동작 | API | 규칙 |
|---|---|---|
| 목록 `workers` | `GET …/workers?state=` | 비우면 서버 기본(재직·정지). 지금 배정 조건(effectiveTaskTypes)·휴게·오늘 출근(일일크루)·속도는 서버 값을 보이기만 |
| 등록 `workers/new` | `POST …/workers` | workerId = 직원 계정 운영자 ID(직접 입력 — 서버는 계정 존재를 확인하지 않고 기록만). 업무 필수, 자격은 "따로 정하기"일 때만 보낸다(생략 = 서버 기본). 409 `WORKER_ALREADY_REGISTERED`, 422 `DUTY_OUTSIDE_QUALIFICATION` |
| 상세 `workers/<workerId>` | `GET …/workers/{id}` | 업무·자격(버전·만료)·PDA 업무 묶음·업무 이력·상태 이력 |
| 업무 바꾸기 | `POST …/duty-changes` + `X-Expected-Version` = dutyVersion | 사유 필수. 응답 `changed=false` 면 "바뀐 것 없음". `affectedAssignments`(맞지 않게 된 진행 중 배정)를 경고로 — 지우지 않음 |
| 자격 바꾸기 | `POST …/qualification-changes` + `X-Expected-Version` = qualificationVersion | 만료는 선택(한국 시간 입력 → +09:00) |
| 상태 바꾸기 | `POST …/state-changes` | 재직·정지·퇴사, 사유 필수, `affectedAssignments` 경고. 로그인·센터 권한은 인사팀 소관(안내만) |
| 속도 배율 | `POST …/speed-changes` | 0.5~2.0 밖이면 보내지 않음, 사유 필수 |
| 휴게 | `POST …/breaks`, `…/breaks/current/end` | 지금 휴게 여부로 단추 하나. 센터 관리자는 번호 없이 켜고, 근무에 정한 자동 휴게도 일찍 끝낼 수 있다(작업자 본인은 409 `AUTO_BREAK_SUPERVISOR_ONLY`, capacity 0.20.0) |
| 휴게 번호(목록 위 칸, 0.20.0) | `GET/PUT /mfcs/{mfcId}/break-pin` | 작업자가 PDA 로 휴게를 켤 때 넣는 4자리. 두 번 같게 넣어야 정함(숫자만, 가림). 서버는 정했는지·누가·언제만 준다 — 번호는 다시 보이지 않음. 새로 정하면 5번 틀려 잠긴(15분) 작업자도 풀린다 |
| 일일크루 오늘 출근 | `POST …/day-enrollments` 본문 `{}` | 일일크루이고 아직 출근 전일 때만. 날짜를 보내지 않는다(생략 = 오늘, 서버가 정함) |
| 근무 일정 | `GET/POST …/shifts`, `POST …/shifts/{id}/cancellations` | 시각 입력은 한국 시간으로 `…+09:00` 을 붙여 보낸다. 16시간·겹침(409 `SHIFT_OVERLAP`)은 서버 판정. 취소는 사유 필수. (0.20.0) 휴게 구간 `breakStartAt`·`breakEndAt`(둘 다 또는 둘 다 없음 — 화면이 막고, 근무 안인지는 서버 400) → 그 시간에 서버가 자동 휴게 |
| 업무 내역(2026-11-17 PC 3) | `GET …/workers/{id}/activities?date=`(capacity 0.17.0, F-7 R3·R4) | 펼칠 때만 부른다. 날짜를 비우면 서버의 오늘(Asia/Seoul). 시각 순 내역(종류·대상·상품·수량·결과, 거절은 빨강)과 종류별 합계(거절은 건수만 — 서버 값). 못 읽은 원장(`unavailableSources`)은 빈 내역으로 두지 않고 경고 |
- 바꾼 뒤 완료 문구·맞지 않는 배정은 상세 화면 위에(양식은 새 버전으로 다시 그려진다).
- 다음 작업 받기(`next-tasks`)는 PDA 전용 — 넣지 않는다.
- **맡은 일(업무)·할 수 있는 일(자격)**(사용자 2026-11-16 "두 기능이 같아 보인다" → 화면만 다듬음, 11-08 분리 결정은 그대로): 이름을 "맡은 일(업무)"·"할 수 있는 일(자격)"·"실제 배정되는 일"로, 상세 두 폼 위에 "실제 배정 = 맡은 일 중 할 수 있는 일" 안내와 지금 값(서버 값 그대로), 자격 만료면 안내. 저장 전 미리 경고 — 맡은 일에 자격 없는 일을 넣으면 "배정되지 않아요", 자격에서 맡은 일을 빼면 "배정에서 빠져요"(미리 보기일 뿐, 확정은 서버 effectiveTaskTypes). LAN(claude-mfc-sup, MFC-SEED-01) 작업자 상세에서 확인.

### 4-4. 배송 현황·배차 실패 — bff 0.3.1 `live-delivery`, case 0.5.2 (`features/delivery/CenterDeliveryPages.tsx`, 2026-11-16)
- 화면 용어(사용자 2026-11-16): 백엔드 case 는 "접수 건"(배차 실패 접수 건), 상태 접수됨·처리 끝남·다시 처리 중, 종결 → 처리 결과 — 백오피스와 같다(`backoffice-web.md` §2-4).
- 백엔드 요청 `mfc-backoffice/2026-11-16-request-center-deliveries-and-dispatch-failures.md`(사용자 "①②③ 추천대로", 배송 원문 §1·§3.6). 새 묶음 "배송".
- **배송 현황** `deliveries`: bff `GET /backoffice/views/live-delivery?mfcId=<주소의 센터>&state=&size=50&cursor=` — 백오피스와 같은 API, 센터 관리자는 자기 센터 고정(다른 센터 403). 상태 비우면 진행 중 전부(오래된 순 50, 넘으면 truncated), 상태 고르면 `page.nextCursor`. 1분마다 다시 읽기. 배차 원천 실패 "모름(조회 실패)", `openCases null` "조회 실패", 못 읽은 원천 경고. "약속 지남"은 서버 `promisedAt < composedAt` 만. 열린 배차 실패 사건은 이 앱의 사건 상세로. 배송·주문 상세 화면은 이 앱에 없어 번호만.
- **배차 실패** `dispatch-failures`: case `GET /cases?kind=DISPATCH_FAILED&centerId=<센터>&size=50`(탭 "처리 중" / "처리 끝남"(`state=CLOSED`), 탭은 URL — 센터 관리자는 닫지 않으므로 열림·닫힘 대신 처리 단계로 부른다, 사용자 2026-11-16) · `GET /cases/{caseId}`(요약·관련·기한·담당·종결·이력). **보기만** — 집기·닫기 버튼 없음(서버 403), "처리는 지원센터(라이더 운영)" 안내. 배차 실패 접수 건의 센터 정보(배송 영역 DD-MFC)는 2026-11-16 배포(백엔드 #55) — 그 뒤 생긴 배차 실패부터 보이고, 그 전 것은 안 보인다고 안내(예전 "센터 정보가 실리기 전엔 0건이 정상" 문구는 지움).
- API 클라이언트: `api.bff`(`/api/v1/backoffice`)·`api.cases`. 계약 타입은 `gen:api` 의 mfc-backoffice 복사 목록에 backoffice-bff·case 를 더해 만든다(`tools/web-tools/gen-api.mjs`).
- 목 `mocks/centerDeliveryHandlers.ts`(우리 센터 진행 중 2·끝난 1·다른 센터 1, 사건 열린 1·닫힌 1·다른 센터 1 — 상태 SUSPENDED 로 거르면 배차·사건 원천 실패). 시험 `features/delivery/centerDelivery.test.tsx`(7).

### 4-4b. 포장 인계 현황 — bff 0.11.0 `packing-handover` (`features/delivery/PackingHandoverPage.tsx`, 2026-11-17 PC 3)
- 백엔드 요청 `clients/all/2026-11-17-request-packing-handover.md`(배송 원문 §10.1·§3.1·§3.4·§3.7). 묶음 "배송"의 첫 메뉴 `packing-handover`. **보기만**.
- bff `GET /backoffice/views/packing-handover?mfcId=<주소의 센터>&state=&size=50&cursor=` — 센터 관리자는 자기 센터 고정(다른 센터 403). 상태(ShipmentState)를 비우면 끝나지 않은 출고(PREPARING·READY·PARTIALLY_HANDED_OVER), 오래된 것부터, `page.nextCursor` 로 다음 쪽. 모니터에 띄워 두는 화면이라 30초마다 다시 읽기.
- 열: 주문번호(`orderNumber`, 없으면 주문 ID · 재발송 표시) · 단계(서버 `stage` — 출고요청·피킹중·패킹중·출고대기·일부 인계·인계 완료, null 이면 추정하지 않고 "단계 없음 — 출고 <원천 상태>") · 피킹/패킹 작업 상태 · 포장(밀봉/전체 · 인계 · 남음, 포장마다 상태·인계 허가·인계 시각·라이더) · 출고대기 시각 · 배차 요청 시각 · 배송 상태·배정 라이더.
- 배송 원천 실패(`delivery.state` null)는 "모름(조회 실패)" + 못 읽은 원천 경고, 배송 없음(`delivery` null)은 "배송 없음" — 섞지 않는다. 개인정보·QR 없음.
- 목 `mocks/packingHandoverHandlers.ts`(우리 센터 진행 중 4·취소 1·다른 센터 1 — 상태 CANCELLED 로 거르면 배송 원천 실패). 시험 `features/delivery/packingHandover.test.tsx`(2).

### 4-5. 작업 현황 — mfc-fulfillment-service 0.4.11 (`features/tasks/TaskPages.tsx`)
| 화면·동작 | API | 규칙 |
|---|---|---|
| 목록 `tasks` | `GET /tasks?mfcId=&type=&state=` | state 를 비우면 서버 기본(ASSIGNED·IN_PROGRESS). 유형·상태 거르기는 URL 쿼리(상태는 하나씩). 커서 더 보기. 담당은 capacity 배정의 투영 — 응답 asOf 를 "담당 기준"으로. 늦음·멈춤은 서버 표시값(자동으로 빼앗지 않음) |
| 상세 `tasks/<taskId>` | `GET /tasks/{id}` | 줄(계획·완료·취소·남음·확정 대기), 막힌 이유, 포장 위치, 방문 순서 방법. 재고 확정 대기 실적이 있으면 안내 |
| 작업 내놓기 | `POST /tasks/{id}/releases` {workerId = 지금 담당, reason?} | ASSIGNED·IN_PROGRESS 이고 담당이 있을 때만 단추. 409 `EXECUTION_IN_FLIGHT` 문구, 503 은 결과 불명(같은 키로 확인). 응답 상태가 READY 일 때만 "내놓음" |
| 출하·포장 | `GET /shipments/{id}`, `GET /packages/{id}/handover-resolution`(누를 때만) | 화면용 주문번호(`orderNumber`, 0.13.0 F-5 — 없으면 안 보임), 포장 인계 숫자(`handoverCode`, F-8), 포장 상태·인계 허가(만료 시각)·라이더. 판정과 "점원 확인 필요" 표시 |
- 확인 필요 포장 목록·확인(`GET /packages?checkRequired=true`, `handover-checks`)— 센터 관리자도(MB-3, fulfillment 0.17.0, 2026-11-19 반영). 목록 위 "확인 필요 포장" 카드: 놓인 위치·포장·주문·라이더·허가 끝 시각, "포장대에 있음" / "포장대에 없음(라이더가 가져감)"(한 번 더 확인 — 재고가 빠지는 확정). 409 FENCE_ACTIVE·INVALID_STATE 는 거절, 결과 불명은 같은 키. 확인 뒤 목록 다시 읽기.
- 시작·실적·포장·배차 요청은 현장 일 — 넣지 않는다.

### 4-5b. 작업 현황 행 조치 — 담당 바꾸기·내려놓기 (`features/tasks/TaskActions.tsx`, 2026-11-19 PC 3)
백엔드 알림 `clients/mfc-backoffice/2026-11-19-notice-reassign-release.md`(서버 변경 없음). 목록에서 늦음·멈춤 행을 위로 올리고, 행마다 단추 → 바로 아래 줄에 폼.
- **담당 바꾸기**(배정됨·진행 중, 대기면 "담당 정하기"): capacity `POST /assignments` {mfcId, taskId, taskType, workerId, reason} + `X-Expected-Version` = 목록 `assignment.assignmentVersion`(없으면 0). 고를 작업자 = `GET /mfcs/{mfcId}/workers?state=ACTIVE` 중 `effectiveTaskTypes` 에 그 유형이 있고 지금 담당이 아닌 사람(휴게 중 표시). 진행 중이면 현장 주의(시작부터 다시·집은 수량 그대로·피킹은 같은 장바구니·포장은 장바구니 확인·앞 사람 PDA). 200(같은 사람)은 "바뀐 것 없음", `OFF_SHIFT` 는 안내만. 409 VERSION_CONFLICT·422 는 거절 안내.
- **내려놓기**(배정됨·진행 중): fulfillment `POST /tasks/{id}/releases` {workerId = 지금 담당, reason} → 응답 READY 일 때만 "내려놓았어요". 409 EXECUTION_IN_FLIGHT·INVALID_STATE·NOT_ASSIGNEE 거절, 503 은 결과 불명(같은 키로 다시).
- 사유 필수(200자). 끝나면 목록·상세를 다시 읽고 1.5초 뒤 한 번 더(배정 반영 지연).

### 4-6. 배정 — mfc-capacity-service 0.14.0 `/assignments`·`/assignment-plans*` (`features/assignments/AssignmentPages.tsx`)
| 화면·동작 | API | 규칙 |
|---|---|---|
| 배정 목록(탭 `?tab=` 기본) | `GET /assignments?mfcId=&state=&date=&workerId=&taskId=` | state 생략 = ACTIVE. 거르기는 URL 쿼리. 출처(직접·추천 확정·다음 작업 받기), 경고(OFF_SHIFT = 근무 밖), `workerEligibility`(지금 맡을 수 없으면 사유) — 서버 값. 진행 중 행에 "다시 배정" |
| 직접 배정(`?tab=manual`) | `GET /assignments?taskId=`(지금 담당 확인) → `POST /assignments` + `X-Expected-Version` | 확인한 지금 담당 버전(없으면 0)으로 보낸다 — 확인 전·작업 ID 를 바꾸면 단추 꺼짐. 작업자는 재직 작업자 목록에서(못 불러오면 직접 입력). 응답 버전이 그대로면 "바뀐 것 없음", OFF_SHIFT 는 알리기만. 422 `WORKER_NOT_REGISTERED`·`WORKER_NOT_ACTIVE`·`DUTY_NOT_ALLOWED`·`ZONE_NOT_QUALIFIED`, 409 `VERSION_CONFLICT` 문구 |
| 배정 추천(`?tab=plan`) | `POST /assignment-plans` {mfcId, horizonMinutes 10~480} | 계산만으로는 배정이 바뀌지 않는다. 계산하면 추천 화면으로. 지난 추천 목록 `GET /assignment-plans?mfcId=&date=&state=`(MB-1, 2026-11-19 — 추천 탭 아래, 열기 = 추천 화면). 예전에는 목록 API 가 없어 추천 ID 로 연다 |
| 추천 화면 `assignments/plans/<planId>` | `GET /assignment-plans/{id}`, `POST …/commits` | 상태·계산 결과·평가(못 넣음·늦음·최대 부하)·한계(limitations)·근무 미등록 작업자·추천 배정·못 넣은 작업(사유). PROPOSED 만 확정 단추. 409 `PLAN_STALE` 이면 계획을 다시 읽어 STALE·낡은 이유를 보인다(아무것도 배정 안 됨) |
- 계산 입력(`…/input`)은 아직 화면에 넣지 않았다(재현 디버그용).

### 4-6b. 작업 시작 — mfc-capacity 0.22.0 (`features/assignments/StartWork.tsx`, 2026-11-19 PC 3)
- 백엔드 알림 `clients/mfc-backoffice/2026-11-19-notice-start-work.md` — 사용자 결정 "배정 추천 화면을 따로 두지 않는다".
- 배정 화면 맨 위 "작업 시작"(앞으로 30·60·120·240분) = `POST /assignment-plans` `{mfcId, horizonMinutes, commit: true}` → 결과 요약(서버 상태 그대로: 배정 N건·남은 작업 사유별, STALE 이면 "다시 눌러 주세요", NO_SOLUTION). 끝나면 배정·작업 목록·홈을 다시 읽는다.
- 탭: 지금 배정(행마다 담당 바꾸기 → 직접 배정) · **담당 없는 작업**(fulfillment `GET /tasks?state=READY` — 줄마다 "담당 정하기", 작업 현황과 같은 폼, 버전 0) · 직접 배정 · 지난 작업 시작(보기만 — "추천 계산"만 하는 단추는 뺐다).

### 4-7. 입고 — mfc-inbound-service 0.9.0 (`features/inbound/InboundPages.tsx`·`InboundOtherTabs.tsx`)
탭은 URL 쿼리 `tab`(입고 작업 기본 · `initial` · `returns` · `supply` · `promises`). 화면 요청 근거: 백엔드 handoff `all/2026-11-07-clients-request-mfc-inbound-screens.md` B2~B4.

| 화면·동작 | API | 규칙 |
|---|---|---|
| 입고 작업 목록 | `GET /inbound-tasks?mfcId=&taskType=&state=&receiptId=` | 화면 기본은 대기(state=READY 를 보낸다), "전체"는 state 없이(주소엔 `state=ALL`). 계획/완료/남음·담당 |
| 입고 작업 상세 `inbound/tasks/<taskId>` | `GET /inbound-tasks/{id}` | 담당이 있으면 "담당만" 안내(서버 409 `NOT_ASSIGNEE`) |
| 품질검사 | `POST …/inspections` {results[]} | 결과 여러 줄(수량·정상/격리·제조 LOT 표기·소비기한·제조일). 합계 > 남은 수량이면 보내지 않음(서버도 400). applyStatus APPLIED = 반영(+ 만든 적치 작업 ID), CAPTURED = 기록만(완료 아님), REJECTED = 재고 거절 사유(잔량 그대로), UNKNOWN_RESULT·503 = 결과 불명 → 같은 키 |
| 적치 | `POST …/putaways` {toLocationCode, qty} | 수량 기본 = 남은 수량. 적치 후보(`/putaway-candidates`)는 누를 때만. 결과 처리는 품질검사와 같다. rejectReason 6개 문구 |
| 초기 보유 수령(`initial`) | `GET /initial-stock-loads?mfcId=&state=`(목록, 기본 수령 전 — MB-1 2026-11-19) 또는 `?approvalId=` → `POST /initial-stock-loads/{receiptId}/receipts` | 목록에서 열면 그 승인 ID 로 찾는다. 이 센터·EXPECTED 일 때만 입력. 빠진 상품 = 0. 202 접수는 완료가 아니다 — 목록을 다시 읽어 상태(전기 대기·끝·거절)를 보인다 |
| 회수품 반입(`returns`) | `POST /return-receipts`(202, resultId = 반입 ID) → `GET /return-receipts/{id}`, 목록 `GET /return-receipts?mfcId=&state=`(MB-1 2026-11-19) | 목록에서 반입을 연다. 반영 상태·검수 상태를 서버 값으로 |
| 공급 요청(`supply`) | `POST /supply-requests`, `GET/PATCH /supply-requests/{id}`(버전), `POST …/withdrawals`(버전), 목록 `GET /supply-requests?mfcId=&state=`(MB-1 2026-11-19) | 목록에서 요청을 연다. 작성 중·제출됨일 때만 고치기, 본사 수신 뒤엔 철회 후 다시. 희망 시각은 한국 시간 +09:00 |
| 입고 예정(`promises`) | `/inbound-promises*` | 계약만(501, MB-2) — 안내만 |

### 4-8. 재고 — mfc-inventory-service 0.16.0 (`features/inventory/InventoryPages.tsx`)
탭은 URL 쿼리 `tab`(상품별 재고 기본 · `counts` · `unshippable` · `policies` · `handlings`). **본사 승인 번호(approvalRef)는 선택**(AP-1, inventory 0.22.0·quality 0.3.0·capacity 0.16.0 — 2026-11-17 PC 3). 기준(한 건 손실 10만 원 이상 또는 한 SKU 20개 이상, 운영 제한 해제는 늘)이면 서버가 422 `APPROVAL_REQUIRED` — `shared/approval.tsx` 가 걸린 기준(`details field=threshold`)과 안 되는 번호의 이유(`field=approvalRef` NOT_APPROVED·ALREADY_USED·EXPIRED·NOT_YET_EFFECTIVE·SELF_APPROVAL·TARGET_MISMATCH·OUT_OF_SCOPE)를 보이고, 승인 요청 본문(`field=approvalRequest`, JSON 문자열)은 화면에 쏟지 않는다. **본사 승인 요청 보내기**(2026-11-17, approval 타입은 PC 2 #74): 안내의 "본사 승인 요청 보내기" → approval-service `POST /change-requests`(422 의 요청 본문 그대로) → `POST /change-requests/{id}/submissions`(초안 버전, 202 resultId = 승인 번호) → 받은 번호를 화면의 번호 칸에 넣어 둔다. "승인 상태 확인" = `GET /approvals/{id}` reviewState(보기만). 승인되면 작업자가 같은 내용으로 다시 보낸다(자동 재전송 없음 — 정정은 같은 Idempotency-Key). 결과 불명이면 같은 키(초안을 만들었으면 제출만), 409 `DUPLICATE_APPROVAL` 은 "열린 승인이 이미 있다" 안내. LAN 은 PC 1 이 `VERIFY` 로 바꾸기 전까지 예전대로(번호 필수·확인 없음).

| 화면·동작 | API | 규칙 |
|---|---|---|
| 상품별 재고 | `GET /mfcs/{id}/stock?sku=`, 센터 전체 `GET /mfcs/{id}/stock-units`(MB-1 2026-11-19 — 품질·위치 거르기, 열기 = 그 상품) | LOT 요약(보유·격리·판매 가능·예약·가용)과 위치·품질·업무 상태별 단위 행 — 서버 값만 |
| 위치·LOT 정정 | `POST /mfcs/{id}/stock-corrections` | 단위 행의 "정정" → 수량(보이는 수량 이하)·목적 위치·바로잡은 LOT 표기/소비기한/제조일 중 하나 이상·사유·본사 승인 번호(선택). **승인 필요(422) 뒤 다시 보낼 때는 같은 `Idempotency-Key`**(승인 대상 = 요청 키 `targetRef <mfcId>:CORRECTION:<키>`, 422 는 기록되지 않음 — 다른 거절이면 새 키). 201 CommandResponse(REJECTED·UNKNOWN_RESULT 처리), 반영 뒤 재고 다시 읽기. 422 `INSUFFICIENT_STOCK`·`APPROVAL_REQUIRED`, 409 `INVARIANT_VIOLATION` 문구 |
| 순환 실사 시작(`counts`) | `POST …/count-sessions` {locationCodes(최대 50, 중복 제거), reason?} | 실사 잠금 칸만 — 409 `LOCATION_NOT_LOCKED`(잠금 주체는 BR-52 R14 대기, 화면은 서버 판정만 안내). 시작하면 그 실사를 연다 |
| 실사 보기·결정 | `GET …/count-sessions?state=`(목록, 기본 승인 대기 — MB-1 2026-11-19), `GET …/count-sessions/{id}`, `POST …/approvals` | 목록에서 실사를 연다. 계수 중에는 차이를 숨긴다(서버가 null). 승인 대기면 승인(본사 승인 번호 선택)·반려. 422 `SELF_APPROVAL`·`APPROVAL_REQUIRED`, 409 `BOOK_CHANGED`. 결정 문구는 실사 화면 위에(결정 영역은 사라진다). 계수·재계수는 PDA |
| 출하 부적격 LOT(`unshippable`) | `GET …/unshippable-lots` | 소비기한 빠른 순. 이미 기타 칸이 아니면 "이동 지시" → 이동 화면을 상품·LOT·출발 칸·수량으로 채워 연다(`moves/new?sku=&lotId=&fromLocation=&qty=`) |
| 보충 기준(`policies`) | `GET/PUT/DELETE …/replenishment-policies` | 칸·상품·최소·목표·단위. 최소 > 목표면 보내지 않음. 고회전 선반이 아니면 422 `REPLENISH_ONLY_HIGH_TURNOVER`. 삭제는 204(`locationCode`·`sku` 쿼리) |
| 상품 취급(`handlings`) | `GET/POST …/sku-handlings` | ON/OFF 거르기, 커서 더 보기. 켜기·끄기는 `X-Expected-Version` = 취급 레코드 version(없으면 0). `changed=false` 면 "바뀐 것 없음". 422 `SKU_INACTIVE`, 404 `SKU_NOT_FOUND` 문구. 일괄 변경(`sku-handling-batches`)은 아직 안 붙임 |

### 4-9. 품질 — mfc-quality-service 0.2.0 (`features/quality/QualityPages.tsx`)
탭은 URL 쿼리 `tab`(격리·해제 기본 · `disposals` · `inspections` · `incidents`). 탭마다 위에 목록(MB-1, quality 0.5.0, 2026-11-19 — 판정 기본 해제 승인 대기, 폐기 기본 승인 대기, 검수 탭은 회수품 반입 목록 + 검수 목록). 목록 "열기" 또는 번호로 연다(`decisionId`·`disposalId`·`inspectionId`·`returnReceiptId` 쿼리). 요청한 사람과 승인하는 사람은 달라야 한다(422 `SELF_APPROVAL`).

| 화면·동작 | API | 규칙 |
|---|---|---|
| 판정(격리·해제) | `POST /quality-decisions` → 202 CommandResponse(resultId = 판정 번호) | 판정·사유(7종)·메모·대상 줄(상품·LOT·위치·수량·업무 상태). 격리는 바로 반영, 해제는 요청만(ACCEPTED → "해제 승인 대기"). 보낸 뒤 판정을 다시 읽어 상태로 보인다(접수를 완료로 보이지 않음) |
| 판정 보기·해제 결정 | `GET /quality-decisions/{id}`, `POST …/{id}/approvals` {APPROVE\|REJECT, note?} | 해제 승인 대기일 때만 단추. 응답 상태가 APPLIED 면 "반영", DECLINED 면 "반려", 그 밖(결과 모름 등)은 상태만 |
| 폐기 요청 | `POST /disposal-approvals` {action REQUEST, lines, reason?, sourceRef?} | 202 resultId = 폐기 번호 → 그 폐기를 연다 |
| 폐기 승인·반려 | `POST /disposal-approvals` {APPROVE\|REJECT, disposalApprovalId, approvalRef} + `X-Expected-Version` | 본사 승인 번호 선택(AP-1). 전량 승인(부분 승인은 아직 안 붙임) |
| 폐기 실행 | `POST /disposal-approvals/{id}/executions` | 승인·일부 실행일 때만. 줄마다 실행 수량(기본 = 남은 승인량, 넘으면 단추 꺼짐 — 서버도 422 `QTY_EXCEEDS_APPROVED`). 실행 상태 APPLIED·REJECTED(사유)·UNKNOWN_RESULT(같은 키) |
| 회수품 검수 | inbound `GET /return-receipts/{id}` → `POST /return-inspections` | 반입이 반영되고 검수 대기일 때만. 줄마다 재판매/폐기·보관 온도대·개봉·신선·폐기 사유. 재판매는 상온·미개봉·신선 아님만(화면이 막고 서버도 422 `RESALE_NOT_ALLOWED`). inspectedBy = 로그인한 사람. 결과는 검수 번호로 연다(재판매·폐기 수량, 폐기 승인 요청 번호) |
| 품질 사고(`incidents`) | `/quality-incidents*` | 계약만(501, MB-2) — 안내만 |
- 계약 머리말의 "회수품 검수 501" 은 낡은 문구 — 서버(`ReturnInspectionService`)에 구현돼 있다(관리자·반입한 사람 아님·줄 합계 = 반입 수량).

### 4-10. 운영 제한 — mfc-capacity-service 0.14.0 `/operation-restrictions*` (`features/restrictions/RestrictionPages.tsx`)
| 화면·동작 | API | 규칙 |
|---|---|---|
| 목록 | `GET /operation-restrictions?mfcId=&activeOnly=` | 기본 활성만(서버 기본 — 보내지 않음), "해제된 것까지"는 `activeOnly=false`(주소 `all=1`). 종류·상태·적용 기간(끝 없음)·축소 후 수용 단위·사유·승인 근거(등록 / 해제)·영향 주문 |
| 등록 | `POST /operation-restrictions` → 201 CommandResponse | 접수 중지·수용 축소. 시작 필수, 끝은 선택(끝 ≤ 시작이면 보내지 않음), 수용 축소는 단위 필수. **승인 근거 직접 입력**(등록은 계약상 필수·기록만 — AP-1 대상 아님), 없으면 단추 꺼짐. 시각은 한국 시간 +09:00. APPLIED 일 때만 완료 문구 |
| 해제 | `DELETE /operation-restrictions/{id}?approvalRef=` + `X-Expected-Version` → 202 | 활성일 때만. 해제는 늘 본사 승인 — 번호는 선택으로 보내고(비우면 query 없음) 없으면 422 승인 안내. APPLIED 면 "해제", 그 밖은 목록을 다시 읽어 상태로 |
- 시간이 지나도 자동 해제하지 않는다(서버) — 화면 문구로 알린다. MFC_SUPERVISOR 가 아니면 서버 403.

### 4-11. 내 정보 — hr-service `GET /hr/employees/me` (`features/me/MyInfoPage.tsx`, 2026-11-18 PC 3)
- 왼쪽 메뉴 "내 세션" 아래 "내 정보"(`/me`, 센터와 상관없음). 이름·사번·운영자 ID·회사 메일(로그인 ID)·고용 형태·소속(센터/본사 부서)·상태 — 서버 값 그대로. 404 = 인사 기록 없음(오류 아님). LAN 에서 MFC_SUPERVISOR·MFC_WORKER 토큰 200(백엔드 확인 2026-11-18).
- 사용자 정정(2026-11-18, 회신 `clients/mfc-backoffice/2026-11-18-reply-my-account.md`): "비밀번호" = 로그인 비밀번호가 아니라 **센터 휴게 번호**, 연락처 = 시스템이 쓰지 않는 **연락 수단 표시용**(mfc-capacity). EA-3·HR-3 철회. 회사 메일은 인사팀만.
- (2026-11-19) 맡은 센터마다(두 곳 이상이면 고르기, 없으면 안내):
  - 센터 휴게 번호(capacity 0.20.0 `break-pin`) — 작업자 목록 위와 같은 카드(`features/workers/BreakPinCard.tsx`). MFC_SUPERVISOR 만 정하기, 그 밖은 보기만.
  - 내 연락처(capacity 0.21.0 `GET·PUT /mfcs/{mfcId}/staff-contacts/me`) — 표시 이름·휴대폰·이메일, X-Expected-Version(처음 0), 빈 칸 = null(지움). 형식(휴대폰 숫자·- 9~11자리, 메일, 이름 50자)은 화면에서 먼저 막고 확정은 서버(400·409). 바뀐 것이 없으면 저장 버튼이 꺼진다.
  - 이 센터 직원 연락처(`GET /mfcs/{mfcId}/staff-contacts`) — 서버 순서 그대로, 이름이 없으면 "이름 · 사번", 내 줄은 "나". 조회 실패 ≠ 빈 목록.
  - 연락처는 라이더·다른 센터가 보라고 둔 값이라 가리지 않고 보인다(사용자 결정). 로그·주소·저장소에는 남기지 않는다.
- 타입: `gen:api` 생성물 `src/api/generated/hr`(PC 2 가 mfc-backoffice 생성 목록에 `hr` 을 넣음, 2026-11-18). 처음 넣을 때 쓴 임시 `src/api/hrSelf.ts` 는 지웠다.

### 4-12. 사람 이름·화면 번호(모든 메뉴, 2026-11-19 PC 3 — ADR-0070 덧붙임 2026-11-19 반영)
- 운영자 ID(작업자·담당·요청자·결정자·승인자·만든 사람 등)는 `shared/OperatorLabel.tsx` `<Who>` 로 "이름 · 사번" — hr 0.8.0 `GET /hr/employee-labels?operatorIds=`(직원 토큰 누구나, 50개까지). 한 화면의 ID 를 모아 한 번에 묻는다. 모르는 ID 는 ID + "확인 불가", 조회 실패는 ID + "이름 못 읽음". 입력칸(작업자 ID 넣기)은 ID 그대로. 작업자 목록·상세는 "등록 이름 · 사번"(사번을 못 읽으면 이름 + "사번 못 읽음").
- **목록·표·링크·칩·안내 글에는 화면 표기만**(덧붙임 — 시스템 ID 도 "끝 8자리"도 쓰지 않는다). 시스템 ID 는 상세의 접힌 "시스템 번호"(복사 단추)에만.
  - 배송 `deliveryNumber`·주문 `orderNumber`(bff 0.14.0) — 번호가 없으면 "번호 없음"만. 라이더는 센터 관리자에게 bff 가 null(0.15.0) → "라이더 정보 비공개"만.
  - 작업 지시(작업·이동·입고 작업·배정 추천) = "종류 · 생긴 시각". 품질 사고 = "파손 사고 · 시각". 배차 실패 접수 건 = case `caseNumber`(C-MMDD-일련).
  - 포장: 인계 판정·bff 포장 인계에 라벨 번호(`handoverCode`)가 없어 목록에는 포장대 위치·"포장 1·2"(출고 안 순서), 포장 시스템 ID 는 시스템 번호 칸. 화면 번호 요청 `docs/handoff/mfc-backoffice/2026-11-19-backend-display-labels.md`.
  - 센터 목록(판정·폐기 승인·검수·반입·공급 요청·초기 보유·실사·배정 추천)은 ID 칸을 빼고 종류·상태·시각으로 알아본다(열면 상세). 배정 목록·추천 줄의 작업은 "작업 보기" 링크.

### 4-13. 통합 백오피스와 같은 겉모습·목록·상세 부품(2026-11-19 PC 3 — 지침 `docs/handoff/all/2026-11-19-request-ui-ux-align.md`)
- 겉모습: `main[data-skin=wing]`(index.css) — 연회색 바탕·흰 상자, 파랑 `#346aff` 하나, 그림자 없는 얇은 테두리, 큰 제목, 넉넉한 표, 흰 단추. 왼쪽 메뉴는 P 배지 로고·고른 메뉴 파란 채움·흰 글자(민트 안 씀).
- 부품(사본 — web-ui 로 올라오면 바꿔 낀다): `shared/listParts.tsx`(StatCard 가로형·StatStrip·countCell·GuideBox·AllDone·SearchBar 칩 접기), `motion.tsx`, `ProgressSteps.tsx`, `StickyTitle.tsx`, `Preview.tsx`, `SavedViews.tsx`, `SearchSelect.tsx`(초성), `SeenMark.tsx`. 앱 것: `recentViews.ts`·`workQueue.tsx`(센터·종류마다), `app/PageChrome.tsx`(탭 제목·끊김 띠·'/' 키), `features/ops/opsQueries.ts`(운영판·탭 제목이 같은 조회).
- 화면:
  - 작업 현황: 상태 카드 4(대기·담당 정해짐·진행 중·막힘 — 상태마다 `GET /tasks?state=&size=50`, 넘치면 "50건 이상", 실패 "?", 누르면 거르기), 넷 다 서버 0건이면 "수고하셨어요", 안내 상자, 검색 칩, 내 보기, 새 줄 강조, 준비 약속 15분 안 숨쉬기·남은 분, 최근 봄, 줄 누르면 미리보기(↑↓·Enter 상세). 상세: 이전·n/N·다음([ ]), 제목 띠, 진행 단계(대기 → 배정 → 진행 → 완료, 막힘은 진행에서 주의, 실패·취소·일부 끝남은 ✕), 시스템 번호(작업·출고). 담당 바꾸기 작업자 고르기는 쳐서 찾기(초성).
  - 작업자: 숫자 카드(재직·정지·휴게 중·일일크루 출근 전 — 서버 기본 목록 전부에서 셈), 안내·칩·내 보기·최근 봄, 상세 이전·다음·제목 띠·시스템 번호(운영자 ID).
  - 이동·보충: 숫자 카드(진행·취소 대기·긴급 — 서버 진행 중 목록에서), 안내·칩·내 보기·새 줄·최근 봄, 상세 이전·다음·제목 띠·진행 단계(지시 → 옮기는 중 → 끝남)·시스템 번호.
  - 입고 작업: 칩·내 보기·새 줄·최근 봄, 상세 이전·다음·제목 띠·시스템 번호(작업·입고·앞 작업).
  - 홈: 숫자 칸 왼쪽 띠 없이 숫자 색, 바뀌면 빛남·▲▼, 처리할 예외 0건(모든 원천 성공)이면 "수고하셨어요".
- 화면 틀: 탭 제목 "(약속 초과 출고 수) 화면 · PMart MFC"(운영판과 같은 조회), 끊김 띠, '/' 로 검색 칸(접혀 있으면 펼침). "움직임 줄이기"면 움직임 모두 끔.
- 홈 보탬(2026-11-19 사용자 "필요한 기능 알아서", `features/ops/FlowBoard.tsx` — 새 API 없음, 이미 읽는 값만):
  - 작업 흐름 두 줄: 위 "먼저 확인"(늦음·멈춤 = 서버 표시값, 막힘, 담당 없음), 아래 유형(피킹·포장·배차 요청·복귀) × 단계(선행 대기 › 대기 › 배정 › 진행) 수. 원천은 운영판의 끝나지 않은 작업 조회(같은 키), 쪽 상한이면 "N+". 누르면 작업 현황이 그 유형·상태로.
  - 작업자 지금: 재직 작업자(`GET …/workers?state=ACTIVE`)마다 "이름 · 사번", 휴게, 맡은 끝나지 않은 작업 수(진행 수), 늦음·멈춤 작업이 있으면 표시. "맡은 일 없음"은 쉬지 않는데 0건일 때 — 작업 목록을 끝까지 읽었을 때만(잘렸거나 실패면 "맡은 작업 모름").
  - 최근 본 것: 이 브라우저·이 센터에서 연 상세(화면 표기만).
- 왼쪽 메뉴 "작업 현황" 옆 늦음·막힘 수 배지(같은 조회, 0·실패면 없음), 머리줄 "?" 단축키 안내(`/`·`[ ]`·↑↓·Enter·Esc).
- 품질 사고: 상태 숫자 카드(처리 중·닫기 대기 — 상태마다 `GET /quality-incidents?state=&size=50`), 목록에서 사고 번호 칸 뺌, 상세 제목 "종류 · 연 시각" + 시스템 번호.
- 하지 않은 것: 일괄 맡기(MFC 에 일괄 명령 대상 없음), 위치·재고 화면의 숫자 카드(서버 상태별 수가 없는 목록이 많아 다음에).

## 5. 목 모드
- 목 계정: 센터 관리자(MFC 1곳 `MFC-BSN-01`), 센터 관리자(MFC 2곳 `MFC-BSN-01`·`MFC-SEL-01`), 현장 작업자, 운영 관리자(센터 없음). `src/mocks/db.ts`.
- 목 핸들러:
  - 로그인(employee-auth — 세션 응답에 목 센터 이름)
  - 위치(`mocks/locationHandlers.ts` — 센터 권한·코드 중복·문법·버전·폐지 조건)
  - 이동(`mocks/moveHandlers.ts` — 관리자만 지시·취소, 카테고리 칸 거절, 재고·적치 후보)
  - 작업자(`mocks/workerHandlers.ts` — 관리자만 바꾸기(휴게·출근은 본인도), 버전·중복·자격 밖 업무·근무 겹침·맞지 않는 배정)
  - 작업(`mocks/taskHandlers.ts` — 기본 상태·커서·내놓기 조건·출하·인계 판정)
  - 배정(`mocks/assignmentHandlers.ts` — 버전·적격 422·같은 사람·추천 계산(READY 작업 → 적격 작업자)·확정 재확인 PLAN_STALE)
  - 입고(`mocks/inboundHandlers.ts` — 담당만·잔량·정상 LOT 마다 적치 작업·선반 아니면 REJECTED·초기 보유 EXPECTED/승인 수량·공급 요청 버전)
  - 재고(`mocks/inventoryHandlers.ts` — 정정 수량·승인 근거, 실사 잠금·자기 승인, 고회전 보충 기준, 취급 버전·비활성. 상품별 재고 조회는 moveHandlers 의 같은 목)
  - 품질(`mocks/qualityHandlers.ts` — 격리 바로 반영·해제 요청, 자기 승인, 폐기 승인 근거·버전·잔량, 회수품 재판매 조건·합계)
  - 운영 제한(`mocks/restrictionHandlers.ts` — 관리자만, 승인 근거, 축소 단위, 활성만 기본, 해제 버전).
  - 메뉴 화면을 만들 때 그 계약의 목을 더한다.
- 목 이동: 진행 중 2(긴급 재배치·자동 보충), 카트 정리 대기 1, 끝남 1(+ 다른 센터 1). 목 재고는 `SKU-MILK-1` 세 줄(하나는 격리).
- 목 작업자(`MFC-BSN-01`): 김현장(정규직, 자격이 업무보다 넓음, 진행 중 피킹 배정 1·근무 1), 이알바(알바, 휴게 중), 박일일(일일크루, 출근 전), 최정지(정지), 정퇴사(퇴사).
- 목 운영 제한(`MFC-BSN-01`): 활성 수용 축소 RST-1(영향 주문 1), 해제된 접수 중지 RST-0.
- 목 품질(`MFC-BSN-01`): 해제 승인 대기 QD-1(요청 = 작업자), 폐기 DSP-1 승인 대기·DSP-2 승인됨(남은 3), 검수 대기 회수품 RR-1(라면 2·우유 1, 반입 = 작업자).
- 목 재고(`MFC-BSN-01`): 실사 CNT-1 승인 대기(시작·계수 = 작업자, 장부 12 → 10), CNT-2 계수 중(시작 = OP-sup-1), 보충 기준 1, 취급 3(ON·OFF·판매 중지), 출하 부적격 2(하나는 이미 기타 칸).
- 목 작업(`MFC-BSN-01`): 피킹 진행 중(멈춤, 출하 SHP-1 — 포장 PKG-1 밀봉·허가 만료), 포장 담당, 피킹 대기(담당 없음), 피킹 막힘, 피킹 끝남, 복귀 진행 중(늦음·재고 확정 대기 실적 1).
- 목 위치: `MFC-BSN-01` 에 사용 중 3·닫힘 2(하나는 재고가 남아 폐지 거절)·폐지 1, `MFC-SEL-01` 에 1.
- 목 모드는 새로고침하면 목 서버 기억이 지워져 다시 로그인해야 한다(화면 안 링크로 옮겨 다닌다).

### 4-4d. 배차 지연 — delivery-dispatch 0.12.0 `GET /dispatch-delays?mfcId=` (`features/delivery/DispatchDelayPage.tsx`, 2026-11-19 PC 3)
- 백엔드 요청 `clients/mfc-backoffice/2026-11-19-request-dispatch-delays.md`(원문 Delivery §3.6). 지연 안내가 난 픽업 전 배송, 약속 이른 순, 30초마다.
- 칸: 배송 번호(execution `GET /deliveries?deliveryIds=&mfcId=` 50개씩 — 없으면 "번호 없음", 조회 실패면 "번호 확인 불가"), 배차 상태, 라이더(없으면 "라이더 없음"), 약속 시각, 약속 대비(지금 − 약속, 지났으면 빨강 숨쉬기), 지연 안내 시각, 시스템 번호(배송·주문).
- "배차 불가로 취소"(claim 0.7.0 CL-5)는 **막아 둠** — 주문 행·미이행 수량을 센터 관리자가 읽을 API 가 없다. 요청 `docs/handoff/mfc-backoffice/2026-11-19-backend-dispatch-cancel-lines.md`(DC-1 서버가 행 채우기 추천).
- 홈 숫자 칸 "배차 지연(픽업 전)" → 이 메뉴.

### 4-4c. 반납 인증번호 — delivery-execution 0.28.0 `/return-handovers*` (`features/delivery/ReturnHandoverPage.tsx`, 2026-11-19 PC 3)
- 회수·반납 배송이 MFC 로 올 때 라이더에게 알려 줄 4자리(PDA 반납 인증번호 화면과 같은 API·번호). `GET /return-handovers?mfcId=` 30초마다, 반납이 끝나면 목록에서 빠진다.
- 5번 틀리면 잠김 → "새 번호 내고 잠김 풀기"(한 번 더 확인, `POST …/{deliveryId}/code-reissues` — 앞 번호는 더 안 맞음, 409 = 이미 끝남). 라이더는 "라이더 정보 비공개"(ADR-0070 덧붙임 — ID 끝자리 안 씀).

### 4-9b. 품질 사고·상품 취급 단종/신상품 — mfc-quality 0.6.0·mfc-inventory 0.27.0 (`features/quality/IncidentPages.tsx`, 2026-11-19 PC 3)
- 사용자 결정(2026-11-19): 자동(결품 보고 중 파손만) + 센터 관리자 직접 등록, 영향 LOT 을 모두 처리(격리 해제 APPLIED·폐기 승인)한 뒤 관리자가 사유를 적고 닫는다. 고객 영향 case 자동은 백엔드 2차.
- 품질 > 품질 사고 탭: 목록(기본 처리 중·닫기 대기), 직접 등록(종류·설명·LOT 1~50 — 이 센터에 재고가 남은 LOT 만, 등록은 격리를 걸지 않음), 상세(영향 LOT 별 처리·남은 LOT 수는 서버 값). "격리 요청"은 격리·해제 탭에 사고 번호·LOT 을 채워 판정 본문 `incidentId` 로 잇는다. 닫기는 남은 LOT 0 일 때만 단추(서버도 409 LOTS_NOT_RESOLVED), 사고 `version` 으로.
- 재고 > 상품 취급: 권한은 지금대로(그 센터 관리자·그 센터 권한 MD). 본사 단종(`offReason` DISCONTINUED)은 "본사 단종" + 켜기 막힘(409 SKU_DISCONTINUED). 신상품(정한 적 없음 `undecided=true`)은 자동으로 켜지 않고 맨 위 배너 "새 상품 n개"(서버 `totalCount`) → "새 상품 보기".
