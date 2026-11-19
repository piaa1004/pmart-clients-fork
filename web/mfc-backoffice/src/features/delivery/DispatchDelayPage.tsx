// 배차 지연(우리 센터) — delivery-dispatch 0.12.0 `GET /dispatch-delays?mfcId=`(백엔드 요청 clients/mfc-backoffice/2026-11-19-request-dispatch-delays,
// 원문 Delivery §3.6 "배차 지연 시간이 기준을 넘으면 MFC 관리자·고객센터에 안내"). 지연 안내(DispatchDelayed)가 난 픽업 전 배송, 약속이 이른 것부터.
// - 배송 번호(ADR-0070)는 delivery-execution `GET /deliveries?deliveryIds=&mfcId=`(0.31.0 묶음, 50개씩)로 붙인다. 못 읽으면 "번호 확인 불가"(번호 없음과 구분).
// - "약속 대비" = 지금 − promisedAt(표시만 — 판정은 서버가 이미 지연 안내로 했다). 약속 시각이 없으면 "약속 없음".
// - "배차 불가로 취소"(claim CL-5, 0.7.0)는 주문의 모든 행 × 미이행 수량을 보내야 하는데, 센터 관리자는 주문 행을 읽을 API 가 없다
//   (order `GET /orders/lookups/{id}` 는 OPERATOR_ADMIN·CS_AGENT·RIDER_OPS 만). 단추는 막아 두고 이유를 보인다 — 요청 handoff mfc-backoffice/2026-11-19-backend-dispatch-cancel-lines.
// - 30초마다 다시 읽는다(목록은 서버가 픽업되면 뺀다).
import { useQuery } from '@tanstack/react-query';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { Api } from '../../api/client';
import { useApi } from '../../app/ApiContext';
import { DisplayNumber, RiderLabel, SystemNumbers } from '../../shared/displayNumber';
import { AllDone, GuideBox } from '../../shared/listParts';
import { messages } from '../../shared/messages';
import { useNow } from '../../shared/motion';

const m = messages.dispatchDelays;
const REFRESH_MS = 30_000;
const BATCH = 50;

export function useDispatchDelays(mfcId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: ['dispatch-delays', mfcId ?? ''],
    enabled: !!mfcId,
    refetchInterval: REFRESH_MS,
    queryFn: async () => (await request('GET', api.dispatch.GET('/dispatch-delays', { params: { query: { mfcId: mfcId ?? '' } } }))).items,
  });
}

/** 배송 ID → 배송 번호(50개씩 묶음 조회) */
async function readNumbers(api: Api, mfcId: string, ids: readonly string[]) {
  const map = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const r = await request('GET', api.execution.GET('/deliveries', { params: { query: { mfcId, deliveryIds: chunk.join(','), size: chunk.length } } }));
    for (const d of r.items ?? []) if (d.deliveryId) map.set(d.deliveryId, d.deliveryNumber ?? null);
  }
  return map;
}

export function DispatchDelaysMenu({ mfcId }: { readonly mfcId: string }) {
  const api = useApi();
  const query = useDispatchDelays(mfcId);
  const ids = (query.data ?? []).map((d) => d.deliveryId);
  const numbers = useQuery({
    queryKey: ['dispatch-delay-numbers', mfcId, ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () => readNumbers(api, mfcId, ids),
  });
  const now = useNow(30_000);
  return (
    <section className="space-y-4">
      <h1>{messages.menus.dispatchDelays}</h1>
      <GuideBox title={m.guideTitle} storeKey="dispatch-delays" items={m.guide} />
      {numbers.isError && (
        <p role="alert" className="alert alert-warning text-sm">
          {m.numbersFailed}
        </p>
      )}
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(items) =>
          items.length === 0 ? (
            <AllDone body={m.none} />
          ) : (
            <table className="table table-sm rounded-box bg-base-100" data-testid="dispatch-delays">
              <thead>
                <tr>
                  <th>{m.col.delivery}</th>
                  <th>{m.col.state}</th>
                  <th>{m.col.rider}</th>
                  <th>{m.col.promised}</th>
                  <th>{m.col.late}</th>
                  <th>{m.col.alerted}</th>
                  <th>{m.col.action}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => {
                  const over = d.promisedAt ? Math.floor((now - Date.parse(d.promisedAt)) / 60_000) : null;
                  return (
                    <tr key={d.deliveryId} data-testid="dispatch-delay-row">
                      <td>
                        {numbers.isPending ? '…' : <DisplayNumber number={numbers.data?.get(d.deliveryId) ?? null} systemId={d.deliveryId} {...(numbers.isError ? { failed: true } : {})} />}
                        <SystemNumbers
                          ids={[
                            { label: messages.displayNumber.system.deliveryId, id: d.deliveryId },
                            { label: messages.displayNumber.system.orderId, id: d.orderId },
                          ]}
                        />
                      </td>
                      <td>{m.state[d.state] ?? d.state}</td>
                      <td>{d.riderId ? <RiderLabel riderId={d.riderId} /> : <span className="font-semibold text-warning">{m.noRider}</span>}</td>
                      <td>{d.promisedAt ? formatSeoul(d.promisedAt) : m.noPromise}</td>
                      <td data-testid="delay-minutes">
                        {over === null ? (
                          messages.none
                        ) : over >= 0 ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-error">
                            <span className="breathe h-2 w-2 rounded-full bg-error" aria-hidden="true" />
                            {m.over(over)}
                          </span>
                        ) : (
                          <span className="text-warning">{m.left(-over)}</span>
                        )}
                      </td>
                      <td>{formatSeoul(d.delayAlertedAt)}</td>
                      <td>
                        <button type="button" className="btn btn-xs" disabled title={m.cancelBlocked}>
                          {m.cancel}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
      </QueryState>
      <p className="text-xs text-base-content/60" data-testid="cancel-blocked">
        {m.cancelBlocked}
      </p>
    </section>
  );
}
