// TRF·Wave — cdc-outbound 0.11.0+ (백엔드 요청 clients/all/2026-11-25-request-cdc-backoffice §2-2).
// - TRF 목록 `GET /cdcs/{cdcId}/transfers?state=&mfcId=&page=&size=`(기한 순, page 0부터) — 거르기·쪽은 URL 쿼리.
// - TRF 상세 `GET /cdcs/{cdcId}/transfers/{trfId}`(줄별 승인·할당·피킹·부족).
// - Wave 만들기 `POST /waves` {cdcId, trfIds} — 확보(ALLOCATED·PARTIALLY_ALLOCATED)되고 Wave 에 안 든 TRF 만 고를 수 있게(판정은 서버 — 409 TRF_ALREADY_IN_WAVE·INVALID_STATE).
// - Wave 상세 `GET /waves/{waveId}`, 릴리스 `POST /waves/{waveId}/releases`(X-Expected-Version, 202 CommandResponse).
//   ACCEPTED 는 완료로 보이지 않는다 — Wave 를 다시 읽어 상태가 바뀐 것만 보인다.
// - Wave 목록 `GET /cdcs/{cdcId}/waves?state=&page=&size=`(0.15.0 W-1 — 만든 시각 최신 순). 화면 위 [TRF | Wave] 탭(?view=waves).
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { DetailHeader, FieldList } from '@pmart/web-ui/standard';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { findWaveId } from '../../shared/findByNumber';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { MfcName, useMfcLabel } from '../../shared/MfcName';
import { SkuName } from '../../shared/SkuName';
import { WaveControls } from './WaveControls';

const m = messages.trf;
const w = messages.wave;

export type TransferSummary = components['schemas']['TransferSummary'];
export type Wave = components['schemas']['Wave'];

/** 목록 거르기에 보이는 상태(서버는 문자열 — 모르는 값도 그대로 보인다) */
const STATES = ['RECEIVED', 'ALLOCATED', 'PARTIALLY_ALLOCATED', 'ALLOCATION_FAILED', 'IN_WAVE', 'PICKED', 'DEPARTED', 'CANCELLED'] as const;
/** Wave 에 넣을 수 있는 TRF(계약 createWave 설명) */
const WAVEABLE = new Set(['ALLOCATED', 'PARTIALLY_ALLOCATED']);
const PAGE_SIZE = 50;

export const trfWavePath = (cdcId: string, rest = '') => centerPath(cdcId, rest ? `trf-wave/${rest}` : 'trf-wave');
export const wavePath = (cdcId: string, waveId: string) => trfWavePath(cdcId, `waves/${encodeURIComponent(waveId)}`);

/** `/c/:cdcId/trf-wave/*` */
export function TrfWaveMenu({ cdcId }: { readonly cdcId: string }) {
  return (
    <Routes>
      <Route index element={<TrfWaveHome cdcId={cdcId} />} />
      <Route path="trf/:trfId" element={<TransferDetailPage cdcId={cdcId} />} />
      <Route path="waves/:waveId" element={<WaveDetailPage cdcId={cdcId} />} />
    </Routes>
  );
}

export function TrfStateBadge({ state }: { readonly state: string | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone =
    state === 'ALLOCATION_FAILED' || state === 'MISMATCHED'
      ? 'badge-error'
      : state === 'PARTIALLY_ALLOCATED' || state === 'CHANGING'
        ? 'badge-warning'
        : state === 'ALLOCATED' || state === 'IN_WAVE' || state === 'PICKING'
          ? 'badge-info'
          : state === 'DEPARTED' || state === 'PICKED' || state === 'LOADED'
            ? 'badge-success'
            : 'badge-ghost';
  return <span className={`badge badge-sm ${tone}`}>{m.state[state] ?? state}</span>;
}

export function WaveStateBadge({ state }: { readonly state: string | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone = state === 'PLANNED' ? 'badge-warning' : state === 'RELEASED' || state === 'IN_PROGRESS' ? 'badge-info' : state === 'WORK_DONE' || state === 'CLOSED' ? 'badge-success' : 'badge-ghost';
  return <span className={`badge badge-sm ${tone}`}>{w.state[state] ?? state}</span>;
}

/** 수량 칸 — 부족이 있으면 빨강 */
function Qty({ n, warn = false }: { readonly n: number; readonly warn?: boolean }) {
  return <span className={`tabular-nums ${warn && n > 0 ? 'font-semibold text-error' : ''}`}>{messages.qty(n)}</span>;
}

// ---------------------------------------------------------------- 첫 화면: [TRF | Wave]

function TrfWaveHome({ cdcId }: { readonly cdcId: string }) {
  const [params] = useSearchParams();
  return params.get('view') === 'waves' ? <WaveListPage cdcId={cdcId} /> : <TransferListPage cdcId={cdcId} />;
}

function ViewTabs({ cdcId, current }: { readonly cdcId: string; readonly current: 'trf' | 'waves' }) {
  return (
    <div role="tablist" className="tabs tabs-box w-fit" data-testid="trf-wave-tabs">
      <Link role="tab" className={`tab ${current === 'trf' ? 'tab-active' : ''}`} aria-selected={current === 'trf'} to={trfWavePath(cdcId)}>
        {w.tabTrf}
      </Link>
      <Link role="tab" className={`tab ${current === 'waves' ? 'tab-active' : ''}`} aria-selected={current === 'waves'} to={`${trfWavePath(cdcId)}?view=waves`}>
        {w.tabWaves}
      </Link>
    </div>
  );
}

const WAVE_STATES = ['PLANNED', 'RELEASED', 'IN_PROGRESS', 'WORK_DONE', 'CLOSED', 'CANCELLED'] as const;
type WaveStateKey = (typeof WAVE_STATES)[number];
const isWaveState = (v: string | null): v is WaveStateKey => !!v && (WAVE_STATES as readonly string[]).includes(v);

function WaveListPage({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state = isWaveState(raw) ? raw : undefined;
  const page = Math.max(0, Number(params.get('page') ?? '0') || 0);
  const set = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setParams(q, { replace: true });
  };
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'waves', state ?? '', page],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/waves', { params: { path: { cdcId }, query: { page, size: PAGE_SIZE, ...(state ? { state } : {}) } } })),
  });
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{messages.menus.trfWave}</h1>
        <WaveOpenForm cdcId={cdcId} />
      </div>
      <ViewTabs cdcId={cdcId} current="waves" />
      <div className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3">
        <label className="flex flex-col gap-1 text-sm">
          {w.stateFilter}
          <select className="select select-sm w-40" value={state ?? ''} onChange={(e) => set({ state: e.target.value, page: '' })} data-testid="wave-state">
            <option value="">{w.all}</option>
            {WAVE_STATES.map((s) => (
              <option key={s} value={s}>
                {w.state[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={w.listEmpty}>
        {(data) => (
          <>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="wave-table">
                <thead>
                  <tr>
                    <th>Wave</th>
                    <th>{w.fields.state}</th>
                    <th className="text-right">{w.fields.trfs}</th>
                    <th>{w.fields.tasks}</th>
                    <th>{w.fields.createdAt}</th>
                    <th>{w.fields.releasedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <tr key={v.waveId} data-testid="wave-row">
                      <td>
                        <Link className="link font-mono text-xs" to={wavePath(cdcId, v.waveId ?? '')}>
                          {v.waveNumber ?? v.waveId}
                        </Link>
                      </td>
                      <td>
                        <WaveStateBadge state={v.state} />
                      </td>
                      <td className="text-right">{v.trfIds?.length ?? 0}</td>
                      <td>{v.taskSummary ? w.fields.taskSummary(v.taskSummary.total ?? 0, v.taskSummary.done ?? 0, v.taskSummary.exception ?? 0) : messages.none}</td>
                      <td>{v.createdAt ? formatSeoul(v.createdAt) : messages.none}</td>
                      <td>{v.releasedAt ? formatSeoul(v.releasedAt) : messages.none}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 text-sm">
              <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => set({ page: page - 1 > 0 ? String(page - 1) : '' })}>
                {m.prev}
              </button>
              <span>{m.page(page)}</span>
              <button type="button" className="btn btn-sm" disabled={!data.hasNext} onClick={() => set({ page: String(page + 1) })}>
                {m.next}
              </button>
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}

// ---------------------------------------------------------------- TRF 목록

function TransferListPage({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const state = params.get('state') ?? '';
  const mfcId = params.get('mfcId') ?? '';
  const no = params.get('no') ?? '';
  const page = Math.max(0, Number(params.get('page') ?? '0') || 0);
  const [mfcDraft, setMfcDraft] = useState(mfcId);
  const [noDraft, setNoDraft] = useState(no);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const query = useQuery({
    queryKey: ['cdc', cdcId, 'transfers', state, mfcId, no, page],
    queryFn: () =>
      request(
        'GET',
        api.outbound.GET('/cdcs/{cdcId}/transfers', {
          params: { path: { cdcId }, query: { page, size: PAGE_SIZE, ...(state ? { state } : {}), ...(mfcId ? { mfcId } : {}), ...(no ? { number: no } : {}) } },
        }),
      ),
  });

  const setQuery = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setParams(q, { replace: true });
    setPicked(new Set());
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery({ mfcId: mfcDraft.trim(), no: noDraft.trim(), page: '' });
  };

  const create = useCommand(async (trfIds: readonly string[], key) =>
    request('POST', api.outbound.POST('/waves', { ...commandParams(key), body: { cdcId, trfIds: [...trfIds] } })),
  );
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1>{messages.menus.trfWave}</h1>
          <p className="text-sm text-base-content/60">{m.lead}</p>
        </div>
        <WaveOpenForm cdcId={cdcId} />
      </div>
      <ViewTabs cdcId={cdcId} current="trf" />

      <form className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3" onSubmit={submit} data-list-part="top">
        <label className="flex flex-col gap-1 text-sm">
          {m.stateFilter}
          <select className="select select-sm w-44" value={state} onChange={(e) => setQuery({ state: e.target.value, page: '' })} data-testid="trf-state">
            <option value="">{m.all}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {m.state[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {m.mfcFilter}
          <input className="input input-sm w-44" value={mfcDraft} placeholder={m.mfcPlaceholder} onChange={(e) => setMfcDraft(e.target.value)} data-testid="trf-mfc" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {m.numberFilter}
          <input className="input input-sm w-36 font-mono" value={noDraft} placeholder="T482913" onChange={(e) => setNoDraft(e.target.value)} data-testid="trf-number" />
        </label>
        <button type="submit" className="btn btn-sm btn-primary">
          {m.search}
        </button>
        {(state || mfcId || no) && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setMfcDraft('');
              setNoDraft('');
              setQuery({ state: '', mfcId: '', no: '', page: '' });
            }}
          >
            {m.reset}
          </button>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="wave-create-bar">
        <span className="text-base-content/60">{picked.size > 0 ? m.picked(picked.size) : m.selectHint}</span>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={picked.size === 0 || create.busy}
          onClick={() =>
            void create.run([...picked]).then((phase) => {
              if (phase.kind === 'done' && phase.result.waveId) {
                void queryClient.invalidateQueries({ queryKey: ['cdc', cdcId, 'transfers'] });
                void navigate(wavePath(cdcId, phase.result.waveId));
              }
            })
          }
          data-testid="wave-create"
        >
          {w.create}
        </button>
        <CommandFeedback command={create} />
      </div>

      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(data) => (
          <>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="trf-table">
                <thead>
                  <tr>
                    <th className="w-8" />
                    <th>{m.fields.trfId}</th>
                    <th>{m.fields.mfc}</th>
                    <th>{m.fields.state}</th>
                    <th>{m.fields.dueAt}</th>
                    <th className="text-right" title={m.hint.lines}>{m.fields.lines}</th>
                    <th className="text-right" title={m.hint.approved}>{m.fields.approved}</th>
                    <th className="text-right" title={m.hint.allocated}>{m.fields.allocated}</th>
                    <th className="text-right" title={m.hint.picked}>{m.fields.picked}</th>
                    <th className="text-right" title={m.hint.short}>{m.fields.short}</th>
                    <th>{m.fields.wave}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((t) => {
                    const canPick = WAVEABLE.has(t.state) && !t.waveId;
                    return (
                      <tr key={t.trfId} data-testid="trf-row">
                        <td>
                          {canPick && (
                            <input type="checkbox" className="checkbox checkbox-sm" aria-label={m.pick(t.trfId)} checked={picked.has(t.trfId)} onChange={() => toggle(t.trfId)} />
                          )}
                        </td>
                        <td>
                          <Link className="link font-mono text-xs" to={trfWavePath(cdcId, `trf/${encodeURIComponent(t.trfId)}`)}>
                            {t.trfNumber ?? shortRef(t.trfId)}
                          </Link>
                        </td>
                        <td className="text-xs">
                          <MfcName id={t.mfcId} />
                        </td>
                        <td>
                          <TrfStateBadge state={t.state} />
                        </td>
                        <td>{formatSeoul(t.dueAt)}</td>
                        <td className="text-right">{t.lineCount}</td>
                        <td className="text-right">
                          <Qty n={t.approvedQty} />
                        </td>
                        <td className="text-right">
                          <Qty n={t.allocatedQty} />
                        </td>
                        <td className="text-right">
                          <Qty n={t.pickedQty} />
                        </td>
                        <td className="text-right">
                          <Qty n={t.shortQty} warn />
                        </td>
                        <td>
                          {t.waveId ? (
                            <Link className="link font-mono text-xs" to={wavePath(cdcId, t.waveId)} title={t.waveId}>
                              {t.waveNumber ?? t.waveId}
                            </Link>
                          ) : (
                            <span className="text-base-content/40">{messages.none}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 text-sm">
              <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setQuery({ page: page - 1 > 0 ? String(page - 1) : '' })}>
                {m.prev}
              </button>
              <span data-testid="trf-page">{m.page(page)}</span>
              <button type="button" className="btn btn-sm" disabled={!data.hasNext} onClick={() => setQuery({ page: String(page + 1) })}>
                {m.next}
              </button>
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}

/** Wave 번호(W4821)로 열기 — waves?number=. 시스템 ID(WAVE-…)도 받는다 */
function WaveOpenForm({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [miss, setMiss] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = id.trim();
        if (!v) return;
        setMiss(null);
        void findWaveId(api, cdcId, v).then(
          (found) => (found ? void navigate(wavePath(cdcId, found)) : setMiss(v)),
          () => setMiss(v),
        );
      }}
      data-testid="wave-open"
    >
      {miss && <span className="text-xs text-error">{w.notFound(miss)}</span>}
      <input className="input input-sm w-40" aria-label={w.openById} placeholder={w.waveIdPlaceholder} value={id} onChange={(e) => setId(e.target.value)} />
      <button type="submit" className="btn btn-sm" disabled={!id.trim()}>
        {w.open}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- TRF 상세

function TransferDetailPage({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const { trfId = '' } = useParams();
  const mfcLabel = useMfcLabel();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'transfer', trfId],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers/{trfId}', { params: { path: { cdcId, trfId } } })),
  });
  return (
    <section className="space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(t) => (
          <>
            <DetailHeader back={{ to: trfWavePath(cdcId), label: m.back }} title={t.trfNumber ?? shortRef(t.trfId)} badges={<TrfStateBadge state={t.state} />} summary={`${m.fields.mfc} ${mfcLabel(t.mfcId)} · ${m.fields.dueAt} ${formatSeoul(t.dueAt)}${t.trfNumber ? ` · ${w.systemId} ${t.trfId}` : ''}`} />
            <div className="rounded-box border border-base-300 bg-base-100 p-4">
              <FieldList
                testId="trf-fields"
                rows={[
                  [m.fields.version, t.trfVersion],
                  [m.fields.deadline, t.deadlineMeaning ? (m.deadline[t.deadlineMeaning] ?? t.deadlineMeaning) : messages.none],
                  [m.fields.wave, t.waveId ? <Link className="link" to={wavePath(cdcId, t.waveId)}>{t.waveNumber ?? t.waveId}</Link> : w.noWave],
                  [m.fields.approved, messages.qty(t.approvedQty)],
                  [m.fields.allocated, messages.qty(t.allocatedQty)],
                  [m.fields.picked, messages.qty(t.pickedQty)],
                  [m.fields.short, <Qty n={t.shortQty} warn />],
                  t.allocationError ? [m.fields.allocationError, t.allocationError] : null,
                  [m.fields.createdAt, t.createdAt ? formatSeoul(t.createdAt) : messages.none],
                  [m.fields.updatedAt, t.updatedAt ? formatSeoul(t.updatedAt) : messages.none],
                ]}
              />
            </div>
            <Readiness cdcId={cdcId} trfId={t.trfId} />
            <h2 className="text-base font-semibold">{m.lines}</h2>
            {t.lines.length === 0 ? (
              <p className="text-sm text-base-content/60">{m.linesEmpty}</p>
            ) : (
              <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                <table className="table table-sm" data-testid="trf-lines">
                  <thead>
                    <tr>
                      <th>{m.fields.sku}</th>
                      <th className="text-right" title={m.hint.approved}>{m.fields.approved}</th>
                      <th className="text-right" title={m.hint.allocated}>{m.fields.allocated}</th>
                      <th className="text-right" title={m.hint.picked}>{m.fields.picked}</th>
                      <th className="text-right" title={m.hint.short}>{m.fields.short}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.lines.map((l) => (
                      <tr key={l.sku}>
                        <td>
                          <SkuName sku={l.sku} />
                        </td>
                        <td className="text-right">
                          <Qty n={l.approvedQty} />
                        </td>
                        <td className="text-right">
                          <Qty n={l.allocatedQty} />
                        </td>
                        <td className="text-right">
                          <Qty n={l.pickedQty} />
                        </td>
                        <td className="text-right">
                          <Qty n={l.shortQty} warn />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}

/** 출발 준비(cdc-outbound 0.16.0 `GET /cdcs/{cdcId}/transfers/{trfId}/readiness`) — 단계·준비 LPN·수량·무게·막힌 이유 */
function Readiness({ cdcId, trfId }: { readonly cdcId: string; readonly trfId: string }) {
  const r = messages.readiness;
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'transfer', trfId, 'readiness'],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers/{trfId}/readiness', { params: { path: { cdcId, trfId } } })),
  });
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">{r.title}</h2>
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(x) => (
          <div className="rounded-box border border-base-300 bg-base-100 p-4">
            <FieldList
              testId="trf-readiness"
              rows={[
                [r.stage, x.readiness ? (r.stages[x.readiness] ?? x.readiness) : messages.none],
                [r.lpn, x.readyLpnCount ?? messages.none],
                [r.qty, x.readyQty !== undefined ? messages.qty(x.readyQty) : messages.none],
                [r.weight, x.totalWeightG !== undefined ? r.kg(x.totalWeightG) : messages.none],
                [r.zones, x.temperatureZones?.length ? x.temperatureZones.map((z) => messages.master.loc.zones[z] ?? z).join(', ') : messages.none],
                [r.earliest, x.earliestReadyAt ? formatSeoul(x.earliestReadyAt) : messages.none],
                [r.blockers, x.blockers?.length ? <span className="text-warning" title={x.blockers.join(', ')}>{x.blockers.map((k) => r.blocker[k] ?? k).join(', ')}</span> : r.none],
              ]}
            />
          </div>
        )}
      </QueryState>
    </div>
  );
}

/**
 * Wave 가 묶은 것(사용자 2026-11-26 "어떤 요청을 묶은 단위인지 설명이 없어도 되는 건가?") — 한 줄 설명 + 받는 MFC·기한·품목·수량 합 +
 * 묶인 TRF 표(받는 MFC·상태·기한·품목 수·승인·할당·피킹·부족). 수량은 TRF 상세(서버 값)를 더한 것 — 한 건이라도 못 읽으면 합계는 "확인 불가".
 */
function WaveContents({ cdcId, trfIds }: { readonly cdcId: string; readonly trfIds: readonly string[] }) {
  const api = useApi();
  const results = useQueries({
    queries: trfIds.map((trfId) => ({
      queryKey: ['cdc', cdcId, 'transfer', trfId],
      queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers/{trfId}', { params: { path: { cdcId, trfId } } })),
    })),
  });
  const rows = results.map((r) => r.data).filter((x): x is NonNullable<typeof x> => !!x);
  const allLoaded = rows.length === trfIds.length;
  const failed = results.some((r) => r.isError);
  const sum = (k: 'lineCount' | 'approvedQty' | 'allocatedQty' | 'pickedQty' | 'shortQty') => (allLoaded ? messages.qty(rows.reduce((a, t) => a + t[k], 0)) : failed ? w.contents.unknown : '…');
  const mfcs = [...new Set(rows.map((t) => t.mfcId))];
  const dues = rows.map((t) => t.dueAt).sort();
  return (
    <section className="space-y-3" data-testid="wave-contents">
      <div>
        <h2 className="text-base font-semibold">{w.contents.title(trfIds.length)}</h2>
        <p className="text-sm text-base-content/60">{w.contents.lead}</p>
      </div>
      <div className="rounded-box border border-base-300 bg-base-100 p-4">
        <FieldList
          testId="wave-summary"
          rows={[
            [w.contents.mfcs, allLoaded ? mfcs.join(', ') || messages.none : failed ? w.contents.unknown : '…'],
            [w.contents.due, dues.length ? (dues.length > 1 && dues[0] !== dues[dues.length - 1] ? `${formatSeoul(dues[0]!)} ~ ${formatSeoul(dues[dues.length - 1]!)}` : formatSeoul(dues[0]!)) : messages.none],
            [m.fields.lines, sum('lineCount')],
            [m.fields.approved, sum('approvedQty')],
            [m.fields.allocated, sum('allocatedQty')],
            [m.fields.picked, sum('pickedQty')],
            [m.fields.short, sum('shortQty')],
          ]}
        />
      </div>
      {failed && (
        <p role="alert" className="alert alert-warning text-sm">
          {w.contents.someFailed}
        </p>
      )}
      <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table className="table table-sm" data-testid="wave-trfs">
          <thead>
            <tr>
              <th>{m.fields.trfId}</th>
              <th>{m.fields.mfc}</th>
              <th>{m.fields.state}</th>
              <th>{m.fields.dueAt}</th>
              <th className="text-right" title={m.hint.lines}>{m.fields.lines}</th>
              <th className="text-right" title={m.hint.approved}>{m.fields.approved}</th>
              <th className="text-right" title={m.hint.allocated}>{m.fields.allocated}</th>
              <th className="text-right" title={m.hint.picked}>{m.fields.picked}</th>
              <th className="text-right" title={m.hint.short}>{m.fields.short}</th>
            </tr>
          </thead>
          <tbody>
            {trfIds.map((id, i) => {
              const t = results[i]?.data;
              return (
                <tr key={id} data-testid="wave-trf-row">
                  <td>
                    <Link className="link font-mono text-xs" to={trfWavePath(cdcId, `trf/${encodeURIComponent(id)}`)}>
                      {t?.trfNumber ?? id}
                    </Link>
                  </td>
                  {t ? (
                    <>
                      <td className="text-xs">
                          <MfcName id={t.mfcId} />
                        </td>
                      <td>
                        <TrfStateBadge state={t.state} />
                      </td>
                      <td>{formatSeoul(t.dueAt)}</td>
                      <td className="text-right">{t.lineCount}</td>
                      <td className="text-right">
                        <Qty n={t.approvedQty} />
                      </td>
                      <td className="text-right">
                        <Qty n={t.allocatedQty} />
                      </td>
                      <td className="text-right">
                        <Qty n={t.pickedQty} />
                      </td>
                      <td className="text-right">
                        <Qty n={t.shortQty} warn />
                      </td>
                    </>
                  ) : (
                    <td colSpan={8} className="text-sm text-base-content/55">
                      {results[i]?.isError ? w.contents.rowFailed : '…'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Wave 상세·릴리스

function WaveDetailPage({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { waveId = '' } = useParams();
  const [accepted, setAccepted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const query = useQuery({
    queryKey: ['cdc', 'wave', waveId],
    queryFn: () => request('GET', api.outbound.GET('/waves/{waveId}', { params: { path: { waveId } } })),
    // 릴리스를 접수(ACCEPTED)한 뒤에는 상태가 바뀔 때까지 다시 읽는다 — 서버가 바꾼 상태만 보인다
    refetchInterval: (q) => (accepted && q.state.data?.state === 'PLANNED' ? 2_000 : false),
  });
  const release = useCommand(async (version: number | undefined, key) =>
    request('POST', api.outbound.POST('/waves/{waveId}/releases', { ...commandParams(key, { path: { waveId }, version }) })),
  );
  const wave = query.data;
  const canRelease = wave?.state === 'PLANNED';
  return (
    <section className="space-y-4">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(v) => (
          <>
            <DetailHeader
              back={{ to: trfWavePath(cdcId), label: w.back }}
              // 화면 번호(W…)가 서버에 생기기 전까지 제목은 '언제 만든 Wave' 로 — 긴 시스템 ID 는 아래 작은 글씨(ADR-0070: 목록·제목에 시스템 ID 를 크게 내지 않는다)
              title={v.waveNumber ?? (v.createdAt ? w.titleAt(formatSeoul(v.createdAt)) : w.titleNoDate)}
              badges={<WaveStateBadge state={v.state} />}
              summary={<span className="font-mono text-xs" data-testid="wave-system-id">{`${w.systemId} ${v.waveId ?? waveId}`}</span>}
              actions={
                <>
                  <Link className="btn btn-sm" to={`${centerPath(cdcId, 'tasks')}?waveId=${encodeURIComponent(v.waveId ?? waveId)}`}>
                    {w.tasks}
                  </Link>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!canRelease || release.busy}
                    title={canRelease ? undefined : w.releaseNote}
                    onClick={() => setConfirming(true)}
                    data-testid="wave-release"
                  >
                    {w.release}
                  </button>
                </>
              }
            />
            {confirming && (
              <div role="alertdialog" className="alert alert-warning text-sm" data-testid="wave-release-confirm">
                <span>{w.releaseConfirm}</span>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
                    {w.cancel}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={release.busy}
                    onClick={() => {
                      setConfirming(false);
                      void release.run(v.version).then((phase) => {
                        if (phase.kind === 'done') {
                          setAccepted(true);
                          void queryClient.invalidateQueries({ queryKey: ['cdc', 'wave', waveId] });
                          void queryClient.invalidateQueries({ queryKey: ['cdc', cdcId, 'tasks'] });
                        }
                      });
                    }}
                    data-testid="wave-release-go"
                  >
                    {w.release}
                  </button>
                </div>
              </div>
            )}
            <CommandFeedback command={release}>
              {(r) =>
                // 서버 상태가 PLANNED 를 벗어났을 때만 "됐어요"(ACCEPTED 는 접수만)
                v.state !== 'PLANNED' ? (
                  <p role="status" className="alert alert-success text-sm">
                    {w.releaseApplied}
                  </p>
                ) : (
                  <p role="status" className="alert alert-info text-sm" data-status={r.status}>
                    {w.releaseAccepted}
                  </p>
                )
              }
            </CommandFeedback>
            <div className="rounded-box border border-base-300 bg-base-100 p-4">
              <FieldList
                testId="wave-fields"
                rows={[
                  [w.fields.version, v.version ?? messages.none],
                  [w.fields.window, v.plannedDepartureWindow?.start ? `${formatSeoul(v.plannedDepartureWindow.start)} ~ ${v.plannedDepartureWindow.end ? formatSeoul(v.plannedDepartureWindow.end) : ''}` : messages.none],
                  [w.fields.tasks, v.taskSummary ? w.fields.taskSummary(v.taskSummary.total ?? 0, v.taskSummary.done ?? 0, v.taskSummary.exception ?? 0) : messages.none],
                  [w.fields.createdAt, v.createdAt ? formatSeoul(v.createdAt) : messages.none],
                  [w.fields.releasedAt, v.releasedAt ? formatSeoul(v.releasedAt) : messages.none],
                ]}
              />
            </div>
            <WaveControls
              cdcId={cdcId}
              wave={v}
              newWavePath={(id) => wavePath(cdcId, id)}
              onChanged={() => {
                void queryClient.invalidateQueries({ queryKey: ['cdc', 'wave', waveId] });
                void queryClient.invalidateQueries({ queryKey: ['cdc', cdcId, 'waves'] });
                void queryClient.invalidateQueries({ queryKey: ['cdc', cdcId, 'tasks'] });
              }}
            />
            <WaveContents cdcId={cdcId} trfIds={v.trfIds ?? []} />
          </>
        )}
      </QueryState>
    </section>
  );
}
