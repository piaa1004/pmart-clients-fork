// cdc-outbound 목(계약 0.13.0): TRF 목록·상세, Wave 만들기·조회·릴리스, 작업 목록·상세. 칠곡 DC CDC01 시연 값(가짜 — 실서버는 TRF 0건일 수 있다).
// 판정은 계약 설명대로 흉내 낸다: Wave 에는 확보(ALLOCATED·PARTIALLY_ALLOCATED)되고 다른 Wave 에 없는 TRF 만, 릴리스는 PLANNED·기대 버전이 맞을 때만.
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import type { components } from '../api/generated/cdc-outbound';
import { idempotent, operator, problem, unauthorized, expectedVersion } from './support';

type TransferDetail = components['schemas']['TransferDetail'];
type Wave = components['schemas']['Wave'];
type Task = components['schemas']['Task'];

const CDC = 'CDC01';
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 26, h - 9, m)).toISOString(); // 2026-11-26 서울 h:m

/** 화면 번호(ADR-0070·0085 — W+4, 무작위·바뀌지 않음) */
const TRF_NUMBERS: Record<string, string> = {
  'TRF-20261126-0001': 'T482913',
  'TRF-20261126-0002': 'T771204',
  'TRF-20261126-0003': 'T305518',
  'TRF-20261126-0004': 'T640271',
  'TRF-20261126-0005': 'T118835',
  'TRF-20261126-0006': 'T927460',
  'TRF-20261125-0009': 'T553019',
};
/** 화면 번호 맞추기(목) — 앞 글자 없이 숫자만도, 대소문자 무시 */
const sameNumber = (n: string | null | undefined, q: string) => !!n && n.replace(/^[A-Za-z]/, '').toUpperCase() === q.trim().replace(/^[A-Za-z]/, '').toUpperCase();
const WAVE_NUMBERS: Record<string, string> = { 'WAVE-20261126-01': 'W4821', 'WAVE-20261126-02': 'W1937' };

function trf(id: string, mfcId: string, state: string, due: string, lines: Array<[string, number, number, number, number]>, waveId: string | null = null, allocationError: string | null = null): TransferDetail {
  const s = (i: number) => lines.reduce((a, l) => a + (l[i] as number), 0);
  return {
    trfId: id,
    trfNumber: TRF_NUMBERS[id] ?? null,
    trfVersion: 1,
    mfcId,
    state,
    deadlineMeaning: 'ARRIVAL',
    dueAt: due,
    waveId,
    waveNumber: waveId ? (WAVE_NUMBERS[waveId] ?? null) : null,
    allocationError,
    lineCount: lines.length,
    approvedQty: s(1),
    allocatedQty: s(2),
    pickedQty: s(3),
    shortQty: s(4),
    createdAt: at(6),
    updatedAt: at(7),
    lines: lines.map(([sku, approvedQty, allocatedQty, pickedQty, shortQty]) => ({ sku, approvedQty, allocatedQty, pickedQty, shortQty })),
  };
}

function seed() {
  const transfers: TransferDetail[] = [
    trf('TRF-20261126-0001', 'MFC-BJG-01', 'PICKING', at(9), [['SKU-1001', 40, 40, 32, 0], ['SKU-1002', 24, 24, 20, 2]], 'WAVE-20261126-01'),
    trf('TRF-20261126-0002', 'MFC-BNG-01', 'PICKING', at(9, 30), [['SKU-1001', 30, 30, 10, 0]], 'WAVE-20261126-01'),
    trf('TRF-20261126-0003', 'MFC-MOKPO-01', 'IN_WAVE', at(10), [['SKU-2001', 12, 12, 0, 0]], 'WAVE-20261126-02'),
    trf('TRF-20261126-0004', 'MFC-SEJ-01', 'ALLOCATED', at(11), [['SKU-3001', 20, 20, 0, 0], ['SKU-3002', 8, 8, 0, 0]]),
    trf('TRF-20261126-0005', 'MFC-CHC-01', 'PARTIALLY_ALLOCATED', at(12), [['SKU-3001', 50, 36, 0, 0]]),
    trf('TRF-20261126-0006', 'MFC-BJG-01', 'ALLOCATION_FAILED', at(13), [['SKU-9001', 6, 0, 0, 0]], null, 'NO_ELIGIBLE_STOCK'),
  ];
  const waves: Wave[] = [
    {
      waveId: 'WAVE-20261126-01', waveNumber: 'W4821',
      cdcId: CDC,
      state: 'IN_PROGRESS',
      version: 3,
      trfIds: ['TRF-20261126-0001', 'TRF-20261126-0002'],
      taskSummary: { total: 3, done: 1, exception: 0 },
      createdAt: at(7),
      releasedAt: at(7, 30),
    },
    { waveId: 'WAVE-20261126-02', waveNumber: 'W1937', cdcId: CDC, state: 'PLANNED', version: 1, trfIds: ['TRF-20261126-0003'], taskSummary: { total: 0, done: 0, exception: 0 }, createdAt: at(8) },
  ];
  const tasks: Task[] = [
    {
      taskId: 'TSK-0001',
      taskNumber: 'K20481',
      waveId: 'WAVE-20261126-01', waveNumber: 'W4821',
      trfId: null,
      trfIds: ['TRF-20261126-0001', 'TRF-20261126-0002'],
      pickMode: 'REGION_BATCH',
      pickMethod: 'FC',
      regionCode: 'BUSAN',
      kind: 'PICK',
      zone: 'A',
      floor: '5',
      dueAt: at(9),
      state: 'IN_PROGRESS',
      version: 2,
      assigneeId: 'cdcw-fc-01',
      lines: [
        {
          sku: 'SKU-1001',
          lot: 'LOT-A1',
          locationCode: 'CDC01-A-5-03-02',
          plannedQty: 70,
          pickedQty: 42,
          shortQty: 0,
          shares: [
            { trfId: 'TRF-20261126-0001', trfNumber: 'T482913', mfcId: 'MFC-BJG-01', dueAt: at(9), plannedQty: 40, pickedQty: 32, shortQty: 0 },
            { trfId: 'TRF-20261126-0002', trfNumber: 'T771204', mfcId: 'MFC-BNG-01', dueAt: at(9, 30), plannedQty: 30, pickedQty: 10, shortQty: 0 },
          ],
        },
      ],
      createdAt: at(7, 30),
    },
    {
      taskId: 'TSK-0002',
      taskNumber: 'K53902',
      waveId: 'WAVE-20261126-01', waveNumber: 'W4821',
      trfId: 'TRF-20261126-0001',
      trfIds: ['TRF-20261126-0001'],
      pickMode: 'DISCRETE',
      pickMethod: 'DPS',
      aisle: '07',
      kind: 'PICK',
      zone: 'B',
      floor: '6',
      dueAt: at(9),
      state: 'PARTIAL',
      version: 3,
      assigneeId: 'cdcw-dl-02',
      lines: [{ sku: 'SKU-1002', lot: 'LOT-B7', locationCode: 'CDC01-B-6-07-01', plannedQty: 24, pickedQty: 20, shortQty: 2, shortReason: 'NOT_FOUND' }],
      createdAt: at(7, 30),
    },
    {
      taskId: 'TSK-0003',
      taskNumber: 'K71136',
      waveId: 'WAVE-20261126-01', waveNumber: 'W4821',
      trfId: 'TRF-20261126-0002',
      trfIds: ['TRF-20261126-0002'],
      pickMode: 'DISCRETE',
      kind: 'PICK',
      zone: 'C',
      floor: '7',
      dueAt: at(9, 30),
      state: 'DONE',
      version: 4,
      assigneeId: 'cdcw-fc-03',
      lines: [{ sku: 'SKU-1003', lot: 'LOT-C2', locationCode: 'CDC01-C-7-01-01', plannedQty: 12, pickedQty: 12, shortQty: 0 }],
      createdAt: at(7, 30),
      completedAt: at(8, 10),
    },
    // 시작 전 작업(작업 조작 시연) — 계획 Wave 에 둔다(진행 중 Wave 의 집계·피킹 화면은 그대로)
    {
      taskId: 'TSK-0004',
      taskNumber: 'K48213',
      waveId: 'WAVE-20261126-02', waveNumber: 'W1937',
      trfId: 'TRF-20261126-0003',
      trfIds: ['TRF-20261126-0003'],
      pickMode: 'DISCRETE',
      kind: 'PICK',
      zone: 'B',
      floor: '6',
      priority: 0,
      dueAt: at(10),
      state: 'CREATED',
      version: 1,
      lines: [{ sku: 'SKU-1002', lot: 'LOT-B7', locationCode: 'CDC01-B-6-67-01-1-1', plannedQty: 8, pickedQty: 0, shortQty: 0 }],
      createdAt: at(8, 5),
    },
  ];
  const departures: components['schemas']['DepartureValidation'][] = [
    {
      departureId: 'DEP-0002',
      departureNumber: 'S240518',
      tripId: 'TRIP-0002',
      vehicleId: 'VH-11',
      source: 'SIMULATED',
      validatedAt: at(8, 40),
      overallResult: 'PARTIALLY_MATCHED',
      transfers: [
        { trfId: 'TRF-20261126-0001', trfNumber: 'T482913', result: 'MATCHED', departedQty: 52, postingStatus: 'APPLIED', residualStatus: 'DONE' },
        { trfId: 'TRF-20261126-0002', trfNumber: 'T771204', result: 'MISMATCHED', departedQty: 0, postingStatus: 'REJECTED', residualStatus: 'FAILED', residualReason: '409 INVALID_STATE' },
      ],
      mismatches: [{ kind: 'LPN_NOT_LOADED', lpn: 'BOX-00042', trfId: 'TRF-20261126-0002', detail: '검품 합격 BOX 가 상차되지 않음' }],
    },
    {
      departureId: 'DEP-0001',
      departureNumber: 'S108274',
      tripId: 'TRIP-0001',
      vehicleId: 'VH-07',
      source: 'SIMULATED',
      validatedAt: at(6, 10),
      overallResult: 'MATCHED',
      transfers: [{ trfId: 'TRF-20261125-0009', trfNumber: 'T553019', result: 'MATCHED', departedQty: 40, postingStatus: 'APPLIED', residualStatus: 'DONE' }],
      mismatches: [],
    },
    // 시뮬레이터가 만든 출발(화면 번호 없음 — 실서버에서 본 모양, 2026-11-26)
    {
      departureId: 'DEP-c5b97d11-901e-4788-8bff-d5544a6b4f57',
      tripId: 'TO-20261126-001',
      vehicleId: 'VH-5T-04A',
      source: 'SIMULATED',
      validatedAt: at(5, 20),
      overallResult: 'MATCHED',
      transfers: [{ trfId: 'TRF-SIM-MWXA84EQ', result: 'MATCHED', departedQty: 6, postingStatus: 'APPLIED', residualStatus: 'DONE' }],
      mismatches: [],
    },
  ];
  return { transfers, waves, tasks, departures, seq: 2 };
}

let store = seed();
type WaveLog = components['schemas']['WaveAdjustment'] & { waveId: string };
type TaskLog = components['schemas']['TaskAdjustment'] & { taskId: string };
const waveLog: WaveLog[] = [];
const taskLog: TaskLog[] = [];

export const resetOutbound = () => {
  store = seed();
  waveLog.length = 0;
  taskLog.length = 0;
};

const summary = (t: TransferDetail) => {
  const { lines, ...rest } = t;
  void lines;
  return rest;
};
const WAVEABLE = new Set(['ALLOCATED', 'PARTIALLY_ALLOCATED']);

/** 자기 센터 운영자만(토큰 centers 에 cdcId) */
function guard(request: Request, cdcId: string) {
  const who = operator(request);
  if (!who) return unauthorized();
  if (!who.centers.includes(cdcId)) return problem(403, 'FORBIDDEN');
  return null;
}

export const outboundHandlers = [
  http.get(`${API_BASE}/cdcs/:cdcId/transfers`, ({ request, params }) => {
    const cdcId = String(params.cdcId);
    const denied = guard(request, cdcId);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const state = q.get('state');
    const mfcId = q.get('mfcId');
    const number = q.get('number');
    const page = Number(q.get('page') ?? '0');
    const size = Number(q.get('size') ?? '50');
    const rows = (cdcId === CDC ? store.transfers : [])
      .filter((t) => (!state || t.state === state) && (!mfcId || t.mfcId === mfcId) && (!number || sameNumber(t.trfNumber, number)))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.trfId.localeCompare(b.trfId));
    return HttpResponse.json({ items: rows.slice(page * size, page * size + size).map(summary), page, size, hasNext: rows.length > (page + 1) * size });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/departures`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const result = q.get('result');
    const page = Number(q.get('page') ?? '0');
    const size = Number(q.get('size') ?? '50');
    const rows = store.departures.filter((d) => !result || d.overallResult === result);
    return HttpResponse.json({ items: rows.slice(page * size, page * size + size), page, size, hasNext: rows.length > (page + 1) * size });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/transfers/:trfId/readiness`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const t = store.transfers.find((x) => x.trfId === params.trfId);
    if (!t) return problem(404, 'NOT_FOUND');
    const stage = t.state === 'PICKING' ? 'PICKING' : t.state === 'PICKED' ? 'PICKED' : t.state === 'DEPARTED' ? 'DEPARTED' : 'NOT_STARTED';
    return HttpResponse.json({
      trfId: t.trfId,
      readiness: stage,
      readyLpnCount: t.pickedQty > 0 ? 3 : 0,
      readyQty: t.pickedQty,
      totalWeightG: t.pickedQty * 450,
      temperatureZones: ['FROZEN'],
      earliestReadyAt: null,
      blockers: t.shortQty > 0 ? ['SHORTAGE_REALLOCATING'] : [],
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/transfers/:trfId`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const t = store.transfers.find((x) => x.trfId === params.trfId);
    return t ? HttpResponse.json(t) : problem(404, 'NOT_FOUND');
  }),

  http.post(`${API_BASE}/waves`, async ({ request }) => {
    const body = (await request.json()) as { cdcId: string; trfIds: string[] };
    const denied = guard(request, body.cdcId);
    if (denied) return denied;
    return idempotent(request, () => {
      const picked = body.trfIds.map((id) => store.transfers.find((t) => t.trfId === id));
      if (picked.some((t) => !t)) return problem(409, 'INVALID_STATE');
      if (picked.some((t) => t!.waveId)) return problem(409, 'TRF_ALREADY_IN_WAVE');
      if (picked.some((t) => !WAVEABLE.has(t!.state))) return problem(409, 'INVALID_STATE');
      store.seq += 1;
      const wave: Wave = {
        waveId: `WAVE-20261126-${String(store.seq).padStart(2, '0')}`,
        waveNumber: `W${String(5000 + store.seq * 37).slice(-4)}`,
        cdcId: body.cdcId,
        state: 'PLANNED',
        version: 1,
        trfIds: [...body.trfIds],
        taskSummary: { total: 0, done: 0, exception: 0 },
        createdAt: new Date().toISOString(),
      };
      store.waves.push(wave);
      for (const t of picked) {
        t!.waveId = wave.waveId!;
        t!.waveNumber = wave.waveNumber ?? null;
        t!.state = 'IN_WAVE';
      }
      return { status: 201, body: wave };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/waves`, ({ request, params }) => {
    const cdcId = String(params.cdcId);
    const denied = guard(request, cdcId);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const state = q.get('state');
    const page = Number(q.get('page') ?? '0');
    const size = Number(q.get('size') ?? '50');
    const number = q.get('number');
    const rows = store.waves
      .filter((v) => v.cdcId === cdcId && (!state || v.state === state) && (!number || sameNumber(v.waveNumber, number)))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || (b.waveId ?? '').localeCompare(a.waveId ?? ''));
    return HttpResponse.json({ items: rows.slice(page * size, page * size + size), page, size, hasNext: rows.length > (page + 1) * size });
  }),

  http.get(`${API_BASE}/waves/:waveId`, ({ request, params }) => {
    const v = store.waves.find((x) => x.waveId === params.waveId);
    if (!v) return operator(request) ? problem(404, 'NOT_FOUND') : unauthorized();
    const denied = guard(request, v.cdcId ?? '');
    return denied ?? HttpResponse.json(v);
  }),

  http.post(`${API_BASE}/waves/:waveId/releases`, ({ request, params }) => {
    const v = store.waves.find((x) => x.waveId === params.waveId);
    if (!v) return operator(request) ? problem(404, 'NOT_FOUND') : unauthorized();
    const denied = guard(request, v.cdcId ?? '');
    if (denied) return denied;
    return idempotent(request, () => {
      if (v.state !== 'PLANNED') return problem(409, 'INVALID_STATE');
      const expected = expectedVersion(request);
      if (expected !== undefined && expected !== v.version) return problem(409, 'VERSION_CONFLICT');
      v.state = 'RELEASED';
      v.version = (v.version ?? 0) + 1;
      v.releasedAt = new Date().toISOString();
      const made: Task[] = (v.trfIds ?? []).map((trfId, i) => {
        const t = store.transfers.find((x) => x.trfId === trfId);
        return {
          taskId: `TSK-${v.waveId}-${i + 1}`,
          waveId: v.waveId!,
          trfId,
          trfIds: [trfId],
          pickMode: 'DISCRETE',
          kind: 'PICK',
          zone: 'A',
          floor: '5',
          dueAt: t?.dueAt ?? new Date().toISOString(),
          state: 'CREATED',
          version: 1,
          lines: (t?.lines ?? []).map((l) => ({ sku: l.sku, lot: 'LOT-NEW', locationCode: 'CDC01-A-5-01-01', plannedQty: l.allocatedQty, pickedQty: 0, shortQty: 0 })),
          createdAt: new Date().toISOString(),
        };
      });
      store.tasks.push(...made);
      v.taskSummary = { total: made.length, done: 0, exception: 0 };
      return { status: 202, body: { status: 'APPLIED', requestId: request.headers.get('Idempotency-Key') ?? '' } };
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/tasks`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const waveId = q.get('waveId');
    if (!waveId) return problem(400, 'VALIDATION_FAILED', [{ field: 'waveId', reason: 'REQUIRED' }]);
    const state = q.get('state');
    const size = Number(q.get('size') ?? '50');
    const from = Number(q.get('cursor') ?? '0');
    const rows = store.tasks.filter((t) => t.waveId === waveId && (!state || t.state === state));
    const next = from + size < rows.length ? String(from + size) : null;
    return HttpResponse.json({ items: rows.slice(from, from + size), page: { nextCursor: next, size } });
  }),

  // Wave 조작(0.22.0) — 목: 버전 확인·상태 조건만, 이력은 메모리
  http.post(`${API_BASE}/waves/:waveId/:op`, async ({ request, params }) => {
    const op = String(params.op);
    if (!['holds', 'resumptions', 'cancellations', 'merges', 'splits'].includes(op)) return undefined;
    const v = store.waves.find((x) => x.waveId === params.waveId);
    if (!v) return operator(request) ? problem(404, 'NOT_FOUND') : unauthorized();
    const denied = guard(request, v.cdcId ?? '');
    if (denied) return denied;
    const body = (await request.json().catch(() => ({}))) as { reason?: string; sourceWaveId?: string; trfIds?: string[] };
    const who = operator(request)?.subject ?? '';
    return idempotent(request, () => {
      const expected = expectedVersion(request);
      if (expected !== undefined && expected !== v.version) return problem(409, 'VERSION_CONFLICT');
      const from = v.state ?? '';
      const log = (action: string, w: Wave, other: string | null, trfIds: string[]) =>
        waveLog.push({ waveId: w.waveId ?? '', adjustmentId: `WA-${waveLog.length + 1}`, action, fromState: from, toState: w.state ?? '', otherWaveId: other, trfIds, reason: body.reason ?? null, actorId: who, adjustedAt: new Date().toISOString() });
      if (op === 'holds') {
        if (v.hold || !['PLANNED', 'RELEASED', 'IN_PROGRESS'].includes(from)) return problem(409, 'INVALID_STATE');
        v.hold = { reason: body.reason ?? '', heldBy: who, heldAt: new Date().toISOString() };
        log('HOLD', v, null, []);
      } else if (op === 'resumptions') {
        if (!v.hold) return problem(409, 'INVALID_STATE');
        delete v.hold;
        log('RESUME', v, null, []);
      } else if (op === 'cancellations') {
        if (from === 'IN_PROGRESS') return problem(409, 'PICKING_STARTED');
        if (from !== 'PLANNED' && from !== 'RELEASED') return problem(409, 'INVALID_STATE');
        v.state = 'CANCELLED';
        log('CANCEL', v, null, v.trfIds ?? []);
      } else if (op === 'merges') {
        const src = store.waves.find((x) => x.waveId === body.sourceWaveId);
        if (!src || src.state !== 'PLANNED' || from !== 'PLANNED') return problem(409, 'INVALID_STATE');
        v.trfIds = [...(v.trfIds ?? []), ...(src.trfIds ?? [])];
        src.state = 'CANCELLED';
        log('MERGE_IN', v, src.waveId ?? null, src.trfIds ?? []);
      } else {
        const move = body.trfIds ?? [];
        if (from !== 'PLANNED' || move.length === 0 || move.length >= (v.trfIds ?? []).length) return problem(409, 'INVALID_STATE');
        v.trfIds = (v.trfIds ?? []).filter((id) => !move.includes(id));
        const made: Wave = { waveId: `WAVE-SPLIT-${store.waves.length + 1}`, waveNumber: `W${String(7000 + store.waves.length * 41).slice(-4)}`, cdcId: v.cdcId ?? CDC, state: 'PLANNED', version: 1, trfIds: move, taskSummary: { total: 0, done: 0, exception: 0 }, createdAt: new Date().toISOString() };
        store.waves.push(made);
        v.version = (v.version ?? 0) + 1;
        log('SPLIT_OUT', v, made.waveId ?? null, move);
        return { status: 201, body: made };
      }
      v.version = (v.version ?? 0) + 1;
      return { status: 200, body: v };
    });
  }),
  http.get(`${API_BASE}/waves/:waveId/adjustments`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    return HttpResponse.json({ items: waveLog.filter((a) => a.waveId === params.waveId).reverse() });
  }),

  // 작업 조작(0.20.0)
  http.post(`${API_BASE}/cdcs/:cdcId/tasks/:taskId/:op`, async ({ request, params }) => {
    const op = String(params.op);
    if (!['reassignments', 'holds', 'resumptions', 'priority-changes'].includes(op)) return undefined;
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const t = store.tasks.find((x) => x.taskId === params.taskId);
    if (!t) return problem(404, 'NOT_FOUND');
    const body = (await request.json().catch(() => ({}))) as { reason?: string; workerId?: string | null; priority?: number };
    const who = operator(request)?.subject ?? '';
    return idempotent(request, () => {
      const expected = expectedVersion(request);
      if (expected !== undefined && expected !== t.version) return problem(409, 'VERSION_CONFLICT');
      const from = t.state ?? '';
      const fromAssignee = t.assigneeId ?? null;
      const fromPriority = t.priority ?? 0;
      const notStarted = ['CREATED', 'ASSIGNED', 'ACCEPTED'].includes(from);
      let action: string;
      if (op === 'reassignments') {
        if (!notStarted) return problem(409, 'INVALID_STATE');
        if (body.workerId) {
          t.assigneeId = body.workerId;
          t.state = 'ASSIGNED';
        } else {
          delete t.assigneeId;
          t.state = 'CREATED';
        }
        action = 'REASSIGN';
      } else if (op === 'holds') {
        if (!notStarted) return problem(409, 'INVALID_STATE');
        t.state = 'HELD';
        action = 'HOLD';
      } else if (op === 'resumptions') {
        if (from !== 'HELD') return problem(409, 'INVALID_STATE');
        t.state = 'CREATED';
        action = 'RESUME';
      } else {
        t.priority = body.priority ?? 0;
        action = 'PRIORITY';
      }
      t.version = (t.version ?? 0) + 1;
      taskLog.push({ taskId: t.taskId ?? '', adjustmentId: `TA-${taskLog.length + 1}`, action, fromState: from, toState: t.state ?? '', fromAssignee, toAssignee: t.assigneeId ?? null, fromPriority, toPriority: t.priority ?? 0, reason: body.reason ?? null, actorId: who, adjustedAt: new Date().toISOString() });
      return { status: 200, body: t };
    });
  }),
  http.get(`${API_BASE}/cdcs/:cdcId/tasks/:taskId/adjustments`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    return HttpResponse.json({ items: taskLog.filter((a) => a.taskId === params.taskId).reverse() });
  }),

  // 작업자 현황(0.18.0 M-1) — 목은 고정 3명(2명 최근 스캔, 1명 오래됨)
  http.get(`${API_BASE}/cdcs/:cdcId/workers`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const workers = [
      { workerId: 'OP-cdc-worker-1', locationCode: 'CDC01-G-5-63-01-2-1', zone: 'G', floor: '5', source: 'SCAN', scannedAt: '2026-11-26T00:28:00Z', locationState: 'FRESH', taskId: null, taskKind: null, taskState: null },
      { workerId: 'OP-cdc-worker-2', locationCode: 'CDC01-D-6-67-01-1-1', zone: 'D', floor: '6', source: 'PICK_RESULT', scannedAt: '2026-11-26T00:29:00Z', locationState: 'FRESH', taskId: null, taskKind: null, taskState: null },
      { workerId: 'OP-cdc-worker-3', locationCode: 'CDC01-G-5-61-01-1-1', zone: 'G', floor: '5', source: 'SCAN', scannedAt: '2026-11-25T23:00:00Z', locationState: 'STALE', taskId: null, taskKind: null, taskState: null },
    ];
    return HttpResponse.json({ asOf: '2026-11-26T00:30:00Z', workers, byFloor: [{ key: '5', count: 1 }, { key: '6', count: 1 }] });
  }),

  // LPN(0.19.0) — 목은 박스 2·롤테이너 1
  http.get(`${API_BASE}/cdcs/:cdcId/lpns`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const unit = q.get('unitType');
    const trf = q.get('trfId');
    const rows = [
      { lpn: 'RT-0001', trfId: 'TRF-20261126-0001', mfcId: 'MFC-BJG-01', waveId: 'WAVE-20261126-01', unitType: 'RT', parentLpn: null, sealState: 'SEALED', sealNo: 'SL-77', temperatureZone: 'AMBIENT', weightG: null, sortedBy: 'OP-cdc-worker-1', sortedAt: '2026-11-25T23:30:00Z', inspection: 'PASS', failReason: null, inspectedAt: '2026-11-25T23:35:00Z', loaded: true, tripId: 'TRIP-0002', vehicleId: 'VH-11', dockCode: 'D3', loadedAt: '2026-11-25T23:38:00Z', departureId: 'DEP-0002', contents: [] },
      { lpn: 'BOX-0001', trfId: 'TRF-20261126-0001', mfcId: 'MFC-BJG-01', waveId: 'WAVE-20261126-01', unitType: 'BOX', parentLpn: 'RT-0001', sealState: 'SEALED', sealNo: null, temperatureZone: 'AMBIENT', weightG: 6200, sortedBy: 'OP-cdc-worker-1', sortedAt: '2026-11-25T23:20:00Z', inspection: 'PASS', failReason: null, inspectedAt: '2026-11-25T23:35:00Z', loaded: true, tripId: 'TRIP-0002', vehicleId: 'VH-11', dockCode: 'D3', loadedAt: '2026-11-25T23:38:00Z', departureId: 'DEP-0002', contents: [{ sku: 'SKU-1003', lot: 'LOT-C2', qty: 12 }] },
      { lpn: 'BOX-0002', trfId: 'TRF-20261126-0002', mfcId: 'MFC-BNG-01', waveId: 'WAVE-20261126-01', unitType: 'BOX', parentLpn: null, sealState: 'UNSEALED', sealNo: null, temperatureZone: 'CHILLED', weightG: null, sortedBy: 'OP-cdc-worker-2', sortedAt: '2026-11-26T00:10:00Z', inspection: null, failReason: null, inspectedAt: null, loaded: false, tripId: null, vehicleId: null, dockCode: null, loadedAt: null, departureId: null, contents: [{ sku: 'SKU-1002', lot: 'LOT-B7', qty: 6 }] },
    ].filter((r) => (!unit || r.unitType === unit) && (!trf || r.trfId === trf));
    return HttpResponse.json({ items: rows, page: 0, size: 50, hasNext: false });
  }),

  // 피킹 부족 재할당(0.19.0) — 목은 1건 진행 중
  http.get(`${API_BASE}/cdcs/:cdcId/shortages`, ({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const state = new URL(request.url).searchParams.get('state');
    const rows = [
      { followupId: 'SF-1', trfId: 'TRF-20261126-0001', mfcId: 'MFC-BJG-01', waveId: 'WAVE-1', taskId: 'TASK-1', sku: 'SKU-1002', lot: 'LOT-B7', locationCode: 'CDC01-B-6-67-01-1-1', shortQty: 2, state: 'PENDING', reallocatedQty: 0, unresolvedQty: 2, newTaskIds: [], reason: null, createdAt: '2026-11-26T00:20:00Z', updatedAt: '2026-11-26T00:20:00Z' },
    ].filter((r) => !state || r.state === state);
    return HttpResponse.json({ items: rows, page: 0, size: 50, hasNext: false });
  }),

  // 그날 출고 집계 — 목은 날짜와 상관없이 지금 TRF·Wave·작업으로 센다
  http.get(`${API_BASE}/cdcs/:cdcId/outbound-summary`, ({ request, params }) => {
    const cdcId = String(params.cdcId);
    const denied = guard(request, cdcId);
    if (denied) return denied;
    const date = new URL(request.url).searchParams.get('date') ?? '2026-11-26';
    const count = (keys: string[]) => Object.entries(keys.reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {})).map(([key, n]) => ({ key, count: n }));
    const trfs = cdcId === CDC ? store.transfers : [];
    const total = (k: 'approvedQty' | 'allocatedQty' | 'pickedQty' | 'shortQty') => trfs.reduce((a, t) => a + t[k], 0);
    const approved = total('approvedQty');
    return HttpResponse.json({
      cdcId,
      date,
      transferCount: trfs.length,
      transfersByState: count(trfs.map((t) => t.state)),
      approvedQty: approved,
      allocatedQty: total('allocatedQty'),
      pickedQty: total('pickedQty'),
      shortQty: total('shortQty'),
      progress: approved === 0 ? null : total('pickedQty') / approved,
      wavesByState: count(store.waves.map((v) => v.state ?? '')),
      tasksByKindState: count(store.tasks.map((t) => `${t.kind}:${t.state}`)),
      byMfc: [...new Set(trfs.map((t) => t.mfcId))].sort().map((mfcId) => {
        const mine = trfs.filter((t) => t.mfcId === mfcId);
        const sum = (k: 'approvedQty' | 'allocatedQty' | 'pickedQty' | 'shortQty') => mine.reduce((a, t) => a + t[k], 0);
        return { mfcId, transferCount: mine.length, approvedQty: sum('approvedQty'), allocatedQty: sum('allocatedQty'), pickedQty: sum('pickedQty'), shortQty: sum('shortQty') };
      }),
      asOf: '2026-11-26T00:30:00Z',
    });
  }),

  http.get(`${API_BASE}/cdcs/:cdcId/tasks/:taskId`,({ request, params }) => {
    const denied = guard(request, String(params.cdcId));
    if (denied) return denied;
    const t = store.tasks.find((x) => x.taskId === params.taskId);
    return t ? HttpResponse.json(t) : problem(404, 'NOT_FOUND');
  }),
];
