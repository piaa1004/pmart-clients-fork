// 출고관리 — 출발 검증 결과 cdc-outbound 0.16.0 `GET /cdcs/{cdcId}/departures?result=&page=&size=`(M-3, 검증 최신 순).
// 줄을 펼치면 TRF 별 결과·재고 반영·남은 할당 해제와 불일치(종류·LPN·내용). 보기만 — 출발 검증은 운송(TMS)·현장이 부른다.
// 차량·기사·운행(운송)은 TMS 서비스 뒤라 없다고 적는다.
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { trfWavePath } from '../trf-wave/TrfWavePages';
import { shortRef } from '../../shared/shortRef';
import { LpnList } from './LpnList';

const t = messages.shipping;
type Departure = components['schemas']['DepartureValidation'];
const RESULTS = ['MATCHED', 'PARTIALLY_MATCHED', 'MISMATCHED'] as const;
type Result = (typeof RESULTS)[number];
const PAGE_SIZE = 50;

export function ResultBadge({ result }: { readonly result: string | undefined }) {
  if (!result) return <>{messages.none}</>;
  const tone = result === 'MATCHED' ? 'badge-success' : result === 'PARTIALLY_MATCHED' ? 'badge-warning' : 'badge-error';
  return <span className={`badge badge-sm ${tone}`}>{t.results[result] ?? result}</span>;
}

/** `/c/:cdcId/shipping` */
export function ShippingMenu({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('result');
  const result = (RESULTS as readonly string[]).includes(raw ?? '') ? (raw as Result) : undefined;
  const page = Math.max(0, Number(params.get('page') ?? '0') || 0);
  const view = params.get("v") === "lpns" ? "lpns" : "departures";
  const [open, setOpen] = useState<string | null>(null);
  const set = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setParams(q, { replace: true });
  };
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'departures', result ?? '', page],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/departures', { params: { path: { cdcId }, query: { page, size: PAGE_SIZE, ...(result ? { result } : {}) } } })),
  });
  return (
    <section className="space-y-4">
      <div>
        <h1>{messages.menus.shipping}</h1>
        <p className="text-sm text-base-content/60">{t.lead}</p>
      </div>
      <div role="tablist" className="tabs tabs-box w-fit" data-testid="shipping-views">
        {(["departures", "lpns"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`tab ${view === k ? "tab-active" : ""}`} onClick={() => set({ v: k === "lpns" ? k : "" })}>
            {messages.lpn.views[k]}
          </button>
        ))}
      </div>
      {view === "lpns" ? (
        <LpnList cdcId={cdcId} />
      ) : (
      <>
      <div className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3">
        <label className="flex flex-col gap-1 text-sm">
          {t.resultFilter}
          <select className="select select-sm w-36" value={result ?? ''} onChange={(e) => set({ result: e.target.value, page: '' })} data-testid="departure-result">
            <option value="">{t.all}</option>
            {RESULTS.map((r) => (
              <option key={r} value={r}>
                {t.results[r]}
              </option>
            ))}
          </select>
        </label>
        <p className="ml-auto text-xs text-base-content/55">{t.noTransport}</p>
      </div>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.empty}>
        {(data) => (
          <>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="departure-table">
                <thead>
                  <tr>
                    <th>{t.departure}</th>
                    <th>{t.validatedAt}</th>
                    <th>{t.result}</th>
                    <th className="text-right">{t.trfs}</th>
                    <th className="text-right">{t.mismatches}</th>
                    <th>{t.vehicle}</th>
                    <th>{t.source}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => {
                    const k = d.departureId ?? '';
                    const isOpen = open === k;
                    const mismatchCount = d.mismatches?.length ?? 0;
                    return (
                      <Fragment key={k}>
                        <tr data-testid="departure-row" className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen}>
                          <td className="font-mono text-xs">
                            <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                              {isOpen ? '▾' : '▸'}
                            </span>
                            {d.departureNumber ?? (d.tripId ? `${t.trip} ${d.tripId}` : shortRef(k))}
                          </td>
                          <td>{d.validatedAt ? formatSeoul(d.validatedAt) : messages.none}</td>
                          <td>
                            <ResultBadge result={d.overallResult} />
                          </td>
                          <td className="text-right">{d.transfers?.length ?? 0}</td>
                          <td className={`text-right ${mismatchCount > 0 ? 'font-semibold text-error' : ''}`}>{mismatchCount}</td>
                          <td className="font-mono text-xs">{d.vehicleId ?? messages.none}</td>
                          <td>{d.source ? (t.sourceName[d.source] ?? d.source) : messages.none}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={7} className="pm-detail bg-base-200/50">
                              <DepartureDetail cdcId={cdcId} d={d} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 text-sm">
              <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => set({ page: page - 1 > 0 ? String(page - 1) : '' })}>
                {messages.trf.prev}
              </button>
              <span>{messages.trf.page(page)}</span>
              <button type="button" className="btn btn-sm" disabled={!data.hasNext} onClick={() => set({ page: String(page + 1) })}>
                {messages.trf.next}
              </button>
            </div>
          </>
        )}
      </QueryState>
      </>
      )}
    </section>
  );
}

function DepartureDetail({ cdcId, d }: { readonly cdcId: string; readonly d: Departure }) {
  return (
    <div className="space-y-3 py-1" data-testid="departure-detail">
      <p className="text-sm" data-testid="departure-story">
        {t.story(d.vehicleId ?? messages.none, (d.transfers ?? []).length, d.validatedAt ? formatSeoul(d.validatedAt) : messages.none)}{' '}
        {t.storyResult[d.overallResult ?? ''] ?? ''}
      </p>
      <p className="text-xs text-base-content/60">{t.columnsHelp}</p>
      <table className="table table-xs">
        <thead>
          <tr>
            <th>{t.trfs}</th>
            <th>{t.result}</th>
            <th className="text-right">{t.departed}</th>
            <th>{t.posting}</th>
            <th>{t.residual}</th>
          </tr>
        </thead>
        <tbody>
          {(d.transfers ?? []).map((x) => (
            <tr key={x.trfId}>
              <td>
                <Link className="link font-mono" to={trfWavePath(cdcId, `trf/${encodeURIComponent(x.trfId ?? '')}`)} title={x.trfId}>
                  {x.trfNumber ?? shortRef(x.trfId)}
                </Link>
              </td>
              <td>
                <ResultBadge result={x.result} />
              </td>
              <td className="text-right tabular-nums">{messages.qty(x.departedQty ?? 0)}</td>
              <td>{x.postingStatus ? (t.postingState[x.postingStatus] ?? x.postingStatus) : messages.none}</td>
              <td>
                {x.residualStatus ? (t.residualState[x.residualStatus] ?? x.residualStatus) : messages.none}
                {x.residualStatus === 'FAILED' && x.residualReason && <span className="ml-1 text-xs text-error">{x.residualReason}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(d.mismatches?.length ?? 0) === 0 ? (
        <p className="text-xs text-base-content/60">{t.noMismatch}</p>
      ) : (
        <table className="table table-xs" data-testid="departure-mismatches">
          <thead>
            <tr>
              <th>{t.kind}</th>
              <th>{t.lpn}</th>
              <th>{t.trfs}</th>
              <th>{t.detail}</th>
            </tr>
          </thead>
          <tbody>
            {(d.mismatches ?? []).map((x, i) => (
              <tr key={`${x.kind}-${x.lpn}-${i}`}>
                <td className="text-error">{x.kind ? (t.mismatchKind[x.kind] ?? x.kind) : messages.none}</td>
                <td className="font-mono">{x.lpn ?? messages.none}</td>
                <td className="font-mono" title={x.trfId}>{x.trfId ? shortRef(x.trfId) : messages.none}</td>
                <td className="whitespace-normal">{x.detail ?? messages.none}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
