// 배정 목: mfc-capacity-service 0.14.0 `/assignments`(목록·수동 배정), `/assignment-plans*`(추천 계산·조회·확정, 0.22.0 commit: true = 작업 시작).
// 서버 규칙 중 화면이 보여 줄 것만: 그 센터 권한, 관리 = MFC_SUPERVISOR, 기본 ACTIVE, X-Expected-Version = 지금 활성 담당 버전(없으면 0),
// 작업자 적격(등록·재직·업무 — 422 코드), 같은 사람이면 변화 없음(200), 지금 적격 여부(workerEligibility), 추천은 READY 작업만 · 확정 때 다시 확인(409 PLAN_STALE).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { db, nextSeq, timestamp, type MockAssignment, type MockPlan, type TaskType } from './db';
import { expectedVersion, idempotent, operator, problem, unauthorized } from './support';
import { effective } from './workerHandlers';

const canAccess = (request: Request, mfcId: string) => operator(request)?.centers.includes(mfcId) ?? false;
const isSupervisor = (request: Request) => operator(request)?.roles.includes('MFC_SUPERVISOR') ?? false;
const seoulDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));

/** 지금 적격 여부(null = 적격) */
function eligibility(mfcId: string, workerId: string, taskType: string): string | null {
  const w = db.workers.get(`${mfcId}/${workerId}`);
  if (!w) return 'WORKER_NOT_REGISTERED';
  if (w.state !== 'ACTIVE') return 'WORKER_NOT_ACTIVE';
  if (!effective(w).includes(taskType as TaskType)) return 'DUTY_NOT_ALLOWED';
  return null;
}

const withEligibility = (a: MockAssignment) => ({ planId: null, detail: null, ...a, workerEligibility: eligibility(a.mfcId, a.workerId, a.taskType) });
const activeOf = (mfcId: string, taskId: string) => db.assignments.find((a) => a.mfcId === mfcId && a.taskId === taskId && a.state === 'ACTIVE');

export const assignmentHandlers = [
  http.get(`${API_BASE}/assignments`, ({ request }) => {
    if (!operator(request)) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId') ?? '';
    if (!canAccess(request, mfcId)) return problem(403, 'FORBIDDEN');
    const state = q.get('state') ?? 'ACTIVE';
    const items = db.assignments
      .filter((a) => a.mfcId === mfcId && a.state === state)
      .filter((a) => !q.get('workerId') || a.workerId === q.get('workerId'))
      .filter((a) => !q.get('taskId') || a.taskId === q.get('taskId'))
      .filter((a) => !q.get('date') || seoulDate(a.assignedAt) === q.get('date'))
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))
      .map(withEligibility);
    return HttpResponse.json({ asOf: { asOf: timestamp(), freshness: 'CURRENT' }, items });
  }),

  http.post(`${API_BASE}/assignments`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as { mfcId: string; taskId: string; taskType: string; workerId: string; reason?: string };
    if (!canAccess(request, body.mfcId) || !isSupervisor(request)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      const current = activeOf(body.mfcId, body.taskId);
      if (expectedVersion(request) !== (current?.assignmentVersion ?? 0)) return problem(409, 'VERSION_CONFLICT');
      if (current?.workerId === body.workerId) return { status: 200, body: withEligibility(current) };
      const notOk = eligibility(body.mfcId, body.workerId, body.taskType);
      if (notOk) return problem(422, notOk);
      if (current) db.assignments = db.assignments.map((a) => (a === current ? { ...a, state: 'SUPERSEDED' } : a));
      const next: MockAssignment = {
        assignmentId: `ASG-${nextSeq()}`,
        mfcId: body.mfcId,
        taskId: body.taskId,
        taskType: body.taskType,
        workerId: body.workerId,
        assignmentVersion: (current?.assignmentVersion ?? 0) + 1,
        state: 'ACTIVE',
        assignedAt: timestamp(),
        source: 'MANUAL',
        assignedBy: operator(request)?.subject ?? null,
        // 근무를 등록하지 않은 작업자 — 목은 늘 근무 밖 경고(막지 않음)
        warnings: [...db.shifts.values()].some((s) => s.workerId === body.workerId && s.state === 'PLANNED') ? [] : ['OFF_SHIFT'],
      };
      db.assignments = [...db.assignments, next];
      // fulfillment 작업 목록의 담당 투영도 맞춘다(실서버는 배정 사건으로 잠깐 뒤에 바뀐다)
      const task = db.tasks.get(body.taskId);
      if (task) db.tasks.set(body.taskId, { ...task, state: task.state === 'READY' ? 'ASSIGNED' : task.state, assignment: { workerId: body.workerId, assignmentVersion: next.assignmentVersion } });
      return { status: 201, body: withEligibility(next) };
    });
  }),

  http.post(`${API_BASE}/assignment-plans`, async ({ request }) => {
    if (!operator(request)) return unauthorized();
    const body = (await request.json()) as { mfcId: string; horizonMinutes: number; commit?: boolean };
    if (!canAccess(request, body.mfcId) || !isSupervisor(request)) return problem(403, 'FORBIDDEN');
    if (!(body.horizonMinutes >= 10 && body.horizonMinutes <= 480)) return problem(400, 'VALIDATION_FAILED', [{ field: 'horizonMinutes', reason: 'INVALID_FORMAT' }]);
    return idempotent(request, () => {
      const start = Date.now();
      const ready = [...db.tasks.values()].filter((t) => t.mfcId === body.mfcId && t.state === 'READY');
      const workers = [...db.workers.values()].filter((w) => w.mfcId === body.mfcId && w.state === 'ACTIVE');
      const items: NonNullable<MockPlan['items']> = [];
      const unassigned: NonNullable<MockPlan['unassigned']> = [];
      for (const t of ready) {
        const w = workers.find((x) => effective(x).includes(t.taskType as TaskType));
        if (!w) {
          unassigned.push({ taskId: t.taskId, taskType: t.taskType, reason: 'NO_ELIGIBLE_WORKER' });
          continue;
        }
        items.push({
          taskId: t.taskId,
          taskType: t.taskType,
          taskVersion: t.version,
          workerId: w.workerId,
          dutyVersion: w.duties[0]!.dutyVersion,
          startAt: new Date(start).toISOString(),
          endAt: new Date(start + 7 * 60_000).toISOString(),
          lateMinutes: 0,
        });
      }
      const plan: MockPlan = {
        planId: `PLAN-${nextSeq()}`,
        inputHash: 'mock-hash',
        mfcId: body.mfcId,
        state: items.length ? 'PROPOSED' : 'NO_SOLUTION',
        solverStatus: items.length ? 'OPTIMAL' : 'INFEASIBLE',
        horizonStart: new Date(start).toISOString(),
        horizonMinutes: body.horizonMinutes,
        items,
        unassigned,
        objective: { unassignedCount: unassigned.length, lateMinutes: 0, maxWorkerLoadMinutes: 7, objectiveValue: 7, wallTimeMs: 120 },
        staleReasons: [],
        settings: {},
        availabilityUnverifiedWorkers: workers.filter((w) => ![...db.shifts.values()].some((s) => s.workerId === w.workerId)).map((w) => w.workerId),
        limitations: ['TRAVEL_ESTIMATED'],
        assignments: [],
        createdBy: operator(request)?.subject ?? '',
        createdAt: timestamp(),
        committedBy: null,
        committedAt: null,
      };
      // (0.22.0) commit: true = "작업 시작" — 추천이 되면 바로 확정(배정)
      if (body.commit && plan.state === 'PROPOSED') {
        const committed = commitPlan(plan, operator(request)?.subject ?? null);
        return { status: 201, body: committed };
      }
      db.plans.set(plan.planId, plan);
      return { status: 201, body: plan };
    });
  }),

  http.get(`${API_BASE}/assignment-plans/:planId`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const plan = db.plans.get(String(params.planId));
    if (!plan) return problem(404, 'NOT_FOUND');
    if (!canAccess(request, plan.mfcId)) return problem(403, 'FORBIDDEN');
    return HttpResponse.json(plan);
  }),

  // 확정: 항목마다 다시 확인 — 하나라도 어긋나면 아무것도 배정하지 않고 STALE + 409 PLAN_STALE
  http.post(`${API_BASE}/assignment-plans/:planId/commits`, ({ request, params }) => {
    if (!operator(request)) return unauthorized();
    const plan = db.plans.get(String(params.planId));
    if (!plan) return problem(404, 'NOT_FOUND');
    if (!canAccess(request, plan.mfcId) || !isSupervisor(request)) return problem(403, 'FORBIDDEN');
    return idempotent(request, () => {
      if (plan.state === 'COMMITTED') return { status: 200, body: plan };
      if (plan.state !== 'PROPOSED') return problem(409, 'INVALID_STATE');
      const stale = (plan.items ?? []).filter((i) => {
        const t = db.tasks.get(i.taskId ?? '');
        return !t || t.state !== 'READY' || t.version !== i.taskVersion || !!activeOf(plan.mfcId, i.taskId ?? '');
      });
      if (stale.length) {
        db.plans.set(plan.planId, { ...plan, state: 'STALE', staleReasons: stale.map((i) => `TASK_CHANGED:${i.taskId ?? ''}`) });
        return problem(409, 'PLAN_STALE');
      }
      return { status: 200, body: commitPlan(plan, operator(request)?.subject ?? null) };
    });
  }),
];

/** 추천 확정 — 배정을 만들고 작업 목록 담당 투영도 맞춘다 */
function commitPlan(plan: MockPlan, by: string | null): MockPlan {
      const made: MockAssignment[] = (plan.items ?? []).map((i) => ({
        assignmentId: `ASG-${nextSeq()}`,
        mfcId: plan.mfcId,
        taskId: i.taskId ?? '',
        taskType: i.taskType ?? '',
        workerId: i.workerId ?? '',
        assignmentVersion: 1,
        state: 'ACTIVE',
        assignedAt: timestamp(),
        source: 'PLAN',
        planId: plan.planId,
        assignedBy: by,
        warnings: [],
      }));
      db.assignments = [...db.assignments, ...made];
      for (const a of made) {
        const task = db.tasks.get(a.taskId);
        if (task) db.tasks.set(a.taskId, { ...task, state: task.state === 'READY' ? 'ASSIGNED' : task.state, assignment: { workerId: a.workerId, assignmentVersion: a.assignmentVersion } });
      }
      const next: MockPlan = { ...plan, state: 'COMMITTED', assignments: made.map(withEligibility), committedBy: by, committedAt: timestamp() };
      db.plans.set(next.planId, next);
      return next;
}
