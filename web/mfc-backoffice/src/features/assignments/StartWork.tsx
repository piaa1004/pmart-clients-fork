// "작업 시작" + 담당 없는 작업 — mfc-capacity 0.22.0(백엔드 알림 clients/mfc-backoffice/2026-11-19-notice-start-work, 사용자 결정 2026-11-19
// "배정 추천 화면을 따로 두지 않는다 — 작업 시작을 누르면 추천대로 바로 배정, 바꾸기는 그 화면에서").
// - 작업 시작 = `POST /assignment-plans` {mfcId, horizonMinutes, commit: true}(Idempotency-Key — 다시 보내기 = 같은 결과).
//   201 state COMMITTED(assignments = 생긴 배정)·NO_SOLUTION·STALE(서버가 한 번 다시 해 보고도 어긋남 → "다시 시작") — 서버 값 그대로 요약한다.
// - 담당 없는 작업 = fulfillment `GET /tasks?mfcId=&state=READY` → 줄마다 "담당 정하기"(작업 현황과 같은 폼 — `POST /assignments`, 버전 0).
// - 끝나면 배정·작업 목록을 다시 읽는다(작업자 PDA 에는 서버가 배정 사건으로 알린다).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/mfc-capacity';
import { useApi } from '../../app/ApiContext';
import { AllDone } from '../../shared/listParts';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { ReassignForm } from '../tasks/TaskActions';

const m = messages.assignments.start;
const taskName = messages.workers.task;
type Plan = components['schemas']['AssignmentPlan'];

const HORIZONS = [30, 60, 120, 240] as const;

export function StartWork({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [horizon, setHorizon] = useState<number>(60);
  const start = useCommand(async (_: null, key) => {
    const plan = await request('POST', api.capacity.POST('/assignment-plans', { ...commandParams(key), body: { mfcId, horizonMinutes: horizon, commit: true } }));
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['assignments', mfcId] }), queryClient.invalidateQueries({ queryKey: ['tasks', mfcId] }), queryClient.invalidateQueries({ queryKey: ['ops', mfcId] })]);
    return plan;
  });
  return (
    <form
      className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm"
      aria-label={m.title}
      data-testid="start-work"
      onSubmit={(e) => {
        e.preventDefault();
        if (start.phase.kind === 'rejected' || start.phase.kind === 'done') start.reset();
        void start.run(null);
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">{m.title}</p>
          <p className="text-xs text-base-content/60">{m.hint}</p>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-xs text-base-content/60">{m.horizon}</span>
          <select className="select select-sm w-28" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} aria-label={m.horizon}>
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {m.minutes(h)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary min-w-28" disabled={start.busy}>
          {start.busy ? m.running : m.button}
        </button>
      </div>
      <CommandFeedback command={start}>{(plan: Plan) => <StartResult plan={plan} />}</CommandFeedback>
    </form>
  );
}

/** 결과 요약 — 서버 상태·배정·남은 작업(사유) 그대로 */
function StartResult({ plan }: { readonly plan: Plan }) {
  const made = plan.assignments ?? [];
  const left = plan.unassigned ?? [];
  const byReason = new Map<string, number>();
  for (const u of left) byReason.set(u.reason ?? 'UNKNOWN', (byReason.get(u.reason ?? 'UNKNOWN') ?? 0) + 1);
  if (plan.state === 'STALE')
    return (
      <p role="alert" className="alert alert-warning text-sm" data-testid="start-result">
        {m.stale}
      </p>
    );
  if (plan.state === 'NO_SOLUTION' || (plan.state === 'COMMITTED' && made.length === 0))
    return (
      <div role="status" className="alert text-sm" data-testid="start-result">
        <p>{m.noSolution}</p>
        {left.length > 0 && <Reasons byReason={byReason} />}
      </div>
    );
  if (plan.state !== 'COMMITTED')
    return (
      <p role="status" className="alert alert-warning text-sm" data-testid="start-result">
        {m.otherState(plan.state ?? '')}
      </p>
    );
  return (
    <div role="status" className="space-y-2 rounded-box border border-success/30 bg-success/10 p-3" data-testid="start-result">
      <p className="font-semibold">{m.done(made.length, left.length)}</p>
      <ul className="space-y-0.5 text-xs">
        {made.map((a) => (
          <li key={a.assignmentId ?? a.taskId}>
            {`${taskName[a.taskType ?? ''] ?? a.taskType} → `}
            <Who id={a.workerId} />
          </li>
        ))}
      </ul>
      {left.length > 0 && <Reasons byReason={byReason} />}
    </div>
  );
}

function Reasons({ byReason }: { readonly byReason: ReadonlyMap<string, number> }) {
  return (
    <p className="text-xs text-base-content/70" data-testid="start-left">
      {m.leftTitle}{' '}
      {[...byReason.entries()].map(([r, n]) => `${m.reason[r] ?? r} ${n}건`).join(' · ')}
    </p>
  );
}

// ---------------------------------------------------------------- 담당 없는 작업

export function UnassignedTasks({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['tasks', mfcId, 'ALL', 'READY', 'unassigned'],
    queryFn: () => request('GET', api.fulfillment.GET('/tasks', { params: { query: { mfcId, state: ['READY'], size: 50 } } })),
  });
  const t = messages.tasks;
  return (
    <div className="space-y-2" data-testid="unassigned-tasks">
      <p className="text-xs text-base-content/60">{m.unassignedHint}</p>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(r) =>
          (r.items ?? []).length === 0 ? (
            <AllDone body={m.noUnassigned} />
          ) : (
            <>
              <table className="table table-sm rounded-box bg-base-100">
                <thead>
                  <tr>
                    <th>{t.type}</th>
                    <th>{t.fields.product}</th>
                    <th>{t.fields.qty}</th>
                    <th>{t.fields.promisedReadyAt}</th>
                    <th>{t.actions.col}</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.items ?? []).map((task) => (
                    <Fragment key={task.taskId}>
                      <tr data-testid="unassigned-row">
                        <td>{t.taskType[task.taskType ?? ''] ?? task.taskType}</td>
                        <td>{t.headline(task.headline?.productName, task.headline?.otherLineCount ?? 0)}</td>
                        <td>{t.qty(task.plannedQty ?? 0, task.completedQty ?? 0, task.remainingQty ?? 0)}</td>
                        <td>{task.promisedReadyAt ? formatSeoul(task.promisedReadyAt) : messages.none}</td>
                        <td>
                          <button type="button" className={`btn btn-xs ${open === task.taskId ? 'btn-active' : ''}`} onClick={() => setOpen(open === task.taskId ? null : (task.taskId ?? null))}>
                            {t.actions.assign}
                          </button>
                        </td>
                      </tr>
                      {open === task.taskId && (
                        <tr>
                          <td colSpan={5}>
                            <ReassignForm mfcId={mfcId} task={task} onClose={() => setOpen(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {r.page?.nextCursor && <p className="text-xs text-base-content/60">{m.moreInTasks}</p>}
            </>
          )
        }
      </QueryState>
    </div>
  );
}
