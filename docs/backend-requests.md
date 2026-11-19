# 백엔드 요청 목록 (계약 공백·확인 필요)

클라이언트 구현에 필요한데 `../pmart-backend/contracts` 에 없거나 모호한 것. **이 저장소에서 백엔드를 고치지 않는다.** 항목은 사용자를 통해 백엔드 담당(다른 계정)에 전달한다.
상태: `OPEN`(미전달) / `SENT`(전달) / `AGREED`(합의, 계약 반영 대기) / `DONE`(계약 반영됨, 커밋 SHA) / `WONTFIX`.
목(mock)에서 임시로 쓰는 경우 코드에 `// BR-xx` 를 표시한다.

기준: pmart-backend `75fe667` (2026-10-23).

| ID | 우선 | 앱 | 요약 | 상태 |
|---|---|---|---|---|
| BR-01 | 높음 | 고객 | 토스 결제창 진입 정보·결제 인증 결과 전달 경로가 고객용 API에 없음 | **RESOLVED**(계약, ADR-0020): `POST /payment-confirmations` 등. 결제 진입 정보는 초안 `nextAction=PAY`·`payment`. 고객앱 반영(2026-10-31, 토스 결제위젯 SDK 연결. customerKey 는 D6 미정이라 anonymous) |
| BR-02 | 높음 | 라이더·MFC·관리자·기사 | 고객 외 주체(라이더·점원·운영자·간선기사) 로그인·전화 본인확인 API 없음 | 일부 DONE — 운영자 로그인 `f6ed21b`(ADR-0018), 점원(mfc_app) 로그인은 employee-auth-service `app=mfc`(백엔드 ADR-0056 6단계, 2026-11-13 구현). 라이더·간선기사·본인확인 OPEN |
| BR-03 | 높음 | 전체(특히 웹) | 사용자 토큰 보관 방식(쿠키/CSRF vs Bearer) 미정, 게이트웨이가 `Cookie` 제거 | RESOLVED: 모바일은 회신(2026-10-24 `clients/all/2026-10-24-clients-reply-high.md`)대로 응답 본문 토큰 + 보안 저장소. 웹 직원 refresh 는 ADR-0059(2026-11-13)로 세션별 HttpOnly 쿠키 + Signed Double-Submit CSRF(web/core `employeeAuth.ts`) |
| BR-04 | 중간 | 관리자 웹 | 게이트웨이 CORS 설정 없음 — 웹 배포 출처 결정 필요 | DONE (`f6ed21b`·`1b0f84b`, 허용 출처 localhost:5173·3000, LAN `http://d603-16`) |
| BR-05 | 높음 | MFC | PDA 작업 목록·작업 상세(피킹 지시 행) 조회 API 없음 | AGREED (`e817184`, check 통과 `3916354`) |
| BR-06 | 높음 | 라이더 | 배차 제안 수신 채널·대기 목록(일반배차모드) API 없음 | AGREED(부분, `e817184`+`f4dd171`, check 통과 `3916354`) — 푸시·SSE·대기 목록 보류 |
| BR-07 | 높음 | 라이더·고객·관리자 | 파일 업로드 API 없음(`photoRefs` 는 존재하지 않는 "file-service" 참조) | 일부 해소 — 리뷰 사진은 review 0.2.0 `POST /review-photos`(고객앱 반영 2026-11-16). 배송 전달 사진·CS 첨부·회수/파손 증빙은 그대로 OPEN |
| BR-08 | 낮음 | 전체 | `X-Source-System` 클라이언트 값 목록 확정 | OPEN |
| BR-09 | 중간 | 고객·라이더 | 푸시 토큰(FCM/APNs) 등록·해제 API 없음 | **RESOLVED**(notification-service 0.4.0 `PUT·DELETE /me/push-tokens/{deviceId}`·`GET /me/push-tokens`, 고객·라이더). 고객앱 반영 2026-11-17~18(요청 `docs/handoff/archive/2026-11-17-backend-customer-push-fcm.md`). 목록 상태 고침 2026-11-19 |
| BR-10 | 중간 | 관리자 웹 | 상세 화면용 조회 경로(bff 미제공 화면)·내보내기/다운로드 API | OPEN |
| BR-11 | 중간 | MFC | 점원 화면의 피킹·패킹·출고대기 현황, 입고 예정 화면의 조회 경로 | OPEN |
| BR-12 | 낮음 | 고객 | 고객 노출 문구용 상태 코드(FUL_*, CXL_* 등) 와 계약 enum 대응 확정 | OPEN |
| BR-13 | 중간 | 고객 | 배송 방식별 현재 가능 여부·불가 사유·예상시간·배달팁 조회 없음 | **RESOLVED**(2026-10-30, 백엔드 1203209): `GET /delivery-options`. 고객앱 배송 선택에 반영(LAN 배포 확인 전) |
| BR-14 | 중간 | 고객 | 견적에 최소주문 부족액·첫 구매 무료 4가지 상태 없음 | **RESOLVED**(2026-10-30, 1203209): Quote `minOrderShortfall`·`firstPurchaseBenefit`, 최소주문 미달은 초안 `blockers`. 고객앱 반영 |
| BR-15 | 중간 | 고객 | 반품·교환 자격(품목별 가능 여부·기한·사유) 조회와 사유별 증빙 요건 없음 | 일부 해소 — 고객 문의 접수·조회는 case-service 0.2.0 `inquiries` 로 생김(고객앱 반영 2026-11-15, 종류 7가지·주문 연결). 전달 사진 조회·사진 첨부·상담 채널 운영 시간은 그대로 없음. 원 요청 `docs/handoff/archive/2026-10-24-backend-customer-gaps.md` |
| BR-16 | 중간 | 고객 | 고객 배송 문의 접수(지연·오배송·파손·누락·미수령) 경로 없음 | 일부 해소 — 고객 문의 접수·조회는 case-service 0.2.0 `inquiries` 로 생김(고객앱 반영 2026-11-15, 종류 7가지·주문 연결). 전달 사진 조회·사진 첨부·상담 채널 운영 시간은 그대로 없음. 원 요청 `docs/handoff/archive/2026-10-24-backend-customer-gaps.md` |
| BR-17 | 낮음 | 고객 | 현금영수증 신청·발급 가능 여부·발급 결과 조회 없음 | 일부 해소 — 고객 문의 접수·조회는 case-service 0.2.0 `inquiries` 로 생김(고객앱 반영 2026-11-15, 종류 7가지·주문 연결). 전달 사진 조회·사진 첨부·상담 채널 운영 시간은 그대로 없음. 원 요청 `docs/handoff/archive/2026-10-24-backend-customer-gaps.md` |
| BR-18 | 낮음 | 고객 | 주문서 이탈 시 초안 처리(명시적 취소 경로 여부) 확인 | 일부 해소 — 고객 문의 접수·조회는 case-service 0.2.0 `inquiries` 로 생김(고객앱 반영 2026-11-15, 종류 7가지·주문 연결). 전달 사진 조회·사진 첨부·상담 채널 운영 시간은 그대로 없음. 원 요청 `docs/handoff/archive/2026-10-24-backend-customer-gaps.md` |
| BR-19 | 낮음 | 고객 | 상품 카드·상세의 100g/100mL당 가격 표시 값 없음 | OPEN |
| BR-20 | 중간 | 고객 | 필수 동의 대기(AUTH_CONSENT)에서 토큰 없이 동의 변경을 호출할 경로·`requiredConsents` 형식 불명 | RESOLVED(회신 2026-11-17 `clients/customer-app/2026-11-17-notice-consents.md`, auth 0.2.0): 동의는 `completions` 본문으로, 형식 `TYPE:version`. 고객앱 반영 `9f949f5` |
| BR-21 | 낮음 | 고객 | `OrderDraft` 응답에 품목·배송 방식·도착 구간·주소 반영 내용이 없음, 품절 처리 "다음에도 적용" 저장 경로 없음 | RESOLVED: 초안 `lines`·`delivery`·`blockers`(2026-10-30, 1203209). 품절 처리 "다음에도 적용"은 customer 0.4.0 `GET`·`PUT /me/order-preferences`(2026-11-18), 고객앱 반영 `61b8553` |
| BR-22 | 낮음 | MFC | 밀봉 요청에 포장재 종류(보냉백 XS~XL·봉투 소~대·보냉재) 필드 없음, 라벨 출력 정보 없음 | OPEN |
| BR-23 | 높음 | 라이더 | 포장 QR 원문 형식이 계약에 없어 스캔한 QR 에서 경로의 packageId 를 얻을 수 없음 | RESOLVED(회신 2026-11-14 `clients/rider-app/2026-11-14-reply-br23-br24-qr-and-drop-info.md`): MFC 형식 `PKG:<packageId>:<packageVersion>`(마지막 `:` 로 나눔, 원문 그대로 `scannedCode`). 라이더앱 반영(2026-11-16 일지, `packageIdFromQr`) |
| BR-24 | 높음 | 라이더 | 라이더가 볼 전달지(주소·상세·출입 안내·요청사항·연락)를 주는 계약 경로가 없음 | RESOLVED(회신 2026-11-14 `clients/rider-app/2026-11-14-reply-br23-br24-qr-and-drop-info.md`): `GET /deliveries/{id}/drop-info`(delivery-execution, 픽업 뒤~전달 완료 전, 연락처는 고객 번호 그대로 — 안심번호 없음). 라이더앱 반영(2026-11-16 일지, `0bf6d58`). LAN 배포됨, 라이더 토큰 실서버 확인은 아직 |
| BR-25 | 중간 | 관리자 웹 | 인증이 필요한 상품 이미지(`GET /content-images/{imageId}`)를 `<img>` 로 표시할 방식 미정 | OPEN(백엔드 인지, handoff 2026-10-30 §0-3) |
| BR-26 | 낮음 | 관리자 웹 | 상품·콘텐츠 초안 목록 조회 API 없음(ID 를 알아야만 다시 열 수 있음) | OPEN |
| BR-27 | 낮음 | 고객 | 이용 불가 계정 오류: 계약 422 `ACCOUNT_NOT_PURCHASABLE` vs 안내 403 `ACCOUNT_NOT_AVAILABLE` | SENT 준비(`docs/handoff/archive/2026-10-30-backend-customer-google-login.md`) |
| BR-28 | 높음 | 고객 | 비회원 둘러보기: `/categories/tree`·`/product-contents/**`·`/prices/**` 가 공개 경로가 아니고 비회원 장바구니 식별 방법 없음 | **RESOLVED**(2026-10-30): 둘러보기 공개(백엔드 `clients-notice-public-browse-and-test-data`), 비회원 장바구니 = 게스트 토큰(ADR-0022, `clients-notice-cart-and-guest-token`). 고객앱 비회원 토큰 반영됨 |
| BR-29 | 높음 | 고객 | 주소 좌표(`AddressInput.geo`)의 출처: 앱에 주소 검색(좌표 제공)이 없어 회원 주소 판정이 늘 UNKNOWN | **RESOLVED**(2026-10-31): 우편번호 검색 + 서버 좌표 변환(BR-30) + 카카오 지도 핀. 판정은 서버가 도로명으로(핀은 배달 위치 참고) |
| BR-30 | 높음 | 고객 | 주소 → 좌표 변환 API(카카오 로컬, REST 키는 서버). 지도 핀 조정 전 시작 좌표 | **RESOLVED**(2026-10-31, 백엔드 회신 `clients-reply-address-geocoding`, ADR-0023). 고객앱 주소 검색·지도 핀 반영 |
| BR-31 | 중간 | 백오피스 | 상품 목록 `GET /products` 에 검색어(상품명·ID) 파라미터가 없음. 콘텐츠 등록의 상품 고르기가 불러온 쪽 안에서만 찾는다 | OPEN |
| BR-32 | 높음 | 고객 | 휴대폰 번호 저장(`POST /me/profile-changes`)이 501. 배송지 받는 분·연락처 자동 채움에 쓸 본인 연락처(가리지 않은 값)·기본 수령정보가 없음 | **RESOLVED**(계약, 회신 `clients/customer-app/2026-11-19-reply-location-in-url-and-open-items.md` §3·덧붙임, customer 0.7.0 — LAN 배포 전): `profile-changes {phone}` 저장(본인 확인 없음, `phoneVerified=false`), `GET /me` `phone`(가리지 않은 값). 고객앱 반영은 BR-60 과 함께 |
| BR-33 | 중간 | 고객 | 내 취소·반품·환불 목록 경로가 없음(클레임 단건 환불 조회만) | OPEN(같은 요청서 §3) |
| BR-34 | 높음 | 고객 | 주문서형 결제위젯: 결제 진입 전에 토스 clientKey(·customerKey)를 받을 경로가 없음(지금은 PAY 이후에만) | **RESOLVED**(2026-11-02, 백엔드 회신 `clients-reply-br34-payment-widget-config`·`clients-notice-toss-customer-key`): `GET /payment-widget-config` → {provider, clientKey, customerKey=accountId}. 고객앱 주문서형 결제위젯 반영 |
| BR-35 | 높음 | 고객 | 주문·초안 품목 `productName`(주문 당시 사본)이 비어 와서 주문 내역에 SKU 가 보임 | **RESOLVED**(회신 `../pmart-backend/docs/handoff/clients/archive/2026-11-02-clients-reply-br35-product-name-snapshot.md`, 초안·주문 `productName`·`optionLabel` 사본). 고객앱 반영 2026-11-02(주문 상세·취소 화면 품목 제목, 이름 없으면 sku) |
| BR-36 | 중간 | 고객 | 상품 상세 `SaleOption.price` 가 항상 null(계약은 "pricing 사본"). 상세에 가격이 안 보임 | OPEN(요청 `docs/handoff/archive/2026-11-02-backend-product-detail-price.md`). 앱은 `GET /prices?skus=` 로 채워 표시 중 |
| BR-37 | 중간 | 고객 | 주문이 참조하는 고객 데이터(주소·수령인·연락처)의 주문 시점 불변성 보장 방식과 "주문 당시 배송지" 고객용 조회 경로 | **RESOLVED**(2026-11-02, 백엔드 회신 `clients-reply-br37-order-shipping-snapshot`): 초안 생성 때 사본 고정 → `DraftDelivery.shippingAddress`·`Order.shippingAddress`. `contact.phoneRef` deprecated. 결제 진입 때 계정 재확인(422 `ACCOUNT_NOT_PURCHASABLE`). 고객앱 반영 |
| BR-38 | 중간 | 백오피스 | 상품 일괄 등록 배치의 `validCount`·`invalidCount` 가 업로드 때 값으로 고정돼 행을 고친 뒤(`PUT /product-drafts/{id}`) 맞지 않음. 유효 0 → 화면이 제출 버튼을 잠갔음 | **RESOLVED**(2026-11-03 회신 `clients-reply-br39-category-zip` §4): 서버가 조회 때 행 기준으로 셈(수정 18:54, LAN 배포 대기). 백오피스 행 기준 집계는 그대로 둠 |
| BR-39 | 중간 | 백오피스 | 이미 등록(APPLIED)된 seed 상품 ID 를 다시 올리면 새 초안이 생겨 바코드 없는 상품은 중복 등록될 수 있음. 업로드 검증에 "이미 상품 X 로 등록됨" 검사 요청 | **RESOLVED**(2026-11-03 회신 §1·2): 승인해도 중복 등록 아님(기존 상품의 새 버전, SKU 유지). 초안 `registration` NEW/UPDATE·`existingProductId`·`existingSkus` 추가 → 백오피스 구분 열·안내·승인 상세 반영(19:20) |
| BR-40 | 중간 | 백오피스 | bff `GET /views/approval-inbox`(통합 승인함) 가 501 — `ViewsController` 가 빈 구현이라 메뉴 "통합 승인함(bff)" 이 열리지 않음 | **RESOLVED**(2026-11-03 회신 `clients-reply-br40-br43` §1, 19:40 LAN 배포): bff 승인함 구현, `dossierId` = 승인 ID(`approvalId` 도 줌), 장애 시 빈 목록 + `unavailableSources`. 백오피스 링크 반영 |
| BR-41 | 중간 | 백오피스 | 제출(SUBMITTED)한 일괄 등록 배치의 승인 요청 본문·승인 ID 를 서버에서 다시 읽을 길이 없음(초안 `approvalId` 는 반영 때만 채움). 화면 이동·새로고침 뒤 "승인 요청"·"승인 상세 보기" 가 사라졌음 | **RESOLVED**(회신 §2, 19:40 배포): 배치 조회의 `pendingSubmission`(상품·콘텐츠)·`approvalRequest`(가격) + `GET /approvals?targetRef=`. 백오피스 반영(sessionStorage 우회 제거) |
| BR-42 | 중간 | 고객 | cart-service 표시용 조회(product·content·pricing·mfc-inventory)에 연결·읽기 timeout 이 없고 순차 호출 — 한 원천(PC3 꺼짐 등)이 안 닿으면 장바구니 조회·담기마다 그만큼 느려짐 | **RESOLVED**(회신 §3, 19:40 배포): 표시용 조회 4곳 동시 호출. timeout 은 공통 기본(연결 1초·응답 5초)이 이미 있었음(요청서 정정). 앱 변경 없음 |
| BR-43 | 높음 | 고객 | 장바구니 변경(담기·수량·선택·삭제) 응답에 갱신된 장바구니(`Cart`)가 없어 앱이 매번 `GET /carts/{id}` 를 한 번 더 부름(탭당 왕복 2회) | **RESOLVED**(회신 §4, 19:40 배포): `CartChangeResult.cart`(GET 과 같은 모양). 앱 반영 — 응답의 cart 로 끝냄(왕복 1회), 없으면 옛 경로 |
| BR-44 | 중간 | 백오피스 | 콘텐츠 일괄 등록: 이미 게시된 콘텐츠를 고쳐 다시 올린 행도 신규와 똑같이 `CREATED` — 초안·승인 행에 신규/기존 게시 갱신 구분(`registration`·기존 게시 버전)이 없음 | **RESOLVED**(2026-11-04 회신 `../pmart-backend/docs/handoff/clients/archive/2026-11-04-clients-reply-br44-br48.md`, LAN 배포 11-04): `ContentDraft.registration` NEW/UPDATE·`published*`, 승인 행 `attributes.registration`. 백오피스 반영 2026-11-06(일괄 등록 "구분" 열·승인 상세 콘텐츠 행) |
| BR-45 | 낮음 | 백오피스 | 승인 상세 `lines[].requestedAmount` 가 금액 없는 행에서 `null` — 계약 Money 는 nullable 아님(생략만 가능). 응답 생략 또는 계약 nullable 로 | **RESOLVED**(2026-11-04 회신 `../pmart-backend/docs/handoff/clients/archive/2026-11-04-clients-reply-br44-br48.md`): 값 없는 승인 행 금액·수량은 생략. 반영 상태(executionState)는 Receipt 미구현으로 VALIDATING 유지 → 승인 상세는 "해당 등록 화면에서 확인" 안내(2026-11-05) |
| BR-46 | 중간 | 백오피스 | 업무 도우미(정책 RAG): ai-assistant-service 계약이 3단계 초안 — 절·문서 버전·확정/제안/미결정 구분·문서 열람·GET 출처·질문 목록·응답 유실 복구·진행 상태·장애/권한 구분·게이트웨이 라우트 없음 | **대부분 해소**(계약 1.1.0, 회신 `../pmart-backend/docs/handoff/clients/archive/2026-11-04-clients-reply-br44-br48.md` §BR-46): 질문 목록 `GET /assistant/question-history` 추가, 원문 열람 API 없음(`citations[].excerpt` 전문), 상태 확인은 응답 코드(503·422)로. 남음: **LAN 배포 보류**(사용자 결정, ADR-0036). 백오피스는 계약 1.1.0 에 맞춘 목 화면(2026-11-06), 실서버는 배포 뒤 연결 |
| BR-47 | 높음 | 고객 | 상품 검색 `mfcId` 지정 시 LAN 센터의 전 상품이 미취급(carried=false)으로 빠짐 — `total` 은 뺀 상품 포함("1개"인데 빈 목록), 빈 페이지에 `nextCursor`, 미취급 숨김/구분 정책 확인 | **RESOLVED**(2026-11-04 회신 `../pmart-backend/docs/handoff/clients/archive/2026-11-04-clients-reply-br44-br48.md`): MFC-SEED-01 은 데이터 문제(275 SKU 취급 ON), `total` 의미 계약 명시, 빈 페이지는 서버가 채움(그래도 `nextCursor` 있으면 계속). 정책: 업무 문서는 구분 표시이나 사용자 결정은 미취급 숨김(2026-11-05, BR-49 와 같은 판단) — 고객앱은 기본값(false) 유지 |
| BR-48 | 중간 | 백오피스 | 카테고리 추가(`/category-tree-additions`·`-uploads`)에 이미 있는 카테고리만 올리면 계약의 422 `NOTHING_TO_ADD` 대신 500 `INTERNAL_ERROR` | **RESOLVED**(2026-11-04 회신 `../pmart-backend/docs/handoff/clients/archive/2026-11-04-clients-reply-br44-br48.md`): 원인은 큰 zip 업로드 메모리 부족(OOM), 스트림으로 수정. 이미 있는 카테고리만이면 422 `NOTHING_TO_ADD`. 클라이언트 변경 없음 |
| BR-49 | 중간 | 고객 | 홈·탭·섹션 진열(`storefront`)이 `mfcId` 를 줘도 미취급을 거르지 않음(`carried` 늘 null, 없는 센터도 10건) — 검색처럼 빼 달라, 빈 섹션 규칙, 숨김 정책 확인 | OPEN(요청 `docs/handoff/archive/2026-11-05-backend-storefront-not-carried.md`). 고객앱은 서버 항목 그대로 |
| BR-50 | 중간 | 고객 | 주문서 로그인 뒤 비회원→회원 장바구니 병합(`POST /carts/{id}/merges`) 앞 확인 — `CART_MERGE_CONFIRM` 이 실제로 오는 조건, 비회원 토큰 만료 시 처리, 센터(mfcId)가 다를 때, LAN 구현 상태 | **ANSWERED**(2026-11-19 회신 `../pmart-backend/docs/handoff/clients/customer-app/2026-11-19-reply-br50-cart-merge.md`, auth 0.2.1·cart 0.2.2 설명만): `CART_MERGE_CONFIRM` 은 안 옴 — 앱이 비회원 장바구니 품목으로 판단, 토큰 만료 403 `FORBIDDEN_OWNER`(갱신 뒤 같은 키), 센터 달라도 거절 없음, LAN 배포됨. **고객앱 반영**(2026-11-19, 목 모드 — 병합 확인 화면 `/cart/merge`, LAN 실서버 확인 전). 2026-11-07 요청서 없이 목록에만 적었음 — 백엔드가 목록을 보고 회신 |
| BR-51 | 높음 | MFC | 배차 자동 요청(AUTO_ON_READY) 제거 — 사용자 결정(2026-11-10): 배차는 무조건 점원 요청. 계약 0.4.5 D-5 는 READY 시 자동 요청 | OPEN(요청 `docs/handoff/archive/2026-11-10-backend-dispatch-manual-only.md`). PDA 는 직원 요청만, 서버가 AUTO_ON_READY 를 보내면 숨기지 않고 관리자 알림 문구 |
| BR-52 | 높음 | MFC | PDA 업무 선택(입고/품질검사/재고 이동/재고 실사/피패킹) 기반 배정 — 다음 작업 받기에 고른 업무 필터, 입고·품질검사·적치 배정 포함, 회수품 반입·회수품 검사·실사 작업 유형 추가, 작업자 본인 조회 허용, 메뉴 권한 기준, 작업 가능 신호, 품질검사 LOT 은 시스템 배정(R15), 품질검사 판정 기준·격리 사유·증빙 사진 업로드·반입 줄 온도대(R18), 이동·실사·피패킹 상품 바코드·패킹 온도대·장바구니·적치 추천·격리 이동·실사 목록 밖 상품·예외 보고(R19), 피킹한 사람에게 같은 주문 패킹 배정·출하대기 랙 위치(R20) | OPEN — **R1·R3·R4 완료**(mfc-capacity 0.13, 클라이언트 PR #2 2026-11-14: `workAreas`·다음 작업 받기 `workArea`·422 `WORK_AREA_NOT_ALLOWED`). 나머지 R2·R5~R7·R12~R20 OPEN — 다음 차례로 R2·R19-1 요청(`docs/handoff/mfc-app/2026-11-14-backend-br52-next-priority.md`). 원 요청 `docs/handoff/mfc-app/2026-11-10-backend-pda-work-areas.md` |
| BR-53 | 중간 | MFC | 입고 수령 화면에 필요한 값 — 입고 예정 행의 상품명·바코드(스캔 대조), RECEIVE 배정의 taskId ↔ trfId 연결, 송장(TRF) 바코드 원문 형식, 행당 차이 사유 1개의 우선순위(수량 차이 vs 격리 사유) | **R8~R11 완료**(mfc-inbound 0.8.0·mfc-inventory 0.15.0, 클라이언트 PR #3 2026-11-14: 실서버 `productName`·`barcodes`, 송장 라벨 `TRF:{trfId}:{version}` 은 trfId 만 비교, R9·R11 확정). 실서버 확인은 안 함. R17(박스 단위)·입고 예정 구현(서버 501)은 남음. 원 요청 `docs/handoff/mfc-app/2026-11-10-backend-pda-work-areas.md` |
| BR-54 | 중간 | 백오피스 | 직원용 라이더 찾기·상세(`GET /riders`, `GET /riders/{riderId}` — PC 5 BOD-3) | **DONE(2026-11-16)** — rider 0.4.0 `GET /riders`·`/riders/{id}`·`pii-reveals`(BOD-3, LAN 11-15). 화면이 실제 API 를 부른다(목 riderDirectoryMock 지움) |
| BR-55 | 중간 | 백오피스 | 전달 실패·도움요청 대기 목록(`GET /delivery-help-requests` 제안 — PC 5 BOD-4), "처리함" 닫기 API 여부 | **DONE(2026-11-16)** — 도움요청은 사건함(case 0.4.0 RIDER_HELP)으로, 전달 실패 확정 대기는 execution 0.4.0 `GET /deliveries?state=FAILURE_REPORTED&sort=OLDEST`. 대기 목록 화면·목(helpQueueMock) 지움 |
| BR-56 | 중간 | 백오피스 | 직원 주문 조회·문의에서 배송 번호(deliveryId)로 잇기 — 컴플레인 기록·배송 확인에 필요 | **DONE(2026-11-16)** — execution 0.4.0 `GET /deliveries?orderId=` — 주문 상세 "이 주문의 배송" |
| BR-57 | 낮음 | 인사팀 백오피스 | 요청 권한으로 고를 수 있는 역할 목록 API(employee-auth) — 역할이 늘 때마다 화면 고정 목록을 맞추지 않게 | **DONE(2026-11-16)** — `GET /employee-auth/roles`(employee-auth 0.5.0, 백엔드 알림 `hr-backoffice/2026-11-15-notice-role-list-and-departments.md` §1). 직원 등록의 요청 권한 역할이 이 응답(이름·순서·센터 필요 여부)을 쓴다 |
| BR-58 | 중간 | 백오피스 | 라이더 도움요청 상담 대화 — 상담원 쪽 대화 읽기·답장·새 메시지 표시·읽음, 상태(처리 중 시점·다시 처리 뒤 대화), 관리자 가림 | **AGREED**(2026-11-16 회신 — 대화는 delivery-execution, 백엔드 PR #60 병합 `5e2455fe` = execution 0.6.0 messages API, LAN 배포는 확인 안 함·DE-2(권한·새 메시지 필드·가림) PR #62 로 PC 5 에 요청). DE-2 반영·배포 뒤 화면을 붙인다. 전화는 보류. 요청 `docs/handoff/archive/2026-11-16-backend-rider-help-chat.md` |
| BR-59 | 중간 | 고객 | 처음 실행 약관(레퍼런스 2-1): 위치 기반 서비스 약관(필수) 동의 유형이 없고(`consentType` 은 TERMS_OF_SERVICE·PRIVACY_POLICY·AGE_OVER_14·MARKETING 뿐), 로그인 전(비회원·기기) 동의·마케팅 푸시 수신 동의를 기록할 경로가 없음 | RESOLVED(2026-11-19, 요청 `docs/handoff/customer-app/2026-11-19-backend-first-run-consents.md` → 회신 `clients/customer-app/2026-11-19-reply-br59-first-run-consents.md`, customer 0.6.0~0.6.1 LAN 배포). 고객앱 반영(목 모드 확인, 미커밋). 백엔드 질문(현재 위치 → 주소 서비스 이름)은 답 `docs/handoff/customer-app/2026-11-19-backend-br59-location-service-answer.md`(카카오 로컬·카카오맵, 휴대폰 위치는 geolocator — 2026-11-19 승인·반영) + 역지오코딩 좌표 쿼리 로그 질문 1개 |
| BR-60 | 중간 | 고객 | 레퍼런스 주소 상세에는 받는 분·연락처가 없고 연락처는 주문서 "내 연락처"에 있는데, 계약 `AddressInput` 은 `receiverName`·`receiverPhone` 필수 | **RESOLVED**(회신 `clients/customer-app/2026-11-19-reply-br60-address-receiver.md`, customer 0.8.0·order 0.14.0 LAN 배포 12:51): R1 두 값 선택, R2 주소 → 프로필, 없으면 `CONTACT_REQUIRED`, R3 프로필 저장 + 초안 다시(주소의 옛 번호는 PATCH `receiverPhone:""`), R4 이름 null. 고객앱 반영 2026-11-19(목 모드) |
| BR-61 | 높음 | 고객 | 고객 주문 조회 `GET /orders/{orderId}` 의 `shipments` 가 늘 빈 배열(`OrdersController` `.shipments(List.of())`) — 고객이 배송 ID 를 알 길이 없어 배송 현황·라이더 지도를 열 수 없음 | OPEN(급함, 요청 `docs/handoff/customer-app/2026-11-19-backend-order-shipments-empty.md` + 묶음 요청 `…/2026-11-19-backend-delivery-status-screen.md` R1) — 이것 때문에 라이더가 지도에 안 뜸 |
| BR-62 | 중간 | 고객 | 배송 현황 시트의 주문한 센터 이름 — 고객용 센터 이름 경로가 없어 브랜드만 보임(`Order.mfcId` 만) | **RESOLVED**(회신 `clients/customer-app/2026-11-19-reply-br61-br62-shipments-center-name.md`, order 0.15.0 `mfcName` — LAN 배포 전, 앱 반영 `61079e5`). 원 OPEN(요청 `docs/handoff/customer-app/2026-11-19-backend-delivery-status-screen.md` R2 — 주문 응답 `mfcName` 제안) |
| BR-63 | 중간 | 고객 | 홈 진열·상품 상세 응답의 `rating`·`reviewCount` 가 null — 같은 상품 rating-summary·리뷰 요약은 480개 | OPEN(요청 `docs/handoff/customer-app/2026-11-19-backend-rating-null-in-cards.md`). 상세는 앱이 rating-summary 로 보임, 카드는 서버 반영 대기 |
| BR-64 | 높음 | 고객 | 가입 즉시 휴대폰 본인 인증(옥토모)·한 번호 한 계정·같은 번호 기존 계정 안내(제공자·가입일·가린 이메일)·탈퇴 1달 재가입 금지 — 인증 상태·API·결과 코드 없음 | 일부 — customer 0.9.0 휴대폰 번호 확인(OCTOMO, 회원 스스로) 배포·고객앱 화면 반영. 가입 단계·한 번호 한 계정·기존 계정 안내·탈퇴 1달은 OPEN(요청 `docs/handoff/customer-app/2026-11-19-backend-phone-verification-signup.md` R1~R7, 원 요청 `…-social-login-identity.md`) |
| BR-65 | 높음 | 고객 | 카카오·네이버 로그인 — auth-service 가 Google 만 검증(501) | OPEN(같은 요청서 BR-65 — 카카오 OIDC ID 토큰, 네이버 Android SDK 액세스 토큰 + 서버 `/v1/nid/me` 확인(콘솔은 Android 만). 앱 SDK 2종 승인됨 2026-11-19, 카카오 콘솔 로그인·OIDC 활성화됨) |
| BR-66 | 높음 | 고객 | 네이버 로그인 콜백 중계 — 네이버 콘솔이 앱 주소(`com.pmart.customer://oauth/naver`)를 받지 않고 도메인 없음 → LAN 게이트웨이 공개 경로가 받은 쿼리를 앱 주소로 302(고정 목적지, 저장·기록 없음) | OPEN(요청 `docs/handoff/customer-app/2026-11-19-backend-naver-oauth-callback-relay.md` R1~R5) |

---

## BR-01 결제 진입·결과 전달 (고객앱)
- 현황: `POST /order-drafts/{draftId}/checkouts` 는 202 `CommandResponse` 만 반환. PG 진입 정보(`clientKey`, `pgOrderId`, `amount`, `orderName`, `checkoutUrl`, `expiresAt`)는 `payment-service` **내부** `POST /internal/payments` 의 `StartPaymentResponse` 에만 있다. `OrderDraft` 스키마에도 없다.
- 토스 결제 인증 후 `successUrl` 로 돌아오는 `paymentKey/orderId/amount` 를 서버에 전달할 고객용 경로가 없다(웹훅만 존재). `successUrl/failUrl` 을 누가 정하는지(앱 딥링크 vs 서버 URL)도 없음.
- 요청: (a) `GET /order-drafts/{draftId}` 의 `nextAction=PAY` 일 때 `checkout` 진입 정보를 포함하거나 별도 조회 경로, (b) 결제 인증 결과 전달 명령 + 짝 조회(또는 서버 `successUrl` 처리 방식 명시), (c) 모바일 딥링크 스킴 합의.
- 클라이언트 원칙(변경 없음): 결제창 복귀만으로 완료 표시 금지, 결과 불명 시 원시도 조회.
- 2026-10-31 고객앱 반영: 초안 `payment`(결제창 정보)·`checkoutFailure`, `POST /payment-confirmations`(응답을 놓치면 다시 보내지 않고 초안 조회), `POST /payment-authorization-failures`(취소·실패 보고). 결제창은 토스 결제위젯 SDK 가 아직 없어 실서버에서는 "연결 안 됨"으로 끝난다. 딥링크(c)는 SDK 를 붙일 때 정한다.

## BR-02 고객 외 주체 인증
- 현황: auth-service 외부 경로는 고객 소셜 로그인 3개 + 토큰 갱신·로그아웃·세션 조회뿐. `Session.principalType` 에는 RIDER/OPERATOR 가 있다. `POST /riders/signups` 는 `phoneVerificationRef`(auth 본인확인 결과) 를 요구하지만 본인확인 API가 없다.
- 요청: 라이더 로그인(아이디·비밀번호 또는 전화 OTP), 전화 본인확인, MFC 점원 로그인(직원 ID 바코드 기반 여부), 운영자 로그인(BO-Q01: IAM·추가 인증), 간선기사 로그인(2단계).
- 2026-10-30: 운영자 로그인 반영(auth `POST /auth/operator-logins`, `/auth/tokens` 회전, `/operator-accounts`, ADR-0018). 백오피스 구현 완료. 추가 인증(BO-Q01)은 없음.

## BR-03 토큰 보관 방식
- auth-service.yaml `info.description`: "쿠키/CSRF 방식은 [팀 확인 필요]". 게이트웨이 `default-filters: RemoveRequestHeader=Cookie`.
- 클라이언트 임시안: 모바일은 Bearer + refresh(보안 저장소). 웹은 access token 메모리 보관. 웹 refresh 를 HttpOnly 쿠키로 할지 결정 필요.
- 2026-11-02 백오피스 임시: 새로고침마다 로그인되는 문제로, refresh token + 기기 ID 만 탭 범위 `sessionStorage` 에 두고 시작 때 refresh 회전 1회로 세션을 되살린다(`web/backoffice/src/api/sessionPersistence.ts`). access token 은 저장하지 않고 localStorage 는 쓰지 않는다. 쿠키 방식이 정해지면 이 파일을 지운다.
- 회신(2026-10-24, `../pmart-backend/docs/handoff/clients/all/2026-10-24-clients-reply-high.md`): 쿠키/CSRF 는 팀 결정 대기. 계약은 토큰을 응답 본문으로 주므로 임시안(모바일 보안 저장소, 웹 access 메모리)대로 진행. 남은 결정은 웹 refresh 를 HttpOnly 쿠키로 할지.
- 결정(2026-11-13, ADR-0059 `../pmart-backend/docs/adr/0059-web-staff-refresh-cookie-signed-double-submit.md`, 요청 `docs/handoff/archive/2026-11-13-web-common-request-refresh-cookie.md`): 웹 백오피스·인사팀 백오피스의 직원 refresh token 은 세션별 HttpOnly 쿠키, CSRF 는 Signed Double-Submit(`__Secure-pmart_ea_csrf_{sessionId}` → `X-CSRF-Token`). PDA 는 본문 refresh 그대로. 반영: `web/core/src/employeeAuth.ts`.
- 정리(2026-11-19): 모바일·웹 모두 정해져 RESOLVED. `sessionPersistence.ts` 는 지금 `@pmart/web-core` 세션 복원 보관(키 `pmart.backoffice.session`)으로 남아 있다 — 위 "지운다"는 옛 계획이다(백오피스 담당 PC 2 영역).

## BR-04 CORS
- 게이트웨이에 CORS 설정 없음. 개발은 Vite 프록시로 우회 가능. 운영에서 관리자 웹을 게이트웨이와 같은 출처로 배포할지, 허용 출처를 둘지 결정 필요.
- 2026-10-30 DONE: 허용 출처 방식(자격 증명 미허용, 쿠키 없음). 백오피스 `npm run build:lan` 은 `http://D603-16:8080/api/v1` 로 직접 호출한다.

## BR-05 MFC 작업 목록
- 현황: `mfc-fulfillment` 외부 경로는 `POST /tasks/{taskId}/executions`, shipments/packages 뿐. 작업 생성은 `/internal/work-orders`. 점원이 "내 작업"을 받을 경로는 `mfc-capacity GET /assignments`(배정)뿐이고, 피킹 지시 행(로케이션·SKU·LOT·지시수량·기피킹량)을 담은 작업 상세가 없다.
- 요청: `GET /tasks?assignee=me&type=&status=`, `GET /tasks/{taskId}`(지시 행·잔량·버전), 작업 시작(claim) 명령(WK-03 "한 요청만 성공").
- 회신(2026-10-24, `../pmart-backend/docs/handoff/2026-10-24-clients-reply-high.md`): 수용. `d3ce55c` + 검토 수정 `e817184`.
  - `GET /tasks?mfcId=&assignee=me&type=&state=`: 파라미터는 `status` 가 아니라 `state`. 기본값은 ASSIGNED, IN_PROGRESS이고 BLOCKED는 빠짐.
  - `GET /tasks/{taskId}`: `lines[].pendingQty`, `pendingExecutions`, `activeStart`.
  - `POST /tasks/{taskId}/starts` 와 짝 조회 `GET …/starts/{requestId}`.
  - 서비스 빌드는 미검증이고 서버 구현 전까지 501이므로 목으로만 쓴다. `assignee=me` 는 BR-02, 실제 배정은 mfc-capacity 수동 배정 계약에 의존한다.
- 추가 질문: 시작 503의 의미, 짝 조회 여부, 같은 키 재전송 → `docs/handoff/archive/2026-10-24-backend-br05-start-503.md`
- 추가 회신(`../pmart-backend/docs/handoff/clients/archive/2026-10-24-clients-reply-br05-start-503.md`, 계약 `c609a4d`):
  - 503은 항상 `DEPENDENCY_UNAVAILABLE` 이고, 시작 안 됨이 확정이다. 판정이 기록되지 않으므로 같은 키로 보내면 다시 판정한다.
  - 짝 조회 404는 확정이 아니다.
  - 응답이 없으면 같은 키로 재전송하는 것이 기본 확정 방법이다.
  - 처리표는 `docs/apps/mfc-app.md` §3-1. 상태는 AGREED 유지(빌드 미검증).

## BR-06 라이더 배차 제안
- 현황: `GET /offers/{offerId}`, `POST /offers/{offerId}/responses` 만 있음. 제안이 라이더에게 도착하는 채널(푸시·SSE·폴링)과 일반배차모드의 대기 목록 조회가 없다.
- 요청: `GET /riders/me/offers`(활성 제안, 남은 시간) 또는 SSE 스트림, 일반배차모드 대기 목록.
- 회신(`../pmart-backend/docs/handoff/2026-10-24-clients-reply-high.md`, `d3ce55c` + `e817184`): 부분 수용.
  - 수용: `GET /offers?state=` 는 본인 제안만 준다. state를 생략하면 SENT이면서 만료 전인 것만 나온다. 응답에 `serverTime` 이 있고, 각 제안에 `remainingSec` 이 있다. 경로는 게이트웨이 라우팅 때문에 `/riders/me/offers` 가 아니라 `/offers` 로 정해졌다.
  - 보류: 푸시·SSE 전달 채널(notification 결정 대기)과 일반배차모드 대기 목록(업무 문서 공백). 푸시 토큰은 BR-09에서 따로 회신한다.
  - 클라이언트 반영: `docs/apps/rider-app.md` "제안 수신과 남은 시간".
- 추가 질문: 폴링 간격 → `docs/handoff/archive/2026-10-24-backend-br06-offer-polling.md`
  - 회신(`../pmart-backend/docs/handoff/2026-10-24-clients-reply-br06-offer-polling.md`, `f4dd171`, lint만 통과, 빌드 미검증): 수용. 응답에 `pollAfterSec` 이 추가됐다(잠정 5초). 받을 수 없는 상태면 null이다. 처리율 제한은 JWT subject 단위 단일 버킷이다. 백그라운드에서 놓쳐도 되는지는 업무 결정 대기다(푸시·BR-09와 함께). 클라이언트 반영: `rider-app.md`.

## BR-07 파일 업로드
- 현황: `delivery-execution` 전달 완료가 `photoRefs`(설명: "file-service 업로드 완료 참조")를 요구하지만 file-service 는 서비스 목록·계약에 없다. 리뷰 사진·CS 첨부·회수/파손 증빙·간선 인계 증빙도 같은 문제.
- 요청: 업로드 경로(사전 서명 URL 등), 용량·형식·개수 제한, 업로드 성공과 명령 성공을 분리하는 참조 ID 규칙.

## BR-08 X-Source-System 값
- `_common.yaml` 예시는 `customer-app`. 클라이언트 제안값: `customer-app`, `rider-app`, `mfc-app`, `backoffice-web`, `driver-app`. 게이트웨이 `/gateway/routes` 의 앱 구분(`CUSTOMER, RIDER, STORE, DRIVER, ADMIN`)과의 대응 확인.

## BR-09 푸시 토큰
- notification-service 채널에 `APP_PUSH` 가 있으나 기기 푸시 토큰 등록·해제 경로가 없다.
- **끝남**: notification-service 0.4.0 `PUT·DELETE /me/push-tokens/{deviceId}`, `GET /me/push-tokens`(CUSTOMER·RIDER). 고객앱은 회원이 되면 등록·로그아웃 전 해제(2026-11-17~18). 목록 상태가 OPEN 으로 남아 있던 것을 2026-11-19 고침.

## BR-10 관리자 웹 조회·내보내기
- bff `views` 8개 외 화면(승인 상세·결정 이력, 사건 상세, 센터·캘린더, 감사, 대량 변경, 정책 참조, 권한·대행 목록 등)은 원서비스 경로를 직접 호출해야 하는지 확인. 게이트웨이 라우트 존재 여부 포함.
- 내보내기/다운로드 생성 API 없음(BO-25: 다운로드 시 현재 권한 재검사).
- 운영자 권한·대행 조회는 auth 내부 API만 존재.

## BR-11 MFC 관리자·입고 현황
- bff `/views/packing-handover`(mfcId) 는 관리자 웹용. PDA/점원 화면에서 같은 정보를 쓸 수 있는지, `mfc-inbound GET /inbound-promises` 의 ETA 포함 여부 확인.

## BR-12 고객 노출 상태
- Commerce 문서는 FUL_*/CXL_*/RET_* 코드와 문구를 쓰지만 계약은 `OrderStatus`, `Shipment.state`, 클레임 상태를 쓴다. 고객 문구 매핑표(Commerce C 621, 1845 "인터페이스 승인 때 확정")를 합의 필요.

## BR-13 배송 방식별 가능 여부·예상시간·배달팁 (고객앱 배송 방식 선택·홈 요약)
- 근거: Commerce :1552 "표시: 한집/알뜰/예약 가능성·예상시간·배달팁·오늘/내일 1시간 슬롯·정원/마감·미설정 사유", :1524·:1530 "권역 밖·휴무·정원 소진·설정 확인 중·조회 실패를 구분해 안내", :1520 00~08시 실제 배송 없음.
- 현황(`f4dd171`): `GET /delivery-conditions` 는 제공 방식 목록(`deliveryModes`)과 `timeRestriction` 만 준다. 지금 한집·알뜰이 가능한지, 불가 사유(심야·휴무·정원·미설정), 예상 소요시간 범위, 방식별 배달팁(적용 전·후)이 없다. `GET /slots` 는 예약 슬롯만 다룬다.
- 요청: 주소(또는 mfcId)와 장바구니 기준으로 방식별 `{mode, availability, unavailableReason, etaMinRange, deliveryTip, deliveryTipReason}` 를 주는 조회. 심야에는 "예약만 가능"과 가장 빠른 도착 슬롯을 서버가 판정한다.
- 클라이언트는 기기 시계로 심야 여부를 판단하지 않는다. 회신 전에는 목으로만 쓴다.

## BR-14 견적의 최소주문 부족액·첫 구매 상태
- 근거: Commerce :1706 "미달은 부족액·불가품목/슬롯 사유 표시", :2821 "최소 주문 15,000원은 오퍼·프로모션 후, 쿠폰 전 상품액", :1490-1512 첫 구매 무료 4가지 상태(적용 예상/다른 주문에서 확인 중/적용 확정/적용 불가).
- 현황: `Quote` 에 `minOrderSatisfied`(boolean)와 `deliveryTipReason`(`FIRST_PURCHASE` 등)만 있다. 부족액과 첫 구매 상태가 없다. 장바구니(`Cart.selectedItemAmount`)는 "견적 아님"이라 장바구니 단계에서는 최소주문·배달팁을 보여줄 서버 값이 없다.
- 요청:
  1. `Quote` 에 최소주문 기준액과 부족액(`minOrderShortfall`)을 넣는다.
  2. 첫 구매 상태 enum을 넣는다.
  3. 장바구니 화면에서 최소주문 미달 여부와 배달팁 예상을 서버 값으로 받을 경로가 있는지(아니면 주문서 진입 후에만 표시하는지) 정해 준다.
- 클라이언트 처리(2026-10-30): 배송 선택 "다음"에서 주문서 초안을 먼저 만들고, 서버가 `MIN_ORDER_AMOUNT`(422) 또는 `minOrderSatisfied=false` 면 주문서로 넘어가지 않고 장바구니로 안내한다. 장바구니 단계 판정은 3번 회신 대기(앱이 15,000원과 비교하지 않는다).
- 참고: 30,000원 판정 상품액은 문서 안에서 :1621("기본단가×수량")과 :2857·:2760("오퍼·프로모션 후, 쿠폰 전")이 다르게 적혀 있다. 계약 `itemAmount` 설명은 후자다. 확인을 부탁한다.

## BR-15 반품·교환 자격과 증빙 요건
- 근거: Commerce :1990 / OMS :336 [확정 정책] 일반 7일, 신선 24시간, 하자·오배송·광고 상이 교환은 3개월 또는 인지 후 30일. Commerce :1986 사유·사진 접수.
- 현황: `ClaimReason` enum(10종)과 `POST /claims` 는 있다. 접수 전에 품목별 가능 여부·불가 사유·기한을 조회할 경로가 없다. 리뷰에는 `GET /me/review-eligibilities` 가 있다. 사유별 사진·상세 필수 여부와 개수·용량 상한도 없다(첨부 업로드 자체는 BR-07).
- 요청: 주문(또는 주문 품목)별 `{orderLineId, claimTypes[RETURN|EXCHANGE], eligible, ineligibleReason, deadline}` 조회, 사유별 증빙 요건(사진 필수·최소/최대 개수·상세 필수·글자 수).
- 클라이언트는 수령 시각으로 기한을 계산하지 않는다.

## BR-16 고객 배송 문의 접수
- 근거: Commerce :1986 "배송 중/완료 주문에서 지연·오배송·파손·품질·누락·미수령·기타 문의를 접수… 오배송은 원주소와 전달 사진 확인, 라이더 연락·채팅/상담 경로", :2238 [팀 확인 필요] 상담 채널·운영 시간·첨부·전달 사진 공개 여부, :2174 고객센터 화면 구성(AI 상담은 필수 범위 아님).
- 현황: `case-service` 의 `/cs-intakes` 는 운영자 접수, `/help-requests` 는 라이더 도움요청이다. 고객이 직접 문의를 접수하고 결과를 조회할 경로가 없다. 고객이 전달 사진을 조회할 경로도 없다.
- 요청: 고객 문의 접수와 조회(주문·배송 건·품목·사유·사진 참조, 멱등), 전달 사진 공개 여부와 조회 경로, 상담 채널 결정(채팅/전화)과 운영 시간 제공 방식.

## BR-17 현금영수증
- 근거: Commerce :1771 "현금영수증은 신청 정보, 실제 발급 가능 여부, 발급 결과 조회를 구분한다. 개인/사업자 입력 화면이 있다는 이유만으로 모든 결제수단이 발급 가능하다고 안내하지 않는다."
- 현황: 계약에 현금영수증 관련 필드·경로가 없다.
- 요청: 1차 범위인지 확인. 1차라면 결제수단별 발급 가능 여부, 신청(개인 휴대폰/사업자 10자리), 발급 결과 조회.

## BR-18 주문서 이탈 시 초안 처리
- 근거: Commerce :109 "화면 이탈이나 제한시간 경과만으로 … 확보를 해제하지 않는다", :1563 "앱에서 타이머만으로 점유 해제하지 않는다". 견적은 초안 생성 후 10분에 만료된다(`Quote.quoteExpiresAt`).
- 현황: `order-drafts` 에는 POST, GET, `/checkouts` 만 있고 취소 경로는 없다.
- 질문: 고객이 주문서에서 뒤로 나갈 때 클라이언트는 아무 호출도 하지 않고 초안 만료를 기다리면 되는가? 아니면 명시적인 초안 취소(확보 해제) 경로를 둘 계획인가? 회신 전 클라이언트 처리안은 "호출 없이 이탈, 재진입 시 GET으로 재검증"이다.

## BR-19 100g/100mL당 가격
- 근거: Commerce 상품 카드 규칙(C 1068~) "이미지·이름·규격·기본가·100g/100mL당 가격·별점·리뷰 수…". `docs/apps/customer-app.md` §2 상품.
- 현황: `DisplayItem`·`SearchHit`·`SaleOption` 에 단위 가격 필드가 없다. `SaleOption.capacityLabel`(예 "500ml")은 표시용 문자열이고, `SkuDetail.weightG` 는 내부 경로(`/internal/skus`)라 고객앱이 쓸 수 없다.
- 요청: 표시용 단위 가격(예 `unitPrice: { basis: G100|ML100, amount }`)을 pricing 사본과 함께 내려줄지, 아니면 1차에서 표시하지 않을지 결정.
- 클라이언트 처리(회신 전): 표시하지 않는다. 라벨 문자열을 파싱해 계산하지 않는다(금액은 서버 값만 표시).

## BR-20 필수 동의 대기 중 동의 반영 경로
- 근거: auth `socialLogin` 설명 "응답 state가 AUTH_CONSENT면 customer-service 필수 동의 완료 후 POST /auth/social-logins/{authRequestId}/completions", `completeSocialLogin` 요청 `consentChangeRequestId`.
- 현황
  1. `AuthResult` 는 AUTH_MEMBER 일 때만 `tokens` 를 준다. 그런데 동의 반영 `POST /me/consent-changes` 는 `bearerAuth` 경로다. AUTH_CONSENT 상태의 클라이언트는 호출할 토큰이 없다.
  2. `requiredConsents: string[]` 의 항목 형식("필요한 동의 항목·버전")이 정해져 있지 않다. `ConsentType` 값만인지, 버전을 붙이는지(예 `TERMS_OF_SERVICE:2026-10`) 알 수 없다. `/me/consent-changes` 는 항목마다 `consentType`·`version` 이 필요하다.
- 질문: (1) AUTH_CONSENT 에서 동의를 반영하는 방법 — 임시 토큰을 줄지, 동의 항목을 `completions` 본문으로 받을지, 공개 동의 경로를 둘지. (2) `requiredConsents` 항목 형식.
- 클라이언트 처리(회신 전): 목에서는 `TYPE:version` 으로 가정해 끝까지 동작한다. 실서버 구현은 계약대로 `/me/consent-changes` → `completions` 순으로 호출하며(`// BR-20`), 401 이 나면 로그인 실패로 보인다.
- 회신(2026-11-17, `../pmart-backend/docs/handoff/clients/customer-app/2026-11-17-notice-consents.md`, auth 0.2.0 CU-1): (1) 동의는 auth `POST /auth/social-logins/{authRequestId}/completions` 본문으로 보낸다(customer `/me/consent-changes` 를 먼저 부르지 않음, `consentChangeRequestId` 없앰). (2) `requiredConsents`·`optionalConsents` 형식은 `TYPE:version`.
- 반영(2026-11-17, `9f949f5`): 고객앱 `auth_repository.dart` 가 completions 본문으로 보낸다. 위 "회신 전" 방식(`/me/consent-changes` 먼저)은 지웠다.

## BR-21 주문 초안 응답의 반영 내용
- 근거: Commerce 주문서(C 1599~) "품목, 방식·시간, 주소, 라이더 요청, 연락처, 품절 시 처리(+다음에도 적용), 금액, 견적 만료·재고 예약 만료"를 보인다. order-service `OrderDraft`.
- 현황
  - `OrderDraft` 는 `quote`·`resources`·`nextAction` 만 준다. 서버가 실제로 받아들인 품목·수량, `deliveryMode`·`arrivalWindow`, 배송지·`deliveryNote`·`outOfStockPreference` 는 돌려주지 않는다.
  - 그래서 주문서는 클라이언트가 보낸 요청 사본을 보여 줄 수밖에 없다. 서버가 품목을 일부 빼거나 슬롯을 바꿔도 화면이 알 수 없다.
  - "품절 시 처리 — 다음에도 적용"을 저장할 경로(고객 설정)가 없다.
- 요청: `OrderDraft` 에 `lines`(sku·수량·스냅샷 이름)와 `delivery`(mode·window·addressId 요약·note·outOfStockPreference)를 넣어 줄지 확인. "다음에도 적용" 저장 위치(customer-service 설정?) 확인.
- 클라이언트 처리(회신 전): 주문서 품목·배송 정보는 보낸 요청 사본을 보인다. 금액·자격·만료는 서버 값만 쓴다. "다음에도 적용"은 화면에 두지 않았다.
- 해소 1(2026-10-30, 1203209): `OrderDraft` 에 `lines`·`delivery`·`blockers` — 주문서는 서버가 받아들인 값을 보인다.
- 해소 2(2026-11-18, customer-service 0.4.0): 주문 기본 설정 `GET`·`PUT /me/order-preferences`(`outOfStockPreference`). 앱이 주문서 기본값으로만 쓰고, 주문마다 초안 값이 정본. 고객앱 반영 `61b8553`(배송 방식 화면 "다음에도 적용" — 들어올 때 GET, 다음 단계에서 PUT, 실패해도 주문은 진행).
  - 참고: 같은 날 백엔드 `2026-11-18-notice-reference-gap-update.md` 표는 "BR-21 그대로"라고 적혀 있지만, 0.4.0 계약 변경 기록(사용자 "A해줘")이 더 뒤의 사실이다.

## BR-22 포장재 종류·라벨 출력
- 근거: MFC-business-logic WK-07 패킹 13단계 "포장재 스캔(보냉팩·아이스팩·드라이아이스)", "보냉백 XS/S/M/L/XL, 상온 봉투 소/중/대", "영수증·라벨 출력·부착". `docs/apps/mfc-app.md` §5.
- 현황: `SealPackageRequest` 에는 `contents`·`bagCount`·`containsAlcohol`·`temperatureZone`·`weightG`·`volumeCm3`·`packedBy` 만 있다. 포장재 종류·크기, 보냉재 사용 기록이 없다. `Package` 에는 `qrCode` 만 있고 라벨에 찍을 정보(주소 요약·주의 문구 등)를 받는 경로가 없다.
- 질문: 포장재 종류·보냉재를 기록할 필드를 둘지(배달 용량·보냉 판정에 쓰는지), 라벨 출력 내용은 어디서 받는지.
- 클라이언트 처리(회신 전): 온도대만 고르고 봉투 수는 포장 1개당 1로 보낸다. 라벨은 QR 값만 화면에 보인다(프린터 `[결정 필요]`).

## BR-23 포장 QR 형식
- 근거: mfc-fulfillment `authorizePackageHandover` 경로 `POST /packages/{packageId}/handover-authorizations`, 본문 `scannedCode`("QR 원문 (packageId + packageVersion)"), `Package.qrCode`.
- 현황: 라이더는 포장 라벨의 QR 만 스캔하는데, 경로에 넣을 `packageId` 를 QR 에서 꺼내는 형식이 정해져 있지 않다. 배송의 `packageIds` 로 후보를 좁힐 수는 있지만, 어느 포장의 QR 인지는 QR 원문을 해석해야 안다.
- 요청: (a) QR 원문 형식을 계약에 명시하거나(예: `PMART-PKG:{packageId}:v{packageVersion}`), (b) 경로 없이 `scannedCode` 만으로 승인하는 `POST /handover-authorizations` 를 둔다.
- 클라이언트 처리(회신 전): 목 형식 `PMART-PKG:{id}:v{n}` 으로 해석한다(`packageIdFromQr`). 해석이 안 되면 "읽지 못했어요"로 안내하고 서버에 보내지 않는다.
- 회신(2026-11-14, `../pmart-backend/docs/handoff/clients/rider-app/2026-11-14-reply-br23-br24-qr-and-drop-info.md`, 사용자 결정 "MFC 형식에 맞춰"): 형식은 `PKG:<packageId>:<packageVersion>`, mfc-fulfillment 가 밀봉 때 발급하는 `Package.qrCode` 와 같다.
  - 마지막 `:` 로 나눈다(버전에 `v` 없음). `scannedCode` 에는 스캔 원문 그대로 넣는다.
  - 재포장된 옛 라벨은 409 `PACKAGE_INVALIDATED`.
  - 배송의 `packageIds` 에 없는 packageId 면 보내지 않고 "이 배송의 포장이 아닙니다"로 안내한다.
- 반영(2026-11-16 rider-app 일지): `packageIdFromQr` 가 `PKG:` 접두어로 해석하고, 목 라벨도 같은 형식으로 바꿨다. 위 "회신 전"의 `PMART-PKG` 형식은 쓰지 않는다.

## BR-24 라이더용 전달지 정보
- 근거: Delivery-business-logic 수행 흐름 "픽업 후: 주소·상세주소·연락(안심번호)", "고객 부재: 연락 2회 이상", `docs/apps/rider-app.md` §2 수행 흐름.
- 현황: `DeliveryExecution`·dispatch `Offer.summary` 에는 도착 지역 요약만 있다. 픽업 뒤 라이더가 볼 상세 주소·출입 안내·요청사항·연락 수단(안심번호)을 주는 경로가 없다. 주소는 customer-service 회원 정보라 라이더가 직접 읽을 수 없다.
- 요청: 픽업(PICKED_UP) 뒤에만 열리는 라이더용 전달지 조회(예: `GET /deliveries/{id}/drop-info`)와 노출 범위·안심번호 방식.
- 클라이언트 처리(회신 전): 목에서만 전달지를 보인다. 실서버 구현은 null 을 돌려주고 화면은 "전달지 정보를 불러오지 못했어요"로 보인다.
- 회신(2026-11-14, `../pmart-backend/docs/handoff/clients/rider-app/2026-11-14-reply-br23-br24-qr-and-drop-info.md`, delivery-execution 0.3.2): `GET /deliveries/{deliveryId}/drop-info`.
  - 배정된 라이더 본인만(다른 라이더 404, 직원 403). 픽업 뒤 ~ 전달 완료 전만(그 밖 409 `DROP_INFO_CLOSED`).
  - 도로명·상세·우편번호·받는 분·연락처·출입 방법·출입 메모·배송 요청사항·좌표. 연락처는 고객 번호 그대로(안심번호 없음, 사용자 결정 2026-11-14). 값은 주문 당시 사본.
  - 사본 없음 404 `DROP_INFO_NOT_FOUND`, 주문 서비스 장애 503.
- 반영(2026-11-16 rider-app 일지, `0bf6d58`): 픽업 뒤에만 부르고, 화면을 나가면 메모리에서 지운다. 수락 전 고객 전화는 잠금.
- 배포: 회신 때는 LAN 미배포였지만, 뒤의 delivery-execution 배포(2026-11-18, 0.25.1 좌표 출처까지)에 들어 있다. 라이더 토큰으로 실서버 확인한 기록은 아직 없다(백엔드는 통합 시험으로 갈음).

## BR-25 상품 이미지 표시 방식 (관리자 웹)
- 근거: 백엔드 handoff `2026-10-30-clients-notice-temp-backoffice-api.md` §0-3, product-content `GET /content-images/{imageId}`(bearerAuth).
- 현황: 이미지 본문도 JWT 가 필요해 `<img src>` 로는 못 받는다.
- 요청: 서명 URL·쿠키·공개 버킷 등 표시 방식 결정. 고객앱(카드 이미지)도 같은 문제다.
- 클라이언트 처리(회신 전): `fetch` + Bearer 로 받아 `URL.createObjectURL` 로 표시한다(`web/backoffice/src/features/contents/AuthedImage.tsx`).

## BR-26 상품·콘텐츠 초안 목록
- 근거: product `/product-drafts`, product-content `/content-drafts` 는 생성·단건 조회·수정·제출만 있다. 배치는 `/…-import-batches/{batchId}` 로 묶어 볼 수 있다.
- 현황: 개별 입력 초안은 만든 직후 화면을 벗어나면 ID 를 알아야만 다시 열 수 있다. 승인 상세의 행(`lineKey` = draftId)으로 거슬러 찾을 수는 있다.
- 요청: `GET /product-drafts?state=&validationState=&cursor=`·`GET /content-drafts?state=&cursor=` 같은 목록(작성자·상태 필터).
- 클라이언트 처리(회신 전): 초안 ID 입력으로 연다.

## BR-27 고객 로그인 이용 불가 계정 오류 코드
- 근거: 계약 auth-service `POST /auth/social-logins` 422 `REQUIRED_CONSENT_MISSING / ACCOUNT_NOT_PURCHASABLE`, 백엔드 안내 `2026-10-30-clients-notice-customer-google-login.md` §4 의 403 `ACCOUNT_NOT_AVAILABLE`.
- 질문: 실제 코드·상태, 두 코드의 차이, 계약 반영 여부.
- 클라이언트 처리(회신 전): 두 코드 모두 같은 문구("지금은 이 계정으로 이용할 수 없어요").

## BR-28 비회원 둘러보기·비회원 장바구니
- 근거: 게이트웨이 public-paths 에 storefront·search·guest-delivery-addresses 는 있으나 카테고리·상품 상세·가격은 없다(토큰 없이 401, LAN 확인 2026-10-30). `docs/apps/customer-app.md` "비회원: 둘러보기·장바구니까지".
- 요청: 고객 읽기 경로를 공개로 열지 결정, 비회원 장바구니 식별 방식(게스트 토큰 / X-Device-Id / 없음).
- 클라이언트 처리(회신 전): 실서버 모드에서 비회원 상세 조회는 오류 화면으로 보인다.

## BR-29 주소 좌표의 출처
- 배경: 백엔드는 배송 가능 판정을 좌표로만 한다(`clients-notice-customer-addresses` §1). `POST /me/addresses` 에 `geo{lat,lng}` 가 없으면 `serviceability.state=UNKNOWN` 이고, 쇼핑 주소로 골라도 담당 MFC 가 정해지지 않는다.
- 고객앱 상태: 주소를 손으로 입력한다. 주소 검색(도로명 → 좌표)이 없어 `geo` 를 보내지 않는다. 좌표를 앱에서 추측해 넣지 않는다.
- 결정 필요(사용자/백엔드): 주소 검색 수단. 예) 카카오 우편번호 + 좌표 변환(카카오 로컬 API 키 필요), 행안부 도로명주소 API + 좌표 API, 또는 서버가 도로명으로 좌표 변환. 앱 키(비밀이 아닌 키라도) 발급·보관 방식도 함께.
- 그때까지: 회원 주소는 저장되지만 "확인 중"으로 표시된다(배송 가능으로 그리지 않음).
- 2026-10-31 임시: 개발 빌드(릴리스 아님)에만 주소 추가 화면에 "[개발] 시험 좌표 넣기(서면역)" 버튼을 둔다. 백엔드 LAN 시험 권역 좌표(35.1578, 129.0597)를 `geo` 로 보낸다. 정식 주소 검색이 정해지면 지운다.
- 2026-10-31 결정(사용자): 다음 우편번호 검색(무료·키 없음)으로 도로명을 고른다 → 서버가 카카오 로컬 API 로 좌표로 바꾼다(BR-30) → 앱이 카카오 지도(네이티브 앱 키)에서 핀을 맞춘다 → 최종 좌표를 `geo` 로 보낸다. 주소 계약은 그대로다.

## BR-30 주소 → 좌표 변환 API (고객앱)
- 요청: `docs/handoff/archive/2026-10-31-backend-address-geocoding.md`. 도로명주소 → 좌표 후보(필수), 좌표 → 주소(선택).
- 이유: 카카오 로컬 API 는 REST API 키(비밀)가 필요하므로 앱이 직접 부르지 않는다. 키는 사용자가 백엔드 `deploy/lan/.secrets/backend.env` 에 넣어 두었다.
- 클라이언트 원칙: 결과 0건과 조회 실패(카카오 장애·사용량 소진)를 구분해 표시한다. 주소 원문을 로그에 남기지 않는다.

## BR-31 상품 목록 검색어 (백오피스)
- 현황: `GET /products` 는 categoryId·saleState·size(최대 200)·cursor 만 받는다. 관리용 명칭이나 ID 로 찾는 파라미터가 없다.
- 백오피스 임시: 콘텐츠 등록의 "승인된 상품" 드롭다운이 200개씩 불러와 그 안에서 거른다. 다 불러오지 않았으면 "없음"이라 하지 않고 "더 불러오기"를 보인다.
- 요청: `GET /products?q=` (관리용 명칭 부분 일치, productId·baseProductId 일치). 상품 수가 늘면 필요하다.

## BR-36 상품 상세 옵션 가격이 비어 옴 (고객앱)
- 현황(LAN 2026-11-02): `GET /product-contents/{id}?mfcId=MFC-SEED-01` 의 `options[].price` 가 `null`. 같은 상품이 홈 카드(storefront)에는 `basePrice` 가 있고 `GET /prices/{sku}` 도 200 이다. product-content-service `ContentQueries` 주석 "가격은 pricing 의 것이라 넣지 않는다" — 의도적으로 안 채운다. 그러나 계약 `product-content-service.yaml` 의 `SaleOption.price` 설명은 "pricing 사본"이라 계약 설명과 구현이 다르다.
- 영향: 고객앱 상세가 "가격 확인 중"으로만 보였다.
- 앱 처리(2026-11-02): 상세 응답의 옵션 가격이 비면 `GET /prices?skus=` 로 표시 가격을 따로 읽어 합친다(`ApiCatalogRepository._pricesFor`). `notSet` 은 "판매 불가"·담기 비활성. 가격 조회 실패는 "가격 확인 중" 유지(0원·판매 불가로 확정하지 않음). 상세에 가격이 오면 가격 API 를 부르지 않으므로 백엔드가 채우기 시작해도 앱 변경은 없다.
- 요청: (a) 상세에 pricing 사본을 채우든지, (b) 계약 설명을 "채우지 않는다. 표시 가격은 `/prices` 로 읽는다"로 고치든지 정해 달라. 요청서 `docs/handoff/archive/2026-11-02-backend-product-detail-price.md`.

## BR-37 주문이 참조하는 고객 데이터의 불변성 (고객앱)
- 배경: 주문(`customer_order`)은 `account_id`·`shopping_address_id` 만 저장하고 주소 원문·수령인·연락처는 없다(ADR-0009 참조 ID 원칙). customer-service 주소는 제자리 수정·물리 삭제로 보이며 이력이 없다. 그런데 계약 `PATCH /me/addresses/{id}` 는 "확정 주문의 주소는 변경되지 않음"이라고 적혀 있다.
- 질문: 그 보장이 어디서 이루어지는지, 확정 주문이 참조한 주소의 삭제를 막는지, 수령인·연락처를 주문 시점으로 고정하는지, 구매 가능 검증을 결제 진입에서 다시 하는지. 질문서 `docs/handoff/archive/2026-11-02-backend-order-customer-reference.md`.
- 고객앱 처리(회신 전): 주문 상세에 배송지를 보이지 않는다. 주소 ID 로 현재 주소를 조회해 "주문 당시 배송지"처럼 보이지 않는다.
- 회신(2026-11-02, `../pmart-backend/docs/handoff/clients/archive/2026-11-02-clients-reply-br37-order-shipping-snapshot.md`): (1) 지금까지 미보장이었음 → 초안 생성 때 주소록을 복사해 고정, 확정 때 주문으로 옮김. 고객용은 `GET /orders/{id}`·초안 `delivery.shippingAddress`(가리지 않음, 배포 전 것은 null). (2) 주소 삭제는 지금 규칙 유지(주문은 사본). (3) 수령인·연락처 = 배송지 값으로 고정, `contact.phoneRef` 는 쓰지 않음(deprecated). (4) 결제 진입 때 계정 재확인 → 422 `ACCOUNT_NOT_PURCHASABLE`.
- 고객앱 반영(2026-11-02): 주문서·주문 상세 "받는 곳" = `shippingAddress`(null 이면 "배송지 정보 없음"), 결제 진입 거절 문구, 백엔드 `312a51b` 계약 재생성.

## BR-38 상품 일괄 등록 배치의 유효·오류 수가 행 수정 뒤 갱신되지 않음 (백오피스)
- 현황(LAN 2026-11-03): `POST /product-import-batches` 는 업로드 때 행을 검증해 `validCount`·`invalidCount` 를 저장한다(`ProductDraftService.uploadBatch` → `DraftStore.updateBatchCounts`). 그 뒤 운영자가 INVALID 행의 빠진 값을 채워 `PUT /product-drafts/{draftId}` 로 저장하면 그 행은 다시 검증돼 `VALID` 가 되지만(`ProductDraftService.update`) 배치의 수는 다시 세지 않는다. `GET /product-import-batches/{batchId}` 는 고친 행은 `VALID` 로, 배치 요약은 여전히 "유효 0" 으로 돌려준다.
- 영향: 백오피스가 `validCount === 0` 이면 "유효 행 제출 준비"를 잠가 두어, 올릴 때 전부 INVALID 였던 배치는 행을 고쳐도 제출할 수 없었다. 제출(`POST …/submissions`) 자체는 행을 직접 보고 `DRAFT`+`VALID` 만 잠그므로 버튼만 풀리면 된다.
- 백오피스 처리(2026-11-03): 요약 줄의 유효·오류 수와 제출 버튼 활성을 응답의 `drafts[]` 에서 직접 센다(`batchCounts`). 행 목록이 없으면 서버 수를 쓴다.
- 요청: 초안 수정·제출 뒤 배치의 `validCount`·`invalidCount`(필요하면 `productCount`)를 다시 세어 주거나, 계약에 "업로드 때 값, 이후 갱신 안 함"이라고 적어 달라. 콘텐츠 일괄 등록 배치도 같은 구조면 함께.

## BR-39 이미 등록된 seed 상품 ID 재업로드 검사 (백오피스)
- 현황(백엔드 읽기 2026-11-03): `POST /product-import-batches` 는 (sourceSystem, seedProductId) 로 초안을 upsert 하는데, `DraftStore.findOpen` 이 `state IN ('DRAFT','SUBMITTED')` 만 찾는다. 승인 반영이 끝난(`APPLIED`) 초안은 "열린 초안"이 아니라서 같은 seed 상품 ID 를 다시 올리면 **새 초안이 생긴다**. 업로드 검증(`DraftRules`)은 바코드만 본다 — 빈 바코드, 초안 안 중복(`BARCODE_DUPLICATED_IN_DRAFT`), 다른 활성 SKU 가 쓰는 바코드(`BARCODE_CONFLICT`).
- 영향: 바코드가 있는 상품은 `BARCODE_CONFLICT` 로 걸리지만, 바코드가 없는 상품은 새 초안이 VALID 로 통과해 제출·승인하면 같은 상품이 한 번 더 등록된다(상품 ID·SKU 가 하나 더 발급). id-map 의 seedProductId → 상품 짝도 둘이 된다.
- 요청: 업로드 검증에 "이 seed 상품 ID 는 이미 상품 {productId} 로 등록됨" 검사를 넣어 달라. 처리 방식은 백엔드가 정하면 된다 — 예: INVALID 문제 코드(가칭 `SOURCE_KEY_ALREADY_APPLIED`, detail 에 productId)로 표시하거나, 기존 상품의 수정 초안으로 upsert. 문제 코드로 가면 코드 값만 알려 주면 백오피스가 문구를 붙인다. 같은 구조면 콘텐츠 일괄 등록도 함께.
- 백오피스: 변경 없음(서버 검증 결과를 표시만 한다).

## BR-40 통합 승인함(bff) 미구현 (백오피스)
- 현황(코드 읽기 2026-11-03): `services/backoffice-bff` 의 `ViewsController` 가 `implements ViewsApi {}` 로 비어 있어 계약 `GET /views/approval-inbox`(및 다른 views) 가 인터페이스 default 로 501 을 돌려준다. 백오피스 메뉴 "통합 승인함(bff)" 은 이 경로를 읽는다.
- 영향: 운영자가 그 메뉴를 열면 목록이 안 나온다. 승인·반려는 승인 상세(`/approvals/{approvalId}`, approval-service 직접)에서 되므로 메뉴 "승인함"(`/approvals`) 으로는 가능하다.
- 요청: (a) `GET /views/approval-inbox` 를 구현해 달라(항목에 `dossierId` = approval-service 승인 ID 인지 확인 요망 — 백오피스는 그 값으로 상세 링크를 만든다), 또는 (b) 구현 시점이 멀면 알려 달라 — 그때까지 백오피스가 메뉴를 숨긴다.

## BR-41 제출한 일괄 등록 배치의 승인 요청 본문·승인 ID 재조회 (백오피스)
- 현황: `POST /product-import-batches/{batchId}/submissions` 응답의 `approvalRequest` 는 그 응답에만 있다. 배치가 SUBMITTED 가 된 뒤 같은 경로를 다시 부르면 422(`NOTHING_TO_SUBMIT`)이고, 같은 Idempotency-Key 재전송만 같은 응답을 준다. 초안의 `approvalId` 는 승인 반영(APPLIED/REJECTED) 때만 채워져(`DraftStore`), 승인 요청을 올린 직후에는 배치·초안 어디에도 승인 ID 가 없다.
- 영향: 운영자가 제출 뒤 승인 상세에 다녀오거나 새로고침하면 "승인 요청" 버튼과 "승인 상세 보기" 링크가 사라졌다. 승인 요청을 아직 안 올린 상태에서 화면을 떠나면 본문을 되찾을 수 없어 배치가 제출된 채 승인 요청만 빠질 수 있다.
- 백오피스 처리(2026-11-03): `GET /approvals?type=PRODUCT` 에서 `targetRef = productImportBatch:{batchId}` 인 건을 찾아 링크를 보이고, 아직 안 올린 승인 요청 본문은 탭 sessionStorage 에 둔다(탭을 닫으면 사라짐, 50건 넘는 목록은 못 찾음).
- 요청(택1 또는 조합): (a) `GET /product-import-batches/{batchId}` 응답에 제출 결과(`submittedDraftIds`·`excludedDraftIds`·`approvalRequest`)와 올린 `approvalId` 를 넣어 달라. (b) approval-service 가 변경 요청 제출 때 정본 서비스에 알려 초안·배치의 `approvalId` 를 바로 채워 달라(지금은 반영 때만). (c) 최소한 `GET …/submissions`(또는 `/submission`) 로 마지막 제출 응답을 다시 읽게 해 달라. 콘텐츠·가격 일괄 등록 배치도 같은 구조면 함께.

## BR-42 cart-service 표시용 조회의 timeout·병렬화 (고객앱)
- 현황(LAN 2026-11-03, 사용자 확인: PC3 꺼짐): cart-service(pc2)는 `GET /carts/{id}` 마다 `CartView.view` 에서 product-service·product-content-service·pricing-service·mfc-inventory-service(pc3) 를 **순차** 호출하고, 담기(`POST …/items`)도 product-service 를 먼저 부른다. `CatalogClient` 의 `RestClient.Builder` 에 연결·읽기 timeout 이 없다(`spring.http.client.*` 미설정. payment·delivery-serviceability 는 설정돼 있음).
- 영향: mfc-inventory-service 가 꺼져 있으면 모든 줄이 `availability=UNKNOWN`(앱 "판매 상태를 확인하는 중이에요")이 되는 건 설계대로지만, 연결 실패를 기다리는 시간만큼 장바구니 조회와 담기(담기 → APPLIED → 다시 읽기)가 매번 느려진다. 원천 하나의 장애가 장바구니 전체 응답 시간을 끌어내린다.
- 요청: (a) cart-service 외부 호출에 짧은 연결·읽기 timeout(예: 연결 1초·읽기 2~3초)을 두어 실패를 빨리 UNKNOWN 으로 넘긴다. (b) 표시용 조회 네 개를 병렬로 부른다. (c) 가능하면 원천 장애가 잠시 이어질 때 반복 대기하지 않게(circuit breaker 등) — 방식은 백엔드가 정한다.
- 앱 처리: 변경 없음. UNKNOWN 은 계속 "확인 중"(0·품절 아님). 응답 `sources[]` 로 어느 원천이 UNAVAILABLE 인지 보이는 개선은 별도 검토.

## BR-43 장바구니 변경 응답에 갱신된 장바구니 포함 (고객앱)
- 현황: `POST /carts/{id}/items`·`PATCH/DELETE …/items/{itemId}` 의 `CartChangeResult` 는 `status`·`cartVersion`·`cartItemId` 만 준다. 앱은 표시용 사본(이름·단가·가용)과 서버 합계(`selectedItemAmount`)를 얻으려고 반영 확인 뒤 `GET /carts/{id}` 를 한 번 더 부른다 → 탭 한 번 = 왕복 2회. 그 GET 은 서버 안에서 표시용 조회 4곳을 순차로 부른다(BR-42).
- 영향: 담기·수량 변경이 느리다(사용자 체감 2026-11-03, PC3 켜도 여전함). 연속 탭은 앱이 모아 보내도록 했지만 왕복 2회 구조는 그대로다.
- 앱 처리(2026-11-03): 수량·선택·삭제는 응답 `cartVersion` 으로 장바구니를 바로 갱신하고(서버가 APPLIED 로 확정한 내용만), 합계는 "확인 중"으로 두었다가 뒤에서 `GET` 으로 채운다. 담기(새 행)는 사본이 필요해 그대로 다시 읽는다.
- 요청: (a) 변경 응답(`CartChangeResult`)에 갱신된 `Cart`(또는 최소한 `selectedItemAmount` 와 바뀐 `CartItem`)를 넣어 달라. 그러면 앱의 두 번째 왕복이 없어진다. (b) BR-42 의 표시용 조회 병렬화·timeout 과 함께.

## BR-44 콘텐츠 일괄 등록의 신규 / 기존 게시 콘텐츠 갱신 구분 (백오피스)
- 현황(백엔드 코드 읽기 2026-11-04, HEAD `4342c58`): seed 업로드는 열린 초안(DRAFT·SUBMITTED)만 upsert 한다. 열린 초안이 없으면 최근 게시본과 해시만 비교해 다르면 새 초안을 만들고 `CREATED` 로 돌려준다 → 이미 게시된 콘텐츠의 수정본과 처음 올리는 콘텐츠가 구분되지 않는다. `ContentDraft`·승인 행 attributes 에 기존 게시 여부·버전이 없다.
- 영향: 고객 결과는 맞다(승인 → 같은 상품의 새 `contentVersion`). 운영자·승인자가 기존 고객 노출 콘텐츠를 덮어쓰는지 화면에서 볼 수 없다.
- 요청: BR-39 처럼 초안(배치 `items[].draft` 포함)과 승인 행 attributes 에 `registration`(NEW/UPDATE)과 기존 게시 버전(`publishedContentVersion` 등). 이름·모양은 백엔드가 정함.
- 백오피스: 회신 전 변경 없음. 회신 뒤 구분 열·안내·승인 상세 표시.

## BR-46 업무 도우미(ai-assistant-service) 계약 확정 (백오피스)
- 현황: `ai-assistant-service.yaml` 은 x-stage 3 "자리 표시용 초안". 게이트웨이 라우트 없음. 출처는 `docRef`·`policyVersion`·`asOf` 뿐, GET 에는 출처 없음, 질의는 동기 200 만.
- 영향: 절·문서 버전·확정/제안/미결정 구분·문서 열람·질문 목록·응답 유실 뒤 복구(키 기반 짝 조회)·진행 상태·장애 구분을 계약으로 보일 수 없다.
- 요청: 요청서 §1 표 14항목(필드·경로·required·라우트·본문 형식).
- 백오피스: `/assistant` 화면 + `AssistantPort`. 목 모드는 `draftMock`, local·LAN 은 `httpAssistant` 로 실서버를 부른다(2026-11-15 — 계약 1.1.0, 서비스 2026-11-09 LAN 배포). 실서버 확인은 안 함.

## BR-47 상품 검색 — 센터 지정 시 전 상품 미취급·total 불일치·빈 페이지 (고객앱)
- 현황(LAN 2026-11-04): `GET /search/products?mfcId=MFC-BSN-01`(또는 MFC-SEED-01) → 검색어 없이 total 162·items 0·nextCursor 있음. `q=탄산수` → total 1·items 0. `includeNotCarried=true` 면 `carried: false` 로 나옴.
- 영향: 고객앱 검색이 "1개"와 "검색 결과가 없어요"를 함께 보인다. 빈 페이지 뒤에 더 있는지 알 수 없다.
- 요청: ① 센터 취급 데이터 확인 ② total 을 뺀 뒤 기준으로(또는 의미 명시) ③ 빈 페이지+커서 없애거나 계속 조회 규칙 명시 ④ 미취급 숨김/구분 정책 확정(Commerce §3627).
- 고객앱: 회신 전 변경 없음.

## BR-48 카테고리 추가 — 이미 있는 카테고리만 올리면 500 (백오피스)
- 현황(LAN 2026-11-04): 계약·코드는 422 `NOTHING_TO_ADD` 인데 응답이 500 `INTERNAL_ERROR`.
- 요청: 원인 확인(문의 번호는 사용자가 전달), 계약대로 422.
- 백오피스: 이 화면에서 `INTERNAL_ERROR` 면 서버 오류 안내 + 문의 번호. 전역 `INTERNAL_ERROR` 문구 추가.

## BR-49 홈·섹션 진열 — 센터 지정 시 미취급 상품 빼기 (고객앱)
- 현황(LAN 2026-11-05): `storefront/home?mfcId=MFC-SEED-01` 10건·섹션 항목 50건 모두 `carried: null`, LAN 에 없는 `MFC-BSN-01` 도 10건. 같은 센터 검색은 미취급을 거름(`total: 0`).
- 사용자 결정: 연결된 MFC 가 취급하지 않는 상품은 안 보인다(검색·진열 모두).
- 요청: ① mfcId 지정 시 진열에서 미취급 제외(검색과 같은 판정) ② 빈 섹션·페이지 규칙 ③ `carried` 채우기 또는 계약 명시 ④ 업무 문서("구분 표시")와 다른 정책 반영 판단.
- 고객앱: 서버 항목 그대로 그림. null 을 판정하지 않음.

## BR-50 주문서 로그인 뒤 장바구니 병합 — 구현 전 확인 (고객앱)
- 현황(실기기 2026-11-07): 비회원으로 담고 장바구니 "주문하기" → 로그인하면 장바구니가 비어 보인다. 고객앱이 병합 API 를 아직 부르지 않는다(로그인 뒤 회원 장바구니를 새로 연다). 비회원 토큰은 지우지 않으므로 비회원 장바구니는 서버에 남아 있을 것으로 본다.
- 계약 기준 구현 계획: 주문서 목적 로그인(`purpose=CHECKOUT`) 응답 `nextAction=CART_MERGE_CONFIRM` → 고객이 고른 항목만 `POST /carts/{회원 cartId}/merges`(회원 토큰 + `X-Guest-Token` + Idempotency-Key, 같은 키 재전송) → 202·결과 불명은 `GET merges/{mergeId}` → 회원 장바구니 다시 읽기. 끝나기 전에는 주문서로 넘어가지 않는다.
- 질문:
  1. 실서버가 `purpose=CHECKOUT` 로그인에 `CART_MERGE_CONFIRM` 을 주는 조건은? 로그인 요청에는 비회원 토큰이 없는데, 비회원 장바구니가 있는지 서버가 어떻게 아나(조건 없이 늘 주나)?
  2. 로그인 시점에 비회원 access token 이 만료됐으면? 병합 전에 비회원 토큰을 갱신해도 되나(`X-Guest-Token` 은 "만료 전"이어야 함). 만료 토큰이면 어떤 code 로 거절하나?
  3. 비회원 장바구니와 회원 장바구니의 센터(`mfcId`)가 다르면? 항목별 재검증 실패(MERGE_PARTIAL)로 오나, 별도 거절인가?
  4. LAN 에서 병합 API 가 구현·배포돼 있나(501 아님)?
- 고객앱: 답을 받기 전에는 목으로만 만든다.
- 요청서 없이 이 목록에만 적어 두었다(백엔드에 전달 안 됨) — 백엔드가 2026-11-19 이 목록을 보고 회신했다.
- **회신(2026-11-19)** `../pmart-backend/docs/handoff/clients/customer-app/2026-11-19-reply-br50-cart-merge.md` — 계약 auth 0.2.1·cart 0.2.2(설명만, 값·모양 변경 없음):
  1. `CART_MERGE_CONFIRM` 은 서버가 보내지 않는다(로그인 요청에 비회원 정보가 없어 모른다, enum 은 하위 호환으로 남김). **앱이 정한다**: `purpose=CHECKOUT` 로그인이 끝나면(`nextAction=NONE`, `COMPLETE_CONSENT` 면 동의 뒤) 비회원 장바구니(`GET /carts/{비회원 cartId}`, 비회원 토큰)에 품목이 있으면 고객 확인(고른 항목만) → `POST /carts/{회원 cartId}/merges`, 없으면 바로 주문서. 일반 로그인은 병합 안 함.
  2. `X-Guest-Token` 만료·무효·주인 아님 → 403 `FORBIDDEN_OWNER`. 병합 전에 비회원 토큰 갱신 가능(`POST /auth/tokens`, 비회원 refresh token, 같은 `X-Device-Id`) — 갱신 뒤 **같은 Idempotency-Key** 로 다시.
  3. 센터가 달라도 거절 없음. 재검증은 원항목 그대로(`SOURCE_ITEM_CHANGED`)·판매 상태·구매 상한뿐. 합친 뒤 회원 장바구니를 다시 읽으면 그 센터 기준 `availability` 가 보이고 주문서 견적이 막는다.
  4. LAN 구현·배포됨(cart-service `MergesController`, 게이트웨이 `/api/v1/carts/**`).
  - 결과: CONFIRMED·PARTIAL(실패 항목은 `reasonCode` 와 함께 비회원 장바구니에 남음)·REJECTED, 202·불명은 `GET /carts/{cartId}/merges/{mergeId}`. 성공분은 같은 SKU 수량 합산, 비회원 장바구니에서 빠짐(한 트랜잭션).
- 고객앱 반영(2026-11-19, 목 모드): 장바구니 "주문하기" → 로그인 전 비회원 cartId 기억 → `purpose=CHECKOUT` 로그인 → 병합 확인(SCR-CART-MERGE-001, `/cart/merge`): 비회원 장바구니를 비회원 토큰으로 읽어 비었으면 바로 주문서, 있으면 고른 항목만 `POST /carts/{회원 cartId}/merges`(회원 토큰 + `X-Guest-Token`, 회원 장바구니 버전). 403 `FORBIDDEN_OWNER` 는 비회원 토큰 갱신 뒤 같은 키, 결과 불명(503·타임아웃)은 같은 키로만 다시(새로 합치지 않음), 409 버전 충돌은 다시 읽고 새로 누름. 결과(합침·일부·거절·정리 대기)를 항목별 이유와 함께 보이고 회원 장바구니를 다시 읽은 뒤 "주문 계속하기". 비회원 장바구니를 못 읽으면 빈 것으로 보지 않고 다시 불러오기/담지 않고 주문하기.
  - 결과 불명 해소는 `GET merges/{mergeId}` 대신 같은 키 재전송(불명이면 mergeId 를 모른다 — 계약 "같은 키 재전송은 기존 병합 결과 반환"). 수량 조정(ADJUST): 항목별 1 ~ 비회원 수량(서버는 원래보다 많으면 SOURCE_ITEM_CHANGED, 적으면 나머지를 비회원에 남김 — `MergeService` 확인), 결과에 못 담은 것이 있으면 "수량 바꿔 다시 담기"(새 키).
  - cart 생성 클라이언트는 다시 만들지 않음(0.2.2 는 설명만 — 모델 같음).

## BR-51 배차 자동 요청(AUTO_ON_READY) 제거 (MFC)
- 사용자 결정(2026-11-10): "배차에 자동요청 기능은 빼 무조건 직원 요청으로."
- 계약 mfc-fulfillment 0.4.5 `POST /shipments/{id}/dispatch-requests` 설명(D-5)은 요청 없이 READY 가 되면 자동 요청(`AUTO_ON_READY`)한다.
- 요청: 자동 요청을 없애고 `DispatchRequest.trigger` 를 MANUAL 만 남길지, 또는 끌 수 있는 설정으로 둘지 회신. `Delivery-business-logic.md` §3.1 의 D-5 문구 갱신 필요.
- PDA: 직원 요청만 쓴다. 출하 준비인데 요청이 없으면 "아직 배차를 요청하지 않았어요" 경고. 서버가 AUTO_ON_READY 를 주면 "직원 요청 없이 서버가 배차를 요청했어요. 관리자에게 알려 주세요".

## BR-52 PDA 업무 선택 기반 배정 (MFC)
- 사용자 결정(2026-11-10): 크루는 작업 목록을 못 본다. 메인(모든 작업자 공통)에서 업무(입고 / 품질검사 / 재고 이동 / 재고 실사 / 피패킹)를 고르고 "작업 준비 완료" → 업무 설명 한 장 → 확인 → 작업 가능 신호 → 서비스가 최우선 작업을 하나씩·단계별로 지시. 권한 없는 업무·메뉴는 "권한이 없어요".
- 상세 요청: `docs/handoff/mfc-app/2026-11-10-backend-pda-work-areas.md`


## BR-54 직원용 라이더 찾기·상세 (백오피스 라이더 운영)
- 백엔드 요청 2026-11-15 `backoffice/2026-11-15-clients-request-backoffice-cs-rider-menus.md` §3, PC 5 BOD-3(`GET /riders`, `GET /riders/{riderId}`) — 아직 계약 없음.
- 클라이언트: 화면은 만들었다(`/riders`). 목 모드에서만 메모리 목(`features/riders/riderDirectoryMock.ts`, BOD-3 제안 모양을 가정), 실서버 모드는 "서버 API 준비 전" 안내만 하고 부르지 않는다. 라이더 ID 를 알면 계정 제한 화면은 바로 연다(계약 있음).
- 필요한 것: 전화번호 완전 일치(숫자만), 제한 상태·수단·운행 상태·운행 센터 필터, 목록 전화번호 가림, 상세(이름·전화 전체·수단·운행·신규 배차·운행 센터·제한·가입일·마지막 heartbeat). 계약이 나오면 생성 타입으로 바꾼다.
- **끝남(2026-11-16)**: rider 0.4.0(백엔드 알림 `backoffice/2026-11-16-notice-rider-delivery-staff-apis.md`). 찾기는 라이더 ID·전화 완전 일치(이름 검색 없음), 상세 이름·전화는 가린 값, 원문은 사유 + `POST /riders/{id}/pii-reveals`. 목 지움.

## BR-55 전달 실패·도움요청 대기 목록 (백오피스 라이더 운영)
- 같은 요청서 §3, PC 5 BOD-4(`GET /delivery-help-requests` 제안) — 아직 계약 없음.
- 클라이언트: 화면은 만들었다(`/delivery-help-requests`, 상태 탭 대기·처리 중·처리함, 오래된 것 먼저, 행 → 배송 화면). 목 모드에서만 메모리 목, 실서버 모드는 안내만. 처리(실패 확정·반려)는 배송 화면의 계약된 API 로 한다. "처리함" 닫기 API 는 정해지지 않아 버튼이 없다.
- **끝남(2026-11-16)**: 백엔드 권고대로 도움요청은 사건함("지원센터 사건" kind=RIDER_HELP, 사건 상세에 도움요청 단건 `GET /deliveries/{id}/help-requests/{requestId}`), 전달 실패 확정 대기는 배송 확인의 `GET /deliveries?state=FAILURE_REPORTED&sort=OLDEST`. `/delivery-help-requests` 는 사건함으로 넘긴다.

## BR-56 직원 주문 조회에서 배송 번호로 잇기 (백오피스 고객센터)
- order 0.3.0 `GET /orders/lookups/{orderId}` 에 배송 번호(deliveryId)가 없다. 문의(`Inquiry`)에도 없다.
- 라이더 컴플레인 기록(`POST /rider-complaints`)·배송 확인은 deliveryId 가 필요해서, 상담원이 주문·문의에서 바로 넘어갈 수 없다(지금은 배송 번호를 직접 넣는다).
- 요청: 주문 상세에 그 주문의 배송 번호 목록(분할·회수 포함)을 싣거나, 주문 ID 로 배송을 찾는 직원용 조회를 계약에 넣어 줄지 회신.
- **끝남(2026-11-16)**: execution 0.4.0 `GET /deliveries?orderId=` — 주문 상세 "이 주문의 배송", 라이더 상세 "이 라이더의 배송".

## BR-57 요청 권한 역할 목록 API (인사팀 백오피스)
- 직원 등록 화면의 "요청 권한 역할" 고르기 목록을 주는 API 가 없어 `web/hr-backoffice/src/api/models.ts` `GRANT_ROLES` 에 고정해 두었다(handoff 2026-11-13 §3). 2026-11-15 `RIDER_OPS` 알림(`hr-backoffice/2026-11-15-notice-role-rider-ops.md`)으로 13개가 됐다.
- 역할이 늘 때마다 화면 목록이 서버 목록과 어긋날 수 있다(서버만 늘면 화면에서 못 고르고, 화면만 늘면 `UNKNOWN_ROLE` 행 거절).
- 요청: employee-auth-service 에 HR_ADMIN 이 부를 수 있는 역할 목록 조회(역할 코드, 표시 이름, 센터를 골라야 하는 역할인지)를 계약에 넣어 줄지 회신. 생기면 고정 목록 대신 그 응답을 쓴다.
- **끝남(2026-11-16)**: 백엔드가 `GET /employee-auth/roles`(0.5.0, 직원 토큰이면 누구나)를 만들었다. `GRANT_ROLES` 를 지우고 `src/features/employees/roles.ts` 가 이 응답을 쓴다(못 불러오면 오류 — 빈 목록 아님).

## BR-58 라이더 도움요청 상담 대화 (백오피스 지원센터)
- 계기: 라이더앱(PC 5)의 "도움요청 상담 대화" 요청. 라이더 쪽은 PC 5 요청서 `rider-app/2026-11-16-backend-trip-info-and-signup.md` §11, 상담원 쪽은 PC 2 요청서 `docs/handoff/archive/2026-11-16-backend-rider-help-chat.md`(PR #45) — 한 계약으로 맞춰 달라고 했다.
- 계약(case 0.11.2·execution 0.5.1)에 대화 API 가 없다. 접수 건 메모는 직원끼리만 보는 기록이라 대신 쓸 수 없다.
- 회신(2026-11-16): 대화는 delivery-execution `GET/POST /deliveries/{deliveryId}/help-requests/{requestId}/messages`(백엔드 PR #60 — 2026-11-16 main `5e2455fe` 에 병합, execution 0.6.0). 답장은 RIDER_OPS·OPERATOR_ADMIN, 새 메시지는 `lastRiderMessageAt`·`lastSupportMessageAt`(직원별 읽음은 화면이 기억), 관리자 가림, 처리 중 = 상담원이 집을 때 — DE-2(PR #62)로 PC 5 에 요청됨.
- 클라이언트: DE-2 가 반영·배포되기 전에는(권한·필드가 바뀜) 화면을 만들지 않는다(추측 경로 금지). 전화 기능은 보류(사용자 2026-11-16).

## BR-59 처음 실행 약관 — 위치 기반 서비스 약관·비회원 동의 기록 (고객앱)
- 계기: 사용자 2026-11-19 "제일처음부터 주소를 무조건 요구했으면 좋겠어", 환영·약관 화면은 "화면만 넣고 백엔드 요청"으로 결정. 레퍼런스 2-1: 앱을 처음 켜면 전체동의 / 위치 기반 서비스 약관 동의(필수) / 마케팅 정보 앱 푸시 알림 수신 동의(선택), "시작하기"는 필수를 골라야 눌림. 2-2 는 마케팅 동의 뒤 "수신동의 처리완료"(전송자·일시) 안내 창.
- 계약 공백: customer-service `consentType` 에 위치 기반 서비스 약관이 없다. auth 동의(AUTH_CONSENT)는 로그인 때만 묻고, 로그인 전(비회원·기기 단위) 동의와 마케팅 푸시 수신 동의를 남길 경로가 없다. 약관 본문(펼쳐 보기 `>`)을 받을 경로도 없다.
- 요청: ① 위치 기반 서비스 약관 동의 유형·버전 ② 비회원(기기 ID 또는 비회원 토큰) 동의 기록 경로와, 로그인 뒤 회원 동의로 옮기는 방식 ③ 마케팅 푸시 수신 동의의 처리 결과(일시) 응답 — 법정 수신동의 안내에 쓴다 ④ 약관 본문 조회.
- 클라이언트(처음): `features/start` — 동의를 이 기기 보안 저장소에만 두고, "처리완료" 안내 창과 약관 `>` 는 넣지 않았다.
- 회신(2026-11-19, `../pmart-backend/docs/handoff/clients/customer-app/2026-11-19-reply-br59-first-run-consents.md`, customer-service 0.6.0·0.6.1, LAN 배포):
  ① `LOCATION_BASED_SERVICE` — **현재 위치 기능을 쓸 때만 필수**(`required=false`, `requiredFor=CURRENT_LOCATION`), 로그인·구매 필수 목록·로그인 동의 단계에 없음.
  ② 기기 동의 `GET /device-consents`·`POST /device-consent-changes`(X-Device-Id, MARKETING·LOCATION_BASED_SERVICE 만) — 로그인하면 서버가 계정으로 옮긴다(앱이 부를 것 없음).
  ③ 동의 조회에 `senderName`·항목별 `lastChangedAt` — 이 값으로 처리완료 안내.
  ④ `GET /consent-terms`(항목·현행 버전·`documentUrl`), `GET /consent-terms/{항목}/{버전}`(Markdown 본문, 시연용 초안·법률 검토 전).
  질문: 현재 위치를 주소로 바꿀 때 쓰는 지도·주소 서비스 이름(위치기반서비스 약관 제6조) — "현재 위치로 찾기" 결정 때 답한다.
- 클라이언트(반영, 2026-11-19): 위치 약관 선택으로("시작하기" 잠금 풀림), 시작하기 → `POST /device-consent-changes`(약관 목록의 현행 버전, 결과 불명은 같은 키 한 번 더) → 서버 응답의 `lastChangedAt`·`senderName` 으로 2-2 동의/거부 안내 → 다음 단계. 약관 `>` → 본문 화면. 기기에는 단계 통과만 남긴다. 재동의 화면은 위치 약관을 묻지 않는다.

## BR-60 배송지에서 받는 분·연락처 빼기, 연락처는 주문서로 (고객앱)
- 계기: 사용자 2026-11-19 "처음 주소관리 쪽에 받는분이랑 연락처 있는데 이거 원래 고객앱 레퍼런스쪽에 이런식으로 있던게 맞아?" → "백엔드에 요청서 올리고 그리고 앱도 바꾸자".
- 레퍼런스: 주소 상세(2-7-1, 3-1 2-4)에는 받는 분·연락처가 없다. 연락처는 주문하기 "내 연락처"(6-3, "번호 변경"). 받는 분 이름 칸은 어디에도 없다.
- 계약 공백: customer-service `AddressInput` 이 `receiverName`·`receiverPhone` 필수. 초안은 이 값을 사본으로 고정(BR-37).
- 요청(`docs/handoff/customer-app/2026-11-19-backend-address-receiver-to-checkout.md`): R1 주소록·비회원 배송지에서 두 값 선택으로, R2 초안 사본은 주소에 없으면 프로필 연락처·이름(BR-32 0.7.0), 연락처가 없으면 막힘, R3 주문서 번호 변경 = 프로필 저장 + 초안 다시(앱 추천) 또는 초안 필드, R4 이름이 없을 때.
- 회신(2026-11-19, `../pmart-backend/docs/handoff/clients/customer-app/2026-11-19-reply-br60-address-receiver.md`): 추천대로 모두 — customer 0.8.0(V11)·order 0.14.0, LAN 배포 12:51~12:53.
- 클라이언트(반영, 2026-11-19): 주소 입력(회원·비회원)에서 두 칸을 빼고 보내지 않음. 주문서 "내 연락처"(6-3) — 사본 연락처 표시·"번호 변경"/막힘 "입력" → 프로필 저장 → 쇼핑 주소에 옛 번호가 있으면 비움 → 새 의도로 초안 다시. 실서버 확인은 아직.

## BR-61 고객 주문 조회의 배송 목록이 비어 있음 (고객앱)
- 계기: 사용자 2026-11-19 실기기 "배송현황에 지도 안 보인다". 고객 앱 로그 — 주문 상세만 열리고 `/eta`·`/stream` 호출 0번.
- 원인: order-service `GET /orders/{orderId}` 가 `shipments` 를 늘 `[]` 로 준다. 고객용 주문 → 배송 ID 경로가 따로 없다(`GET /deliveries?orderId=` 는 직원 전용).
- 요청: R1 `shipments[]`(deliveryId·state·lines) 채우기, R2 채워지는 시점. 대안 — 고객용 "내 주문의 배송" 조회.

## BR-62 배송 현황의 주문한 센터 이름 (고객앱)
- 계기: 사용자 2026-11-19 "주문 넣은 MFC … 다 떠야지"(레퍼런스 "B마트 부산동래").
- 공백: 고객은 `Order.mfcId` 만 받는다. 센터 이름은 center-master(직원 전용)·배차/실행 직원 응답 `mfcName` 에만 있다.
- 요청(`docs/handoff/customer-app/2026-11-19-backend-delivery-status-screen.md` R2): 고객 주문 응답에 `mfcName`. 앱은 그때까지 브랜드만(ID 를 보이지 않음).

## BR-63 홈 진열·상품 상세의 평점이 비어 옴 (고객앱)
- 계기: 사용자 2026-11-19 "무농약 햇양파 리뷰 480개인데 안 보여". rating-summary·리뷰 요약은 480, 진열 항목·상세 응답 rating 은 null.
- 요청(`docs/handoff/customer-app/2026-11-19-backend-rating-null-in-cards.md`): 진열·상세 사본을 집계와 같게(기존 리뷰 다시 채우기).

## BR-64 가입 즉시 휴대폰 본인 인증·한 번호 한 계정 (고객앱)
- 계기·결정: 사용자 2026-11-19 — 옥토모로 휴대폰 인증, 가입하자마자, 처음 가입한 제공자 하나로만 로그인, 같은 번호 기존 계정 안내에 제공자·가입일·가린 이메일 모두, 탈퇴 번호 1달 재가입 금지.
- 요청(`docs/handoff/customer-app/2026-11-19-backend-social-login-identity.md`): R1 로그인 상태 `AUTH_IDENTITY_REQUIRED`, R2 인증 시작·결과 API, R3 `IDENTITY_ALREADY_REGISTERED`(+제공자·가입일·가린 이메일)·`IDENTITY_REJOIN_BLOCKED`, R4 한 번호 한 계정, R5 제공자 연결 없음, R6 BR-32 번호와의 관계, R7 탈퇴 1달.

## BR-65 카카오·네이버 로그인 (고객앱)
- auth-service 가 Google 만 검증. 카카오 = OIDC ID 토큰 검증, 네이버 = Android SDK 액세스 토큰을 서버가 `/v1/nid/me` 로 확인(사용자 2026-11-19 — 고객앱은 Android 만, PC 웹·Callback·서버 코드 교환 없음). 앱 `kakao_flutter_sdk_user`·`flutter_naver_login` 추가는 사용자 승인 대기.
- 2026-11-19 진행: 백엔드가 customer 0.9.0 휴대폰 번호 확인(OCTOMO — 고객이 대표번호로 숫자 문자, "보냈어요" 때만 확인)을 만들고 배포. 고객앱 `/me/phone-verification`(레퍼런스 13 모양) 반영. 남은 BR-64(가입 단계·중복 안내·탈퇴 1달·기존 회원) 요청서 `docs/handoff/customer-app/2026-11-19-backend-phone-verification-signup.md`.
