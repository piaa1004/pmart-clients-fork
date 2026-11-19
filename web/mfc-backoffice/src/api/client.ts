import createClient from 'openapi-fetch';

import { createPmartFetch, TokenStore, type EmployeeAuthPaths, type PmartFetch } from '@pmart/web-core';
import { SOURCE_SYSTEM } from './command';
import { refreshEmployeeTokens } from './employeeAuth';
import type { paths as ApprovalPaths } from './generated/approval';
import type { paths as BffPaths } from './generated/backoffice-bff';
import type { paths as CasePaths } from './generated/case';
import type { paths as CenterPaths } from './generated/center-master';
import type { paths as DispatchPaths } from './generated/delivery-dispatch';
import type { paths as ExecutionPaths } from './generated/delivery-execution';
import type { paths as HrPaths } from './generated/hr';
import type { paths as CapacityPaths } from './generated/mfc-capacity';
import type { paths as FulfillmentPaths } from './generated/mfc-fulfillment';
import type { paths as InboundPaths } from './generated/mfc-inbound';
import type { paths as InventoryPaths } from './generated/mfc-inventory';
import type { paths as LocationPaths } from './generated/mfc-location';
import type { paths as QualityPaths } from './generated/mfc-quality';

export { SOURCE_SYSTEM };

/** 게이트웨이 기준 경로. 기본은 같은 출처(개발 프록시·mock 의 MSW). lan 은 VITE_PMART_API_BASE(게이트웨이 CORS 허용 출처에 있어야 한다). */
export const API_BASE = import.meta.env.VITE_PMART_API_BASE || `${globalThis.location.origin}/api/v1`;

export const tokens = new TokenStore();

/** 메뉴별 계약(handoff §2): 인력·배정·운영 제한 = capacity, 작업 현황 = fulfillment, 이동·입고 = inbound, 재고 = inventory, 위치 = location, 품질 = quality */
export function createApi(pmartFetch: PmartFetch, baseUrl = API_BASE) {
  const options = { baseUrl, fetch: pmartFetch };
  return {
    employeeAuth: createClient<EmployeeAuthPaths>(options),
    center: createClient<CenterPaths>(options),
    capacity: createClient<CapacityPaths>(options),
    fulfillment: createClient<FulfillmentPaths>(options),
    inbound: createClient<InboundPaths>(options),
    inventory: createClient<InventoryPaths>(options),
    location: createClient<LocationPaths>(options),
    quality: createClient<QualityPaths>(options),
    // 우리 센터 배송 현황(bff 0.3.1 live-delivery — 계약 servers.url /api/v1/backoffice)·배차 실패 사건(case 0.5.2)
    bff: createClient<BffPaths>({ ...options, baseUrl: `${baseUrl}/backoffice` }),
    cases: createClient<CasePaths>(options),
    // 본사 승인 요청(AP-1) — 422 APPROVAL_REQUIRED 의 요청 본문으로 변경 요청 만들기·제출, 승인 상태 조회
    approval: createClient<ApprovalPaths>(options),
    // 내 정보 — hr-service 본인 조회
    hr: createClient<HrPaths>(options),
    // 반납 인증번호(delivery-execution 0.28.0) — 회수·반납 배송이 MFC 로 올 때 라이더에게 알려 줄 4자리
    execution: createClient<ExecutionPaths>(options),
    // 배차 지연 목록(delivery-dispatch 0.12.0)
    dispatch: createClient<DispatchPaths>(options),
  };
}

export type Api = ReturnType<typeof createApi>;

export const api: Api = createApi(
  createPmartFetch({
    sourceSystem: SOURCE_SYSTEM,
    tokens,
    // 401 이면 refresh token 회전으로 한 번 갱신(single-flight). 세션이 끝나면 tokens 가 비워진다.
    refresh: () => refreshEmployeeTokens(api, tokens),
  }),
);
