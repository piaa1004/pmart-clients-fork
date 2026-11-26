// 출하·운송 — TMS 1단계(백엔드 회신 2026-11-26-reply-transport, TR-1·TR-2). 탭 ?v=trips|orders|requests|routes, 출고일 ?date=(기본 오늘 Asia/Seoul).
// - 운행: transport-execution `GET /cdcs/{cdcId}/trips?shipDate=&state=&delayed=`(계획 출차 순). 줄을 펼치면 정차·예상 도착·인계 대조·예외·기록과
//   직원이 대신 넣는 입력(입차·상차 스캔·출차·정차 도착/인계/출발·DC 복귀·예외) — 모두 Idempotency-Key, 상태는 서버가 돌려준 값으로 다시 읽는다.
// - 배차·잔여 물량·노선: TransportPlanning.tsx. 차량·기사(fleet)·노선 등록·정규차 지정: FleetPages.tsx.
// 지연(delayed)·인계 결과(MATCHED/MISMATCHED)·예상 도착은 서버 판정만 보여 준다. 도크는 아직 없다(TR-3 뒤로).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { StatCard } from '@pmart/web-ui/standard';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/transport-execution';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { MfcName, useMfcLabel } from '../../shared/MfcName';
import { Who } from '../../shared/OperatorLabel';
import { DockView } from './DockView';
import { FleetView } from './FleetPages';
import { TransferRequestsView } from './TransferRequests';
import { OrdersView, RoutesView } from './TransportPlanning';

const t = messages.transport;
type S = components['schemas'];
export type Trip = S['Trip'];
type TripState = S['TripState'];
type Stop = Trip['stops'][number];
type IncidentType = S['IncidentType'];
const TRIP_STATES: readonly TripState[] = ['SCHEDULED', 'CHECKED_IN', 'LOADED', 'DEPARTED', 'COMPLETED', 'CANCELLED'];
const VIEWS = ['trips', 'orders', 'docks', 'requests', 'routes', 'fleet'] as const;
type View = (typeof VIEWS)[number];
const MANUAL_INCIDENTS: readonly IncidentType[] = ['DELAY', 'VEHICLE_BREAKDOWN', 'ACCIDENT', 'UNLOADING_WAIT', 'TEMPERATURE_EXCURSION', 'OTHER'];

export const todaySeoul = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const fmt = (v: string | null | undefined) => (v ? formatSeoul(v) : messages.none);
/** 바코드 입력 → 목록(줄바꿈·쉼표·공백) */
const splitCodes = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
export const tempLabel = (v: string | null | undefined) => (v ? (t.temp[v] ?? v) : messages.none);

export function TripStateBadge({ state }: { readonly state: string | null | undefined }) {
  const tone = state === 'COMPLETED' ? 'badge-success' : state === 'DEPARTED' ? 'badge-info' : state === 'CANCELLED' ? 'badge-ghost' : state === 'LOADED' ? 'badge-primary' : 'badge-outline';
  return <span className={`badge badge-sm whitespace-nowrap ${tone}`}>{state ? (t.tripState[state] ?? state) : messages.none}</span>;
}

function DelayBadge({ on }: { readonly on: boolean | undefined }) {
  return on ? (
    <span className="badge badge-sm badge-error whitespace-nowrap" title={t.delayedHint}>
      {t.delayed}
    </span>
  ) : null;
}

/** `/c/:cdcId/transport` */
export function TransportMenu({ cdcId }: { readonly cdcId: string }) {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.find((v) => v === params.get('v')) ?? 'trips';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : todaySeoul();
  const set = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setParams(q, { replace: true });
  };
  return (
    <section className="space-y-4">
      <div>
        <h1>{messages.menus.transport}</h1>
        <p className="max-w-4xl text-sm text-base-content/60">{t.lead}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" className="tabs tabs-box w-fit" data-testid="transport-views">
          {VIEWS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} className={`tab ${view === k ? 'tab-active' : ''}`} onClick={() => set({ v: k === 'trips' ? '' : k, state: '' })}>
              {t.views[k]}
            </button>
          ))}
        </div>
        {view !== 'routes' && view !== 'fleet' && (
          <label className="flex items-center gap-2 text-sm">
            {t.shipDate}
            <input type="date" className="input input-sm w-40" value={date} onChange={(e) => set({ date: e.target.value })} data-testid="transport-date" />
          </label>
        )}
      </div>
      {view === 'trips' && <TripsView cdcId={cdcId} date={date} />}
      {view === 'orders' && <OrdersView cdcId={cdcId} date={date} />}
      {view === 'docks' && <DockView cdcId={cdcId} date={date} />}
      {view === 'requests' && <TransferRequestsView cdcId={cdcId} date={date} />}
      {view === 'routes' && <RoutesView cdcId={cdcId} />}
      {view === 'fleet' && <FleetView />}
    </section>
  );
}

export const tripsKey = (cdcId: string) => ['cdc', cdcId, 'trips'] as const;

function TripsView({ cdcId, date }: { readonly cdcId: string; readonly date: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const filter = params.get('state') ?? '';
  const [open, setOpen] = useState<string | null>(null);
  // 요약 카드는 그날 전체로 세고, 표만 거른다(한 번 읽어 화면에서 거름 — 하루 운행은 노선 × 온도대라 200 안쪽)
  const query = useQuery({
    queryKey: [...tripsKey(cdcId), date],
    refetchInterval: 15_000,
    queryFn: () => request('GET', api.transportExecution.GET('/cdcs/{cdcId}/trips', { params: { path: { cdcId }, query: { shipDate: date, size: 200 } } })),
  });
  const setFilter = (v: string) => {
    const q = new URLSearchParams(params);
    if (v && v !== filter) q.set('state', v);
    else q.delete('state');
    setParams(q, { replace: true });
  };
  return (
    <QueryState state={toUiState(query, () => false)} onRetry={() => void query.refetch()}>
      {(data) => {
        const items = data.items;
        const count = (s: string) => items.filter((x) => x.state === s).length;
        const delayed = items.filter((x) => x.delayed && x.state !== 'COMPLETED' && x.state !== 'CANCELLED').length;
        const incidents = items.reduce((a, x) => a + (x.incidents ?? []).filter((i) => i.state === 'OPEN').length, 0);
        const waiting = items.filter((x) => ['SCHEDULED', 'CHECKED_IN', 'LOADED'].includes(x.state) && x.plannedDepartureAt).sort((a, b) => a.plannedDepartureAt!.localeCompare(b.plannedDepartureAt!));
        const next = waiting[0];
        const nextMin = next ? Math.round((new Date(next.plannedDepartureAt!).getTime() - query.dataUpdatedAt) / 60_000) : null;
        const rows = items.filter((x) => (filter === 'delayed' ? x.delayed : !filter || x.state === filter));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="trip-stats">
              <StatCard layout="stack" label={t.nextDeparture} value={next && nextMin !== null ? t.nextIn(nextMin) : t.noNext} hint={next ? `${next.routeId} ${tempLabel(next.tempClass)} · ${fmt(next.plannedDepartureAt)}` : undefined} tone="info" />
              <StatCard label={t.tripState.DEPARTED} value={count('DEPARTED')} onClick={() => setFilter('DEPARTED')} active={filter === 'DEPARTED'} />
              <StatCard label={t.delayed} value={delayed} hint={t.delayedHint} tone="error" onClick={() => setFilter('delayed')} active={filter === 'delayed'} testId="trip-delayed" />
              <StatCard label={t.openIncidents} value={incidents} tone="warning" />
            </div>
            <div className="flex flex-wrap gap-2" data-testid="trip-state-filter">
              <button type="button" className={`btn btn-xs ${!filter ? 'btn-primary' : ''}`} onClick={() => setFilter('')}>
                {t.all} {items.length}
              </button>
              {TRIP_STATES.map((s) => (
                <button key={s} type="button" className={`btn btn-xs ${filter === s ? 'btn-primary' : ''}`} onClick={() => setFilter(s)}>
                  {t.tripState[s]} {count(s)}
                </button>
              ))}
              <span className="ml-auto self-center text-xs text-base-content/55">{t.refresh}</span>
            </div>
            {rows.length === 0 ? (
              <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60">{t.emptyTrips}</p>
            ) : (
              <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                <table className="table table-sm" data-testid="trip-table">
                  <thead>
                    <tr>
                      <th>{t.trip}</th>
                      <th>{t.route}</th>
                      <th>{t.vehicle}</th>
                      <th>{t.plannedDeparture}</th>
                      <th>{t.state}</th>
                      <th>{t.stops}</th>
                      <th>{t.nextEta}</th>
                      <th className="text-right">{t.boxes}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => {
                      const isOpen = open === x.tripId;
                      const nextStop = x.stops.find((s) => s.state === 'PLANNED' || s.state === 'ARRIVED');
                      const done = x.stops.filter((s) => s.state === 'HANDED_OVER' || s.state === 'DEPARTED').length;
                      return (
                        <Fragment key={x.tripId}>
                          <tr data-testid="trip-row" className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : x.tripId)} aria-expanded={isOpen}>
                            <td className="whitespace-nowrap font-mono text-xs">
                              <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                                {isOpen ? '▾' : '▸'}
                              </span>
                              {x.tripId}
                            </td>
                            <td className="whitespace-nowrap">
                              {x.routeId} · {tempLabel(x.tempClass)}
                            </td>
                            <td className="whitespace-nowrap">
                              {x.plateNo ?? x.vehicleId ?? messages.none}
                              <span className="block text-xs text-base-content/55">
                                {x.driverName ?? x.driverId ?? messages.none}
                                {x.dockCode ? ` · ${t.dock} ${x.dockCode.split('-').slice(1, 5).join('-')}` : ''}
                              </span>
                            </td>
                            <td className="whitespace-nowrap">{fmt(x.plannedDepartureAt)}</td>
                            <td>
                              <span className="flex flex-wrap gap-1">
                                <TripStateBadge state={x.state} />
                                <DelayBadge on={x.delayed} />
                              </span>
                            </td>
                            <td className="whitespace-nowrap">
                              {done} / {x.stops.length}
                            </td>
                            <td className="whitespace-nowrap">{nextStop && x.state === 'DEPARTED' ? `${nextStop.mfcId} ${fmt(nextStop.estimatedArrivalAt ?? nextStop.plannedArrivalAt)}` : messages.none}</td>
                            <td className="whitespace-nowrap text-right">
                              {x.boxCount ?? 0} · {x.rtCount ?? 0}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={8} className="pm-detail bg-base-200/50">
                                <TripDetail cdcId={cdcId} trip={x} />
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
          </div>
        );
      }}
    </QueryState>
  );
}

/** 운행 명령 하나 — 보내고 끝나면 목록을 다시 읽는다 */
function useTripCommand<V>(cdcId: string, send: (vars: V, key: Parameters<typeof commandParams>[0]) => Promise<Trip>) {
  const qc = useQueryClient();
  const cmd = useCommand(send);
  const run = (v: V) =>
    cmd.run(v).then((phase) => {
      if (phase.kind === 'done') void qc.invalidateQueries({ queryKey: tripsKey(cdcId) });
      return phase;
    });
  return { cmd, run };
}

function Done() {
  return (
    <p role="status" className="alert alert-info py-1 text-sm">
      {t.done}
    </p>
  );
}

function TripDetail({ cdcId, trip }: { readonly cdcId: string; readonly trip: Trip }) {
  const api = useApi();
  const tripId = trip.tripId;
  const path = { tripId };
  const simple = useTripCommand(cdcId, (op: 'check-ins' | 'departures' | 'physical-ends', key) => {
    const e = api.transportExecution;
    const p = { ...commandParams(key, { path }), body: {} };
    if (op === 'check-ins') return request('POST', e.POST('/trips/{tripId}/check-ins', p));
    if (op === 'departures') return request('POST', e.POST('/trips/{tripId}/departures', p));
    return request('POST', e.POST('/trips/{tripId}/physical-ends', p));
  });
  const stopsOpen = trip.stops.some((s) => s.state !== 'HANDED_OVER' && s.state !== 'DEPARTED');
  const [panel, setPanel] = useState<'loading' | 'incident' | null>(null);
  return (
    <div className="space-y-3 p-1" data-testid="trip-detail">
      <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <p>
          <span className="text-base-content/60">{t.driver}</span> {trip.driverName ?? trip.driverId ?? messages.none}
        </p>
        <p>
          <span className="text-base-content/60">{t.plannedDeparture}</span> {fmt(trip.plannedDepartureAt)}
          {trip.departedAt ? ` → ${fmt(trip.departedAt)}` : ''}
        </p>
        <p>
          <span className="text-base-content/60">{t.outbound}</span> {trip.departureId ? shortRef(trip.departureId) : messages.none}
          {trip.outboundLinkage ? ` · ${t.linkage[trip.outboundLinkage] ?? trip.outboundLinkage}` : ''}
          {trip.outboundResult ? ` · ${messages.shipping.results[trip.outboundResult] ?? trip.outboundResult}` : ''}
        </p>
        <p data-testid="trip-dock">
          <span className="text-base-content/60">{t.dock}</span> {trip.dockCode ? <span className="font-mono">{trip.dockCode}</span> : <span className="text-base-content/55">{t.noDock}</span>}
        </p>
      </div>

      <StopsTable cdcId={cdcId} trip={trip} />

      <div className="rounded-box border border-base-300 bg-base-100 p-3">
        <h3 className="mb-1 text-sm font-semibold">{t.transfers}</h3>
        <ul className="flex flex-wrap gap-2 text-xs">
          {(trip.transfers ?? []).map((x) => (
            <li key={x.trfId} className={`badge badge-sm ${x.loaded ? 'badge-success badge-outline' : 'badge-ghost'}`}>
              {shortRef(x.trfId)} · {x.loaded ? t.lpnCount(x.lpns?.length ?? 0) : t.notLoaded}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3" data-testid="trip-actions">
        <p className="text-xs text-base-content/60">{t.actionsLead}</p>
        <div className="flex flex-wrap gap-2">
          {trip.state === 'SCHEDULED' && (
            <button type="button" className="btn btn-sm btn-primary" disabled={simple.cmd.busy} onClick={() => void simple.run('check-ins')} data-testid="trip-checkin">
              {t.checkIn}
            </button>
          )}
          {(trip.state === 'CHECKED_IN' || trip.state === 'LOADED') && (
            <button type="button" className="btn btn-sm" onClick={() => setPanel(panel === 'loading' ? null : 'loading')} data-testid="trip-loading-open">
              {t.loading}
            </button>
          )}
          {trip.state === 'LOADED' && (
            <button type="button" className="btn btn-sm btn-primary" title={t.departHint} disabled={simple.cmd.busy} onClick={() => void simple.run('departures')} data-testid="trip-depart">
              {t.depart}
            </button>
          )}
          {trip.state === 'DEPARTED' && !stopsOpen && (
            <button type="button" className="btn btn-sm btn-primary" disabled={simple.cmd.busy} onClick={() => void simple.run('physical-ends')} data-testid="trip-end">
              {t.end}
            </button>
          )}
          {trip.state !== 'CANCELLED' && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPanel(panel === 'incident' ? null : 'incident')} data-testid="incident-open">
              {t.newIncident}
            </button>
          )}
        </div>
        {trip.state === 'LOADED' && <p className="text-xs text-base-content/55">{t.departHint}</p>}
        <CommandFeedback command={simple.cmd}>{() => <Done />}</CommandFeedback>
        {panel === 'loading' && <LoadingForm cdcId={cdcId} trip={trip} onClose={() => setPanel(null)} />}
        {panel === 'incident' && <IncidentForm cdcId={cdcId} trip={trip} onClose={() => setPanel(null)} />}
      </div>

      <Incidents cdcId={cdcId} trip={trip} />

      {(trip.events?.length ?? 0) > 0 && (
        <details className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
          <summary className="cursor-pointer font-semibold">{t.events}</summary>
          <ul className="mt-2 space-y-1 text-xs" data-testid="trip-events">
            {[...(trip.events ?? [])].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`}>
                {fmt(e.at)} · {t.eventType[e.type ?? ''] ?? e.type}
                {e.stopSeq ? ` (${t.stopSeq(e.stopSeq)})` : ''}
                {e.location ? ` · ${e.location}` : ''}
                {e.temperatureC !== null && e.temperatureC !== undefined ? ` · ${e.temperatureC}℃` : ''} · {e.actorId ? <Who id={e.actorId} /> : (t.source[e.source ?? ''] ?? messages.none)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StopsTable({ cdcId, trip }: { readonly cdcId: string; readonly trip: Trip }) {
  const [handover, setHandover] = useState<number | null>(null);
  return (
    <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
      <table className="table table-sm" data-testid="trip-stops">
        <thead>
          <tr>
            <th>{t.stops}</th>
            <th>{t.mfc}</th>
            <th>{t.state}</th>
            <th>{t.plannedArrival}</th>
            <th>{t.eta}</th>
            <th>{t.arrived}</th>
            <th>{t.handover}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {trip.stops.map((s, i) => {
            const seq = s.seq ?? i + 1;
            return (
              <Fragment key={seq}>
                <tr data-testid="stop-row">
                  <td>{t.stopSeq(seq)}</td>
                  <td className="font-mono text-xs">
                    <MfcName id={s.mfcId} />
                    <span className="block text-base-content/55">{(s.trfIds ?? []).map(shortRef).join(', ')}</span>
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      <span className="badge badge-sm badge-outline whitespace-nowrap">{t.stopState[s.state ?? ''] ?? s.state}</span>
                      <DelayBadge on={s.delayed} />
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{fmt(s.plannedArrivalAt)}</td>
                  <td className={`whitespace-nowrap ${s.delayed ? 'font-semibold text-error' : ''}`}>{fmt(s.estimatedArrivalAt)}</td>
                  <td className="whitespace-nowrap">{fmt(s.arrivedAt)}</td>
                  <td>
                    <HandoverCell stop={s} />
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <StopActions cdcId={cdcId} trip={trip} stop={s} seq={seq} onHandover={() => setHandover(handover === seq ? null : seq)} />
                  </td>
                </tr>
                {handover === seq && (
                  <tr>
                    <td colSpan={8}>
                      <HandoverForm cdcId={cdcId} trip={trip} stop={s} seq={seq} onClose={() => setHandover(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HandoverCell({ stop }: { readonly stop: Stop }) {
  const h = stop.handover;
  if (!h) return <>{messages.none}</>;
  const bad = h.result === 'MISMATCHED';
  return (
    <span className="text-xs" data-testid="handover-cell">
      <span className={`badge badge-sm ${bad ? 'badge-error' : 'badge-success'}`}>{t.handoverResult[h.result ?? ''] ?? h.result}</span> {t.handoverCounts(h.shippedBoxes ?? 0, h.receivedBoxes ?? 0)}
      {(h.missingLpns?.length ?? 0) > 0 && <span className="block text-error">{`${t.missing} ${h.missingLpns!.join(', ')}`}</span>}
      {(h.extraLpns?.length ?? 0) > 0 && <span className="block text-error">{`${t.extra} ${h.extraLpns!.join(', ')}`}</span>}
      {(h.damagedLpns?.length ?? 0) > 0 && <span className="block text-error">{`${t.damaged} ${h.damagedLpns!.join(', ')}`}</span>}
      {h.receiverName && <span className="block text-base-content/55">{h.receiverName}</span>}
    </span>
  );
}

function StopActions({ cdcId, trip, stop, seq, onHandover }: { readonly cdcId: string; readonly trip: Trip; readonly stop: Stop; readonly seq: number; readonly onHandover: () => void }) {
  const api = useApi();
  const c = useTripCommand(cdcId, (op: 'arrivals' | 'departures', key) => {
    const p = { ...commandParams(key, { path: { tripId: trip.tripId, stopSeq: seq } }), body: {} };
    return op === 'arrivals'
      ? request('POST', api.transportExecution.POST('/trips/{tripId}/stops/{stopSeq}/arrivals', p))
      : request('POST', api.transportExecution.POST('/trips/{tripId}/stops/{stopSeq}/departures', p));
  });
  if (trip.state !== 'DEPARTED') return null;
  const prevOpen = trip.stops.some((v) => (v.seq ?? 0) < seq && v.state !== 'DEPARTED');
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {stop.state === 'PLANNED' && !prevOpen && (
        <button type="button" className="btn btn-xs btn-primary" disabled={c.cmd.busy} onClick={() => void c.run('arrivals')} data-testid="stop-arrive">
          {t.arrive}
        </button>
      )}
      {stop.state === 'ARRIVED' && (
        <button type="button" className="btn btn-xs btn-primary" onClick={onHandover} data-testid="stop-handover-open">
          {t.handover}
        </button>
      )}
      {stop.state === 'HANDED_OVER' && (
        <button type="button" className="btn btn-xs" disabled={c.cmd.busy} onClick={() => void c.run('departures')} data-testid="stop-depart">
          {t.stopDepart}
        </button>
      )}
      <CommandFeedback command={c.cmd}>{() => null}</CommandFeedback>
    </span>
  );
}

function LoadingForm({ cdcId, trip, onClose }: { readonly cdcId: string; readonly trip: Trip; readonly onClose: () => void }) {
  const api = useApi();
  const transfers = trip.transfers ?? [];
  const [codes, setCodes] = useState<Record<string, string>>(() => Object.fromEntries(transfers.map((x) => [x.trfId ?? '', (x.lpns ?? []).join('\n')])));
  const [rt, setRt] = useState<Record<string, string>>(() => Object.fromEntries(transfers.map((x) => [x.trfId ?? '', x.rtCount === null || x.rtCount === undefined ? '' : String(x.rtCount)])));
  const any = Object.values(codes).some((v) => splitCodes(v).length > 0);
  const c = useTripCommand(cdcId, (body: S['LoadingInput'], key) => request('POST', api.transportExecution.POST('/trips/{tripId}/loading-completions', { ...commandParams(key, { path: { tripId: trip.tripId } }), body })));
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 p-3"
      data-testid="loading-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!any) return;
        void c.run({
          transfers: transfers.map((x) => {
            const id = x.trfId ?? '';
            const n = /^\d+$/.test(rt[id] ?? '') ? Number(rt[id]) : undefined;
            return { trfId: id, lpns: splitCodes(codes[id] ?? ''), ...(n === undefined ? {} : { rtCount: n }) };
          }),
        });
      }}
    >
      <p className="text-xs text-base-content/60">{t.loadingLead}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {transfers.map((x) => {
          const id = x.trfId ?? '';
          return (
            <div key={id} className="space-y-1">
              <label className="flex flex-col gap-1 text-sm">
                {t.lpnsOf(id)}
                <textarea className="textarea textarea-sm font-mono" rows={3} value={codes[id] ?? ''} onChange={(e) => setCodes({ ...codes, [id]: e.target.value })} data-testid={`loading-lpns-${id}`} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                {t.rt}
                <input className="input input-sm w-20" inputMode="numeric" value={rt[id] ?? ''} onChange={(e) => setRt({ ...rt, [id]: e.target.value })} />
              </label>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={!any || c.cmd.busy} data-testid="loading-go">
          {t.loading}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          {t.close}
        </button>
      </div>
      <CommandFeedback command={c.cmd}>{() => <Done />}</CommandFeedback>
    </form>
  );
}

function HandoverForm({ cdcId, trip, stop, seq, onClose }: { readonly cdcId: string; readonly trip: Trip; readonly stop: Stop; readonly seq: number; readonly onClose: () => void }) {
  const api = useApi();
  const trfIds = stop.trfIds ?? [];
  // 빈 칸에서 시작한다 — 보낸 박스를 미리 채우면 대조가 의미 없어진다
  const [got, setGot] = useState<Record<string, string>>({});
  const [bad, setBad] = useState<Record<string, string>>({});
  const [receiver, setReceiver] = useState('');
  const c = useTripCommand(cdcId, (body: S['HandoverInput'], key) =>
    request('POST', api.transportExecution.POST('/trips/{tripId}/stops/{stopSeq}/handovers', { ...commandParams(key, { path: { tripId: trip.tripId, stopSeq: seq } }), body })),
  );
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3"
      data-testid="handover-form"
      onSubmit={(e) => {
        e.preventDefault();
        void c.run({
          ...(receiver.trim() ? { receiverName: receiver.trim() } : {}),
          transfers: trfIds.map((id) => {
            const damaged = splitCodes(bad[id] ?? '');
            return { trfId: id, receivedLpns: splitCodes(got[id] ?? ''), ...(damaged.length ? { damagedLpns: damaged } : {}) };
          }),
        });
      }}
    >
      <p className="text-xs text-base-content/60">{t.handoverLead}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {trfIds.map((id) => (
          <div key={id} className="space-y-1">
            <label className="flex flex-col gap-1 text-sm">
              {t.receivedOf(id)}
              <textarea className="textarea textarea-sm font-mono" rows={3} value={got[id] ?? ''} onChange={(e) => setGot({ ...got, [id]: e.target.value })} data-testid={`handover-lpns-${id}`} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t.damagedOf(id)}
              <input className="input input-sm font-mono" value={bad[id] ?? ''} onChange={(e) => setBad({ ...bad, [id]: e.target.value })} />
            </label>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        {t.receiver}
        <input className="input input-sm w-40" maxLength={30} value={receiver} onChange={(e) => setReceiver(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm btn-primary" disabled={c.cmd.busy} data-testid="handover-go">
          {t.handoverGo}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          {t.close}
        </button>
      </div>
      <CommandFeedback command={c.cmd}>{() => <Done />}</CommandFeedback>
    </form>
  );
}

function IncidentForm({ cdcId, trip, onClose }: { readonly cdcId: string; readonly trip: Trip; readonly onClose: () => void }) {
  const api = useApi();
  const mfcLabel = useMfcLabel();
  const [type, setType] = useState<IncidentType>('DELAY');
  const [stopSeq, setStopSeq] = useState('');
  const [desc, setDesc] = useState('');
  const c = useTripCommand(cdcId, (body: { type: IncidentType; stopSeq?: number; description: string }, key) =>
    request('POST', api.transportExecution.POST('/trips/{tripId}/incidents', { ...commandParams(key, { path: { tripId: trip.tripId } }), body })),
  );
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-box border border-base-300 p-3"
      data-testid="incident-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!desc.trim()) return;
        void c.run({ type, description: desc.trim(), ...(stopSeq ? { stopSeq: Number(stopSeq) } : {}) });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {t.incidents}
        <select className="select select-sm w-32" value={type} onChange={(e) => setType(e.target.value as IncidentType)} data-testid="incident-type">
          {MANUAL_INCIDENTS.map((k) => (
            <option key={k} value={k}>
              {t.incidentType[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t.stopOptional}
        <select className="select select-sm w-36" value={stopSeq} onChange={(e) => setStopSeq(e.target.value)}>
          <option value="">{t.noStop}</option>
          {trip.stops.map((s) => (
            <option key={s.seq} value={String(s.seq)}>
              {t.stopSeq(s.seq ?? 0)} {mfcLabel(s.mfcId)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
        {t.incidentDesc}
        <input className="input input-sm" maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="incident-desc" />
      </label>
      <button type="submit" className="btn btn-sm btn-primary" disabled={!desc.trim() || c.cmd.busy} data-testid="incident-go">
        {t.newIncident}
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
        {t.close}
      </button>
      <div className="w-full">
        <CommandFeedback command={c.cmd}>{() => <Done />}</CommandFeedback>
      </div>
    </form>
  );
}

function Incidents({ cdcId, trip }: { readonly cdcId: string; readonly trip: Trip }) {
  const list = trip.incidents ?? [];
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-3" data-testid="trip-incidents">
      <h3 className="mb-1 text-sm font-semibold">{t.incidents}</h3>
      {list.length === 0 ? (
        <p className="text-xs text-base-content/60">{t.noIncidents}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {list.map((i) => (
            <IncidentRow key={i.incidentId} cdcId={cdcId} tripId={trip.tripId} incident={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function IncidentRow({ cdcId, tripId, incident: i }: { readonly cdcId: string; readonly tripId: string; readonly incident: NonNullable<Trip['incidents']>[number] }) {
  const api = useApi();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const c = useTripCommand(cdcId, (resolution: string, key) =>
    request('POST', api.transportExecution.POST('/trips/{tripId}/incidents/{incidentId}/resolutions', { ...commandParams(key, { path: { tripId, incidentId: i.incidentId ?? '' } }), body: { resolution } })),
  );
  return (
    <li data-testid="incident-row">
      <span className={`badge badge-sm mr-1 ${i.state === 'OPEN' ? 'badge-warning' : 'badge-ghost'}`}>{t.incidentState[i.state ?? ''] ?? i.state}</span>
      <strong>{t.incidentType[i.type ?? ''] ?? i.type}</strong>
      {i.stopSeq ? ` · ${t.stopSeq(i.stopSeq)}` : ''} · {i.description} <span className="text-xs text-base-content/55">{fmt(i.raisedAt)}</span>
      {i.resolution && <span className="block text-xs text-base-content/70">→ {i.resolution}</span>}
      {i.state === 'OPEN' && !open && (
        <button type="button" className="btn btn-xs btn-ghost ml-2" onClick={() => setOpen(true)} data-testid="incident-resolve-open">
          {t.resolve}
        </button>
      )}
      {open && (
        <form
          className="mt-1 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void c.run(text.trim());
          }}
        >
          <input className="input input-sm min-w-56 flex-1" placeholder={t.resolution} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} data-testid="incident-resolution" />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim() || c.cmd.busy} data-testid="incident-resolve-go">
            {t.resolve}
          </button>
          <div className="w-full">
            <CommandFeedback command={c.cmd}>{() => <Done />}</CommandFeedback>
          </div>
        </form>
      )}
    </li>
  );
}
