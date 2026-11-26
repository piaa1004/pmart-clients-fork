// 출하·운송 — 배차(운송지시서)·잔여 물량(이관요청서)·노선. transport-planning 0.2.0(TR-1).
// - 배차 `GET /cdcs/{cdcId}/transport-orders?shipDate=`, 생성 `POST …/transport-orders/generations {shipDate}`,
//   계획완료 `…/{orderId}/confirmations`(X-Expected-Version), 결행 `…/skips`, 취소 `…/cancellations`, 요청서 옮기기 `…/request-moves`(X-Expected-Version).
// - 잔여 물량 `GET /cdcs/{cdcId}/transport-requests?shipDate=&state=`(기본 보류 HELD). 노선 `GET /cdcs/{cdcId}/routes`(보기만 — 등록·정규차 지정은 다음 단계).
// 적재율·적재 초과·결행 후보는 서버 값 그대로. 계획완료가 CONFIRMING 으로 남으면 "계획완료 진행 중"(확정 아님).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/transport-planning';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { MfcName } from '../../shared/MfcName';
import { Who } from '../../shared/OperatorLabel';
import { NewRouteForm, RegularVehicleForm } from './FleetPages';
import { tempLabel, TripStateBadge, tripsKey } from './TransportPage';

const t = messages.transport;
type S = components['schemas'];
type Order = S['TransportOrder'];
const fmt = (v: string | null | undefined) => (v ? formatSeoul(v) : messages.none);
const ordersKey = (cdcId: string) => ['cdc', cdcId, 'transport-orders'] as const;

function OrderStateBadge({ state }: { readonly state: string }) {
  const tone = state === 'DISPATCHED' ? 'badge-success' : state === 'CONFIRMING' ? 'badge-warning' : state === 'PLANNING' ? 'badge-info' : 'badge-ghost';
  return <span className={`badge badge-sm whitespace-nowrap ${tone}`}>{t.orderState[state] ?? state}</span>;
}

function LoadBar({ o }: { readonly o: Order }) {
  const ratio = o.loadRatio ?? (o.maxRt ? (o.loadRt ?? 0) / o.maxRt : 0);
  const over = o.flags?.includes('OVER_CAPACITY');
  return (
    <span className="flex min-w-28 items-center gap-2">
      <progress className={`progress h-2 w-16 ${over ? 'progress-error' : 'progress-primary'}`} value={Math.min(ratio, 1) * 100} max={100} />
      <span className={`whitespace-nowrap text-xs ${over ? 'font-semibold text-error' : ''}`}>{t.loadOf(o.loadRt ?? 0, o.maxRt ?? 0)}</span>
    </span>
  );
}

export function OrdersView({ cdcId, date }: { readonly cdcId: string; readonly date: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [...ordersKey(cdcId), date],
    queryFn: () => request('GET', api.transportPlanning.GET('/cdcs/{cdcId}/transport-orders', { params: { path: { cdcId }, query: { shipDate: date, size: 200 } } })),
  });
  const gen = useCommand(async (shipDate: string, key) => request('POST', api.transportPlanning.POST('/cdcs/{cdcId}/transport-orders/generations', { ...commandParams(key, { path: { cdcId } }), body: { shipDate } })));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-box border border-base-300 bg-base-100 p-3">
        <p className="min-w-64 max-w-3xl flex-1 text-sm text-base-content/60">{t.ordersLead}</p>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={gen.busy}
            title={t.generateHint}
            data-testid="orders-generate"
            onClick={() =>
              void gen.run(date).then((p) => {
                if (p.kind === 'done') void qc.invalidateQueries({ queryKey: ['cdc', cdcId] });
              })
            }
          >
            {t.generate}
          </button>
          <span className="text-xs text-base-content/55">{t.generateHint}</span>
        </div>
        <div className="w-full">
          <CommandFeedback command={gen}>
            {(r) => (
              <div role="status" className="alert alert-info flex-col items-start gap-1 py-2 text-sm" data-testid="orders-generated">
                <span>{t.generated(r.orders?.length ?? 0)}</span>
                {r.requests && (
                  <span className="text-xs">
                    {t.requestsByState}:{' '}
                    {Object.entries(r.requests)
                      .map(([k, n]) => `${t.reqState[k] ?? k} ${n}`)
                      .join(' · ')}
                  </span>
                )}
                {(r.unplannedReasons?.length ?? 0) > 0 && (
                  <span className="text-xs">
                    {t.unplanned}: {r.unplannedReasons!.map((u) => `${u.routeId} ${tempLabel(u.tempClass)} — ${t.unplannedReason[u.reason ?? ''] ?? u.reason}`).join(', ')}
                  </span>
                )}
              </div>
            )}
          </CommandFeedback>
        </div>
      </div>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.emptyOrders}>
        {(data) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="order-table">
              <thead>
                <tr>
                  <th>{t.trip}</th>
                  <th>{t.route}</th>
                  <th>{t.vehicle}</th>
                  <th>{t.plannedDeparture}</th>
                  <th>{t.load}</th>
                  <th className="text-right">{t.trfs}</th>
                  <th>{t.state}</th>
                  <th>{t.tripStateCopy}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => {
                  const isOpen = open === o.orderId;
                  return (
                    <Fragment key={o.orderId}>
                      <tr data-testid="order-row" className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : o.orderId)} aria-expanded={isOpen}>
                        <td className="whitespace-nowrap font-mono text-xs">
                          <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                            {isOpen ? '▾' : '▸'}
                          </span>
                          {o.orderId}
                        </td>
                        <td className="whitespace-nowrap">
                          {o.routeId} · {tempLabel(o.tempClass)}
                        </td>
                        <td className="font-mono text-xs">{o.vehicleId ?? messages.none}</td>
                        <td className="whitespace-nowrap">{fmt(o.plannedDepartureAt)}</td>
                        <td>
                          <LoadBar o={o} />
                        </td>
                        <td className="text-right">{o.trfIds?.length ?? 0}</td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            <OrderStateBadge state={o.state} />
                            {o.flags?.includes('OVER_CAPACITY') && <span className="badge badge-sm badge-error whitespace-nowrap">{t.overCapacity}</span>}
                            {o.cancelCandidate && o.state === 'PLANNING' && <span className="badge badge-sm badge-warning whitespace-nowrap">{t.cancelCandidate}</span>}
                          </span>
                        </td>
                        <td>{o.tripState ? <TripStateBadge state={o.tripState} /> : messages.none}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="pm-detail bg-base-200/50">
                            <OrderDetail cdcId={cdcId} order={o} all={data.items} />
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

function useOrderCommand<V>(cdcId: string, send: (vars: V, key: Parameters<typeof commandParams>[0]) => Promise<Order>) {
  const qc = useQueryClient();
  const cmd = useCommand(send);
  const run = (v: V) =>
    cmd.run(v).then((phase) => {
      if (phase.kind === 'done') {
        void qc.invalidateQueries({ queryKey: ordersKey(cdcId) });
        void qc.invalidateQueries({ queryKey: ['cdc', cdcId, 'transport-requests'] });
        void qc.invalidateQueries({ queryKey: tripsKey(cdcId) });
      }
      return phase;
    });
  return { cmd, run };
}

function OrderDetail({ cdcId, order: o, all }: { readonly cdcId: string; readonly order: Order; readonly all: readonly Order[] }) {
  const api = useApi();
  const p = api.transportPlanning;
  const path = { cdcId, orderId: o.orderId };
  const [panel, setPanel] = useState<'skip' | 'cancel' | 'move' | null>(null);
  const confirm = useOrderCommand(cdcId, (_: undefined, key) => request('POST', p.POST('/cdcs/{cdcId}/transport-orders/{orderId}/confirmations', { ...commandParams(key, { path, version: o.version }), body: {} })));
  const planning = o.state === 'PLANNING';
  const cancellable = planning || (o.state === 'DISPATCHED' && o.tripState !== 'DEPARTED' && o.tripState !== 'COMPLETED');
  const hasReq = (o.trfIds?.length ?? 0) > 0;
  const over = o.flags?.includes('OVER_CAPACITY') ?? false;
  return (
    <div className="space-y-3 p-1" data-testid="order-detail">
      <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>{t.stops}</th>
              <th>{t.mfc}</th>
              <th>{t.plannedArrival}</th>
              <th>{t.trfs}</th>
              <th className="text-right">{t.boxes}</th>
            </tr>
          </thead>
          <tbody>
            {(o.stops ?? []).map((s) => (
              <tr key={s.seq}>
                <td>{t.stopSeq(s.seq ?? 0)}</td>
                <td>
                  <MfcName id={s.mfcId} />
                </td>
                <td>{fmt(s.plannedArrivalAt)}</td>
                <td className="font-mono">{(s.trfIds ?? []).map(shortRef).join(', ') || messages.none}</td>
                <td className="text-right">
                  {s.boxCount ?? 0} · {s.rtCount ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o.state !== 'PLANNING' && (
        <p className="text-sm" data-testid="order-dock">
          <span className="text-base-content/60">{t.dock}</span> {o.dockCode ? <span className="font-mono">{o.dockCode}</span> : <span className="text-base-content/55">{t.noDock}</span>}
        </p>
      )}
      {o.reason && <p className="text-sm">{`${t.reason.replace('(필수)', '')}: ${o.reason}`}</p>}
      {(planning || cancellable) && (
        <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3" data-testid="order-actions">
          <div className="flex flex-wrap gap-2">
            {planning && (
              <button type="button" className="btn btn-sm btn-primary" disabled={!hasReq || over || confirm.cmd.busy} title={t.confirmHint} onClick={() => void confirm.run(undefined)} data-testid="order-confirm">
                {t.confirm}
              </button>
            )}
            {planning && hasReq && (
              <button type="button" className="btn btn-sm" onClick={() => setPanel(panel === 'move' ? null : 'move')} data-testid="order-move-open">
                {t.move}
              </button>
            )}
            {planning && !hasReq && (
              <button type="button" className="btn btn-sm" onClick={() => setPanel(panel === 'skip' ? null : 'skip')} data-testid="order-skip-open">
                {t.skip}
              </button>
            )}
            {cancellable && (
              <button type="button" className="btn btn-sm btn-ghost text-error" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')} data-testid="order-cancel-open">
                {t.cancel}
              </button>
            )}
          </div>
          {planning && <p className="text-xs text-base-content/55">{over ? t.overCapacity : `${t.confirmHint} ${t.dockFull}`}</p>}
          <CommandFeedback command={confirm.cmd}>
            {(r) => (
              <p role="status" className="alert alert-info py-1 text-sm">
                {t.confirmed(t.orderState[r.state] ?? r.state)} · {t.dock} {r.dockCode ?? t.noDock}
              </p>
            )}
          </CommandFeedback>
          {(panel === 'skip' || panel === 'cancel') && <ReasonForm cdcId={cdcId} order={o} kind={panel} onClose={() => setPanel(null)} />}
          {panel === 'move' && <MoveForm cdcId={cdcId} order={o} all={all} onClose={() => setPanel(null)} />}
        </div>
      )}
      {(o.history?.length ?? 0) > 0 && (
        <details className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
          <summary className="cursor-pointer font-semibold">{t.history}</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {[...(o.history ?? [])].reverse().map((h, i) => (
              <li key={`${h.at}-${i}`}>
                {fmt(h.at)} · {h.action} · <Who id={h.actorId} />
                {h.detail ? ` · ${h.detail}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ReasonForm({ cdcId, order: o, kind, onClose }: { readonly cdcId: string; readonly order: Order; readonly kind: 'skip' | 'cancel'; readonly onClose: () => void }) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const c = useOrderCommand(cdcId, (r: string, key) => {
    const params = { ...commandParams(key, { path: { cdcId, orderId: o.orderId } }), body: { reason: r } };
    return kind === 'skip'
      ? request('POST', api.transportPlanning.POST('/cdcs/{cdcId}/transport-orders/{orderId}/skips', params))
      : request('POST', api.transportPlanning.POST('/cdcs/{cdcId}/transport-orders/{orderId}/cancellations', params));
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid={`order-${kind}-form`}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) void c.run(reason.trim());
      }}
    >
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
        {t.reason}
        <input className="input input-sm" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="order-reason" />
      </label>
      <button type="submit" className={`btn btn-sm ${kind === 'cancel' ? 'btn-error' : 'btn-primary'}`} disabled={!reason.trim() || c.cmd.busy} data-testid="order-reason-go">
        {kind === 'skip' ? t.skip : t.cancel}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
        {t.close}
      </button>
      <div className="w-full">
        <CommandFeedback command={c.cmd}>
          {(r) => (
            <p role="status" className="alert alert-info py-1 text-sm">
              {t.orderState[r.state] ?? r.state}
            </p>
          )}
        </CommandFeedback>
      </div>
    </form>
  );
}

function MoveForm({ cdcId, order: o, all, onClose }: { readonly cdcId: string; readonly order: Order; readonly all: readonly Order[]; readonly onClose: () => void }) {
  const api = useApi();
  const targets = all.filter((x) => x.orderId !== o.orderId && x.state === 'PLANNING' && x.tempClass === o.tempClass && x.shipDate === o.shipDate);
  const [trfId, setTrfId] = useState(o.trfIds?.[0] ?? '');
  const [to, setTo] = useState(targets[0]?.orderId ?? '');
  const [reason, setReason] = useState('');
  const c = useOrderCommand(cdcId, (body: { trfId: string; toOrderId: string; reason?: string }, key) =>
    request('POST', api.transportPlanning.POST('/cdcs/{cdcId}/transport-orders/{orderId}/request-moves', { ...commandParams(key, { path: { cdcId, orderId: o.orderId }, version: o.version }), body })),
  );
  if (targets.length === 0) return <p className="text-sm text-base-content/60">{t.noMoveTarget}</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid="order-move-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (trfId && to) void c.run({ trfId, toOrderId: to, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {t.moveTrf}
        <select className="select select-sm w-52" value={trfId} onChange={(e) => setTrfId(e.target.value)} data-testid="move-trf">
          {(o.trfIds ?? []).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t.moveTo}
        <select className="select select-sm w-60" value={to} onChange={(e) => setTo(e.target.value)} data-testid="move-to">
          {targets.map((x) => (
            <option key={x.orderId} value={x.orderId}>
              {x.orderId} · {x.routeId} ({t.loadOf(x.loadRt ?? 0, x.maxRt ?? 0)})
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
        {t.moveReason}
        <input className="input input-sm" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!trfId || !to || c.cmd.busy} data-testid="move-go">
        {t.move}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
        {t.close}
      </button>
      <div className="w-full">
        <CommandFeedback command={c.cmd}>{() => <p role="status" className="alert alert-info py-1 text-sm">{t.done}</p>}</CommandFeedback>
      </div>
    </form>
  );
}

export function RoutesView({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'routes'],
    queryFn: () => request('GET', api.transportPlanning.GET('/cdcs/{cdcId}/routes', { params: { path: { cdcId } } })),
  });
  const [creating, setCreating] = useState(false);
  const [regular, setRegular] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-64 max-w-3xl flex-1 text-sm text-base-content/60">{t.routesLead}</p>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreating(!creating)} data-testid="route-new">
          {t.newRoute}
        </button>
      </div>
      {creating && <NewRouteForm cdcId={cdcId} onClose={() => setCreating(false)} />}
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.emptyRoutes}>
        {(data) => (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="route-list">
            {data.items.map((r) => (
              <article key={r.routeId} className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3" data-testid="route-card">
                <header className="flex flex-wrap items-baseline gap-2">
                  <strong className="font-mono">{r.routeId}</strong>
                  <span>{r.name}</span>
                  {!r.active && <span className="badge badge-sm badge-ghost">{t.inactive}</span>}
                  <span className="ml-auto text-sm text-base-content/70">
                    {t.departureTime} {r.departureTime} · {t.returnMinutes(r.returnMinutes)}
                  </span>
                </header>
                <ol className="flex flex-wrap items-center gap-1 text-xs">
                  <li className="badge badge-sm badge-neutral">DC</li>
                  {r.stops.map((s) => (
                    <li key={s.seq} className="flex items-center gap-1">
                      <span aria-hidden className="text-base-content/40">
                        →
                      </span>
                      <span className="badge badge-sm badge-outline font-mono">
                        <MfcName id={s.mfcId} /> {s.plannedArrivalOffsetMinutes !== undefined ? t.offset(s.plannedArrivalOffsetMinutes) : ''}
                      </span>
                    </li>
                  ))}
                </ol>
                <ul className="flex flex-wrap gap-2 text-xs">
                  {r.regularVehicles.length === 0 ? (
                    <li className="text-base-content/60">{t.unplannedReason.NO_REGULAR_VEHICLE}</li>
                  ) : (
                    r.regularVehicles.map((v) => (
                      <li key={v.tempClass} className="rounded border border-base-300 px-2 py-1">
                        {t.regular} {tempLabel(v.tempClass)} · <span className="font-mono">{v.vehicleId}</span> · {t.maxRt(v.maxRt ?? 0)}
                      </li>
                    ))
                  )}
                </ul>
                {regular === r.routeId ? (
                  <RegularVehicleForm cdcId={cdcId} route={r} onClose={() => setRegular(null)} />
                ) : (
                  <button type="button" className="btn btn-xs" onClick={() => setRegular(r.routeId)} data-testid="regular-open">
                    {t.setRegular}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
