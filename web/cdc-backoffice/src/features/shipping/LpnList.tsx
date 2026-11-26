// LPN 목록(출고 단위 — 박스 BOX·팔레트 PLT·롤테이너 RT) — cdc-outbound 0.19.0 `GET /cdcs/{cdcId}/lpns?trfId=&unitType=&page=&size=`(분류 최신 순).
// 분류 → 봉인 → 검품 → 상차까지 어디 있는지 본다. 보기만 — 분류·검품·상차는 현장 PDA.
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { MfcName } from '../../shared/MfcName';
import { findTrfId } from '../../shared/findByNumber';
import { Who } from '../../shared/OperatorLabel';
import { SkuName } from '../../shared/SkuName';
import { trfWavePath } from '../trf-wave/TrfWavePages';

const l = messages.lpn;
const UNITS = ['BOX', 'PLT', 'RT'] as const;
const PAGE_SIZE = 50;

/** 지금 어디까지 — 상차 > 검품 결과 > 분류만 */
function Stage({ x }: { readonly x: { readonly loaded: boolean; readonly inspection?: string | null; readonly failReason?: string | null } }) {
  if (x.loaded) return <span className="badge badge-sm badge-success">{l.loaded}</span>;
  if (x.inspection === 'FAIL' || x.inspection === 'FAILED') return <span className="badge badge-sm badge-error" title={x.failReason ?? undefined}>{l.inspectFail}</span>;
  if (x.inspection) return <span className="badge badge-sm badge-info">{l.inspected}</span>;
  return <span className="badge badge-sm badge-ghost">{l.sorted}</span>;
}

export function LpnList({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const unit = UNITS.find((u) => u === params.get('unit'));
  const trfId = params.get('trf') ?? '';
  const page = Math.max(0, Number(params.get('lp') ?? '0') || 0);
  const [draft, setDraft] = useState(trfId);
  const [miss, setMiss] = useState<string | null>(null);
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
    queryKey: ['cdc', cdcId, 'lpns', unit ?? '', trfId, page],
    refetchInterval: 30_000,
    queryFn: () =>
      request('GET', api.outbound.GET('/cdcs/{cdcId}/lpns', { params: { path: { cdcId }, query: { page, size: PAGE_SIZE, ...(unit ? { unitType: unit } : {}), ...(trfId ? { trfId } : {}) } } })),
  });
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 bg-base-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          setMiss(null);
          if (!v) {
            set({ trf: '', lp: '' });
            return;
          }
          void findTrfId(api, cdcId, v).then(
            (found) => (found ? set({ trf: found, lp: '' }) : setMiss(v)),
            () => setMiss(v),
          );
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          {l.unit}
          <select className="select select-sm w-36" value={unit ?? ''} onChange={(e) => set({ unit: e.target.value, lp: '' })} data-testid="lpn-unit">
            <option value="">{l.all}</option>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {l.units[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          TRF
          <input className="input input-sm w-56" value={draft} placeholder={l.trfPlaceholder} onChange={(e) => setDraft(e.target.value)} data-testid="lpn-trf" />
          {miss && <span className="text-xs text-error">{messages.wave.notFound(miss)}</span>}
        </label>
        <button type="submit" className="btn btn-sm">
          {l.search}
        </button>
        <p className="ml-auto text-xs text-base-content/55">{l.lead}</p>
      </form>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={l.empty}>
        {(d) => (
          <>
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm" data-testid="lpn-table">
                <thead>
                  <tr>
                    <th>LPN</th>
                    <th>{l.unit}</th>
                    <th>TRF · MFC</th>
                    <th>{l.stage}</th>
                    <th>{l.seal}</th>
                    <th>{l.temp}</th>
                    <th>{l.vehicle}</th>
                    <th>{l.sortedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((x) => {
                    const isOpen = open === x.lpn;
                    return (
                      <Fragment key={x.lpn}>
                        <tr className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : x.lpn)} aria-expanded={isOpen} data-testid="lpn-row">
                          <td className="font-mono text-xs">
                            <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                              {isOpen ? '▾' : '▸'}
                            </span>
                            {x.lpn}
                            {x.parentLpn && <span className="block pl-4 text-base-content/55">{l.inParent(x.parentLpn)}</span>}
                          </td>
                          <td>{l.units[x.unitType] ?? x.unitType}</td>
                          <td className="text-xs">
                            <Link className="link font-mono" to={trfWavePath(cdcId, `trf/${encodeURIComponent(x.trfId)}`)} onClick={(e) => e.stopPropagation()}>
                              {shortRef(x.trfId)}
                            </Link>
                            {x.mfcId && <MfcName id={x.mfcId} className="ml-1 text-base-content/60" />}
                          </td>
                          <td>
                            <Stage x={x} />
                          </td>
                          <td className="text-xs">{x.sealNo ?? l.sealState[x.sealState] ?? x.sealState}</td>
                          <td className="text-xs">{x.temperatureZone ? (messages.transport.temp[x.temperatureZone] ?? x.temperatureZone) : messages.none}</td>
                          <td className="text-xs">{x.vehicleId ? `${x.vehicleId}${x.dockCode ? ` · ${x.dockCode}` : ''}` : messages.none}</td>
                          <td className="text-xs">{x.sortedAt ? formatSeoul(x.sortedAt) : messages.none}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={8} className="pm-detail bg-base-200/50">
                              <div className="space-y-2 p-1 text-sm" data-testid="lpn-detail">
                                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/70">
                                  <span>
                                    {l.sortedBy} <Who id={x.sortedBy} />
                                  </span>
                                  {x.weightG !== null && x.weightG !== undefined && <span>{l.weight(x.weightG)}</span>}
                                  {x.inspectedAt && <span>{`${l.inspected} ${formatSeoul(x.inspectedAt)}`}</span>}
                                  {x.failReason && <span className="text-error">{x.failReason}</span>}
                                  {x.loadedAt && <span>{`${l.loaded} ${formatSeoul(x.loadedAt)}`}</span>}
                                  {x.tripId && <span>{`${l.trip} ${x.tripId}`}</span>}
                                </div>
                                {(x.contents ?? []).length === 0 ? (
                                  <p className="text-xs text-base-content/55">{x.unitType === 'BOX' ? l.noContents : l.container}</p>
                                ) : (
                                  <table className="table table-xs">
                                    <tbody>
                                      {(x.contents ?? []).map((c) => (
                                        <tr key={`${c.sku}-${c.lot}`}>
                                          <td>
                                            <SkuName sku={c.sku ?? ''} />
                                          </td>
                                          <td className="font-mono">{c.lot}</td>
                                          <td className="text-right tabular-nums">{messages.qty(c.qty ?? 0)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(page > 0 || d.hasNext) && (
              <div className="flex justify-center gap-2">
                <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => set({ lp: String(page - 1) })}>
                  {l.prev}
                </button>
                <button type="button" className="btn btn-sm" disabled={!d.hasNext} onClick={() => set({ lp: String(page + 1) })}>
                  {l.next}
                </button>
              </div>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
