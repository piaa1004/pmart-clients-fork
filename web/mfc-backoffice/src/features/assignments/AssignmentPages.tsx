// 배정 — mfc-capacity-service 0.14.0(요청서 mfc-backoffice/2026-11-15 §2·§2-1 "작업 배정·재배정, 배정 추천 계산·확정, 배정 목록").
// - 목록 `GET /assignments?mfcId=&date=&workerId=&taskId=&state=`(state 생략 = ACTIVE). 거르기·탭은 URL 쿼리. workerEligibility(지금 맡을 수 있나)는 서버 값.
// - 직접 배정 `POST /assignments` + X-Expected-Version = 지금 활성 담당 버전(없으면 0) — 화면은 "지금 담당 확인"으로 읽은 버전을 보낸다(그 사이 바뀌면 409).
//   같은 사람이면 서버가 바꾸지 않고 지금 배정을 돌려준다(버전이 그대로면 "바뀐 것 없음"). 근무 밖은 warnings OFF_SHIFT 로 알리기만.
// - 추천 `POST /assignment-plans` {mfcId, horizonMinutes} → 계획(PROPOSED 등) — 배정은 바뀌지 않는다. 확정 `POST …/{planId}/commits`(전부 또는 전무, 409 PLAN_STALE → 다시 읽어 낡은 이유).
// - 지난 추천 목록 `GET /assignment-plans?mfcId=&date=&state=`(MB-1) — 추천 탭 아래, 열기 = 추천 화면.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-capacity';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { SystemNumbers } from '../../shared/displayNumber';
import { Who } from '../../shared/OperatorLabel';
import { PlanList } from '../lists/CenterLists';
import { StartWork, UnassignedTasks } from './StartWork';

const m = messages.assignments;
const taskName = messages.workers.task;

/** 작업 칸 — 시스템 ID 대신 그 작업 상세로 가는 링크(ADR-0070 덧붙임: 목록에는 화면 표기만). 작업 현황에 상세가 있는 유형(피킹·포장·배차·복귀)만 링크 */
function TaskLink({ mfcId, taskId, taskType }: { readonly mfcId: string; readonly taskId: string | undefined; readonly taskType: string | undefined }) {
  if (!taskId || !['PICK', 'PACK', 'DISPATCH', 'RETURN'].includes(taskType ?? '')) return <>{messages.none}</>;
  return (
    <Link className="link" to={centerPath(mfcId, `tasks/${encodeURIComponent(taskId)}`)} data-testid="task-link">
      {m.openTask}
    </Link>
  );
}

type Cap = components['schemas'];
type Assignment = Cap['Assignment'];
type AssignmentState = NonNullable<Assignment['state']>;
type TaskType = Cap['TaskType'];
type Plan = Cap['AssignmentPlan'];

const STATES: readonly AssignmentState[] = ['ACTIVE', 'SUPERSEDED', 'RELEASED'];
const TASK_TYPES: readonly TaskType[] = ['PICK', 'PACK', 'RETURN', 'DISPATCH', 'RECEIVE', 'INSPECT', 'PUTAWAY', 'REPLENISH', 'MOVE'];
const isState = (v: string | null): v is AssignmentState => !!v && (STATES as readonly string[]).includes(v);
const isTaskType = (v: string | null): v is TaskType => !!v && (TASK_TYPES as readonly string[]).includes(v);
type Tab = 'list' | 'unassigned' | 'manual' | 'plan';

const assignmentsPath = (mfcId: string, rest = '') => centerPath(mfcId, rest ? `assignments/${rest}` : 'assignments');

/** `/c/:mfcId/assignments/*` */
export function AssignmentsMenu({ mfcId }: { readonly mfcId: string }) {
  return (
    <Routes>
      <Route index element={<AssignmentsHome mfcId={mfcId} />} />
      <Route path="plans/:planId" element={<PlanPage mfcId={mfcId} />} />
    </Routes>
  );
}

function AssignmentsHome({ mfcId }: { readonly mfcId: string }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = raw === 'manual' || raw === 'plan' || raw === 'unassigned' ? raw : 'list';
  const go = (next: Tab, extra: Record<string, string> = {}) => setParams(new URLSearchParams({ ...(next === 'list' ? {} : { tab: next }), ...extra }), { replace: true });
  return (
    <section className="space-y-4">
      <h1>{messages.menus.assignments}</h1>
      <p className="text-sm opacity-70">{m.intro}</p>
      {/* 작업 시작(capacity 0.22.0) — 누르면 추천대로 바로 배정. 바꾸기는 아래 목록·담당 없는 작업·직접 배정에서 */}
      <StartWork mfcId={mfcId} />
      <div role="tablist" className="tabs tabs-box w-fit">
        {(['list', 'unassigned', 'manual', 'plan'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'tab-active' : ''}`} onClick={() => go(t)}>
            {m.tabs[t]}
          </button>
        ))}
      </div>
      {tab === 'list' && <AssignmentList mfcId={mfcId} onReassign={(a) => go('manual', { taskId: a.taskId ?? '', taskType: a.taskType ?? '' })} />}
      {tab === 'manual' && <ManualAssign key={`${params.get('taskId') ?? ''}`} mfcId={mfcId} initialTaskId={params.get('taskId') ?? ''} initialTaskType={params.get('taskType')} />}
      {tab === 'unassigned' && <UnassignedTasks mfcId={mfcId} />}
      {tab === 'plan' && <PlanStart mfcId={mfcId} />}
    </section>
  );
}

// ---------------------------------------------------------------- 목록

function Eligibility({ code }: { readonly code: string | null | undefined }) {
  if (!code) return <span className="opacity-70">{m.eligible}</span>;
  return <span className="badge badge-sm badge-error">{m.notEligible(m.eligibilityCode[code] ?? code)}</span>;
}

function AssignmentList({ mfcId, onReassign }: { readonly mfcId: string; readonly onReassign: (a: Assignment) => void }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const rawState = params.get('state');
  const state = isState(rawState) ? rawState : undefined;
  const date = params.get('date') ?? '';
  const workerId = params.get('workerId') ?? '';
  const taskId = params.get('taskId') ?? '';
  const query = useQuery({
    queryKey: ['assignments', mfcId, state ?? 'ACTIVE', date, workerId, taskId],
    queryFn: () =>
      request(
        'GET',
        api.capacity.GET('/assignments', {
          params: { query: { mfcId, ...(state ? { state } : {}), ...(date ? { date } : {}), ...(workerId ? { workerId } : {}), ...(taskId ? { taskId } : {}) } },
        }),
      ),
  });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const rows = query.data?.items ?? [];
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-3 text-sm" onSubmit={(e) => e.preventDefault()}>
        <label className="flex flex-col gap-1">
          {m.filters.state}
          <select className="select select-sm w-32" value={state ?? 'ACTIVE'} onChange={(e) => set('state', e.target.value === 'ACTIVE' ? '' : e.target.value)}>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {m.state[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {m.filters.date}
          <input className="input input-sm w-40" type="date" value={date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {m.filters.worker}
          <input className="input input-sm w-36 font-mono" value={workerId} onChange={(e) => set('workerId', e.target.value.trim())} />
        </label>
        <label className="flex flex-col gap-1">
          {m.filters.task}
          <input className="input input-sm w-40 font-mono" value={taskId} onChange={(e) => set('taskId', e.target.value.trim())} />
        </label>
        {query.data?.asOf?.asOf && <span className="text-xs opacity-70">{m.asOf(formatSeoul(query.data.asOf.asOf))}</span>}
      </form>
      <p className="text-xs opacity-70">{m.eligibilityNote}</p>
      <QueryState state={toUiState(query, () => rows.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {() => (
          <table className="table table-sm rounded-box bg-base-100">
            <thead>
              <tr>
                <th>{m.fields.task}</th>
                <th>{m.fields.taskType}</th>
                <th>{m.fields.worker}</th>
                <th>{m.fields.version}</th>
                <th>{m.fields.source}</th>
                <th>{m.fields.assignedAt}</th>
                <th>{m.fields.warnings}</th>
                <th>{m.fields.eligibility}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.assignmentId} data-testid="assignment-row">
                  <td>
                    <TaskLink mfcId={mfcId} taskId={a.taskId} taskType={a.taskType} />
                  </td>
                  <td>{taskName[a.taskType ?? ''] ?? a.taskType}</td>
                  <td>
                    <Who id={a.workerId} />
                  </td>
                  <td>{a.assignmentVersion}</td>
                  <td>{m.source[a.source ?? ''] ?? a.source ?? messages.none}</td>
                  <td>{a.assignedAt ? formatSeoul(a.assignedAt) : messages.none}</td>
                  <td>{a.warnings?.length ? a.warnings.map((w) => m.warning[w] ?? w).join(', ') : messages.none}</td>
                  <td>
                    <Eligibility code={a.workerEligibility} />
                  </td>
                  <td>
                    {a.state === 'ACTIVE' && (
                      <button type="button" className="btn btn-xs" onClick={() => onReassign(a)}>
                        {m.reassign}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------- 직접 배정

function ManualAssign({ mfcId, initialTaskId, initialTaskType }: { readonly mfcId: string; readonly initialTaskId: string; readonly initialTaskType: string | null }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState(initialTaskId);
  const [taskType, setTaskType] = useState<TaskType>(isTaskType(initialTaskType) ? initialTaskType : 'PICK');
  const [workerId, setWorkerId] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  /** 확인한 지금 담당(이 작업 ID 의) — 이 버전으로 보낸다 */
  const [checked, setChecked] = useState<{ readonly taskId: string; readonly workerId: string | null; readonly version: number } | null>(null);
  const workers = useQuery({
    queryKey: ['workers', mfcId, 'ACTIVE'],
    queryFn: async () => (await request('GET', api.capacity.GET('/mfcs/{mfcId}/workers', { params: { path: { mfcId }, query: { state: 'ACTIVE' } } }))).items ?? [],
  });
  const check = useCommand(async (id: string) => {
    setNotice(null);
    const r = await request('GET', api.capacity.GET('/assignments', { params: { query: { mfcId, taskId: id } } }));
    const active = (r.items ?? [])[0];
    setChecked({ taskId: id, workerId: active?.workerId ?? null, version: active?.assignmentVersion ?? 0 });
    return r;
  });
  const assign = useCommand(async (_: null, key) => {
    setNotice(null);
    const version = checked?.version ?? 0;
    const r = await request(
      'POST',
      api.capacity.POST('/assignments', {
        ...commandParams(key, { version }),
        body: { mfcId, taskId, taskType, workerId, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      }),
    );
    const notes = [r.assignmentVersion === version ? m.unchanged : m.assigned(r.workerId ?? '', r.assignmentVersion ?? 0)];
    if (r.warnings?.includes('OFF_SHIFT')) notes.push(m.offShift);
    setNotice(notes.join(' '));
    setChecked(null);
    await queryClient.invalidateQueries({ queryKey: ['assignments', mfcId] });
    return r;
  });
  const ready = !!checked && checked.taskId === taskId && !!workerId;
  return (
    <form
      className="max-w-3xl space-y-3 rounded-box bg-base-100 p-4 text-sm"
      aria-label={m.tabs.manual}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        if (assign.phase.kind === 'rejected' || assign.phase.kind === 'done') assign.reset();
        void assign.run(null);
      }}
    >
      <p className="text-xs opacity-70">{m.manualHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          {m.filters.task}
          <input
            className="input input-sm w-48 font-mono"
            maxLength={96}
            value={taskId}
            onChange={(e) => {
              setTaskId(e.target.value.trim());
              setChecked(null);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          {m.fields.taskType}
          <select className="select select-sm w-32" value={taskType} onChange={(e) => setTaskType(e.target.value as TaskType)}>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {taskName[t]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!taskId || check.busy}
          onClick={() => {
            if (check.phase.kind !== 'idle' && check.phase.kind !== 'running') check.reset();
            void check.run(taskId);
          }}
        >
          {m.checkCurrent}
        </button>
      </div>
      {check.phase.kind === 'rejected' && <CommandFeedback command={check} />}
      {checked && checked.taskId === taskId && (
        <p data-testid="current-assignee">{checked.workerId ? m.current(checked.workerId, checked.version) : m.currentNone}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {workers.isError ? (
          <label className="flex flex-col gap-1">
            {m.chooseWorker}
            <input className="input input-sm w-48 font-mono" value={workerId} onChange={(e) => setWorkerId(e.target.value.trim())} />
            <span className="text-warning text-xs">{m.workersFailed}</span>
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            {m.chooseWorker}
            <select className="select select-sm w-56" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">{messages.none}</option>
              {(workers.data ?? []).map((w) => (
                <option key={w.workerId} value={w.workerId}>
                  {`${w.displayName ?? ''} (${w.workerId ?? ''})`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          {m.fields.reason}
          <input className="input input-sm w-64" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ready || assign.busy}>
          {m.assign}
        </button>
      </div>
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      <CommandFeedback command={assign} />
    </form>
  );
}

// ---------------------------------------------------------------- 추천

/** 지난 작업 시작(추천) 목록 — 사용자 결정 2026-11-19 로 "추천만 계산" 화면은 두지 않는다(작업 시작은 위 단추). 지난 것은 보기만 */
function PlanStart({ mfcId }: { readonly mfcId: string }) {
  const navigate = useNavigate();
  const [planId, setPlanId] = useState('');
  return (
    <div className="max-w-3xl space-y-3">
      <PlanList mfcId={mfcId} />
      <form
        className="flex flex-wrap items-end gap-2 rounded-box bg-base-100 p-4 text-sm"
        aria-label={m.openPlan}
        onSubmit={(e) => {
          e.preventDefault();
          if (planId) void navigate(assignmentsPath(mfcId, `plans/${encodeURIComponent(planId)}`));
        }}
      >
        <label className="flex flex-col gap-1">
          {m.planIdLabel}
          <input className="input input-sm w-48 font-mono" value={planId} onChange={(e) => setPlanId(e.target.value.trim())} />
        </label>
        <button type="submit" className="btn btn-sm" disabled={!planId}>
          {m.openPlan}
        </button>
      </form>
    </div>
  );
}

function PlanPage({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const { planId = '' } = useParams();
  const query = useQuery({
    queryKey: ['plan', planId],
    queryFn: () => request('GET', api.capacity.GET('/assignment-plans/{planId}', { params: { path: { planId } } })),
  });
  return (
    <section className="max-w-5xl space-y-4">
      <Link to={`${assignmentsPath(mfcId)}?tab=plan`} className="link text-sm">
        {m.tabs.plan}
      </Link>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(plan) => <PlanView mfcId={mfcId} plan={plan} />}
      </QueryState>
    </section>
  );
}

function PlanView({ mfcId, plan }: { readonly mfcId: string; readonly plan: Plan }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const planId = plan.planId ?? '';
  const [notice, setNotice] = useState<string | null>(null);
  const commit = useCommand(async (_: null, key) => {
    setNotice(null);
    try {
      const r = await request('POST', api.capacity.POST('/assignment-plans/{planId}/commits', { ...commandParams(key, { path: { planId } }) }));
      queryClient.setQueryData(['plan', planId], r);
      if (r.state === 'COMMITTED') setNotice(m.committed);
      await queryClient.invalidateQueries({ queryKey: ['assignments', mfcId] });
      return r;
    } catch (e) {
      // 409 PLAN_STALE 등 — 계획을 다시 읽어 낡은 이유를 보인다
      await queryClient.invalidateQueries({ queryKey: ['plan', planId] });
      throw e;
    }
  });
  const o = plan.objective;
  return (
    <>
      <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
        {/* 화면 표기 = 종류 · 시각(ADR-0070 덧붙임) — 계획 ID 는 아래 시스템 번호 칸 */}
        {`${m.planLabel} · ${plan.createdAt ? formatSeoul(plan.createdAt) : messages.none}`}
        <span className={`badge badge-sm ${plan.state === 'PROPOSED' ? 'badge-info' : plan.state === 'COMMITTED' ? 'badge-success' : 'badge-warning'}`}>
          {m.planState[plan.state ?? ''] ?? plan.state}
        </span>
      </h1>
      {notice && (
        <p role="status" className="text-success text-sm">
          {notice}
        </p>
      )}
      <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 rounded-box bg-base-100 p-4 text-sm">
        <dt className="opacity-70">{m.solver}</dt>
        <dd>{plan.solverStatus ?? messages.none}</dd>
        <dt className="opacity-70">{m.horizonShown}</dt>
        <dd>{plan.horizonStart ? `${formatSeoul(plan.horizonStart)} · ${plan.horizonMinutes ?? ''}` : messages.none}</dd>
        <dt className="opacity-70">{m.objectiveLabel}</dt>
        <dd>{o ? m.objective(o.unassignedCount ?? 0, o.lateMinutes ?? 0, o.maxWorkerLoadMinutes ?? 0) : messages.none}</dd>
        <dt className="opacity-70">{m.limitations}</dt>
        <dd>{plan.limitations?.length ? plan.limitations.join(', ') : messages.none}</dd>
        <dt className="opacity-70">{m.unverified}</dt>
        <dd>
          {plan.availabilityUnverifiedWorkers?.length
            ? plan.availabilityUnverifiedWorkers.map((w, i) => (
                <span key={w}>
                  {i > 0 && ', '}
                  <Who id={w} />
                </span>
              ))
            : messages.none}
        </dd>
        {(plan.staleReasons ?? []).length > 0 && (
          <>
            <dt className="opacity-70">{m.staleReasons}</dt>
            <dd data-testid="stale-reasons">{plan.staleReasons!.join(', ')}</dd>
          </>
        )}
      </dl>
      <SystemNumbers ids={[{ label: m.planLabel, id: plan.planId }]} />
      <div className="rounded-box bg-base-100 p-4 text-sm">
        <h2 className="mb-2 font-semibold">{m.items}</h2>
        {(plan.items ?? []).length === 0 ? (
          <p className="opacity-70">{messages.none}</p>
        ) : (
          <table className="table table-xs">
            <thead>
              <tr>
                <th>{m.fields.task}</th>
                <th>{m.fields.taskType}</th>
                <th>{m.fields.worker}</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {(plan.items ?? []).map((i) => (
                <tr key={i.taskId} data-testid="plan-item">
                  <td>
                    <TaskLink mfcId={mfcId} taskId={i.taskId} taskType={i.taskType} />
                  </td>
                  <td>{taskName[i.taskType ?? ''] ?? i.taskType}</td>
                  <td>
                    <Who id={i.workerId} />
                  </td>
                  <td>{i.startAt && i.endAt ? m.period(formatSeoul(i.startAt), formatSeoul(i.endAt)) : messages.none}</td>
                  <td className="text-warning">{m.late(i.lateMinutes ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(plan.unassigned ?? []).length > 0 && (
          <>
            <h3 className="mt-3 mb-1 font-semibold">{m.unassigned}</h3>
            <ul className="list-disc pl-5">
              {(plan.unassigned ?? []).map((u) => (
                <li key={u.taskId}>{`${u.taskId ?? ''} · ${taskName[u.taskType ?? ''] ?? u.taskType ?? ''} · ${m.unassignedReason[u.reason ?? ''] ?? u.reason ?? ''}`}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      {plan.state === 'PROPOSED' && (
        <div className="space-y-2 rounded-box bg-base-100 p-4 text-sm">
          <p className="text-xs opacity-70">{m.commitHint}</p>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={commit.busy}
            onClick={() => {
              if (commit.phase.kind === 'rejected') commit.reset();
              void commit.run(null);
            }}
          >
            {m.commit}
          </button>
          <CommandFeedback command={commit} />
        </div>
      )}
      {plan.state === 'STALE' && commit.phase.kind === 'rejected' && <CommandFeedback command={commit} />}
    </>
  );
}
