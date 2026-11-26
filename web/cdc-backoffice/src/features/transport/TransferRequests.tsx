// 출하·운송 [이관요청서] — TMS 정본 5장 "이관요청서 수신과 자동 검증"(사용자 2026-11-26 "TMS md 파일 보고 … 이관신청 하는 곳" → A안: 수신·확인).
// 이관요청서는 WMS 가 만들고 TMS 는 받아서 검증만 한다(TMS D-04·D-05) — 그래서 여기엔 "새로 만들기"가 없다.
// - 목록 transport-planning `GET /cdcs/{cdcId}/transport-requests?shipDate=`(기한 순, 상태 전부 — 화면에서 상태별로 센다)
// - 받기 = 배차 생성 `POST …/transport-orders/generations {shipDate}`(cdc-outbound transport-feed 에서 그 출고일 TRF 를 가져와 V1~V8 검증 → 수용·보류·반려·제외)
// - 펼치면: 검증 결과 사유·보완 주체(TMS 5.2 표), 상품별 요청·할당·피킹·부족(cdc-outbound TRF 상세), TRF 상세·운송지시서 바로가기
// 판정은 서버 — 화면은 사유 코드를 TMS 문서의 말로 옮기기만 한다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { StatCard } from '@pmart/web-ui/standard';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/transport-planning';
import { useApi } from '../../app/ApiContext';
import { centerPath } from '../../app/nav';
import { messages } from '../../shared/messages';
import { shortRef } from '../../shared/shortRef';
import { MfcName } from '../../shared/MfcName';
import { SkuName } from '../../shared/SkuName';
import { trfWavePath } from '../trf-wave/TrfWavePages';
import { tempLabel } from './TransportPage';

const t = messages.transport;
const r = messages.transferRequests;
type Req = components['schemas']['TransportRequest'];
type ReqState = components['schemas']['TransportRequestState'];
const STATES: readonly ReqState[] = ['RECEIVED', 'ACCEPTED', 'HELD', 'REJECTED', 'EXCLUDED', 'ASSIGNED', 'DEPARTED', 'HANDED_OVER'];
const tone = (s: string) =>
  s === 'HELD' ? 'badge-warning' : s === 'REJECTED' ? 'badge-error' : s === 'EXCLUDED' ? 'badge-ghost' : s === 'ACCEPTED' ? 'badge-info' : s === 'HANDED_OVER' ? 'badge-success' : 'badge-outline';

export function TransferRequestsView({ cdcId, date }: { readonly cdcId: string; readonly date: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filter = STATES.find((s) => s === params.get('state')) ?? '';
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['cdc', cdcId, 'transport-requests', date, 'all'],
    queryFn: () => request('GET', api.transportPlanning.GET('/cdcs/{cdcId}/transport-requests', { params: { path: { cdcId }, query: { shipDate: date, size: 200 } } })),
  });
  const receive = useCommand(async (shipDate: string, key) => request('POST', api.transportPlanning.POST('/cdcs/{cdcId}/transport-orders/generations', { ...commandParams(key, { path: { cdcId } }), body: { shipDate } })));
  const pick = (s: string) => {
    const q = new URLSearchParams(params);
    if (s && s !== filter) q.set('state', s);
    else q.delete('state');
    setParams(q, { replace: true });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-box border border-base-300 bg-base-100 p-3">
        <p className="min-w-64 max-w-3xl flex-1 text-sm text-base-content/60">{r.lead}</p>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={receive.busy}
            data-testid="requests-receive"
            onClick={() =>
              void receive.run(date).then((p) => {
                if (p.kind === 'done') void qc.invalidateQueries({ queryKey: ['cdc', cdcId] });
              })
            }
          >
            {r.receive}
          </button>
          <span className="text-xs text-base-content/55">{r.receiveHint}</span>
        </div>
        <div className="w-full">
          <CommandFeedback command={receive}>
            {(res) => (
              <p role="status" className="alert alert-info py-1 text-sm" data-testid="requests-received">
                {r.received(
                  Object.entries(res.requests ?? {})
                    .map(([k, n]) => `${t.reqState[k] ?? k} ${n}`)
                    .join(' · ') || messages.none,
                )}
              </p>
            )}
          </CommandFeedback>
        </div>
      </div>
      <QueryState state={toUiState(query, () => false)} onRetry={() => void query.refetch()}>
        {(data) => {
          const count = (s: string) => data.items.filter((x) => x.state === s).length;
          const waiting = count('ACCEPTED');
          const blocked = count('HELD') + count('REJECTED');
          const rows = data.items.filter((x) => !filter || x.state === filter);
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="request-stats">
                <StatCard label={r.total} value={data.items.length} hint={data.hasNext ? r.more : undefined} />
                <StatCard label={r.waiting} value={waiting} hint={r.waitingHint} tone="info" onClick={() => pick('ACCEPTED')} active={filter === 'ACCEPTED'} />
                <StatCard label={r.blocked} value={blocked} hint={r.blockedHint} tone="warning" onClick={() => pick('HELD')} active={filter === 'HELD'} testId="request-blocked" />
              </div>
              <div className="flex flex-wrap gap-2" data-testid="request-filter">
                <button type="button" className={`btn btn-xs ${!filter ? 'btn-primary' : ''}`} onClick={() => pick('')}>
                  {t.all} {data.items.length}
                </button>
                {STATES.filter((s) => count(s) > 0 || s === filter).map((s) => (
                  <button key={s} type="button" className={`btn btn-xs ${filter === s ? 'btn-primary' : ''}`} onClick={() => pick(s)}>
                    {t.reqState[s]} {count(s)}
                  </button>
                ))}
              </div>
              {rows.length === 0 ? (
                <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60">{data.items.length === 0 ? r.empty : t.emptyRequests}</p>
              ) : (
                <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
                  <table className="table table-sm" data-testid="request-table">
                    <thead>
                      <tr>
                        <th>{r.trf}</th>
                        <th>{t.mfc}</th>
                        <th>{t.dueAt}</th>
                        <th>{t.tempLabel}</th>
                        <th className="text-right">{t.qty}</th>
                        <th className="text-right">{t.boxes}</th>
                        <th>{r.result}</th>
                        <th>{t.order}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((x) => {
                        const isOpen = open === x.trfId;
                        return (
                          <Fragment key={x.trfId}>
                            <tr data-testid="request-row" className="cursor-pointer hover" onClick={() => setOpen(isOpen ? null : x.trfId)} aria-expanded={isOpen}>
                              <td className="whitespace-nowrap font-mono text-xs">
                                <span aria-hidden className="mr-1 inline-block w-3 text-base-content/50">
                                  {isOpen ? '▾' : '▸'}
                                </span>
                                {x.trfNumber ?? shortRef(x.trfId)}
                                <span className="ml-1 text-base-content/45">v{x.trfVersion}</span>
                              </td>
                              <td className="text-xs">
                                <MfcName id={x.mfcId} />
                              </td>
                              <td className="whitespace-nowrap">{x.dueAt ? formatSeoul(x.dueAt) : messages.none}</td>
                              <td className="whitespace-nowrap">{x.tempClass ? tempLabel(x.tempClass) : (x.tempClasses ?? []).map(tempLabel).join('+') || messages.none}</td>
                              <td className="whitespace-nowrap text-right tabular-nums">
                                {x.acceptedQty ?? 0} / {x.approvedQty ?? 0}
                              </td>
                              <td className="whitespace-nowrap text-right tabular-nums">
                                {x.boxCount ?? 0} · {x.rtCount ?? t.rtPending}
                              </td>
                              <td>
                                <span className="flex flex-wrap items-center gap-1">
                                  <span className={`badge badge-sm whitespace-nowrap ${tone(x.state)}`}>{t.reqState[x.state] ?? x.state}</span>
                                  {x.reason && <span className="text-xs">{t.reqReason[x.reason] ?? x.reason}</span>}
                                  {x.lateReceipt && (
                                    <span className="badge badge-sm badge-ghost whitespace-nowrap" title={t.lateHint}>
                                      {t.late}
                                    </span>
                                  )}
                                </span>
                              </td>
                              <td className="font-mono text-xs">{x.orderId ?? messages.none}</td>
                            </tr>
                            {isOpen && (
                              <tr>
                                <td colSpan={8} className="pm-detail bg-base-200/50">
                                  <RequestDetail cdcId={cdcId} req={x} />
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
    </div>
  );
}

function RequestDetail({ cdcId, req }: { readonly cdcId: string; readonly req: Req }) {
  const api = useApi();
  const trf = useQuery({
    queryKey: ['cdc', cdcId, 'transfer', req.trfId],
    queryFn: () => request('GET', api.outbound.GET('/cdcs/{cdcId}/transfers/{trfId}', { params: { path: { cdcId, trfId: req.trfId } } })),
  });
  const check = req.reason ? r.checks[req.reason] : undefined;
  return (
    <div className="space-y-3 p-1" data-testid="request-detail">
      <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
        <h3 className="mb-1 font-semibold">{r.validation}</h3>
        {req.reason ? (
          <p data-testid="request-check">
            <span className="font-mono text-xs text-base-content/60">{check?.check ?? ''}</span> {t.reqReason[req.reason] ?? req.reason}
            {check && (
              <>
                {' — '}
                {check.what} <span className="badge badge-sm badge-outline ml-1">{r.owner(check.owner)}</span>
              </>
            )}
          </p>
        ) : (
          <p>{r.stateText[req.state] ?? t.reqState[req.state] ?? req.state}</p>
        )}
        <p className="mt-1 text-xs text-base-content/55">
          {r.meta(req.allocationState ?? messages.none, req.receivedAt ? formatSeoul(req.receivedAt) : messages.none, req.weightKg ?? 0)}
        </p>
      </div>
      <div className="rounded-box border border-base-300 bg-base-100 p-3">
        <h3 className="mb-1 text-sm font-semibold">{r.lines}</h3>
        <QueryState state={toUiState(trf, (d) => d.lines.length === 0)} onRetry={() => void trf.refetch()} emptyText={r.noLines}>
          {(d) => (
            <table className="table table-xs" data-testid="request-lines">
              <thead>
                <tr>
                  <th>{r.sku}</th>
                  <th className="text-right">{r.approved}</th>
                  <th className="text-right">{r.allocated}</th>
                  <th className="text-right">{r.picked}</th>
                  <th className="text-right">{r.short}</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.sku}>
                    <td>{l.productName ?? <SkuName sku={l.sku} />}</td>
                    <td className="text-right tabular-nums">{l.approvedQty}</td>
                    <td className={`text-right tabular-nums ${l.allocatedQty < l.approvedQty ? 'text-warning' : ''}`}>{l.allocatedQty}</td>
                    <td className="text-right tabular-nums">{l.pickedQty}</td>
                    <td className={`text-right tabular-nums ${l.shortQty > 0 ? 'text-error' : ''}`}>{l.shortQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="btn btn-xs" to={trfWavePath(cdcId, `trf/${encodeURIComponent(req.trfId)}`)}>
          {r.openTrf}
        </Link>
        {req.orderId && (
          <Link className="btn btn-xs" to={`${centerPath(cdcId, 'transport')}?v=orders&date=${req.shipDate}`}>
            {r.openOrder(req.orderId)}
          </Link>
        )}
      </div>
    </div>
  );
}
