import { http } from 'msw';

import { API_BASE } from '../api/client';
import { assignmentHandlers } from './assignmentHandlers';
import { authHandlers } from './authHandlers';
import { centerDeliveryHandlers } from './centerDeliveryHandlers';
import { approvalHandlers } from './approvalHandlers';
import { packingHandoverHandlers } from './packingHandoverHandlers';
import { inboundHandlers } from './inboundHandlers';
import { inventoryHandlers } from './inventoryHandlers';
import { locationHandlers } from './locationHandlers';
import { moveHandlers } from './moveHandlers';
import { qualityHandlers } from './qualityHandlers';
import { restrictionHandlers } from './restrictionHandlers';
import { taskHandlers } from './taskHandlers';
import { workerHandlers } from './workerHandlers';
import { listHandlers } from './listHandlers';
import { incidentHandlers } from './incidentHandlers';
import { meHandlers } from './meHandlers';
import { returnHandoverHandlers } from './returnHandoverHandlers';
import { dispatchDelayHandlers } from './dispatchDelayHandlers';
import { staffContactHandlers } from './staffContactHandlers';
import { operator, unauthorized } from './support';

/** 게이트웨이 공개 경로(계약 security: []) */
const PUBLIC = [`${API_BASE}/employee-auth/tokens`, `${API_BASE}/employee-auth/tokens/refresh`];

/** 게이트웨이처럼: 공개 경로가 아니면 유효한 access token 이 있어야 한다(없거나 만료·폐기 → 401). */
const gateway = http.all(`${API_BASE}/*`, ({ request }) => {
  const url = request.url.split('?')[0] ?? '';
  if (PUBLIC.includes(url)) return undefined;
  return operator(request) ? undefined : unauthorized();
});

// 센터 이름은 sessions/current 의 centerDetails(0.9.0)로 온다 — GET /centers 목은 두지 않는다(authHandlers 의 mockCenterNames).
export const handlers = [gateway, ...authHandlers, ...locationHandlers, ...moveHandlers, ...workerHandlers, ...taskHandlers, ...assignmentHandlers, ...inboundHandlers, ...inventoryHandlers, ...qualityHandlers, ...restrictionHandlers, ...centerDeliveryHandlers, ...packingHandoverHandlers, ...approvalHandlers, ...meHandlers, ...listHandlers, ...returnHandoverHandlers, ...incidentHandlers, ...staffContactHandlers, ...dispatchDelayHandlers];
