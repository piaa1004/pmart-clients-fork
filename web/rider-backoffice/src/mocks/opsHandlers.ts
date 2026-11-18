// ⚠ 화면 개발·시험용 목 — 라이더 운영 화면(2026-11-17, PC 5): 대시보드 수·라이더 찾기/상세(정산계좌 여부·동의 — 2026-11-18)/제한/원문/제한 검토·
// 라이더 배정 이력(dispatch `GET /rider-assignments`, 2026-11-18)·관제 위치·
// 직원용 수행료/운행시간·상태 정정·실패 결정·배차 취소·도움요청 대화·라이더 문의 대화·수행료 조정·추가 배달료·센터 목록.
// 실제 서버 동작이 아니다(권한·상태 규칙은 흉내만). 상태는 resetOps() 로 되돌린다.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { nextSeq, timestamp } from './db';
import { isStaffPhotoOf } from './staffEvidenceHandlers';
import { idempotent, operator, problem, unauthorized } from './support';

const OPS_ROLES = ['RIDER_OPS', 'OPERATOR_ADMIN'];
const canAct = (roles: readonly string[]) => roles.some((r) => OPS_ROLES.includes(r));

interface MockRider {
  riderId: string;
  nameMasked: string;
  phoneMasked: string;
  vehicleType: string;
  operatingStatus: 'ON_DUTY' | 'OFF_DUTY';
  restriction: string;
  joinedAt: string;
  version: number;
}

function seedRiders(): MockRider[] {
  return [
    { riderId: 'RD-7', nameMasked: '김*수', phoneMasked: '010****5678', vehicleType: 'MOTORCYCLE', operatingStatus: 'ON_DUTY', restriction: 'NORMAL', joinedAt: '2026-11-17T01:00:00.000Z', version: 2 },
    { riderId: 'RD-8', nameMasked: '이*', phoneMasked: '010****1234', vehicleType: 'BICYCLE', operatingStatus: 'OFF_DUTY', restriction: 'SUSPENDED', joinedAt: '2026-11-16T03:00:00.000Z', version: 1 },
  ];
}

type MockReview = { reviewId: string; riderId: string; complaintType: string; state: string; complaints: Array<{ complaintId: string; deliveryId: string; recordedAt: string }>; openedAt: string; decidedAt?: string; decidedBy?: string; note?: string };

function seedReviews(): MockReview[] {
  const c = (n: number) => ({ complaintId: `RC-${n}`, deliveryId: `DLV-${n}`, recordedAt: `2026-11-1${n}T02:00:00.000Z` });
  return [
    { reviewId: 'RV-1', riderId: 'RD-8', complaintType: 'DAMAGE', state: 'OPEN', complaints: [c(4), c(5), c(6)], openedAt: '2026-11-17T00:00:00.000Z' },
    { reviewId: 'RV-0', riderId: 'RD-7', complaintType: 'REPORT', state: 'DISMISSED', complaints: [c(1), c(2), c(3)], openedAt: '2026-11-14T00:00:00.000Z', decidedAt: '2026-11-14T05:00:00.000Z', decidedBy: 'OP-rops-1', note: '고객 오해 — 통화 확인' },
  ];
}

function seedComplaints() {
  return [
    { complaintId: 'RC-6', complaintType: 'DAMAGE', riderId: 'RD-8', deliveryId: 'DLV-6', orderId: 'ORD-6', recordedAt: '2026-11-16T02:00:00.000Z', recordedBy: 'OP-cs-1', source: 'CS_AGENT' },
    { complaintId: 'RC-5', complaintType: 'DAMAGE', riderId: 'RD-8', deliveryId: 'DLV-5', orderId: 'ORD-5', recordedAt: '2026-11-15T02:00:00.000Z', recordedBy: 'OP-cs-1', source: 'CS_AGENT' },
    { complaintId: 'RC-4', complaintType: 'DAMAGE', riderId: 'RD-8', deliveryId: 'DLV-4', orderId: null, recordedAt: '2026-11-14T02:00:00.000Z', recordedBy: 'OP-cs-2', source: 'CS_AGENT' },
  ];
}

export const ops = {
  riders: seedRiders(),
  reviews: seedReviews(),
  complaints: seedComplaints(),
  restrictionHistory: [] as Array<Record<string, unknown>>,
  helpMessages: [] as Array<{ messageId: string; seq: number; senderType: 'RIDER' | 'SUPPORT'; body: string | null; masked?: boolean; createdAt: string }>,
  help: { state: 'OPEN' as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED', resolvedAt: null as string | null },
  inquiryMessages: [] as Array<{ messageId: string; seq: number; senderType: 'RIDER' | 'SUPPORT'; body: string; createdAt: string }>,
  inquiryStatus: 'RECEIVED' as 'RECEIVED' | 'ANSWERED' | 'CLOSED',
  adjustments: [{ earningId: 'ERN-1', deliveryId: 'DLV-1', riderId: 'RD-7', calculable: false, settlementState: 'ESTIMATED', recordedAt: '2026-11-17T02:00:00.000Z', note: '자동 완료(픽업 5시간)' }],
  surcharges: [
    { requestId: 'SUR-1', deliveryId: 'DLV-3', riderId: 'RD-7', reason: 'ELEVATOR_OUT_OF_ORDER', floor: 22, amount: 1000, evidenceRefs: ['EVP-1'], state: 'REQUESTED', requestedAt: '2026-11-17T03:00:00.000Z' },
  ] as Array<Record<string, unknown> & { requestId: string; state: string }>,
};

export function resetOps(): void {
  ops.riders = seedRiders();
  ops.reviews = seedReviews();
  ops.complaints = seedComplaints();
  ops.restrictionHistory = [];
  ops.helpMessages = [{ messageId: 'HM-1', seq: 1, senderType: 'RIDER', body: '공동현관 비밀번호가 틀려요', createdAt: '2026-11-17T01:00:00.000Z' }];
  ops.help = { state: 'OPEN', resolvedAt: null };
  ops.inquiryMessages = [];
  ops.inquiryStatus = 'RECEIVED';
  ops.adjustments = [{ earningId: 'ERN-1', deliveryId: 'DLV-1', riderId: 'RD-7', calculable: false, settlementState: 'ESTIMATED', recordedAt: '2026-11-17T02:00:00.000Z', note: '자동 완료(픽업 5시간)' }];
  ops.surcharges = [
    { requestId: 'SUR-1', deliveryId: 'DLV-3', riderId: 'RD-7', reason: 'ELEVATOR_OUT_OF_ORDER', floor: 22, amount: 1000, evidenceRefs: ['EVP-1'], state: 'REQUESTED', requestedAt: '2026-11-17T03:00:00.000Z' },
  ];
}
resetOps();

const applied = (id: string) => ({ status: 200, body: { status: 'APPLIED', requestId: id, resultId: id, occurredAt: timestamp() } });

/** 로그인 직원만, 조치는 라이더 운영·관리자만(서버처럼 403) */
function guard(request: Request, act = false) {
  const who = operator(request);
  if (!who) return { error: unauthorized() } as const;
  if (act && !canAct(who.roles)) return { error: problem(403, 'FORBIDDEN') } as const;
  return { who } as const;
}

// 목 사진 — 96×96 바둑판 PNG(화면에 그림이 그려지는지 보려고). 실제 사진 아님.
const MOCK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAAyklEQVR4nO3YsQmAMBRF0ew/j7VDuIGNtSM4Qgg2N3Dg1ZfklH/cz7u047yWtnt/7P4BQIDafUCAAAECFO4DAgQIEKBwHxCgn0C1B9X6gAABAgQo3AcECBAgQOE+IECAAAEK9x3MJgMECBAgQOE+IECAAAEK9wEBAgQIULjvYDYZIECAAAEK9wEBAgQIULgPCBAgQIDCfQezyQABAgQIULgPCBAgQIDCfUCAAAECFO47mE0GCBAgQIDCfUCAAAECFO4DAgQIEKBw/wMWQ6s4ffbY6QAAAABJRU5ErkJggg==';
const mockPhoto = () => Uint8Array.from(atob(MOCK_PNG), (c) => c.charCodeAt(0));
const IQP_1 = { photoId: 'IQP-1', url: '/api/v1/inquiry-photos/IQP-1', contentType: 'image/jpeg' as const, sizeBytes: 4, uploadedAt: '2026-11-17T00:29:00.000Z' };
const SUR_DONE = { requestId: 'SUR-0', deliveryId: 'DLV-3', riderId: 'RD-8', reason: 'ELEVATOR_OUT_OF_ORDER', floor: 18, amount: 500, evidenceRefs: [], state: 'APPROVED', requestedAt: '2026-11-16T05:00:00.000Z', decidedAt: '2026-11-16T06:00:00.000Z', decidedBy: 'OP-rops-1', decisionNote: null };

const RIDER_ASSIGNMENTS = [
  { offerId: 'OF-3', deliveryId: 'DLV-1', orderId: 'ORD-1', mfcId: 'MFC-BSJ-01', type: 'FORWARD', purpose: 'DELIVERY', source: 'AI_RECOMMENDED', fee: 3900, assignedAt: '2026-11-17T02:00:00.000Z', deliveryState: 'PICKED_UP', outcome: 'CURRENT', cancellation: null },
  { offerId: 'OF-2', deliveryId: 'DLV-3', orderId: 'ORD-3', mfcId: 'MFC-BSJ-01', type: 'FORWARD', purpose: 'DELIVERY', source: 'DELIVERY_LIST', fee: 3500, assignedAt: '2026-11-16T05:00:00.000Z', deliveryState: 'CLOSED', outcome: 'DONE', cancellation: null },
  {
    offerId: 'OF-1',
    deliveryId: 'DLV-5',
    orderId: 'ORD-5',
    mfcId: 'MFC-BSJ-01',
    type: 'FORWARD',
    purpose: 'DELIVERY',
    source: 'AI_RECOMMENDED',
    fee: null,
    assignedAt: '2026-11-15T03:00:00.000Z',
    deliveryState: 'ASSIGNED',
    outcome: 'CANCELLED',
    cancellation: { requestedBy: 'OPERATOR', reason: 'NO_SHOW', reasonDetail: '20분 넘게 가게에 안 옴', at: '2026-11-15T03:30:00.000Z' },
  },
];

export const opsHandlers = [
  http.get(`${API_BASE}/centers`, () =>
    HttpResponse.json({ items: [{ centerId: 'MFC-BSJ-01', name: 'PMart 부산진구지점', type: 'MFC', address: '부산 부산진구 중앙대로 000(목 주소)', coordinates: { lat: 35.1585, lng: 129.062 } }] }),
  ),

  http.get(`${API_BASE}/riders/stats`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const rs = ops.riders;
    const by = (x: string) => rs.filter((r) => r.restriction === x).length;
    return HttpResponse.json({
      total: rs.length,
      onDuty: rs.filter((r) => r.operatingStatus === 'ON_DUTY').length,
      onDutyAcceptingNew: 1,
      byRestriction: { NORMAL: by('NORMAL'), DISPATCH_RESTRICTED: by('DISPATCH_RESTRICTED'), SUSPENDED: by('SUSPENDED'), TERMINATED: by('TERMINATED') },
      joinedToday: 1,
      asOf: timestamp(),
    });
  }),
  http.get(`${API_BASE}/delivery-stats`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      inProgress: { UNASSIGNED: 1, ASSIGNED: 0, ARRIVED_AT_STORE: 0, PICKED_UP: 2, ARRIVED_AT_CUSTOMER: 0, FAILURE_REPORTED: 1, RETURN_PICKED_UP: 0 },
      completedToday: 5,
      failedToday: 1,
      openHelpRequests: 1,
      adjustmentPending: ops.adjustments.length,
      surchargeRequested: ops.surcharges.filter((s) => s.state === 'REQUESTED').length,
      asOf: timestamp(),
    });
  }),

  http.get(`${API_BASE}/riders/restriction-reviews`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const q = new URL(request.url).searchParams;
    const state = q.get('state') ?? 'OPEN';
    const items = ops.reviews.filter((v) => v.state === state && (!q.get('riderId') || v.riderId === q.get('riderId')));
    return HttpResponse.json({ items });
  }),
  http.post(`${API_BASE}/riders/restriction-reviews/:reviewId/decisions`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const v = ops.reviews.find((x) => x.reviewId === params.reviewId);
    if (!v) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { decision: string; note?: string };
    return idempotent(request, () => {
      if (v.state !== 'OPEN') return problem(409, 'INVALID_STATE');
      Object.assign(v, { state: body.decision, decidedAt: timestamp(), decidedBy: g.who.subject, ...(body.note ? { note: body.note } : {}) });
      return { status: 200, body: { ...v } };
    });
  }),
  // case 0.x `GET /rider-complaints`(역할 CS_AGENT·OPERATOR_ADMIN·RIDER_OPS) — 최근 기록 순
  http.get(`${API_BASE}/rider-complaints`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const q = new URL(request.url).searchParams;
    const items = ops.complaints.filter((c) => !q.get('riderId') || c.riderId === q.get('riderId'));
    return HttpResponse.json({ items, page: { nextCursor: null } });
  }),
  http.get(`${API_BASE}/riders`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const q = new URL(request.url).searchParams;
    // 정렬은 흉내만: 상태 바뀐 순은 버전 높은 순으로 본다
    const order = q.get('sort') === 'STATE_CHANGED_DESC' ? (a: MockRider, b: MockRider) => b.version - a.version : (a: MockRider, b: MockRider) => b.joinedAt.localeCompare(a.joinedAt);
    const items = ops.riders
      .filter((r) => !q.get('riderId') || r.riderId === q.get('riderId'))
      .filter((r) => !q.get('restriction') || r.restriction === q.get('restriction'))
      .filter((r) => !q.get('operatingStatus') || r.operatingStatus === q.get('operatingStatus'))
      .filter((r) => !q.get('vehicleType') || r.vehicleType === q.get('vehicleType'))
      .sort(order)
      .map((r) => ({ ...r, signupStatus: 'APPROVED' }));
    return HttpResponse.json({ items, page: 0, size: items.length, hasNext: false });
  }),
  http.get(`${API_BASE}/riders/:riderId/restrictions`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const r = ops.riders.find((x) => x.riderId === params.riderId);
    if (!r) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({ current: r.restriction, version: r.version, items: ops.restrictionHistory.filter((h) => h.riderId === r.riderId) });
  }),
  http.post(`${API_BASE}/riders/:riderId/restrictions`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const r = ops.riders.find((x) => x.riderId === params.riderId);
    if (!r) return problem(404, 'NOT_FOUND');
    const body = (await request.json()) as { restriction: string; reason: string };
    return idempotent(request, () => {
      const rec = { riderId: r.riderId, previous: r.restriction, restriction: body.restriction, reason: body.reason, changedBy: g.who.subject, changedAt: timestamp(), version: r.version + 1 };
      r.restriction = body.restriction;
      r.version += 1;
      ops.restrictionHistory.unshift(rec);
      return { status: 200, body: rec };
    });
  }),
  http.post(`${API_BASE}/riders/:riderId/pii-reveals`, async ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { reason?: string };
    if (!body.reason || body.reason.trim().length < 2) return problem(400, 'VALIDATION_FAILED');
    return idempotent(request, () => ({ status: 200, body: { riderId: params.riderId, name: '김민수', phone: '01012345678', recordedAt: timestamp() } }));
  }),
  http.get(`${API_BASE}/riders/:riderId`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const r = ops.riders.find((x) => x.riderId === params.riderId);
    if (!r) return problem(404, 'NOT_FOUND');
    return HttpResponse.json({
      ...r,
      signupStatus: 'APPROVED',
      signupDecidedBy: 'AUTO',
      deliveryAreas: [{ mfcId: 'MFC-BSJ-01' }],
      operating: { status: r.operatingStatus, newDispatchEnabled: r.operatingStatus === 'ON_DUTY', changedAt: '2026-11-17T00:30:00.000Z' },
      restriction: { state: r.restriction },
      // rider 0.10.0 — 계좌는 등록 여부·은행 이름만(번호·예금주 없음), 동의는 항목마다 마지막만
      ...(r.riderId === 'RD-7'
        ? {
            bankAccountRegistered: true,
            bankName: '국민은행',
            consents: [
              { consentType: 'TERMS_OF_SERVICE', version: '2026-10', agreedAt: '2026-11-17T01:00:00.000Z' },
              { consentType: 'PRIVACY', version: '2026-11', agreedAt: '2026-11-17T01:00:00.000Z' },
            ],
          }
        : { bankAccountRegistered: false, bankName: null, consents: [] }),
    });
  }),
  // dispatch 0.8.0 — 라이더 배정 이력(배정 최신순, cursor). RIDER_OPS·OPERATOR_ADMIN·CS_AGENT
  http.get(`${API_BASE}/rider-assignments`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    if (!g.who.roles.some((x) => ['RIDER_OPS', 'OPERATOR_ADMIN', 'CS_AGENT'].includes(x))) return problem(403, 'FORBIDDEN');
    const q = new URL(request.url).searchParams;
    const all = q.get('riderId') === 'RD-7' ? RIDER_ASSIGNMENTS : [];
    const size = Number(q.get('size') ?? '20') || 20;
    const from = Number(q.get('cursor') ?? '0') || 0;
    const items = all.slice(from, from + size);
    return HttpResponse.json({ items, page: { size: items.length, nextCursor: from + size < all.length ? String(from + size) : null } });
  }),

  http.get(`${API_BASE}/rider-earnings/adjustment-queue`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ items: ops.adjustments });
  }),
  http.post(`${API_BASE}/rider-earnings/:earningId/adjustments`, ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    return idempotent(request, () => {
      ops.adjustments = ops.adjustments.filter((a) => a.earningId !== params.earningId);
      return { status: 200, body: { earningId: params.earningId, settlementState: 'CONFIRMED' } };
    });
  }),
  http.get(`${API_BASE}/rider-earnings`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      items: [{ earningId: 'ERN-9', deliveryId: 'DLV-3', riderId: 'RD-7', calculable: true, total: 3900, settlementState: 'PENDING_CONFIRMATION', recordedAt: '2026-11-17T02:00:00.000Z' }],
      totals: { estimated: 3900, confirmed: 0, paid: 0 },
      page: { size: 1 },
    });
  }),
  http.get(`${API_BASE}/rider-operating-time`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    // execution 0.25.0 — 운행시간(수락~완료) totalSeconds 와 따로 접속(connectedSeconds)·대기(waitingSeconds)
    return HttpResponse.json({ from: '2026-11-16', to: '2026-11-17', totalSeconds: 5400, connectedSeconds: 9000, waitingSeconds: 1800, days: [] });
  }),

  http.get(`${API_BASE}/surcharge-requests`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    // 거르기: state·riderId(완전 일치), 기본은 전부(계약). 목 전용: SUR-0 은 이미 승인된 건
    const q = new URL(request.url).searchParams;
    const all = [SUR_DONE, ...ops.surcharges];
    return HttpResponse.json({ items: all.filter((s) => (!q.get('state') || s.state === q.get('state')) && (!q.get('riderId') || s.riderId === q.get('riderId'))) });
  }),
  http.post(`${API_BASE}/surcharge-requests/:requestId/decisions`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { decision: 'APPROVE' | 'REJECT' };
    const s = ops.surcharges.find((x) => x.requestId === params.requestId);
    if (!s) return problem(404, 'NOT_FOUND');
    return idempotent(request, () => {
      s.state = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      return { status: 200, body: { ...s, decidedBy: g.who.subject, decidedAt: timestamp() } };
    });
  }),

  http.get(`${API_BASE}/rider-locations`, ({ request }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      asOf: timestamp(),
      items: [
        {
          riderId: 'RD-7',
          nameMasked: '김*수',
          vehicleType: 'MOTORCYCLE',
          newDispatchEnabled: true,
          restriction: 'NORMAL',
          location: { lat: 35.1585, lng: 129.062, accuracyM: 10, recordedAt: timestamp(), receivedAt: timestamp(), quality: 'GOOD' },
          staleSinceSeconds: 8,
          stale: false,
          // tracking 0.9.0 — 운행 시작(배송 중이라 대기 아님 → waitingSince null)
          onDutySince: new Date(Date.now() - 2 * 3600_000).toISOString(),
          waitingSince: null,
          activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_CUSTOMER', pickedUp: true, etaDrop: null }],
        },
        // 신규배차를 꺼 둔 운행 라이더 — 대기로 세지 않는다(waitingSince null)
        { riderId: 'RD-9', vehicleType: 'BICYCLE', newDispatchEnabled: false, restriction: 'NORMAL', location: null, staleSinceSeconds: null, stale: true, onDutySince: new Date(Date.now() - 40 * 60_000).toISOString(), waitingSince: null, activeDeliveries: [] },
      ],
    });
  }),

  // 0.22.0: evidenceRefs(선택)는 이 배송에 직원이 올린 사진만(staff-evidence-photos 목) — 아니면 422 PHOTO_NOT_FOUND
  http.post(`${API_BASE}/deliveries/:deliveryId/status-corrections`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { evidenceRefs?: string[] };
    const deliveryId = String(params['deliveryId']);
    if ((body.evidenceRefs ?? []).some((ref) => !isStaffPhotoOf(deliveryId, ref))) return problem(422, 'PHOTO_NOT_FOUND', [{ field: 'evidenceRefs', reason: 'NOT_ALLOWED' }]);
    return idempotent(request, () => applied(`COR-${nextSeq()}`));
  }),
  http.post(`${API_BASE}/deliveries/:deliveryId/failure-decisions`, async ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { reason?: string };
    if (body.reason && !canAct(g.who.roles)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => applied(`DEC-${nextSeq()}`));
  }),
  http.post(`${API_BASE}/deliveries/:deliveryId/assignment-cancellations`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return idempotent(request, () => applied(`CAN-${nextSeq()}`));
  }),

  http.get(`${API_BASE}/delivery-help-requests`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({
      items: [{ requestId: 'HR-1', deliveryId: 'DLV-1', riderId: 'RD-7', category: 'ADDRESS_ISSUE', state: 'OPEN', createdAt: '2026-11-17T01:00:00.000Z' }],
    });
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/messages`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ items: ops.helpMessages, helpState: ops.help.state });
  }),
  http.post(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/messages`, async ({ request }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { body: string };
    return idempotent(request, () => {
      const msg = { messageId: `HM-${nextSeq()}`, seq: ops.helpMessages.length + 1, senderType: 'SUPPORT' as const, body: body.body, createdAt: timestamp() };
      ops.helpMessages.push(msg);
      return { status: 201, body: msg };
    });
  }),
  http.get(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    // 목 전용: HR-CASE 는 접수 건이 붙은 도움요청(처리함 409 HELP_REQUEST_HAS_CASE), 사진 EVP-H2 는 못 받는 사진(404)
    const withCase = params.requestId === 'HR-CASE';
    return HttpResponse.json({
      requestId: params.requestId,
      deliveryId: params.deliveryId,
      category: 'ADDRESS_ISSUE',
      state: withCase ? 'IN_PROGRESS' : ops.help.state,
      detail: '공동현관',
      evidenceRefs: ['EVP-H1', 'EVP-H2'],
      caseId: withCase ? 'CASE-9' : null,
      resolvedAt: ops.help.resolvedAt,
      createdAt: '2026-11-17T01:00:00.000Z',
    });
  }),
  // 도움요청 처리함(0.4.0) — OPEN·IN_PROGRESS → RESOLVED, 이미 RESOLVED 면 409 INVALID_STATE, 접수 건이 붙었으면 409 HELP_REQUEST_HAS_CASE
  http.post(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/resolutions`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return idempotent(request, () => {
      if (params.requestId === 'HR-CASE') return problem(409, 'HELP_REQUEST_HAS_CASE');
      if (ops.help.state === 'RESOLVED') return problem(409, 'INVALID_STATE');
      ops.help = { state: 'RESOLVED', resolvedAt: timestamp() };
      return { status: 200, body: { requestId: params.requestId, deliveryId: params.deliveryId, state: 'RESOLVED', resolvedAt: ops.help.resolvedAt, resolvedBy: g.who.subject } };
    });
  }),
  // 대화 가리기(0.8.0) — OPERATOR_ADMIN 만, 사유 2~500자
  http.post(`${API_BASE}/deliveries/:deliveryId/help-requests/:requestId/messages/:messageId/maskings`, async ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    if (!g.who.roles.includes('OPERATOR_ADMIN')) return problem(403, 'FORBIDDEN');
    const body = (await request.json()) as { reason?: string };
    const reason = (body.reason ?? '').trim();
    if (reason.length < 2 || reason.length > 500) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'LENGTH' }]);
    const msg = ops.helpMessages.find((x) => x.messageId === params.messageId);
    if (!msg) return problem(404, 'NOT_FOUND');
    return idempotent(request, () => {
      msg.body = null;
      msg.masked = true;
      return { status: 200, body: msg };
    });
  }),
  // 증빙 사진(0.20.0) — 원본 이미지. 목 전용: EVP-H2 는 404(못 받는 사진)
  http.get(`${API_BASE}/deliveries/:deliveryId/evidence-photos/:photoRef`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    if (params.photoRef === 'EVP-H2') return problem(404, 'NOT_FOUND');
    return new HttpResponse(mockPhoto(), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  }),

  http.get(`${API_BASE}/inquiries`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    const status = new URL(request.url).searchParams.get('status');
    const one = { inquiryId: 'INQ-1', category: 'SETTLEMENT', title: '정산 문의', status: ops.inquiryStatus, createdAt: '2026-11-17T00:30:00.000Z' };
    return HttpResponse.json({ items: !status || status === ops.inquiryStatus ? [one] : [] });
  }),
  http.get(`${API_BASE}/inquiries/:inquiryId/messages`, ({ request }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ items: ops.inquiryMessages, status: ops.inquiryStatus });
  }),
  http.post(`${API_BASE}/inquiries/:inquiryId/replies`, async ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    const body = (await request.json()) as { body: string };
    return idempotent(request, () => {
      ops.inquiryMessages.push({ messageId: `IM-${nextSeq()}`, seq: ops.inquiryMessages.length + 1, senderType: 'SUPPORT', body: body.body, createdAt: timestamp() });
      ops.inquiryStatus = 'ANSWERED';
      return { status: 200, body: { inquiryId: params.inquiryId, status: 'ANSWERED' } };
    });
  }),
  http.post(`${API_BASE}/inquiries/:inquiryId/closures`, ({ request, params }) => {
    const g = guard(request, true);
    if ('error' in g) return g.error;
    return idempotent(request, () => {
      ops.inquiryStatus = 'CLOSED';
      return { status: 200, body: { inquiryId: params.inquiryId, status: 'CLOSED' } };
    });
  }),
  // 문의 사진(case 0.14.0) — 목 전용: IQP-1 만 있음, 그 밖 404
  http.get(`${API_BASE}/inquiry-photos/:photoId`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    if (params.photoId !== IQP_1.photoId) return problem(404, 'NOT_FOUND');
    return new HttpResponse(mockPhoto(), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } });
  }),
  http.get(`${API_BASE}/inquiries/:inquiryId`, ({ request, params }) => {
    const g = guard(request);
    if ('error' in g) return g.error;
    return HttpResponse.json({ inquiryId: params.inquiryId, category: 'SETTLEMENT', title: '정산 문의', body: '지난주 정산이 빠졌어요', status: ops.inquiryStatus, createdAt: '2026-11-17T00:30:00.000Z', version: 1, replies: [], photos: [IQP_1] });
  }),
];
