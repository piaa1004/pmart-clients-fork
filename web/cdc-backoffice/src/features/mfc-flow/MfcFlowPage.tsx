// MFC 재고 이동 — DC → MFC 로 보내는 재고가 지금 어디까지 왔는지(사용자 2026-11-26 "mfc로의 실시간 재고이동을 바로 볼 수 있는 거").
// 새 API 없이 기존 직원 조회만, 15초마다 다시 읽는다:
//   `GET /cdcs/{cdcId}/transfers?size=200`(TRF 단계·MFC — 기한 순) · `GET /cdcs/{cdcId}/departures?size=30`(출발 검증 — 최신 순, TRF 별 출발 수량)
//   · `GET /cdcs/{cdcId}/outbound-summary`(오늘 MFC 별 byMfc, 0.18.0) · `GET /cdcs/{cdcId}/stock-snapshot`(SKU 별 transit = 출발했지만 MFC 가 아직 받지 않은 수량).
// 단계 나눔은 TRF 상태로(서버 값) — 확보·대기 / Wave·피킹 / 출고 준비 / 출발. 숫자는 서버 값을 더한 것, 못 읽으면 그 칸은 실패로(0 으로 꾸미지 않는다).
import { useQuery } from '@tanstack/react-query';
import { Fragment, useMemo } from 'react';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import { StatCard } from '@pmart/web-ui/standard';
import type { components } from '../../api/generated/cdc-outbound';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { MfcName } from '../../shared/MfcName';
import { ResultBadge } from '../shipping/ShippingPage';
import { trfWavePath } from '../trf-wave/TrfWavePages';

const t = messages.mfcFlow;
type TransferSummary = components['schemas']['TransferSummary'];
const STAGES = ['WAIT', 'PICK', 'READY', 'DEPARTED'] as const;
type Stage = (typeof STAGES)[number];
const REFRESH = 15_000;

/** TRF 상태 → 단계(취소는 빼고) */
export function stageOf(state: string): Stage | null {
  if (state === 'CANCELLED') return null;
  if (state === 'IN_WAVE' || state === 'PICKING') return 'PICK';
  if (state === 'PICKED' || state === 'SORTED' || state === 'INSPECTED' || state === 'LOADED' || state === 'MISMATCHED') return 'READY';
  if (state === 'DEPARTED') return 'DEPARTED';
  return 'WAIT';
}

const trfLabel = (x: { readonly trfId: string; readonly trfNumber?: string | null }) => x.trfNumber ?? x.trfId;

/** `/c/:cdcId/mfc-flow` */
export function MfcFlowMenu({ cdcId }: { readonly cdcId: string }) {
  const api = useApi();
  const transfers = useQuery({
    queryKey: ['cdc', cdcId, 'transfers', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers', { params: { path: { cdcId }, query: { size: 200 } } })),
  });
  const summary = useQuery({
    queryKey: ['cdc', cdcId, 'outbound-summary', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/outbound-summary', { params: { path: { cdcId } } })),
  });
  const stock = useQuery({
    queryKey: ['cdc', cdcId, 'stock', '', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.inventory.GET('/cdcs/{cdcId}/stock-snapshot', { params: { path: { cdcId } } })),
  });
  const transit = stock.data ? (stock.data.items ?? []).reduce((a, s) => a + (s.transit ?? 0), 0) : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1>{messages.menus.mfcFlow}</h1>
          <p className="max-w-4xl text-sm text-base-content/60">{t.lead}</p>
        </div>
        {transfers.dataUpdatedAt > 0 && <span className="text-xs text-base-content/55">{t.asOf(formatSeoul(new Date(transfers.dataUpdatedAt).toISOString()))}</span>}
      </div>
      <QueryState state={toUiState(transfers, (d) => d.items.length === 0)} onRetry={() => void transfers.refetch()} emptyText={t.noTrf}>
        {(data) => (
          <FlowBody
            cdcId={cdcId}
            trfs={data.items}
            partial={data.hasNext}
            transit={transit}
            transitFailed={stock.isError}
            byMfc={summary.data?.byMfc ?? null}
            summaryFailed={summary.isError}
          />
        )}
      </QueryState>
      <RecentDepartures cdcId={cdcId} trfs={transfers.data?.items ?? []} />
    </section>
  );
}

function FlowBody({
  cdcId,
  trfs,
  partial,
  transit,
  transitFailed,
  byMfc,
  summaryFailed,
}: {
  readonly cdcId: string;
  readonly trfs: readonly TransferSummary[];
  readonly partial: boolean;
  readonly transit: number | null;
  readonly transitFailed: boolean;
  readonly byMfc: ReadonlyArray<{ mfcId: string; transferCount: number; approvedQty: number; pickedQty: number; shortQty: number }> | null;
  readonly summaryFailed: boolean;
}) {
  // MFC × 단계 → TRF 수·수량(단계에 맞는 수량: 대기 = 승인, 피킹 = 피킹 합, 준비·출발 = 피킹 합)
  const grid = useMemo(() => {
    const m = new Map<string, Record<Stage, { n: number; qty: number }>>();
    for (const x of trfs) {
      const st = stageOf(x.state);
      if (!st) continue;
      const row = m.get(x.mfcId) ?? { WAIT: { n: 0, qty: 0 }, PICK: { n: 0, qty: 0 }, READY: { n: 0, qty: 0 }, DEPARTED: { n: 0, qty: 0 } };
      row[st].n += 1;
      row[st].qty += st === 'WAIT' || st === 'PICK' ? x.approvedQty : x.pickedQty;
      m.set(x.mfcId, row);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [trfs]);
  const total = (st: Stage) => grid.reduce((a, [, r]) => ({ n: a.n + r[st].n, qty: a.qty + r[st].qty }), { n: 0, qty: 0 });
  const today = new Map((byMfc ?? []).map((b) => [b.mfcId, b]));
  return (
    <div className="space-y-4">
      {/* 단계 흐름 — 왼쪽에서 오른쪽으로 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="flow-stages">
        {STAGES.map((st) => {
          const s = total(st);
          return <StatCard key={st} label={t.stages[st]} value={s.n} hint={t.units(s.qty)} tone={st === 'DEPARTED' ? 'success' : st === 'READY' ? 'info' : undefined} />;
        })}
        <StatCard label={t.transit} value={transit === null ? (transitFailed ? messages.loadFailed : '…') : t.units(transit)} hint={t.transitHint} tone="warning" />
      </div>
      <ul className="grid gap-x-6 gap-y-0.5 text-xs text-base-content/60 md:grid-cols-2" data-testid="flow-legend">
        {STAGES.map((st) => (
          <li key={st}>
            <b className="font-semibold text-base-content/80">{t.stages[st]}</b> {t.stageHint[st]}
          </li>
        ))}
      </ul>
      {partial && (
        <p role="note" className="text-xs text-warning">
          {t.partial}
        </p>
      )}
      <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table className="table table-sm" data-testid="flow-table">
          <thead>
            <tr>
              <th>{t.mfc}</th>
              {STAGES.map((st) => (
                <th key={st} className="text-center" title={t.stageHint[st]}>
                  {t.stages[st]}
                </th>
              ))}
              <th className="border-l border-base-300 text-right" title={t.today}>{`${t.today} ${t.todayApproved}`}</th>
              <th className="text-right">{t.todayPicked}</th>
              <th className="text-right">{t.todayShort}</th>
            </tr>
          </thead>
          <tbody>
            {grid.map(([mfcId, row]) => {
              const d = today.get(mfcId);
              return (
                <tr key={mfcId} data-testid="flow-row">
                  <td className="font-mono text-xs">
                    <Link className="link" to={`${centerPath(cdcId, 'trf-wave')}?mfcId=${encodeURIComponent(mfcId)}`}>
                      <MfcName id={mfcId} />
                    </Link>
                  </td>
                  {STAGES.map((st) => (
                    <td key={st} className="text-center">
                      <StageCell n={row[st].n} qty={row[st].qty} stage={st} />
                    </td>
                  ))}
                  {d ? (
                    <>
                      <td className="border-l border-base-300 text-right tabular-nums">{messages.qty(d.approvedQty)}</td>
                      <td className="text-right tabular-nums">{messages.qty(d.pickedQty)}</td>
                      <td className={`text-right tabular-nums ${d.shortQty > 0 ? 'font-semibold text-error' : ''}`}>{messages.qty(d.shortQty)}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="border-l border-base-300 text-center text-xs text-base-content/50">
                      {summaryFailed ? messages.loadFailed : messages.none}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 단계 한 칸 — 건수가 있으면 진하게, 없으면 흐리게 */
function StageCell({ n, qty, stage }: { readonly n: number; readonly qty: number; readonly stage: Stage }) {
  if (n === 0) return <span className="text-base-content/30">—</span>;
  const tone = stage === 'DEPARTED' ? 'text-success' : stage === 'READY' ? 'text-info' : stage === 'PICK' ? 'text-primary' : '';
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={`font-semibold ${tone}`}>{t.trfs(n)}</span>
      <span className="text-xs text-base-content/60 tabular-nums">{t.units(qty)}</span>
    </span>
  );
}

/** 최근 출발 — 출발 검증(최신 순)을 TRF 줄로 펼쳐 "언제 · 어느 MFC 로 · 몇 개 · 결과" */
function RecentDepartures({ cdcId, trfs }: { readonly cdcId: string; readonly trfs: readonly TransferSummary[] }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'departures', 'flow'],
    refetchInterval: REFRESH,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/departures', { params: { path: { cdcId }, query: { size: 30 } } })),
  });
  const byTrf = useMemo(() => new Map(trfs.map((x) => [x.trfId, x])), [trfs]);
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{t.recent}</h2>
      <QueryState state={toUiState(query, (d) => d.items.length === 0)} onRetry={() => void query.refetch()} emptyText={t.recentEmpty}>
        {(d) => (
          <ol className="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100" data-testid="flow-recent">
            {d.items.map((dep) => (
              <Fragment key={dep.departureId}>
                {(dep.transfers ?? []).map((x) => {
                  const trf = x.trfId ? byTrf.get(x.trfId) : undefined;
                  return (
                    <li key={`${dep.departureId}-${x.trfId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm" data-testid="flow-recent-row">
                      <span className="w-28 shrink-0 text-xs text-base-content/60">{dep.validatedAt ? formatSeoul(dep.validatedAt) : messages.none}</span>
                      <Link className="link font-mono text-xs" to={trfWavePath(cdcId, `trf/${encodeURIComponent(x.trfId ?? '')}`)}>
                        {x.trfNumber ?? (trf ? trfLabel(trf) : shortRef(x.trfId))}
                      </Link>
                      <span aria-hidden className="text-base-content/40">→</span>
                      <DepartureMfc cdcId={cdcId} trfId={x.trfId ?? ''} known={trf?.mfcId} />
                      <span className="tabular-nums">{t.departedLine(x.departedQty ?? 0)}</span>
                      <ResultBadge result={x.result} />
                      {dep.vehicleId && <span className="text-xs text-base-content/55">{`${messages.shipping.vehicle} ${dep.vehicleId}`}</span>}
                    </li>
                  );
                })}
              </Fragment>
            ))}
          </ol>
        )}
      </QueryState>
    </section>
  );
}

/** 최근 출발의 받는 MFC — 오늘 TRF 목록에 없는(지난 날) TRF 는 TRF 상세에서 찾는다(출발 검증 응답에는 MFC 가 없다) */
function DepartureMfc({ cdcId, trfId, known }: { readonly cdcId: string; readonly trfId: string; readonly known: string | undefined }) {
  const api = useApi();
  const q = useQuery({
    queryKey: ['cdc', cdcId, 'transfer', trfId],
    enabled: !known && !!trfId,
    staleTime: 5 * 60_000,
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers/{trfId}', { params: { path: { cdcId, trfId } } })),
  });
  const id = known ?? q.data?.mfcId;
  return id ? <MfcName id={id} className="text-xs" /> : <span className="text-xs text-base-content/50">{q.isError ? messages.loadFailed : messages.none}</span>;
}
