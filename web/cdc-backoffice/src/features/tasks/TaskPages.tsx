// 통합 작업관리 — cdc-outbound `GET /cdcs/{cdcId}/tasks?waveId=&state=&pageSize=&cursor=`(waveId 필수)·`GET /cdcs/{cdcId}/tasks/{taskId}`.
// - Wave 고르기: `GET /cdcs/{cdcId}/waves`(0.15.0) 최근 200개에서 고르거나 번호를 넣는다.
// - 상세에서 담당 바꾸기·보류·우선순위(0.20.0, TaskControls). 착수·실적은 현장 PDA 일이라 이 화면에 없다.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { DetailHeader, FieldList } from '@pmart/web-ui/standard';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { findWaveId } from '../../shared/findByNumber';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { MfcName } from '../../shared/MfcName';
import { Who } from '../../shared/OperatorLabel';
import { SkuName } from '../../shared/SkuName';
import { wavePath, WaveStateBadge } from '../trf-wave/TrfWavePages';
import { TaskControls } from './TaskControls';

const m = messages.task;

export type Task = components['schemas']['Task'];
type TaskState = components['schemas']['TaskState'];
const STATES: readonly TaskState[] = ['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PARTIAL', 'DONE', 'EXCEPTION', 'HELD', 'CANCELLED'];
const isState = (v: string | null): v is TaskState => !!v && (STATES as readonly string[]).includes(v);

const tasksPath = (cdcId: string, rest = '') => centerPath(cdcId, rest ? `tasks/${rest}` : 'tasks');

/** `/c/:cdcId/tasks/*` */
export function TasksMenu({ cdcId }: { readonly cdcId: string }) {
  return (
    <Routes>
      <Route index element={<TaskListPage cdcId={cdcId} />} />
      <Route path=":taskId" element={<TaskDetailPage cdcId={cdcId} />} />
    </Routes>
  );
}

export function TaskStateBadge({ state }: { readonly state: string | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone = state === 'EXCEPTION' ? 'badge-error' : state === 'PARTIAL' ? 'badge-warning' : state === 'DONE' ? 'badge-success' : state === 'CANCELLED' ? 'badge-ghost' : state === 'CREATED' ? 'badge-ghost' : 'badge-info';
  return <span className={`badge badge-sm ${tone}`}>{m.state[state] ?? state}</span>;
}

const sum = (t: Task, k: 'plannedQty' | 'pickedQty' | 'shortQty') => (t.lines ?? []).reduce((a, l) => a + (l[k] ?? 0), 0);
const place = (t: Task) => [t.zone, t.floor ? `${t.floor}층` : null, t.aisle].filter(Boolean).join(' · ') || messages.none;
const trfText = (t: Task) => ((t.trfIds?.length ?? 0) > 1 ? m.batch(t.trfIds!.length) : (t.trfNumber ?? t.trfNumbers?.[0] ?? (shortRef(t.trfId ?? t.trfIds?.[0]) || messages.none)));

/** 최근 Wave 200개(만든 시각 최신 순 — cdc-outbound 0.15.0) */
function useRecentWaves(cdcId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['cdc', cdcId, 'waves', 'recent'],
    queryFn: async () => {
      const page = await request('GET', api.outbound.GET('/cdcs/{cdcId}/waves', { params: { path: { cdcId }, query: { size: 200 } } }));
      // 화면 번호(waveNumber — 없으면 옛 기록이라 시스템 ID)로 고르게 한다
      return page.items.filter((v) => !!v.waveId).map((v) => ({ id: v.waveId!, label: v.waveNumber ?? v.waveId! }));
    },
  });
}

function TaskListPage({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const waveId = params.get('waveId') ?? '';
  const raw = params.get('state');
  const state = isState(raw) ? raw : undefined;
  const waves = useRecentWaves(cdcId);
  const [draft, setDraft] = useState('');
  const [miss, setMiss] = useState<string | null>(null);
  const set = (k: string, v: string) => {
    const q = new URLSearchParams(params);
    if (v) q.set(k, v);
    else q.delete(k);
    setParams(q, { replace: true });
  };
  const wave = useQuery({
    queryKey: ['cdc', 'wave', waveId],
    enabled: !!waveId,
    queryFn: () => request('GET', api.outbound.GET('/waves/{waveId}', { params: { path: { waveId } } })),
  });
  const tasks = useInfiniteQuery({
    queryKey: ['cdc', cdcId, 'tasks', waveId, state ?? ''],
    enabled: !!waveId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(
        'GET',
        api.outbound.GET('/cdcs/{cdcId}/tasks', {
          params: { path: { cdcId }, query: { waveId, ...(state ? { state } : {}), ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const rows = useMemo(() => tasks.data?.pages.flatMap((p) => p.items ?? []) ?? [], [tasks.data]);

  return (
    <section className="space-y-4">
      <h1>{m.title}</h1>
      <form
        className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3"
        data-list-part="top"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (!v) return;
          setMiss(null);
          void findWaveId(api, cdcId, v).then(
            (found) => {
              if (!found) return setMiss(v);
              setDraft('');
              set('waveId', found);
            },
            () => setMiss(v),
          );
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          {m.wavesFromTrf}
          <select
            className="select select-sm w-52"
            value={waves.data?.some((x) => x.id === waveId) ? waveId : ''}
            onChange={(e) => {
              setDraft('');
              set('waveId', e.target.value);
            }}
            disabled={!waves.data}
            data-testid="task-wave-select"
          >
            <option value="">{waves.isError ? messages.loadFailed : waves.data && waves.data.length === 0 ? m.noWaves : m.choose}</option>
            {(waves.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {m.pickWave}
          <input className="input input-sm w-40" value={draft} placeholder={messages.wave.waveIdPlaceholder} onChange={(e) => setDraft(e.target.value)} data-testid="task-wave-input" />
          {miss && <span className="text-xs text-error">{messages.wave.notFound(miss)}</span>}
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!draft.trim()}>
          {messages.wave.open}
        </button>
        <label className="flex flex-col gap-1 text-sm">
          {m.stateFilter}
          <select className="select select-sm w-36" value={state ?? ''} onChange={(e) => set('state', e.target.value)} data-testid="task-state">
            <option value="">{m.all}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {m.state[s]}
              </option>
            ))}
          </select>
        </label>
      </form>
      <p className="text-xs text-base-content/55">{m.pickWaveHint}</p>

      {!waveId ? (
        <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60" data-testid="task-no-wave">
          {m.choose}
        </p>
      ) : (
        <>
          {wave.data && (
            <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="task-wave-head">
              <Link className="link font-mono" to={wavePath(cdcId, waveId)} title={waveId}>
                {wave.data.waveNumber ?? waveId}
              </Link>
              <WaveStateBadge state={wave.data.state} />
              {wave.data.taskSummary && (
                <span className="text-base-content/60">
                  {messages.wave.fields.taskSummary(wave.data.taskSummary.total ?? 0, wave.data.taskSummary.done ?? 0, wave.data.taskSummary.exception ?? 0)}
                </span>
              )}
            </div>
          )}
          <QueryState state={toUiState(tasks, () => rows.length === 0)} onRetry={() => void tasks.refetch()} emptyText={m.empty}>
            {() => (
              <>
                <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                  <table className="table table-sm" data-testid="task-table">
                    <thead>
                      <tr>
                        <th>{m.fields.taskId}</th>
                        <th>{m.fields.kind}</th>
                        <th>{m.fields.mode}</th>
                        <th>{m.fields.place}</th>
                        <th>{m.fields.trf}</th>
                        <th>{m.fields.dueAt}</th>
                        <th>{m.fields.state}</th>
                        <th>{m.fields.assignee}</th>
                        <th className="text-right">{m.fields.progress}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => {
                        const short = sum(t, 'shortQty');
                        return (
                          <tr key={t.taskId} data-testid="task-row">
                            <td>
                              <Link className="link font-mono text-xs" to={tasksPath(cdcId, encodeURIComponent(t.taskId ?? ''))}>
                                {t.taskNumber ?? t.taskId}
                              </Link>
                            </td>
                            <td>{t.kind ? (m.kind[t.kind] ?? t.kind) : messages.none}</td>
                            <td>
                              {t.pickMode ? (m.mode[t.pickMode] ?? t.pickMode) : messages.none}
                              {t.pickMethod && <span className="ml-1 text-xs text-base-content/55">{t.pickMethod}</span>}
                              {t.regionCode && <span className="ml-1 text-xs text-base-content/55">{t.regionCode}</span>}
                            </td>
                            <td>{place(t)}</td>
                            <td className="font-mono text-xs">{trfText(t)}</td>
                            <td>{t.dueAt ? formatSeoul(t.dueAt) : messages.none}</td>
                            <td>
                              <TaskStateBadge state={t.state} />
                            </td>
                            <td>{t.assigneeId ? <Who id={t.assigneeId} /> : <span className="text-base-content/40">{m.unassigned}</span>}</td>
                            <td className="text-right tabular-nums">
                              {`${messages.qty(sum(t, 'pickedQty'))} / ${messages.qty(sum(t, 'plannedQty'))}`}
                              {short > 0 && <span className="ml-1 font-semibold text-error">{`(${m.fields.short} ${messages.qty(short)})`}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {tasks.hasNextPage && (
                  <div className="flex justify-center">
                    <button type="button" className="btn btn-sm" disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>
                      {m.more}
                    </button>
                  </div>
                )}
              </>
            )}
          </QueryState>
        </>
      )}
    </section>
  );
}

function TaskDetailPage({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const { taskId = '' } = useParams();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'task', taskId],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/tasks/{taskId}', { params: { path: { cdcId, taskId } } })),
  });
  return (
    <section className="space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(t) => (
          <>
            <DetailHeader
              back={{ to: t.waveId ? `${tasksPath(cdcId)}?waveId=${encodeURIComponent(t.waveId)}` : tasksPath(cdcId), label: m.back }}
              // 화면 번호(K…) 전까지 제목은 '종류 작업 · 구역·층' — 시스템 ID 는 아래 작은 글씨
              title={`${t.taskNumber ? `${t.taskNumber} · ` : ''}${m.titleOf(t.kind ? (m.kind[t.kind] ?? t.kind) : m.taskWord, place(t))}`}
              badges={<TaskStateBadge state={t.state} />}
              summary={
                <span className="space-x-2">
                  <span>{[t.pickMode ? (m.mode[t.pickMode] ?? t.pickMode) : null, t.pickMethod ?? null].filter(Boolean).join(' · ')}</span>
                  <span className="font-mono text-xs" data-testid="task-system-id">{`${messages.wave.systemId} ${t.taskId ?? taskId}`}</span>
                </span>
              }
            />
            <TaskControls cdcId={cdcId} task={t} />
            <div className="rounded-box border border-base-300 bg-base-100 p-4">
              <FieldList
                testId="task-fields"
                rows={[
                  [messages.trf.fields.wave, t.waveId ? <Link className="link" to={wavePath(cdcId, t.waveId)}>{t.waveNumber ?? t.waveId}</Link> : messages.none],
                  [m.fields.trf, (t.trfNumbers?.length ? t.trfNumbers : t.trfIds?.length ? t.trfIds : t.trfId ? [t.trfId] : []).join(', ') || messages.none],
                  [m.fields.method, t.pickMethod ?? messages.none],
                  [m.fields.region, t.regionCode ?? messages.none],
                  [m.fields.dueAt, t.dueAt ? formatSeoul(t.dueAt) : messages.none],
                  [m.fields.assignee, t.assigneeId ? <Who id={t.assigneeId} /> : m.unassigned],
                  [m.fields.createdAt, t.createdAt ? formatSeoul(t.createdAt) : messages.none],
                  [m.fields.completedAt, t.completedAt ? formatSeoul(t.completedAt) : messages.none],
                ]}
              />
            </div>
            <h2 className="text-base font-semibold">{m.lines}</h2>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="task-lines">
                <thead>
                  <tr>
                    <th>{m.fields.sku}</th>
                    <th>{m.fields.lot}</th>
                    <th>{m.fields.location}</th>
                    <th className="text-right">{m.fields.planned}</th>
                    <th className="text-right">{m.fields.picked}</th>
                    <th className="text-right">{m.fields.short}</th>
                    <th>{m.fields.shortReason}</th>
                    <th>{m.shares}</th>
                  </tr>
                </thead>
                <tbody>
                  {(t.lines ?? []).length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center text-sm text-base-content/60" data-testid="task-no-lines">
                        {t.state === 'CANCELLED' ? m.noLinesCancelled : m.noLines}
                      </td>
                    </tr>
                  )}
                  {(t.lines ?? []).map((l, i) => (
                    <tr key={`${l.sku}-${l.lot}-${l.locationCode}-${i}`}>
                      <td>
                        <SkuName sku={l.sku ?? ''} />
                      </td>
                      <td className="font-mono text-xs">{l.lot ?? messages.none}</td>
                      <td className="font-mono text-xs">{l.locationCode ?? messages.none}</td>
                      <td className="text-right tabular-nums">{messages.qty(l.plannedQty ?? 0)}</td>
                      <td className="text-right tabular-nums">{messages.qty(l.pickedQty ?? 0)}</td>
                      <td className={`text-right tabular-nums ${(l.shortQty ?? 0) > 0 ? 'font-semibold text-error' : ''}`}>{messages.qty(l.shortQty ?? 0)}</td>
                      <td title={l.shortReason}>{l.shortReason ? (m.shortReasons[l.shortReason] ?? l.shortReason) : messages.none}</td>
                      <td className="whitespace-normal text-xs">
                        {(l.shares ?? []).length === 0
                          ? messages.none
                          : (l.shares ?? []).map((s) => (
                              <div key={s.trfId}>
                                <MfcName id={s.mfcId} /> <span className="font-mono" title={s.trfId}>{s.trfNumber ?? shortRef(s.trfId)}</span>{` · ${messages.qty(s.pickedQty ?? 0)}/${messages.qty(s.plannedQty ?? 0)}`}
                              </div>
                            ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}
