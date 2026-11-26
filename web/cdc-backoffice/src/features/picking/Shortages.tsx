// 피킹 부족 재할당(결품 관리) — cdc-outbound 0.19.0 `GET /cdcs/{cdcId}/shortages?state=`(최신 순).
// PDA 가 부족을 올리면 서버가 그 칸 재고를 풀고(재계수 대기) 다른 칸에서 다시 할당해 새 작업을 만든다. 보기만 — 서버가 진행한다.
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { MfcName } from '../../shared/MfcName';
import { SkuName } from '../../shared/SkuName';
import { trfWavePath } from '../trf-wave/TrfWavePages';

const s = messages.shortages;
const STATES = ['PENDING', 'RELEASED', 'DONE', 'FAILED'] as const;
type State = (typeof STATES)[number];
const tone = (st: string) => (st === 'FAILED' ? 'badge-error' : st === 'DONE' ? 'badge-success' : 'badge-warning');

export function Shortages({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const raw = params.get('ss');
  const state: State | undefined = raw === 'all' ? undefined : (STATES.find((x) => x === raw) ?? 'PENDING');
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'shortages', state ?? 'all'],
    refetchInterval: 30_000,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/shortages', { params: { path: { cdcId }, query: { size: 100, ...(state ? { state } : {}) } } })),
  });
  return (
    <section className="space-y-2" data-testid="shortages">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-base font-semibold">{s.title}</h2>
          <p className="text-xs text-base-content/60">{s.lead}</p>
        </div>
        <label className="ml-auto flex flex-col gap-1 text-sm">
          {s.stateFilter}
          <select
            className="select select-sm w-36"
            value={state ?? 'all'}
            onChange={(e) => {
              const q = new URLSearchParams(params);
              q.set('ss', e.target.value);
              setParams(q, { replace: true });
            }}
            data-testid="shortage-state"
          >
            {STATES.map((x) => (
              <option key={x} value={x}>
                {s.state[x]}
              </option>
            ))}
            <option value="all">{s.all}</option>
          </select>
        </label>
      </div>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={s.empty}>
        {(d) => (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm" data-testid="shortage-table">
              <thead>
                <tr>
                  <th>{s.sku}</th>
                  <th>{s.location}</th>
                  <th>TRF · MFC</th>
                  <th className="text-right">{s.short}</th>
                  <th className="text-right">{s.reallocated}</th>
                  <th className="text-right">{s.unresolved}</th>
                  <th>{s.stateLabel}</th>
                  <th>{s.createdAt}</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((x) => (
                  <tr key={x.followupId} data-testid="shortage-row">
                    <td>
                      <SkuName sku={x.sku} />
                      <span className="block font-mono text-xs text-base-content/55">{x.lot}</span>
                    </td>
                    <td className="font-mono text-xs">
                      <Link className="link" to={`${centerPath(cdcId, 'inventory')}?tab=recount`}>
                        {x.locationCode}
                      </Link>
                    </td>
                    <td className="text-xs">
                      <Link className="link font-mono" to={trfWavePath(cdcId, `trf/${encodeURIComponent(x.trfId)}`)}>
                        {shortRef(x.trfId)}
                      </Link>
                      {x.mfcId && <MfcName id={x.mfcId} className="ml-1 text-base-content/60" />}
                    </td>
                    <td className="text-right tabular-nums font-semibold text-error">{messages.qty(x.shortQty)}</td>
                    <td className="text-right tabular-nums">{messages.qty(x.reallocatedQty)}</td>
                    <td className={`text-right tabular-nums ${x.unresolvedQty > 0 ? 'font-semibold text-warning' : ''}`}>{messages.qty(x.unresolvedQty)}</td>
                    <td>
                      <span className={`badge badge-sm ${tone(x.state)}`}>{s.state[x.state] ?? x.state}</span>
                      {x.reason && <span className="block text-xs text-base-content/60">{x.reason}</span>}
                    </td>
                    <td className="text-xs">{x.createdAt ? formatSeoul(x.createdAt) : messages.none}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </section>
  );
}
