// 재고관리 > 품질·폐기·리콜 — cdc-quality 0.3.0(사용자 2026-11-26 "바로 할 수 있는 것부터").
// - 품질 보류 `GET|POST /cdcs/{cdcId}/quality-holds`, 상세 `GET …/{holdId}`, 해제 요청 `POST …/{holdId}/release-requests`, 해제 결정 `POST …/release-requests/{releaseId}/decisions`
// - 폐기 요청 `POST /cdcs/{cdcId}/disposal-approvals`(보류된 수량만), 목록·상세, 결정 `…/decisions`, 실행 `…/executions`(실제 폐기 수량·증빙)
// - 리콜 `GET|POST /cdc-recalls`(여러 센터 — 본사 승인 번호 필수), 상세 `GET /cdc-recalls/{recallId}`(센터별 보류·이미 출발한 물량)
// 명령 결과는 서버 상태로만 보인다: 201 이라도 APPLYING·UNKNOWN_RESULT 는 "반영 중"(성공 아님) — 목록을 다시 읽어 서버 값으로 확인한다.
// 결정은 다른 관리자(요청자 본인 422 SELF_APPROVAL), 본사 기준 이상이면 approvalRef(422 APPROVAL_REQUIRED) — 판정은 서버.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-quality';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { Who } from '../../shared/OperatorLabel';
import { SkuName } from '../../shared/SkuName';

const q = messages.quality;
type S = components['schemas'];
type Hold = S['Hold'];
type Disposal = S['DisposalApproval'];
type Recall = S['Recall'];
type HoldState = S['HoldState'];
type DisposalState = S['DisposalState'];
type ExactLine = S['ExactLine'];

const VIEWS = ['holds', 'disposals', 'recalls'] as const;
type View = (typeof VIEWS)[number];
const HOLD_STATES: readonly HoldState[] = ['APPLYING', 'UNKNOWN_RESULT', 'APPLIED', 'PARTIALLY_RELEASED', 'REJECTED', 'CLOSED'];
const DISPOSAL_STATES: readonly DisposalState[] = ['REQUESTED', 'APPROVED', 'PARTIALLY_EXECUTED', 'COMPLETED', 'DECLINED'];
const HOLD_REASONS = ['MANUAL', 'TEMPERATURE_EXCURSION', 'TRANSPORT_INCIDENT', 'INSPECTION_FAILED', 'SUSPECTED_CONTAMINATION'] as const;
const DISPOSAL_REASONS = ['EXPIRED', 'DAMAGED', 'RECALL', 'TEMPERATURE', 'CONTAMINATION', 'OTHER'] as const;
const RECALL_REASONS = ['SAFETY', 'LABELING', 'CONTAMINATION', 'SUPPLIER_NOTICE', 'OTHER'] as const;
const SEVERITIES = ['CLASS_1', 'CLASS_2', 'CLASS_3'] as const;

const label = (map: Readonly<Record<string, string>>, k: string | null | undefined) => (k ? (map[k] ?? k) : messages.none);
/** 서버 상태 → 배지 색(반영 중·불명은 성공색 아님) */
const tone = (s: string | undefined) => {
  if (!s) return 'badge-ghost';
  if (['APPLYING', 'UNKNOWN_RESULT', 'TRACING', 'PENDING'].includes(s)) return 'badge-warning';
  if (['REJECTED', 'DECLINED'].includes(s)) return 'badge-error';
  if (['REQUESTED', 'APPROVED'].includes(s)) return 'badge-info';
  if (['APPLIED', 'ISSUED', 'PARTIALLY_RELEASED', 'PARTIALLY_EXECUTED'].includes(s)) return 'badge-primary';
  return 'badge-ghost';
};
function StateBadge({ map, state }: { readonly map: Readonly<Record<string, string>>; readonly state: string | undefined }) {
  return <span className={`badge badge-sm whitespace-nowrap ${tone(state)}`}>{label(map, state)}</span>;
}
const toInt = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

export function QualityTab({ cdcId }: { readonly cdcId: string }) {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.find((v) => v === params.get('qv')) ?? 'holds';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="tabs tabs-box tabs-sm w-fit" data-testid="quality-views">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={`tab ${view === v ? 'tab-active' : ''}`}
              onClick={() => {
                const n = new URLSearchParams(params);
                n.set('qv', v);
                n.delete('qs');
                setParams(n, { replace: true });
              }}
            >
              {q.views[v]}
            </button>
          ))}
        </div>
        <p className="max-w-4xl text-xs text-base-content/60">{q.lead}</p>
      </div>
      {view === 'holds' && <Holds cdcId={cdcId} />}
      {view === 'disposals' && <Disposals cdcId={cdcId} />}
      {view === 'recalls' && <Recalls cdcId={cdcId} />}
    </div>
  );
}

function StateFilter({ states, map, testId }: { readonly states: readonly string[]; readonly map: Readonly<Record<string, string>>; readonly testId: string }) {
  const [params, setParams] = useSearchParams();
  return (
    <label className="flex flex-col gap-1 text-sm">
      {q.stateFilter}
      <select
        className="select select-sm w-40"
        value={params.get('qs') ?? ''}
        onChange={(e) => {
          const n = new URLSearchParams(params);
          if (e.target.value) n.set('qs', e.target.value);
          else n.delete('qs');
          setParams(n, { replace: true });
        }}
        data-testid={testId}
      >
        <option value="">{q.all}</option>
        {states.map((s) => (
          <option key={s} value={s}>
            {label(map, s)}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ───────────── 품질 보류 ───────────── */

function Holds({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params] = useSearchParams();
  const state = HOLD_STATES.find((s) => s === params.get('qs'));
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'quality-holds', state ?? 'all'],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.quality.GET('/cdcs/{cdcId}/quality-holds', { params: { path: { cdcId }, query: { size: 100, ...(state ? { state } : {}) } } })),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <StateFilter states={HOLD_STATES} map={q.holdState} testId="hold-state" />
        <button type="button" className="btn btn-sm btn-primary ml-auto" onClick={() => setCreating(!creating)} data-testid="hold-new">
          {q.newHold}
        </button>
      </div>
      {creating && <NewHold cdcId={cdcId} onDone={() => setCreating(false)} />}
      <QueryState state={toUiState(query, (d) => (d.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={q.empty}>
        {(d) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="hold-table">
              <thead>
                <tr>
                  <th>{q.id}</th>
                  <th>{q.reason}</th>
                  <th>{q.sku}</th>
                  <th className="text-right">{q.held}</th>
                  <th className="text-right">{q.remaining}</th>
                  <th>{q.state}</th>
                  <th>{q.requestedBy}</th>
                  <th>{q.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {(d.items ?? []).map((h) => {
                  const id = h.holdId ?? '';
                  const lines = h.lines ?? [];
                  const held = lines.reduce((a, l) => a + (l.heldQty ?? 0), 0);
                  const left = lines.reduce((a, l) => a + remainingOf(l), 0);
                  const isOpen = open === id;
                  const pendingRel = (h.releases ?? []).filter((r) => r.state === 'REQUESTED').length;
                  return (
                    <Fragment key={id}>
                      <tr className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} data-testid="hold-row">
                        <td className="font-mono text-xs">
                          <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                            {isOpen ? '▾' : '▸'}
                          </span>
                          {id}
                        </td>
                        <td>{label(q.holdReason, h.reason)}</td>
                        <td>
                          {lines[0] ? <SkuName sku={lines[0].sku ?? ''} /> : messages.none}
                          {lines.length > 1 && <span className="ml-1 text-xs text-base-content/55">{`+${lines.length - 1}`}</span>}
                        </td>
                        <td className="text-right tabular-nums">{messages.qty(held)}</td>
                        <td className="text-right tabular-nums font-semibold">{messages.qty(left)}</td>
                        <td>
                          <StateBadge map={q.holdState} state={h.state} />
                          {pendingRel > 0 && <span className="badge badge-sm badge-info ml-1">{`${q.releases} ${pendingRel}`}</span>}
                        </td>
                        <td>
                          <Who id={h.requestedBy} />
                        </td>
                        <td className="text-xs">{h.createdAt ? formatSeoul(h.createdAt) : messages.none}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="pm-detail bg-base-200/50">
                            <HoldDetail cdcId={cdcId} holdId={id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

type HoldLine = NonNullable<Hold['lines']>[number];
const remainingOf = (l: HoldLine) => Math.max(0, (l.heldQty ?? 0) - (l.releasedQty ?? 0) - (l.disposedQty ?? 0));

type Draft = { sku: string; lot: string; locationCode: string; qty: string };
const emptyDraft: Draft = { sku: '', lot: '', locationCode: '', qty: '' };

function NewHold({ cdcId, onDone }: { readonly cdcId: string; readonly onDone: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [reason, setReason] = useState<(typeof HOLD_REASONS)[number]>('MANUAL');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const [lines, setLines] = useState<Draft[]>([{ ...emptyDraft }]);
  const create = useCommand(async (body: S['HoldInput'], key) =>
    request('POST', api.quality.POST('/cdcs/{cdcId}/quality-holds', { ...commandParams(key, { path: { cdcId } }), body })),
  );
  const valid = lines.every((l) => l.sku.trim() && l.lot.trim() && (l.qty.trim() === '' || (toInt(l.qty) ?? 0) > 0));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const body: S['HoldInput'] = {
      reason,
      lines: lines.map((l) => ({
        sku: l.sku.trim(),
        lot: l.lot.trim(),
        ...(l.locationCode.trim() ? { locationCode: l.locationCode.trim() } : {}),
        ...(toInt(l.qty) ? { qty: toInt(l.qty)! } : {}),
      })),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(evidence.trim() ? { evidenceRef: evidence.trim() } : {}),
    };
    void create.run(body).then((phase) => {
      if (phase.kind === 'done') void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'quality-holds'] });
    });
  };
  const set = (i: number, k: keyof Draft, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <form className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" onSubmit={submit} data-testid="hold-form">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {q.reason}
          <select className="select select-sm w-44" value={reason} onChange={(e) => setReason(e.target.value as (typeof HOLD_REASONS)[number])} data-testid="hold-reason">
            {HOLD_REASONS.map((r) => (
              <option key={r} value={r}>
                {q.holdReason[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {q.evidence}
          <input className="input input-sm w-44" value={evidence} maxLength={128} onChange={(e) => setEvidence(e.target.value)} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {q.note}
          <input className="input input-sm w-full min-w-48" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-base-content/60">{q.lineHint}</p>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2" data-testid="hold-line">
            <input className="input input-sm w-36" placeholder={q.sku + '(SKU)'} aria-label={q.sku} value={l.sku} onChange={(e) => set(i, 'sku', e.target.value)} data-testid={`hold-sku-${i}`} />
            <input className="input input-sm w-32" placeholder={q.lot} aria-label={q.lot} value={l.lot} onChange={(e) => set(i, 'lot', e.target.value)} data-testid={`hold-lot-${i}`} />
            <input className="input input-sm w-56" placeholder={q.allCells} aria-label={q.location} value={l.locationCode} onChange={(e) => set(i, 'locationCode', e.target.value)} />
            <input className="input input-sm w-24" inputMode="numeric" placeholder={q.qty} aria-label={q.qty} value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} />
            {lines.length > 1 && (
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                {q.removeLine}
              </button>
            )}
          </div>
        ))}
        {lines.length < 50 && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setLines([...lines, { ...emptyDraft }])}>
            {q.addLine}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-sm btn-warning" disabled={!valid || create.busy} data-testid="hold-go">
          {q.holdGo}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>
          {q.cancel}
        </button>
      </div>
      <CommandFeedback command={create}>
        {(h: Hold) => (
          <p role="status" className="alert alert-info text-sm">
            {q.holdDone(h.holdId ?? '')} <StateBadge map={q.holdState} state={h.state} />
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

function HoldDetail({ cdcId, holdId }: { readonly cdcId: string; readonly holdId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'quality-holds', 'detail', holdId],
    refetchInterval: 10_000,
    queryFn: () => request('GET', api.quality.GET('/cdcs/{cdcId}/quality-holds/{holdId}', { params: { path: { cdcId, holdId } } })),
  });
  const [mode, setMode] = useState<'release' | 'dispose' | null>(null);
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(h) => {
        const lines = h.lines ?? [];
        const canAct = h.state === 'APPLIED' || h.state === 'PARTIALLY_RELEASED';
        return (
          <div className="space-y-3 p-1" data-testid="hold-detail">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/70">
              {h.sourceRef && <span>{`출처 ${h.sourceRef}`}</span>}
              {h.evidenceRef && <span>{`${q.evidence} ${h.evidenceRef}`}</span>}
              {h.note && <span>{`${q.note}: ${h.note}`}</span>}
              {h.rejectReason && <span className="text-error">{q.rejectReason(h.rejectReason)}</span>}
            </div>
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>{q.sku}</th>
                  <th>{q.lot}</th>
                  <th>{q.location}</th>
                  <th className="text-right">{q.requested}</th>
                  <th className="text-right">{q.held}</th>
                  <th className="text-right">{q.released}</th>
                  <th className="text-right">{q.disposed}</th>
                  <th className="text-right">{q.remaining}</th>
                  <th>{q.state}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.lineNo}>
                    <td>
                      <SkuName sku={l.sku ?? ''} />
                    </td>
                    <td className="font-mono">{l.lot}</td>
                    <td className="font-mono">{l.locationCode ?? q.allCells}</td>
                    <td className="text-right tabular-nums">{l.requestedQty ?? messages.none}</td>
                    <td className="text-right tabular-nums">{messages.qty(l.heldQty ?? 0)}</td>
                    <td className="text-right tabular-nums">{messages.qty(l.releasedQty ?? 0)}</td>
                    <td className="text-right tabular-nums">{messages.qty(l.disposedQty ?? 0)}</td>
                    <td className="text-right tabular-nums font-semibold">{messages.qty(remainingOf(l))}</td>
                    <td>
                      <StateBadge map={q.lineState} state={l.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(h.releases ?? []).length > 0 && <Releases cdcId={cdcId} hold={h} />}
            {canAct && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`btn btn-xs ${mode === 'release' ? 'btn-primary' : ''}`} onClick={() => setMode(mode === 'release' ? null : 'release')} data-testid="hold-release-open">
                  {q.releaseRequest}
                </button>
                <button type="button" className={`btn btn-xs ${mode === 'dispose' ? 'btn-error' : ''}`} onClick={() => setMode(mode === 'dispose' ? null : 'dispose')} data-testid="hold-dispose-open">
                  {q.disposalRequest}
                </button>
                <Link className="btn btn-ghost btn-xs" to={`${centerPath(cdcId, 'inventory')}?tab=quality&qv=disposals`}>
                  {q.views.disposals} ›
                </Link>
              </div>
            )}
            {canAct && mode && <LineRequest cdcId={cdcId} hold={h} mode={mode} onDone={() => setMode(null)} />}
          </div>
        );
      }}
    </QueryState>
  );
}

/** 해제·폐기 요청 — 보류 줄마다 남은 수량 이하. 칸을 안 정한 보류 줄은 칸을 적어야 한다(ExactLine 은 칸 필수) */
function LineRequest({ cdcId, hold, mode, onDone }: { readonly cdcId: string; readonly hold: Hold; readonly mode: 'release' | 'dispose'; readonly onDone: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const holdId = hold.holdId ?? '';
  const lines = (hold.lines ?? []).filter((l) => remainingOf(l) > 0);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [loc, setLoc] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<(typeof DISPOSAL_REASONS)[number]>('EXPIRED');
  const picked: ExactLine[] = lines
    .map((l) => ({ l, n: toInt(qty[l.lineNo ?? 0] ?? '') }))
    .filter((x) => x.n !== null && x.n > 0)
    .map(({ l, n }) => ({ sku: l.sku ?? '', lot: l.lot ?? '', locationCode: l.locationCode ?? (loc[l.lineNo ?? 0] ?? '').trim(), qty: n! }));
  const over = lines.some((l) => (toInt(qty[l.lineNo ?? 0] ?? '') ?? 0) > remainingOf(l));
  const valid = picked.length > 0 && !over && picked.every((x) => x.locationCode);
  const cmd = useCommand(async (body: { lines: ExactLine[]; note?: string }, key) =>
    mode === 'release'
      ? request('POST', api.quality.POST('/cdcs/{cdcId}/quality-holds/{holdId}/release-requests', { ...commandParams(key, { path: { cdcId, holdId } }), body }))
      : request('POST', api.quality.POST('/cdcs/{cdcId}/disposal-approvals', { ...commandParams(key, { path: { cdcId } }), body: { ...body, holdId, reason } })),
  );
  if (lines.length === 0) return <p className="text-sm text-base-content/60">{q.noRemaining}</p>;
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void cmd.run({ lines: picked, ...(note.trim() ? { note: note.trim() } : {}) }).then((phase) => {
          if (phase.kind === 'done') {
            void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'quality-holds'] });
            void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'disposals'] });
          }
        });
      }}
      data-testid={`hold-${mode}-form`}
    >
      <p className="text-sm font-semibold">{mode === 'release' ? q.releaseRequest : q.disposalRequest}</p>
      {lines.map((l) => {
        const n = l.lineNo ?? 0;
        const tooMany = (toInt(qty[n] ?? '') ?? 0) > remainingOf(l);
        return (
          <div key={n} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-40">
              <SkuName sku={l.sku ?? ''} />
            </span>
            <span className="w-24 font-mono text-xs">{l.lot}</span>
            {l.locationCode ? (
              <span className="w-56 font-mono text-xs">{l.locationCode}</span>
            ) : (
              <input className="input input-xs w-56" placeholder={q.needLocation} aria-label={q.location} value={loc[n] ?? ''} onChange={(e) => setLoc({ ...loc, [n]: e.target.value })} />
            )}
            <input
              className={`input input-xs w-20 ${tooMany ? 'input-error' : ''}`}
              inputMode="numeric"
              aria-label={`${l.sku} ${q.qty}`}
              value={qty[n] ?? ''}
              onChange={(e) => setQty({ ...qty, [n]: e.target.value })}
              data-testid={`req-qty-${n}`}
            />
            <span className="text-xs text-base-content/60">{`/ ${q.remaining} ${messages.qty(remainingOf(l))}`}</span>
          </div>
        );
      })}
      <div className="flex flex-wrap items-end gap-2">
        {mode === 'dispose' && (
          <label className="flex flex-col gap-1 text-sm">
            {q.reason}
            <select className="select select-xs w-32" value={reason} onChange={(e) => setReason(e.target.value as (typeof DISPOSAL_REASONS)[number])} data-testid="dispose-reason">
              {DISPOSAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {q.disposalReason[r]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {q.note}
          <input className="input input-xs w-full min-w-48" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className={`btn btn-xs ${mode === 'dispose' ? 'btn-error' : 'btn-primary'}`} disabled={!valid || cmd.busy} data-testid={`hold-${mode}-go`}>
          {q.requestGo}
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onDone}>
          {q.cancel}
        </button>
      </div>
      <CommandFeedback command={cmd}>
        {() => (
          <p role="status" className="alert alert-info text-sm">
            {q.requestDone}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

/** 해제 요청 목록 + 결정(승인·반려) */
function Releases({ cdcId, hold }: { readonly cdcId: string; readonly hold: Hold }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold">{q.releases}</p>
      <ul className="space-y-2">
        {(hold.releases ?? []).map((r) => (
          <li key={r.releaseId} className="rounded border border-base-300 bg-base-100 p-2 text-sm" data-testid="release-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{r.releaseId}</span>
              <StateBadge map={q.releaseState} state={r.state} />
              <span className="text-xs text-base-content/60">
                {(r.lines ?? []).map((l) => `${l.sku} ${l.lot} ${l.locationCode} × ${l.qty}`).join(' · ')}
              </span>
              <span className="text-xs">
                {q.requestedBy} <Who id={r.requestedBy} />
              </span>
              {r.decidedBy && (
                <span className="text-xs">
                  {q.decidedBy} <Who id={r.decidedBy} />
                </span>
              )}
              {r.rejectReason && <span className="text-xs text-error">{q.rejectReason(r.rejectReason)}</span>}
            </div>
            {r.state === 'REQUESTED' && (
              <Decide
                testId={`release-decide-${r.releaseId}`}
                invalidate={['cdc', cdcId, 'quality-holds']}
                send={(api, body, key) =>
                  request(
                    'POST',
                    api.quality.POST('/cdcs/{cdcId}/quality-holds/{holdId}/release-requests/{releaseId}/decisions', {
                      ...commandParams(key, { path: { cdcId, holdId: hold.holdId ?? '', releaseId: r.releaseId ?? '' } }),
                      body,
                    }),
                  )
                }
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Api = ReturnType<typeof useApi>;
/** 결정 칸(승인·반려) — 반려는 사유 필수, 승인할 때 본사 승인 번호는 기준 넘을 때만(서버 판정) */
function Decide({
  send,
  invalidate,
  testId,
}: {
  readonly send: (api: Api, body: S['DecisionInput'], key: Parameters<Parameters<typeof useCommand>[0]>[1]) => Promise<unknown>;
  readonly invalidate: readonly unknown[];
  readonly testId: string;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [approvalRef, setApprovalRef] = useState('');
  const cmd = useCommand((body: S['DecisionInput'], key) => send(api, body, key));
  const go = (decision: 'APPROVE' | 'REJECT') => {
    const body: S['DecisionInput'] = { decision, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(approvalRef.trim() && decision === 'APPROVE' ? { approvalRef: approvalRef.trim() } : {}) };
    void cmd.run(body).then((phase) => {
      if (phase.kind === 'done') {
        void qc.invalidateQueries({ queryKey: [...invalidate] });
      }
    });
  };
  return (
    <div className="mt-2 space-y-1" data-testid={testId}>
      <div className="flex flex-wrap items-end gap-2">
        <input className="input input-xs w-56" placeholder={q.decisionReason} aria-label={q.decisionReason} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        <input className="input input-xs w-44" placeholder={q.approvalRef} aria-label={q.approvalRef} title={q.approvalHint} value={approvalRef} maxLength={128} onChange={(e) => setApprovalRef(e.target.value)} />
        <button type="button" className="btn btn-xs btn-primary" disabled={cmd.busy} onClick={() => go('APPROVE')}>
          {q.approve}
        </button>
        <button type="button" className="btn btn-xs" disabled={cmd.busy || !reason.trim()} onClick={() => go('REJECT')}>
          {q.reject}
        </button>
      </div>
      <p className="text-xs text-base-content/50">{q.approvalHint}</p>
      <CommandFeedback command={cmd}>
        {() => (
          <p role="status" className="alert alert-info py-1 text-sm">
            {q.decided}
          </p>
        )}
      </CommandFeedback>
    </div>
  );
}

/* ───────────── 폐기 ───────────── */

function Disposals({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params] = useSearchParams();
  const state = DISPOSAL_STATES.find((s) => s === params.get('qs'));
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'disposals', state ?? 'all'],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.quality.GET('/cdcs/{cdcId}/disposal-approvals', { params: { path: { cdcId }, query: { size: 100, ...(state ? { state } : {}) } } })),
  });
  return (
    <div className="space-y-3">
      <StateFilter states={DISPOSAL_STATES} map={q.disposalState} testId="disposal-state" />
      <QueryState state={toUiState(query, (d) => (d.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={q.empty}>
        {(d) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="disposal-table">
              <thead>
                <tr>
                  <th>{q.id}</th>
                  <th>{q.reason}</th>
                  <th>{q.sku}</th>
                  <th className="text-right">{q.approved}</th>
                  <th className="text-right">{q.executed}</th>
                  <th>{q.state}</th>
                  <th>{q.requestedBy}</th>
                  <th>{q.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {(d.items ?? []).map((x) => {
                  const id = x.disposalApprovalId ?? '';
                  const lines = x.lines ?? [];
                  const isOpen = open === id;
                  return (
                    <Fragment key={id}>
                      <tr className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} data-testid="disposal-row">
                        <td className="font-mono text-xs">
                          <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                            {isOpen ? '▾' : '▸'}
                          </span>
                          {id}
                        </td>
                        <td>{label(q.disposalReason, x.reason)}</td>
                        <td>
                          {lines[0] ? <SkuName sku={lines[0].sku ?? ''} /> : messages.none}
                          {lines.length > 1 && <span className="ml-1 text-xs text-base-content/55">{`+${lines.length - 1}`}</span>}
                        </td>
                        <td className="text-right tabular-nums">{messages.qty(lines.reduce((a, l) => a + (l.approvedQty ?? 0), 0))}</td>
                        <td className="text-right tabular-nums">{messages.qty(lines.reduce((a, l) => a + (l.executedQty ?? 0), 0))}</td>
                        <td>
                          <StateBadge map={q.disposalState} state={x.state} />
                        </td>
                        <td>
                          <Who id={x.requestedBy} />
                        </td>
                        <td className="text-xs">{x.createdAt ? formatSeoul(x.createdAt) : messages.none}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="pm-detail bg-base-200/50">
                            <DisposalDetail cdcId={cdcId} d={x} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function DisposalDetail({ cdcId, d }: { readonly cdcId: string; readonly d: Disposal }) {
  const id = d.disposalApprovalId ?? '';
  const canExecute = d.state === 'APPROVED' || d.state === 'PARTIALLY_EXECUTED';
  return (
    <div className="space-y-3 p-1" data-testid="disposal-detail">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/70">
        <span>{`보류 ${d.holdId ?? messages.none}`}</span>
        {d.note && <span>{`${q.note}: ${d.note}`}</span>}
        {d.decidedBy && (
          <span>
            {q.decidedBy} <Who id={d.decidedBy} />
            {d.decisionReason ? ` · ${d.decisionReason}` : ''}
          </span>
        )}
        {d.approvalRef && <span>{`${q.approvalRef} ${d.approvalRef}`}</span>}
      </div>
      {d.state === 'REQUESTED' && (
        <Decide
          testId={`disposal-decide-${id}`}
          invalidate={['cdc', cdcId, 'disposals']}
          send={(api, body, key) =>
            request('POST', api.quality.POST('/cdcs/{cdcId}/disposal-approvals/{disposalApprovalId}/decisions', { ...commandParams(key, { path: { cdcId, disposalApprovalId: id } }), body }))
          }
        />
      )}
      {canExecute ? (
        <Execute cdcId={cdcId} d={d} />
      ) : (
        <table className="table table-xs">
          <thead>
            <tr>
              <th>{q.sku}</th>
              <th>{q.lot}</th>
              <th>{q.location}</th>
              <th className="text-right">{q.approved}</th>
              <th className="text-right">{q.executed}</th>
            </tr>
          </thead>
          <tbody>
            {(d.lines ?? []).map((l) => (
              <tr key={`${l.sku}-${l.lot}-${l.locationCode}`}>
                <td>
                  <SkuName sku={l.sku ?? ''} />
                </td>
                <td className="font-mono">{l.lot}</td>
                <td className="font-mono">{l.locationCode}</td>
                <td className="text-right tabular-nums">{messages.qty(l.approvedQty ?? 0)}</td>
                <td className="text-right tabular-nums">{messages.qty(l.executedQty ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(d.executions ?? []).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold">{q.executions}</p>
          <ul className="space-y-1 text-xs">
            {(d.executions ?? []).map((e) => (
              <li key={e.executionId} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{e.executionId}</span>
                <StateBadge map={q.execState} state={e.state} />
                <span>{`${q.evidence} ${e.evidenceRef ?? messages.none}`}</span>
                <span>{(e.lines ?? []).map((l) => `${l.sku} ${l.lot} × ${l.qty}`).join(' · ')}</span>
                <Who id={e.executedBy} />
                {e.createdAt && <span className="text-base-content/55">{formatSeoul(e.createdAt)}</span>}
                {e.rejectReason && <span className="text-error">{q.rejectReason(e.rejectReason)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 폐기 실행 — 실제 폐기한 수량(승인 − 실행 이하)·증빙 */
function Execute({ cdcId, d }: { readonly cdcId: string; readonly d: Disposal }) {
  const api = useApi();
  const qc = useQueryClient();
  const id = d.disposalApprovalId ?? '';
  const lines = d.lines ?? [];
  const [qty, setQty] = useState<Record<number, string>>({});
  const [evidence, setEvidence] = useState('');
  const left = (i: number) => Math.max(0, (lines[i]?.approvedQty ?? 0) - (lines[i]?.executedQty ?? 0));
  const picked: ExactLine[] = lines
    .map((l, i) => ({ l, n: toInt(qty[i] ?? '') }))
    .filter((x) => x.n !== null && x.n > 0)
    .map(({ l, n }) => ({ sku: l.sku ?? '', lot: l.lot ?? '', locationCode: l.locationCode ?? '', qty: n! }));
  const over = lines.some((_, i) => (toInt(qty[i] ?? '') ?? 0) > left(i));
  const valid = picked.length > 0 && !over && evidence.trim().length > 0;
  const cmd = useCommand(async (body: { evidenceRef: string; lines: ExactLine[] }, key) =>
    request('POST', api.quality.POST('/cdcs/{cdcId}/disposal-approvals/{disposalApprovalId}/executions', { ...commandParams(key, { path: { cdcId, disposalApprovalId: id } }), body })),
  );
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void cmd.run({ evidenceRef: evidence.trim(), lines: picked }).then((phase) => {
          if (phase.kind === 'done') void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'disposals'] });
        });
      }}
      data-testid="disposal-execute"
    >
      <p className="text-sm font-semibold">{q.execute}</p>
      <p className="text-xs text-base-content/60">{q.executeHint}</p>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-40">
            <SkuName sku={l.sku ?? ''} />
          </span>
          <span className="w-24 font-mono text-xs">{l.lot}</span>
          <span className="w-56 font-mono text-xs">{l.locationCode}</span>
          <input
            className={`input input-xs w-20 ${(toInt(qty[i] ?? '') ?? 0) > left(i) ? 'input-error' : ''}`}
            inputMode="numeric"
            aria-label={`${l.sku} ${q.executed}`}
            value={qty[i] ?? ''}
            onChange={(e) => setQty({ ...qty, [i]: e.target.value })}
            data-testid={`exec-qty-${i}`}
          />
          <span className="text-xs text-base-content/60">{`/ ${q.approved} ${messages.qty(l.approvedQty ?? 0)} · ${q.executed} ${messages.qty(l.executedQty ?? 0)}`}</span>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {q.evidence}
          <input className="input input-xs w-56" value={evidence} maxLength={128} onChange={(e) => setEvidence(e.target.value)} data-testid="exec-evidence" />
        </label>
        <button type="submit" className="btn btn-xs btn-error" disabled={!valid || cmd.busy} data-testid="exec-go">
          {q.executeGo}
        </button>
      </div>
      <CommandFeedback command={cmd}>
        {() => (
          <p role="status" className="alert alert-info py-1 text-sm">
            {q.executed_}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

/* ───────────── 리콜 ───────────── */

function Recalls({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ['cdc-recalls'],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.quality.GET('/cdc-recalls', { params: { query: { size: 100 } } })),
  });
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn btn-sm btn-error" onClick={() => setCreating(!creating)} data-testid="recall-new">
          {q.newRecall}
        </button>
      </div>
      {creating && <NewRecall onDone={() => setCreating(false)} />}
      <QueryState state={toUiState(query, (d) => (d.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={q.empty}>
        {(d) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="recall-table">
              <thead>
                <tr>
                  <th>{q.id}</th>
                  <th>{q.sku}</th>
                  <th>{q.lot}</th>
                  <th>{q.reason}</th>
                  <th>{q.severityLabel}</th>
                  <th>{q.state}</th>
                  <th>{q.approvalRef}</th>
                  <th>{q.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {(d.items ?? []).map((r) => {
                  const id = r.recallId ?? '';
                  const isOpen = open === id;
                  return (
                    <Fragment key={id}>
                      <tr className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen} data-testid="recall-row">
                        <td className="font-mono text-xs">
                          <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                            {isOpen ? '▾' : '▸'}
                          </span>
                          {id}
                        </td>
                        <td>
                          <SkuName sku={r.sku ?? ''} />
                        </td>
                        <td className="font-mono text-xs">{(r.lots ?? []).join(', ')}</td>
                        <td>{label(q.recallReason, r.reason)}</td>
                        <td>{label(q.severity, r.severity)}</td>
                        <td>
                          <StateBadge map={q.recallState} state={r.state} />
                        </td>
                        <td className="font-mono text-xs">{r.approvalRef}</td>
                        <td className="text-xs">{r.createdAt ? formatSeoul(r.createdAt) : messages.none}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="pm-detail bg-base-200/50">
                            <RecallDetail cdcId={cdcId} recallId={id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function RecallDetail({ cdcId, recallId }: { readonly cdcId: string; readonly recallId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc-recalls', recallId],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.quality.GET('/cdc-recalls/{recallId}', { params: { path: { recallId } } })),
  });
  return (
    <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
      {(r: Recall) => (
        <div className="grid gap-4 p-1 lg:grid-cols-2" data-testid="recall-detail">
          <div className="space-y-1">
            <p className="text-xs font-semibold">{q.centers}</p>
            {(r.centers ?? []).length === 0 ? (
              <p className="text-sm text-base-content/55">{r.state === 'TRACING' ? q.recallState.TRACING : q.empty}</p>
            ) : (
              <table className="table table-xs">
                <tbody>
                  {(r.centers ?? []).map((c) => (
                    <tr key={`${c.cdcId}-${c.lot}`}>
                      <td className="font-mono">{c.cdcId}</td>
                      <td className="font-mono">{c.lot}</td>
                      <td>
                        {c.cdcId === cdcId ? (
                          <Link className="link font-mono" to={`${centerPath(cdcId, 'inventory')}?tab=quality&qv=holds`}>
                            {c.holdId}
                          </Link>
                        ) : (
                          <span className="font-mono">{c.holdId}</span>
                        )}
                      </td>
                      <td>
                        <StateBadge map={q.holdState} state={c.holdState} />
                      </td>
                      <td className="text-right tabular-nums">{messages.qty(c.heldQty ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold">{q.departures}</p>
            {r.traceFreshness === 'UNAVAILABLE' ? (
              <p className="text-sm text-warning">{q.traceUnavailable}</p>
            ) : (r.departures ?? []).length === 0 ? (
              <p className="text-sm text-base-content/55">{q.empty}</p>
            ) : (
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>{q.lot}</th>
                    <th>TRF</th>
                    <th>{q.mfc}</th>
                    <th className="text-right">{q.departed}</th>
                    <th className="text-right">{q.received}</th>
                    <th className="text-right">{q.unreconciled}</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.departures ?? []).map((x) => (
                    <tr key={`${x.departureId}-${x.lot}`}>
                      <td className="font-mono">{x.lot}</td>
                      <td className="font-mono" title={x.trfId}>{shortRef(x.trfId)}</td>
                      <td className="font-mono">{x.mfcId ?? messages.none}</td>
                      <td className="text-right tabular-nums">{messages.qty(x.q ?? 0)}</td>
                      <td className="text-right tabular-nums">{messages.qty(x.received ?? 0)}</td>
                      <td className={`text-right tabular-nums ${(x.unreconciled ?? 0) > 0 ? 'font-semibold text-warning' : ''}`}>{messages.qty(x.unreconciled ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </QueryState>
  );
}

function NewRecall({ onDone }: { readonly onDone: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [sku, setSku] = useState('');
  const [lots, setLots] = useState('');
  const [reason, setReason] = useState<(typeof RECALL_REASONS)[number]>('SAFETY');
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number] | ''>('');
  const [approvalRef, setApprovalRef] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [note, setNote] = useState('');
  const lotList = [...new Set(lots.split(',').map((x) => x.trim()).filter(Boolean))];
  const valid = sku.trim() && lotList.length > 0 && lotList.length <= 50 && approvalRef.trim();
  const cmd = useCommand(async (body: { sku: string; lots: string[]; reason: (typeof RECALL_REASONS)[number]; approvalRef: string; severity?: (typeof SEVERITIES)[number]; externalRef?: string; note?: string }, key) =>
    request('POST', api.quality.POST('/cdc-recalls', { ...commandParams(key, {}), body })),
  );
  return (
    <form
      className="space-y-3 rounded-box border border-error/40 bg-base-100 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void cmd
          .run({
            sku: sku.trim(),
            lots: lotList,
            reason,
            approvalRef: approvalRef.trim(),
            ...(severity ? { severity } : {}),
            ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          })
          .then((phase) => {
            if (phase.kind === 'done') void qc.invalidateQueries({ queryKey: ['cdc-recalls'] });
          });
      }}
      data-testid="recall-form"
    >
      <p role="note" className="text-sm text-error">
        {q.recallHint}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {q.sku}(SKU)
          <input className="input input-sm w-36" value={sku} onChange={(e) => setSku(e.target.value)} data-testid="recall-sku" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {q.recallLots}
          <input className="input input-sm w-56" value={lots} onChange={(e) => setLots(e.target.value)} data-testid="recall-lots" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {q.reason}
          <select className="select select-sm w-32" value={reason} onChange={(e) => setReason(e.target.value as (typeof RECALL_REASONS)[number])}>
            {RECALL_REASONS.map((r) => (
              <option key={r} value={r}>
                {q.recallReason[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {q.severityLabel}
          <select className="select select-sm w-36" value={severity} onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number] | '')}>
            <option value="">{messages.none}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {q.severity[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {q.approvalRef}
          <input className="input input-sm w-44" value={approvalRef} maxLength={128} onChange={(e) => setApprovalRef(e.target.value)} data-testid="recall-approval" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {q.externalRef}
          <input className="input input-sm w-44" value={externalRef} maxLength={128} onChange={(e) => setExternalRef(e.target.value)} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {q.note}
          <input className="input input-sm w-full min-w-48" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-error" disabled={!valid || cmd.busy} data-testid="recall-go">
          {q.recallGo}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>
          {q.cancel}
        </button>
      </div>
      <CommandFeedback command={cmd}>
        {(r: Recall) => (
          <p role="status" className="alert alert-info text-sm">
            {q.recallDone(r.recallId ?? '')} <StateBadge map={q.recallState} state={r.state} />
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}
