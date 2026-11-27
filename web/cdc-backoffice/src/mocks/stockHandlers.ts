// cdc-inventory(0.7.1)·cdc-location(0.5.1) 목 — 칠곡 CDC01 시연 값(가짜).
// 재고 현황·LOT·위치, 재계수 대기·풀기, SKU 취급 목록·켜기/끄기, 로케이션 목록·상세·상태 바꾸기(202 APPLIED), 통로 피킹 방식.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components as Inv } from '../api/generated/cdc-inventory';
import type { components as Loc } from '../api/generated/cdc-location';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';

type Availability = Inv['schemas']['Availability'];
type RecountHold = Inv['schemas']['RecountHold'];
type SkuHandling = Inv['schemas']['SkuHandling'];
type Location = Loc['schemas']['Location'];

const asOf = { asOf: '2026-11-26T00:00:00Z', freshness: 'CURRENT' as const };

function seed() {
  const stock: Availability[] = [
    {
      cdcId: 'CDC01',
      sku: 'SKU-1001',
      onHand: 1200,
      eligible: 1180,
      reserved: 70,
      held: 20,
      safety: { state: 'VALUE', value: 100 },
      available: 1010,
      transit: 0,
      handlingActive: true,
      lots: [
        {
          lot: 'LOT-A1',
          expiresAt: '2026-12-20',
          remainingDays: 24,
          eligible: 800,
          reserved: 70,
          held: 0,
          locations: [
            { locationCode: 'CDC01-A-5-03-02-1-1', qualityState: 'RELEASED', onHand: 700, reserved: 70 },
            { locationCode: 'CDC01-A-5-63-01-2-1', qualityState: 'RELEASED', onHand: 100, reserved: 0 },
            // 새 배치(R-25) 칸 — 평면도에서 재고 있는 통로 보이기
            { locationCode: 'CDC01-G-5-03-02-1-1', qualityState: 'RELEASED', onHand: 40, reserved: 0 },
            { locationCode: 'CDC01-H-5-05-01-1-1', qualityState: 'RELEASED', onHand: 24, reserved: 0 },
          ],
        },
        { lot: 'LOT-A2', expiresAt: '2027-01-10', remainingDays: 45, eligible: 380, reserved: 0, held: 20, locations: [{ locationCode: 'CDC01-A-5-04-02-1-1', qualityState: 'HELD', onHand: 400, reserved: 0 }] },
      ],
    },
    { cdcId: 'CDC01', sku: 'SKU-2001', onHand: 300, eligible: 300, reserved: 12, held: 0, safety: { state: 'NOT_SET' }, available: null, transit: 24, handlingActive: true, lots: [] },
    { cdcId: 'CDC01', sku: 'SKU-9001', onHand: 0, eligible: 0, reserved: 0, held: 0, safety: { state: 'VALUE', value: 10 }, available: 0, transit: 0, handlingActive: false, lots: [] },
  ];
  const holds: RecountHold[] = [
    { holdId: 'RCH-1', sku: 'SKU-1002', lot: 'LOT-B7', locationCode: 'CDC01-B-6-67-01-1-1', state: 'HELD', shortQty: 2, allocationId: 'ALC-1', sourceRef: 'TSK-0002', createdAt: '2026-11-25T23:20:00Z', releasedAt: null },
    { holdId: 'RCH-0', sku: 'SKU-3001', lot: 'LOT-C1', locationCode: 'CDC01-C-5-70-02-1-1', state: 'RELEASED', shortQty: 1, createdAt: '2026-11-24T23:00:00Z', releasedAt: '2026-11-25T01:00:00Z', releasedBy: 'OP-cdc-sup', releaseReason: '다시 세어 맞음' },
  ];
  const handlings: SkuHandling[] = [
    { sku: 'SKU-1001', handlingEnabled: true, version: 2, skuState: 'ACTIVE', changedBy: 'OP-cdc-sup', reason: '오픈', updatedAt: '2026-11-24T00:00:00Z' },
    { sku: 'SKU-1002', handlingEnabled: true, version: 1, skuState: 'ACTIVE', changedBy: 'OP-cdc-sup', reason: null, updatedAt: '2026-11-24T00:00:00Z' },
    { sku: 'SKU-8001', handlingEnabled: false, version: 0, skuState: 'ACTIVE', changedBy: null, reason: null, updatedAt: null },
    { sku: 'SKU-9001', handlingEnabled: false, version: 3, skuState: 'INACTIVE', changedBy: 'OP-admin-cdc', reason: '단종', updatedAt: '2026-11-20T00:00:00Z' },
  ];
  const loc = (code: string, zone: Location['temperatureZone'], type: Location['locationType'], state: NonNullable<Location['state']>, maxQty: number, occupied: number | null, reserved: number): Location => {
    const [center = '', area = '', floor = '', aisle = '', bay = '', level = '0', slot = '1'] = code.split('-');
    return {
      locationCode: code,
      centerId: 'CDC01',
      temperatureZone: zone,
      locationType: type,
      capacity: { unit: type === 'RESERVE' ? 'PLT' : 'EACH', maxQty },
      state,
      version: 1,
      parts: { center, area, floor, aisle, bay, level: Number(level), slot: Number(slot) },
      occupiedQty: occupied,
      openReservedQty: reserved,
      availableQty: occupied === null ? null : Math.max(0, maxQty - occupied - reserved),
      ...(type === 'PICK_FACE' ? { pickFaceMinQty: 20, pickFaceTargetQty: null } : {}),
      updatedAt: '2026-11-25T00:00:00Z',
    };
  };
  const locations: Location[] = [
    loc('CDC01-A-5-03-02-1-1', 'FROZEN', 'RESERVE', 'ACTIVE', 2, 1, 0),
    loc('CDC01-A-5-63-01-2-1', 'FROZEN', 'PICK_FACE', 'ACTIVE', 120, null, 0),
    loc('CDC01-B-6-67-01-1-1', 'CHILLED', 'PICK_FACE', 'BLOCKED', 80, 30, 0),
    loc('CDC01-C-5-02-24-3-1', 'AMBIENT', 'RESERVE', 'DRAFT', 2, 0, 0),
    loc('CDC01-C-5-91-01-0-1', 'AMBIENT', 'STAGING', 'ACTIVE', 40, 12, 4),
  ];
  const aisles = [
    { area: 'A', floor: '5', aisle: '63', pickMethod: 'DPS' as const, updatedBy: 'OP-cdc-sup', updatedAt: '2026-11-25T00:00:00Z' },
    { area: 'B', floor: '6', aisle: '67', pickMethod: 'LINE' as const, updatedBy: 'OP-cdc-sup', updatedAt: '2026-11-25T00:00:00Z' },
    { area: 'C', floor: '5', aisle: '70', pickMethod: 'FC' as const, updatedBy: 'OP-cdc-sup', updatedAt: '2026-11-25T00:00:00Z' },
  ];
  const counts: Inv['schemas']['CountSession'][] = [
    {
      sessionId: 'CNT-0001',
      sessionNumber: 'C1001',
      cdcId: 'CDC01',
      state: 'PENDING_APPROVAL',
      locationCodes: ['CDC01-B-6-67-01-1-1'],
      sheet: [{ locationCode: 'CDC01-B-6-67-01-1-1', sku: 'SKU-1002', lot: 'LOT-B7' }],
      startedBy: 'OP-other-sup',
      firstCounterId: 'cdcw-qc-01',
      recounterId: 'cdcw-qc-02',
      decidedBy: null,
      reason: '피킹 부족 재계수',
      createdAt: '2026-11-26T00:10:00Z',
      decidedAt: null,
    },
  ];
  return { stock, holds, handlings, locations, aisles, counts, cseq: 1 };
}

let store = seed();
const mockFirst = new Map<string, Array<{ locationCode: string; sku: string; lot: string; qty: number }>>();
export const resetStock = () => {
  store = seed();
  mockFirst.clear();
};

function guard(request: Request, cdcId: string) {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.centers.includes(cdcId)) return problem(403, 'FORBIDDEN');
  return null;
}

const NEXT: Readonly<Record<string, Readonly<Record<string, Location['state']>>>> = {
  ACTIVATE: { DRAFT: 'ACTIVE', INACTIVE: 'ACTIVE' },
  BLOCK: { ACTIVE: 'BLOCKED' },
  UNBLOCK: { BLOCKED: 'ACTIVE' },
  DEACTIVATE: { ACTIVE: 'INACTIVE', BLOCKED: 'INACTIVE' },
  RETIRE: { DRAFT: 'RETIRED' },
};

/** product-service 목 — GET /products?q=<SKU>(SKU 코드 완전 일치) */
const productNames: Readonly<Record<string, string>> = {
  'SKU-1001': '냉동 만두 1kg',
  'SKU-1002': '냉장 우유 900ml',
  'SKU-1003': '생수 2L 6입',
  'SKU-2001': '양파 3kg',
};

export const stockHandlers = [
  http.get(`${API_BASE}/skus/:sku`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const sku = String(params.sku);
    if (!productNames[sku]) return problem(404, 'NOT_FOUND');
    const frozen = sku === 'SKU-1001';
    return HttpResponse.json({
      sku,
      productId: `PRD-${sku}`,
      baseProductId: `PRD-${sku}`,
      unitType: 'E',
      unitsPerSku: 1,
      weightG: 1050,
      netContent: { amount: 1000, unit: 'G' },
      saleState: 'ON_SALE',
      barcodes: ['8801234567890'],
      shelfLifeGuarantee: { minRemainingDays: 30 },
      logistics: { unitsPerBox: 12, boxesPerPallet: 40, ti: 8, hi: 5, storageType: frozen ? 'FROZEN' : 'CHILLED' },
      version: 1,
    });
  }),
  http.get(`${API_BASE}/products`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const name = productNames[q];
    return HttpResponse.json({ items: name ? [{ productId: `PRD-${q}`, internalName: name, saleState: 'ON_SALE', version: 1 }] : [], page: { nextCursor: null, size: 1 } });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/stock-snapshot`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const sku = q.get('sku');
    const withPlaces = q.get('withPlaces') === 'true';
    const items = store.stock
      .filter((a) => !sku || a.sku === sku)
      .map((a) => ({ ...a, productName: productNames[a.sku ?? ''] ?? null }))
      .map((a) => (withPlaces ? a : { ...a, lots: (a.lots ?? []).map(({ locations: _l, ...lot }) => (void _l, lot)) }));
    return HttpResponse.json({ snapshotId: 'SNAP-mock', cdcId: params.cdcId, asOf, items });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/recount-holds`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const state = new URL(request.url).searchParams.get('state');
    return HttpResponse.json({ items: store.holds.filter((h) => !state || h.state === state) });
  }),

  http.post(`${API_BASE}/cdcs/:cdcId/recount-holds/:holdId/releases`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { reason?: string };
    return idempotent(request, () => {
      const h = store.holds.find((x) => x.holdId === params.holdId);
      if (!h) return problem(404, 'NOT_FOUND');
      if (!body.reason) return problem(400, 'VALIDATION_FAILED', [{ field: 'reason', reason: 'REQUIRED' }]);
      if (h.state === 'HELD') {
        h.state = 'RELEASED';
        h.releasedAt = new Date().toISOString();
        h.releaseReason = body.reason;
        h.releasedBy = operator(request)?.subject ?? null;
      }
      return { status: 200, body: h };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/sku-handlings`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const enabled = new URL(request.url).searchParams.get('enabled');
    const items = store.handlings.filter((h) => enabled === null || String(h.handlingEnabled) === enabled);
    return HttpResponse.json({ centerId: params.cdcId, items, page: { nextCursor: null, size: items.length } });
  }),

  http.post(`${API_BASE}/cdcs/:cdcId/sku-handlings`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { sku: string; enabled: boolean; reason?: string };
    return idempotent(request, () => {
      const h = store.handlings.find((x) => x.sku === body.sku);
      if (!h) return problem(404, 'SKU_NOT_FOUND');
      const expected = expectedVersion(request);
      if (expected !== undefined && expected !== h.version) return problem(409, 'VERSION_CONFLICT');
      if (body.enabled && h.skuState === 'INACTIVE') return problem(422, 'SKU_INACTIVE');
      const changed = h.handlingEnabled !== body.enabled;
      if (changed) {
        h.handlingEnabled = body.enabled;
        h.version += 1;
        h.changedBy = operator(request)?.subject ?? null;
        h.reason = body.reason ?? null;
        h.updatedAt = new Date().toISOString();
      }
      return { status: 200, body: { status: 'APPLIED', requestId: 'req-mock', changed, occurredAt: new Date().toISOString(), handling: h } };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/locations`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const f = (k: string, v: string | undefined) => !q.get(k) || q.get(k) === v;
    const items = store.locations.filter(
      (x) => f('temperatureZone', x.temperatureZone) && f('area', x.parts?.area) && f('floor', x.parts?.floor) && f('locationType', x.locationType) && f('state', x.state),
    );
    return HttpResponse.json({ items, page: { nextCursor: null, size: items.length } });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/locations/:code`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const x = store.locations.find((l) => l.locationCode === params.code);
    return x ? HttpResponse.json(x) : problem(404, 'NOT_FOUND');
  }),

  http.post(`${API_BASE}/cdcs/:cdcId/locations/:code/state-changes`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { action: string; reason?: string; approvalRef?: string };
    return idempotent(request, () => {
      const x = store.locations.find((l) => l.locationCode === params.code);
      if (!x) return problem(404, 'NOT_FOUND');
      const expected = expectedVersion(request);
      if (expected !== undefined && expected !== x.version) return problem(409, 'VERSION_CONFLICT');
      const to = NEXT[body.action]?.[x.state ?? ''];
      if (!to) return problem(409, 'INVALID_STATE');
      if (body.action === 'RETIRE' && !body.approvalRef) return problem(422, 'APPROVAL_REQUIRED');
      x.state = to;
      x.version = (x.version ?? 0) + 1;
      x.updatedAt = new Date().toISOString();
      return { status: 202, body: { status: 'APPLIED', requestId: 'req-mock' } };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/location-stocks`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const prefix = q.get('locationPrefix') ?? '';
    const limit = Number(q.get('limit') ?? '500');
    const rows = store.stock
      .flatMap((a) => (a.lots ?? []).flatMap((lot) => (lot.locations ?? []).map((p) => ({ locationCode: p.locationCode ?? '', sku: a.sku ?? '', lot: lot.lot ?? '', qualityState: p.qualityState ?? 'RELEASED', onHand: p.onHand ?? 0, reserved: p.reserved ?? 0, expiresAt: lot.expiresAt ?? null }))))
      .filter((r) => r.locationCode.startsWith(prefix))
      .sort((x, y) => x.locationCode.localeCompare(y.locationCode) || x.sku.localeCompare(y.sku));
    return HttpResponse.json({ cdcId: params.cdcId, asOf, truncated: rows.length > limit, items: rows.slice(0, limit) });
  }),

  http.post(`${API_BASE}/cdcs/:cdcId/count-sessions`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { locationCodes: string[]; reason?: string };
    return idempotent(request, () => {
      if (body.locationCodes.some((c) => c.split('-')[3] === '91')) return problem(400, 'STAGING_NOT_COUNTED');
      if (store.counts.some((s) => ['COUNTING', 'RECOUNT_REQUIRED', 'PENDING_APPROVAL'].includes(s.state ?? '') && s.locationCodes?.some((c) => body.locationCodes.includes(c))))
        return problem(409, 'COUNT_IN_PROGRESS');
      store.cseq += 1;
      const s: Inv['schemas']['CountSession'] = {
        sessionId: `CNT-${String(store.cseq).padStart(4, '0')}`,
        cdcId: String(params.cdcId),
        state: 'COUNTING',
        locationCodes: body.locationCodes,
        sheet: body.locationCodes.flatMap((code) => store.stock.flatMap((a) => (a.lots ?? []).filter((l) => l.locations?.some((p) => p.locationCode === code)).map((l) => ({ locationCode: code, sku: a.sku ?? '', lot: l.lot ?? '' })))),
        startedBy: operator(request)?.subject ?? '',
        firstCounterId: null,
        recounterId: null,
        decidedBy: null,
        reason: body.reason ?? null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
      };
      store.counts.push(s);
      return { status: 201, body: s };
    });
  }),

  // 실사 목록(0.12.0 CS-1)
  http.get(`${API_BASE}/cdcs/:cdcId/count-sessions`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const sp = new URL(request.url).searchParams;
    const state = sp.get('state');
    const num = sp.get('number')?.replace(/^C/i, '');
    const rows = store.counts.filter((x) => (!state || x.state === state) && (!num || x.sessionNumber?.replace(/^C/i, '') === num));
    return HttpResponse.json({ items: rows, page: 0, size: 50, hasNext: false });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/count-sessions/:sessionId`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const s = store.counts.find((x) => x.sessionId === params.sessionId);
    return s ? HttpResponse.json(s) : problem(404, 'NOT_FOUND');
  }),

  // 첫 계수·재계수 — 장부(목: stock 의 칸 현물)와 같으면 MATCHED
  http.post(`${API_BASE}/cdcs/:cdcId/count-sessions/:sessionId/:step`, async ({ request, params }) => {
    const step = String(params.step);
    if (step !== 'counts' && step !== 'recounts') return undefined;
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { lines: Array<{ locationCode: string; sku: string; lot: string; qty: number }> };
    return idempotent(request, () => {
      const sess = store.counts.find((x) => x.sessionId === params.sessionId);
      if (!sess) return problem(404, 'NOT_FOUND');
      const me = operator(request)?.subject ?? '';
      if (step === 'counts' && sess.state !== 'COUNTING') return problem(409, 'INVALID_STATE');
      if (step === 'recounts' && sess.state !== 'RECOUNT_REQUIRED') return problem(409, 'INVALID_STATE');
      if (step === 'recounts' && sess.firstCounterId === me) return problem(409, 'SAME_COUNTER');
      const book = (x: { locationCode: string; sku: string; lot: string }) =>
        store.stock.find((a) => a.sku === x.sku)?.lots?.find((l) => l.lot === x.lot)?.locations?.find((l) => l.locationCode === x.locationCode)?.onHand ?? 0;
      const same = body.lines.every((x) => x.qty === book(x));
      if (step === 'counts') {
        sess.firstCounterId = me;
        mockFirst.set(sess.sessionId ?? '', body.lines);
        sess.state = same ? 'MATCHED' : 'RECOUNT_REQUIRED';
      } else {
        sess.recounterId = me;
        sess.state = same ? 'MATCHED' : 'PENDING_APPROVAL';
      }
      if (sess.state === 'MATCHED' || sess.state === 'PENDING_APPROVAL') {
        const first = mockFirst.get(sess.sessionId ?? '') ?? body.lines;
        sess.lines = body.lines.map((x) => ({ ...x, bookQty: book(x), firstQty: first.find((f) => f.locationCode === x.locationCode && f.sku === x.sku && f.lot === x.lot)?.qty ?? x.qty, finalQty: x.qty, deltaQty: x.qty - book(x) }));
      }
      return { status: 200, body: sess };
    });
  }),

  http.post(`${API_BASE}/cdcs/:cdcId/count-sessions/:sessionId/decisions`, async ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const body = (await request.json()) as { decision: 'APPROVE' | 'REJECT'; reason: string };
    return idempotent(request, () => {
      const s = store.counts.find((x) => x.sessionId === params.sessionId);
      if (!s) return problem(404, 'NOT_FOUND');
      if (s.state !== 'PENDING_APPROVAL') return problem(409, 'INVALID_STATE');
      const me = operator(request)?.subject;
      if (me && [s.startedBy, s.firstCounterId, s.recounterId].includes(me)) return problem(422, 'SELF_APPROVAL');
      s.state = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      s.decidedBy = me ?? null;
      s.decidedAt = new Date().toISOString();
      s.lines = (s.sheet ?? []).map((x) => ({ ...x, bookQty: 30, firstQty: 27, finalQty: 28, deltaQty: -2 }));
      return { status: 200, body: s };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/aisle-pick-methods`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    return HttpResponse.json({ items: store.aisles });
  }),
];
