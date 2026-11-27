// 실사 — cdc-inventory 0.8.0 `/cdcs/{cdcId}/count-sessions`(MFC 실사와 같게 — 사용자 "MFC 실사와 같게").
// 사용자 2026-11-26 "실사는 정해진 양식대로, 칸 별로 딱딱 입력할 수 있게": 칸은 구역·층·통로로 불러 골라 시작하고, 계수표(칸·상품·LOT)마다 수량 칸에 넣는다.
// - 시작 `POST`(칸 1~200) → COUNTING. 칸이 잠기고 계수표에는 장부 수량이 없다(서버가 주지 않음 — 보지 않고 센다).
// - 첫 계수 `POST …/counts`(COUNTING) → 같으면 MATCHED, 다르면 RECOUNT_REQUIRED. 계수자 = 로그인한 사람.
// - 재계수 `POST …/recounts`(RECOUNT_REQUIRED, 첫 계수자와 다른 사람 — 같으면 409 SAME_COUNTER) → MATCHED 또는 PENDING_APPROVAL.
// - 결정 `POST …/decisions`(PENDING_APPROVAL, 시작·계수자가 아닌 관리자 — 422 SELF_APPROVAL).
// - 모든 줄에 수량을 넣어야 보낸다(빈 칸을 0 으로 치지 않는다). 현장 PDA 로 세도 된다 — 같은 실사.
// - 최근 실사 목록(0.12.0 CS-1 — 2026-11-27 백엔드 회신으로 붙임)·화면 번호로 열기(0.17.0 number).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { FieldList } from '@pmart/web-ui/standard';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/cdc-inventory';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { Who } from '../../shared/OperatorLabel';
import { SkuName } from '../../shared/SkuName';

const c = messages.countSession;
type CountSession = components['schemas']['CountSession'];
const AREAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
const FLOORS = ['5', '6', '7'] as const;
const MAX = 200;

function CountStateBadge({ state }: { readonly state: string | undefined }) {
  if (!state) return <>{messages.none}</>;
  const tone = state === 'PENDING_APPROVAL' || state === 'RECOUNT_REQUIRED' ? 'badge-warning' : state === 'COUNTING' ? 'badge-info' : state === 'REJECTED' ? 'badge-ghost' : 'badge-success';
  return <span className={`badge badge-sm ${tone}`}>{c.states[state] ?? state}</span>;
}

/** 실사 단계 — 시작 → 첫 계수 → (다르면) 재계수 → (다르면) 결정 */
function Steps({ state }: { readonly state: string | undefined }) {
  const order = ['COUNTING', 'RECOUNT_REQUIRED', 'PENDING_APPROVAL', 'DONE'];
  // 지금 할 단계까지 칠한다 — 계수 중이면 "첫 계수", 재계수 필요면 "재계수", 결정 대기·끝이면 "결정·끝"
  const at = state === 'MATCHED' || state === 'APPROVED' || state === 'REJECTED' ? 3 : Math.min(3, order.indexOf(state ?? '') + 1);
  return (
    <ol className="steps steps-horizontal w-full text-xs" data-testid="count-steps">
      {c.stepNames.map((n, i) => (
        <li key={n} className={`step ${i <= at ? 'step-primary' : ''}`}>
          {n}
        </li>
      ))}
    </ol>
  );
}

export function CountTab({ cdcId }: { readonly cdcId: string }) {
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('session') ?? '';
  const api = useApi();
  const [openId, setOpenId] = useState('');
  const [miss, setMiss] = useState<string | null>(null);
  const go = (id: string) => {
    const q = new URLSearchParams(params);
    if (id) q.set('session', id);
    else q.delete('session');
    setParams(q, { replace: true });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-base-content/60">{c.lead}</p>
      {sessionId ? (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('')}>
            {c.newOne}
          </button>
          <CountSessionView cdcId={cdcId} sessionId={sessionId} />
        </>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <StartForm cdcId={cdcId} onStarted={go} />
            <form
              className="h-fit space-y-3 rounded-box border border-base-300 bg-base-100 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const v = openId.trim();
                if (!v) return;
                setMiss(null);
                // 화면 번호(0.17.0 number)로 먼저 찾고, 못 찾으면 시스템 ID 로 연다
                if (v.toUpperCase().startsWith('CNT-')) return go(v);
                void request('GET', api.inventory.GET('/cdcs/{cdcId}/count-sessions', { params: { path: { cdcId }, query: { number: v, size: 1 } } })).then(
                  (d) => (d.items[0]?.sessionId ? go(d.items[0].sessionId) : setMiss(v)),
                  () => setMiss(v),
                );
              }}
            >
              <h2 className="text-base font-semibold">{c.openById}</h2>
              <div className="flex gap-2">
                <input className="input input-sm w-full" value={openId} placeholder={c.idPlaceholder} onChange={(e) => setOpenId(e.target.value)} aria-label={c.openById} />
                <button type="submit" className="btn btn-sm" disabled={!openId.trim()}>
                  {c.open}
                </button>
              </div>
              {miss && <p className="text-xs text-error">{c.notFound(miss)}</p>}
            </form>
          </div>
          <RecentCounts cdcId={cdcId} onOpen={go} />
        </>
      )}
    </div>
  );
}

/** 최근 실사(cdc-inventory 0.12.0 CS-1 — 만든 시각 최신 순) — 끝나지 않은 것 먼저, 누르면 그 실사 */
const OPEN_STATES = new Set(['COUNTING', 'RECOUNT_REQUIRED', 'PENDING_APPROVAL']);
function RecentCounts({ cdcId, onOpen }: { readonly cdcId: string; readonly onOpen: (id: string) => void }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'count-sessions', 'recent'],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/count-sessions', { params: { path: { cdcId }, query: { size: 30 } } })),
  });
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{c.recent}</h2>
      <p className="text-xs text-base-content/55">{c.recentHint}</p>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={c.recentEmpty}>
        {(d) => (
          <ul className="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100" data-testid="count-recent">
            {[...d.items]
              .sort((a, b) => Number(!OPEN_STATES.has(a.state ?? '')) - Number(!OPEN_STATES.has(b.state ?? '')))
              .map((s) => (
                <li key={s.sessionId}>
                  <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-base-200" onClick={() => s.sessionId && onOpen(s.sessionId)} data-testid="count-recent-row">
                    <span className="w-28 font-mono font-semibold" title={s.sessionId}>
                      {s.sessionNumber ?? s.sessionId}
                    </span>
                    <CountStateBadge state={s.state} />
                    <span className="text-base-content/70">{c.recentLine(s.locationCodes?.length ?? 0)}</span>
                    {s.reason && <span className="text-base-content/60">{s.reason}</span>}
                    <span className="ml-auto flex items-center gap-2 text-xs text-base-content/55">
                      <Who id={s.startedBy} />
                      {s.createdAt ? formatSeoul(s.createdAt) : ''}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

/** 실사 시작 — 구역·층·통로로 칸을 불러 체크해서 고른다(출고대기 91·접안 90 은 실사 대상 아님) */
function StartForm({ cdcId, onStarted }: { readonly cdcId: string; readonly onStarted: (id: string) => void }) {
  const api = useApi();
  // ?loc=<칸 코드> 로 오면(재계수 대기 [이 칸 실사]) 그 칸의 구역·층·통로를 열고 미리 고른다
  const [params] = useSearchParams();
  const preset = params.get('loc')?.split('-') ?? [];
  const [area, setArea] = useState<(typeof AREAS)[number]>((AREAS as readonly string[]).includes(preset[1] ?? '') ? (preset[1] as (typeof AREAS)[number]) : 'C');
  const [floor, setFloor] = useState<(typeof FLOORS)[number]>((FLOORS as readonly string[]).includes(preset[2] ?? '') ? (preset[2] as (typeof FLOORS)[number]) : '5');
  const [aisle, setAisle] = useState(preset[3] ?? '');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(params.get('loc') ? [params.get('loc')!] : []));
  const [reason, setReason] = useState('');
  const locs = useQuery({
    queryKey: ['cdc', cdcId, 'locations', 'count-pick', area, floor],
    queryFn: async () => {
      const page = await request('GET', api.location.GET('/cdcs/{cdcId}/locations', { params: { path: { cdcId }, query: { area, floor, size: 200 } } }));
      return (page.items ?? []).filter((l) => l.state !== 'RETIRED' && l.locationType !== 'STAGING' && l.locationType !== 'DOCK');
    },
  });
  const shown = useMemo(() => (locs.data ?? []).filter((l) => !aisle.trim() || l.parts?.aisle === aisle.trim().padStart(2, '0')), [locs.data, aisle]);
  const start = useCommand(async (body: { locationCodes: string[]; reason?: string }, key) =>
    request('POST', api.inventory.POST('/cdcs/{cdcId}/count-sessions', { ...commandParams(key, { path: { cdcId } }), body })),
  );
  const toggle = (code: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else if (next.size < MAX) next.add(code);
      return next;
    });
  const allShown = shown.length > 0 && shown.every((l) => picked.has(l.locationCode));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (picked.size === 0) return;
    void start.run({ locationCodes: [...picked], ...(reason.trim() ? { reason: reason.trim() } : {}) }).then((phase) => {
      if (phase.kind === 'done' && phase.result.sessionId) onStarted(phase.result.sessionId);
    });
  };
  return (
    <form className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" onSubmit={submit} data-testid="count-start">
      <h2 className="text-base font-semibold">{c.start}</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {messages.master.loc.area}
          <select className="select select-sm w-24" value={area} onChange={(e) => setArea(e.target.value as (typeof AREAS)[number])} data-testid="count-area">
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {messages.master.loc.floor}
          <select className="select select-sm w-24" value={floor} onChange={(e) => setFloor(e.target.value as (typeof FLOORS)[number])} data-testid="count-floor">
            {FLOORS.map((f) => (
              <option key={f} value={f}>
                {`${f}층`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {c.aisle}
          <input className="input input-sm w-24" value={aisle} placeholder={c.aisleAll} onChange={(e) => setAisle(e.target.value.replace(/\D/g, '').slice(0, 2))} data-testid="count-aisle" />
        </label>
      </div>
      <QueryState state={toUiState(locs, () => shown.length === 0)} onRetry={() => void locs.refetch()} emptyText={c.noLocations}>
        {() => (
          <div className="max-h-72 overflow-y-auto rounded-box border border-base-300">
            <table className="table table-xs" data-testid="count-pick-table">
              <thead className="sticky top-0 bg-base-100">
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      aria-label={c.pickAll}
                      checked={allShown}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (allShown) for (const l of shown) next.delete(l.locationCode);
                          else for (const l of shown) if (next.size < MAX) next.add(l.locationCode);
                          return next;
                        })
                      }
                    />
                  </th>
                  <th>{messages.master.loc.code}</th>
                  <th>{messages.master.loc.type}</th>
                  <th>{messages.master.loc.state}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.locationCode} className="hover cursor-pointer" onClick={() => toggle(l.locationCode)}>
                    <td>
                      <input type="checkbox" className="checkbox checkbox-xs" aria-label={c.pick(l.locationCode)} checked={picked.has(l.locationCode)} onChange={() => toggle(l.locationCode)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td className="font-mono">{l.locationCode}</td>
                    <td>{messages.master.loc.types[l.locationType] ?? l.locationType}</td>
                    <td>{messages.master.loc.states[l.state ?? ''] ?? l.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      <div className="flex flex-wrap items-end gap-3">
        <span className="text-sm" data-testid="count-picked">
          {c.picked(picked.size, MAX)}
        </span>
        <label className="flex flex-col gap-1 text-sm">
          {c.reason}
          <input className="input input-sm w-64" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm btn-primary" disabled={picked.size === 0 || start.busy} data-testid="count-start-go">
          {c.start}
        </button>
      </div>
      <CommandFeedback command={start} />
    </form>
  );
}

function CountSessionView({ cdcId, sessionId }: { readonly cdcId: string; readonly sessionId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'count-session', sessionId],
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/count-sessions/{sessionId}', { params: { path: { cdcId, sessionId } } })),
    // 현장 PDA 로 세는 동안에도 맞게 15초마다 다시 읽는다
    refetchInterval: (q) => (q.state.data?.state === 'COUNTING' || q.state.data?.state === 'RECOUNT_REQUIRED' ? 15_000 : false),
  });
  return (
    <section className="space-y-3" data-testid="count-session">
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(s) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">{c.session(s.sessionId ?? sessionId)}</h2>
              <CountStateBadge state={s.state} />
            </div>
            <Steps state={s.state} />
            <div className="rounded-box border border-base-300 bg-base-100 p-4">
              <FieldList
                rows={[
                  [c.locations, c.locationCount(s.locationCodes?.length ?? 0)],
                  [c.startedBy, <Who id={s.startedBy} />],
                  [c.firstCounter, <Who id={s.firstCounterId} />],
                  [c.recounter, <Who id={s.recounterId} />],
                  [c.decidedBy, <Who id={s.decidedBy} />],
                  [c.createdAt, s.createdAt ? formatSeoul(s.createdAt) : messages.none],
                  [c.decidedAt, s.decidedAt ? formatSeoul(s.decidedAt) : messages.none],
                  [c.reason, s.reason ?? messages.none],
                ]}
              />
            </div>
            {s.state === 'COUNTING' && <CountSheetForm cdcId={cdcId} session={s} kind="first" />}
            {s.state === 'RECOUNT_REQUIRED' && <CountSheetForm cdcId={cdcId} session={s} kind="recount" />}
            {s.lines && s.lines.length > 0 && <ResultTable session={s} />}
            {s.state === 'PENDING_APPROVAL' && <DecideForm cdcId={cdcId} sessionId={sessionId} />}
          </>
        )}
      </QueryState>
    </section>
  );
}

/** 계수표 — 칸·상품·LOT 마다 수량 칸(장부 수량은 보이지 않는다). 모든 줄을 넣어야 보낸다 */
function CountSheetForm({ cdcId, session, kind }: { readonly cdcId: string; readonly session: CountSession; readonly kind: 'first' | 'recount' }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const sheet = useMemo(() => session.sheet ?? [], [session.sheet]);
  const keyOf = (x: { locationCode?: string; sku?: string; lot?: string }) => `${x.locationCode}|${x.sku}|${x.lot}`;
  const [qty, setQty] = useState<Readonly<Record<string, string>>>({});
  const [touched, setTouched] = useState(false);
  const send = useCommand(async (lines: Array<{ locationCode: string; sku: string; lot: string; qty: number }>, key) => {
    const opts = { ...commandParams(key, { path: { cdcId, sessionId: session.sessionId ?? '' } }), body: { lines } };
    return kind === 'first'
      ? request('POST', api.inventory.POST('/cdcs/{cdcId}/count-sessions/{sessionId}/counts', opts))
      : request('POST', api.inventory.POST('/cdcs/{cdcId}/count-sessions/{sessionId}/recounts', opts));
  });
  const missing = sheet.filter((x) => !/^\d+$/.test(qty[keyOf(x)] ?? ''));
  const byLoc = useMemo(() => {
    const m = new Map<string, typeof sheet>();
    for (const x of sheet) m.set(x.locationCode ?? '', [...(m.get(x.locationCode ?? '') ?? []), x]);
    return [...m.entries()];
  }, [sheet]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missing.length > 0) return;
    void send
      .run(sheet.map((x) => ({ locationCode: x.locationCode ?? '', sku: x.sku ?? '', lot: x.lot ?? '', qty: Number(qty[keyOf(x)]) })))
      .then((phase) => {
        if (phase.kind === 'done') void queryClient.invalidateQueries({ queryKey: ['cdc', cdcId, 'count-session', session.sessionId] });
      });
  };
  return (
    <form className="space-y-3 rounded-box border border-primary/40 bg-base-100 p-4" onSubmit={submit} data-testid="count-sheet-form">
      <div>
        <h3 className="text-base font-semibold">{kind === 'first' ? c.firstTitle : c.recountTitle}</h3>
        <p className="text-xs text-base-content/60">{kind === 'first' ? c.firstHint : c.recountHint}</p>
      </div>
      {sheet.length === 0 ? (
        <p className="text-sm text-base-content/60">{c.emptySheet}</p>
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300">
          <table className="table table-sm" data-testid="count-sheet">
            <thead>
              <tr>
                <th>{messages.locStock.location}</th>
                <th>{messages.locStock.product}</th>
                <th>{messages.inventory.lot}</th>
                <th className="w-32 text-right">{c.countedQty}</th>
              </tr>
            </thead>
            <tbody>
              {byLoc.flatMap(([loc, rows]) =>
                rows.map((x, i) => {
                  const k = keyOf(x);
                  const bad = touched && !/^\d+$/.test(qty[k] ?? '');
                  return (
                    <tr key={k}>
                      <td className="font-mono text-xs">{i === 0 ? loc : ''}</td>
                      <td>
                        <SkuName sku={x.sku ?? ''} />
                      </td>
                      <td className="font-mono text-xs">{x.lot}</td>
                      <td className="text-right">
                        <input
                          type="text"
                          inputMode="numeric"
                          className={`input input-sm w-24 text-right tabular-nums ${bad ? 'input-error' : ''}`}
                          value={qty[k] ?? ''}
                          aria-label={c.qtyFor(x.locationCode ?? '', x.sku ?? '', x.lot ?? '')}
                          onChange={(e) => setQty((p) => ({ ...p, [k]: e.target.value.replace(/\D/g, '').slice(0, 7) }))}
                          data-testid={`count-qty-${k}`}
                        />
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
      {touched && missing.length > 0 && (
        <p role="alert" className="text-sm text-error">
          {c.fillAll(missing.length)}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-sm btn-primary" disabled={sheet.length === 0 || send.busy} data-testid="count-submit">
          {kind === 'first' ? c.submitFirst : c.submitRecount}
        </button>
        <span className="text-xs text-base-content/55">{c.counterNote}</span>
      </div>
      <CommandFeedback command={send}>{(r) => <p role="status" className="alert alert-success text-sm">{c.counted(c.states[r.state ?? ''] ?? r.state ?? '')}</p>}</CommandFeedback>
    </form>
  );
}

/** 결정 뒤(MATCHED·APPROVED·REJECTED) 또는 결정 대기 — 서버가 주는 장부·첫 계수·최종·차이 */
function ResultTable({ session }: { readonly session: CountSession }) {
  return (
    <>
      <h3 className="text-sm font-semibold">{c.lines}</h3>
      <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table className="table table-sm" data-testid="count-lines">
          <thead>
            <tr>
              <th>{messages.locStock.location}</th>
              <th>{messages.locStock.product}</th>
              <th>{messages.inventory.lot}</th>
              <th className="text-right">{c.book}</th>
              <th className="text-right">{c.first}</th>
              <th className="text-right">{c.final}</th>
              <th className="text-right">{c.delta}</th>
            </tr>
          </thead>
          <tbody>
            {(session.lines ?? []).map((l) => (
              <tr key={`${l.locationCode}-${l.sku}-${l.lot}`}>
                <td className="font-mono text-xs">{l.locationCode}</td>
                <td>
                  <SkuName sku={l.sku ?? ''} />
                </td>
                <td className="font-mono text-xs">{l.lot}</td>
                <td className="text-right tabular-nums">{messages.qty(l.bookQty ?? 0)}</td>
                <td className="text-right tabular-nums">{messages.qty(l.firstQty ?? 0)}</td>
                <td className="text-right tabular-nums">{messages.qty(l.finalQty ?? 0)}</td>
                <td className={`text-right tabular-nums font-semibold ${(l.deltaQty ?? 0) < 0 ? 'text-error' : (l.deltaQty ?? 0) > 0 ? 'text-success' : ''}`}>{l.deltaQty ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DecideForm({ cdcId, sessionId }: { readonly cdcId: string; readonly sessionId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [approvalRef, setApprovalRef] = useState('');
  const decide = useCommand(async (body: { decision: 'APPROVE' | 'REJECT'; reason: string; approvalRef?: string }, key) =>
    request('POST', api.inventory.POST('/cdcs/{cdcId}/count-sessions/{sessionId}/decisions', { ...commandParams(key, { path: { cdcId, sessionId } }), body })),
  );
  const send = (decision: 'APPROVE' | 'REJECT') => {
    if (!reason.trim()) return;
    void decide.run({ decision, reason: reason.trim(), ...(approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}) }).then((phase) => {
      if (phase.kind === 'done') void queryClient.invalidateQueries({ queryKey: ['cdc', cdcId, 'count-session', sessionId] });
    });
  };
  return (
    <div className="space-y-3 rounded-box border border-warning/40 bg-base-100 p-4" data-testid="count-decide">
      <h3 className="text-sm font-semibold">{c.decide}</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {c.decisionReason}
          <input className="input input-sm w-72" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="count-decision-reason" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {c.approvalRef}
          <input className="input input-sm w-56" value={approvalRef} maxLength={128} onChange={(e) => setApprovalRef(e.target.value)} />
        </label>
        <button type="button" className="btn btn-sm btn-primary" disabled={!reason.trim() || decide.busy} onClick={() => send('APPROVE')} data-testid="count-approve">
          {c.approve}
        </button>
        <button type="button" className="btn btn-sm" disabled={!reason.trim() || decide.busy} onClick={() => send('REJECT')} data-testid="count-reject">
          {c.reject}
        </button>
      </div>
      <CommandFeedback command={decide}>{() => <p role="status" className="alert alert-success text-sm">{c.decided}</p>}</CommandFeedback>
    </div>
  );
}
