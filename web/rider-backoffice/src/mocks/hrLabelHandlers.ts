// 사본: web/backoffice/src/mocks/hrLabelHandlers.ts (main ed3e74c) — hr 0.8.0 `GET /hr/employee-labels` 목(ADR-0070 덧붙임 — 직원 표시 "이름 · 사번").
// 아는 ID 만 돌려준다(모르는 ID 는 빠짐 → 화면은 "직원 …끝 6자리" 그대로). 이름은 목 표시([목])를 붙인다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';

export const MOCK_EMPLOYEE_LABELS: Readonly<Record<string, { name: string; employeeNo: string }>> = {
  'OP-admin-1': { name: '[목] 관리자', employeeNo: 'P2026-00001' },
  'OP-cs-2': { name: '[목] 최상담', employeeNo: 'P2026-00005' },
  'OP-rops-1': { name: '[목] 정운영', employeeNo: 'P2026-00006' },
};

export const hrLabelHandlers = [
  http.get(`${API_BASE}/hr/employee-labels`, ({ request }) => {
    const ids = new URL(request.url).searchParams.getAll('operatorIds');
    if (ids.length < 1 || ids.length > 50)
      return HttpResponse.json({ type: 'about:blank', title: 'bad', status: 400, code: 'VALIDATION_FAILED', traceId: 't' }, { status: 400, headers: { 'content-type': 'application/problem+json' } });
    return HttpResponse.json({ items: ids.flatMap((operatorId) => (MOCK_EMPLOYEE_LABELS[operatorId] ? [{ operatorId, ...MOCK_EMPLOYEE_LABELS[operatorId] }] : [])) });
  }),
];
