// 라이더 관제(2026-11-17, PC 5 — ADR-0068): tracking `GET /rider-locations?mfcId=` — 운행 중 라이더의 지금 위치·끊김·진행 중 배송.
// RIDER_OPS·OPERATOR_ADMIN 만(서버 403), 10초마다 다시 불러오기, 이동 이력 없음. 지도는 VITE_KAKAO_JS_KEY 가 있을 때만(없으면 안내 + 표).
// 거르기(전체·배송 중·위치 끊김)는 주소 쿼리 filter.
// 2026-11-18: 관리자 화면 모양 — 머리말, 조건 상자(센터 + 보기 칩), 요약 카드(누르면 그 거르기), 지도 구역, 표(위치 상태 꼬리표).
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { ChipGroup, DataTable, PageHeader, Section, StatCard, StatusBadge } from '../../shared/admin';
import { isSimRider, SimBadge } from '../../shared/sim';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { CenterPicker, label, none, when } from '../../shared/opsUi';
import { ActiveDeliverySummary, ControlRiderPanel } from './ControlRiderPanel';
import { ControlSearch } from './ControlSearch';
import { useDropLocations } from './dropLocation';
import { CONTROL_REFRESH_MS } from './refresh';
import { KakaoRiderMap, type MapRider, type MapRoute } from './KakaoRiderMap';

const c = ops.control;
const n = messages.names;
export { CONTROL_REFRESH_MS };

/** 이 화면에서만 쓰는 문구 */
const cx = {
  view: '보기',
  onDuty: '운행 중',
  delivering: '배송 중',
  staleOrNone: '위치 끊김·없음',
  people: (k: number) => `${k}명`,
  map: '위치 지도',
  list: '라이더 목록',
  receiving: '수신 중',
  legend: { ok: '대기', delivering: '배송 중', stale: '끊김' },
  refresh: '10초마다 새로 불러와요',
} as const;

type Filter = 'all' | 'delivering' | 'stale' | 'sim';
type Rider = components['schemas']['ControlRider'];

// 거르기·지도 색은 서버 값으로만: stale(서버 3분 기준) 또는 위치 없음 = 끊김, 진행 중 배송 있음 = 배송 중.
const isStale = (r: Rider) => r.stale || !r.location;
const isDelivering = (r: Rider) => r.activeDeliveries.length > 0;

function LocationBadge({ r }: { readonly r: Rider }) {
  if (!r.location) return <StatusBadge tone="error">{c.noLocation}</StatusBadge>;
  if (r.stale) return <StatusBadge tone="error">{c.stale}</StatusBadge>;
  return <StatusBadge tone="success">{cx.receiving}</StatusBadge>;
}

export function ControlPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const mfcId = params.get('mfcId') ?? '';
  const rawFilter = params.get('filter');
  const filter: Filter = rawFilter === 'delivering' || rawFilter === 'stale' || rawFilter === 'sim' ? rawFilter : 'all';
  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params);
    if (f === 'all') p.delete('filter');
    else p.set('filter', f);
    setParams(p);
  };
  const filterLink = (f: Filter) => `/control?mfcId=${encodeURIComponent(mfcId)}${f === 'all' ? '' : `&filter=${f}`}`;
  const board = useQuery({
    queryKey: ['rider-locations', mfcId],
    enabled: mfcId !== '',
    refetchInterval: CONTROL_REFRESH_MS,
    queryFn: () => request('GET', api.tracking.GET('/rider-locations', { params: { query: { mfcId } } })),
  });
  // 센터 좌표(지도 가운데) — CenterPicker 와 같은 목록 캐시
  const centers = useQuery({
    queryKey: ['centers', 'MFC'],
    queryFn: () => request('GET', api.center.GET('/centers', { params: { query: { type: 'MFC' } } })),
  });
  // 센터를 아직 안 골랐으면 첫 센터로 연다(빈 화면에서 드롭다운을 찾아야 하지 않게 — 2026-11-18 사용자). 고른 뒤 바꾸는 건 그대로.
  const firstCenter = centers.data?.items?.[0]?.centerId;
  useEffect(() => {
    if (!mfcId && firstCenter) {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('mfcId', firstCenter);
          return p;
        },
        { replace: true },
      );
    }
  }, [mfcId, firstCenter, setParams]);
  const center = (centers.data?.items ?? []).find((x) => x.centerId === mfcId);
  const coords = center?.coordinates;
  const centerPoint = coords?.lat != null && coords.lng != null ? { lat: coords.lat, lng: coords.lng } : null;
  // 고른 라이더(오른쪽 "라이더 한눈에") — URL ?rider= (주문번호로 찾았으면 ?delivery= 도) 로 둬서 새로 고침·공유해도 그대로
  const selectedId = params.get('rider') ?? '';
  const focusDeliveryId = params.get('delivery') ?? '';
  const select = useCallback(
    (riderId: string) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (riderId) p.set('rider', riderId);
        else p.delete('rider');
        p.delete('delivery');
        return p;
      }),
    [setParams],
  );
  const found = useCallback(
    (hit: { readonly riderId: string; readonly mfcId?: string | null; readonly deliveryId?: string }) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (hit.mfcId) p.set('mfcId', hit.mfcId);
        p.set('rider', hit.riderId);
        if (hit.deliveryId) p.set('delivery', hit.deliveryId);
        else p.delete('delivery');
        p.delete('filter');
        return p;
      }),
    [setParams],
  );
  // 고른 라이더 배송의 전달지 — 상세 칸과 같은 캐시(배송마다 한 번, 열람 기록)
  const selectedRider = (board.data?.items ?? []).find((r) => r.riderId === selectedId);
  const routeIds = selectedRider?.activeDeliveries.length ? selectedRider.activeDeliveries.map((d) => d.deliveryId) : focusDeliveryId && selectedId ? [focusDeliveryId] : [];
  const drops = useDropLocations(routeIds);
  const routes: MapRoute[] = drops.flatMap((q, i) => (q.data?.lat != null && q.data.lng != null ? [{ deliveryId: routeIds[i] ?? '', drop: { lat: q.data.lat, lng: q.data.lng } }] : []));
  return (
    <section className="space-y-4">
      <PageHeader title={c.title} description={c.intro} />
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 rounded-box border border-base-300 bg-base-100 px-5 py-4" aria-label="관제 조건" role="group">
        <ControlSearch onFound={found} />
        <CenterPicker value={mfcId} onChange={(v) => setParams(v ? { mfcId: v } : {})} />
        <div className="flex flex-col gap-1 text-sm">
          <span>{cx.view}</span>
          <ChipGroup
            label={cx.view}
            value={filter}
            options={(['all', 'delivering', 'stale', 'sim'] as const).map((f) => ({ value: f, label: c.filter[f] }))}
            onChange={setFilter}
          />
        </div>
      </div>
      {mfcId === '' ? (
        <p role="note" className="rounded-box bg-base-300/50 px-4 py-3 text-sm text-base-content/75">
          {c.pickCenter}
        </p>
      ) : (
        <QueryState state={toUiState(board, (b) => (b.items ?? []).length === 0)} onRetry={() => void board.refetch()} emptyText={c.empty}>
          {(b) => {
            const all = b.items ?? [];
            const staleFlag = all.filter((r) => r.stale).length;
            const staleOrNone = all.filter(isStale).length;
            const items = all.filter((r) => (filter === 'delivering' ? isDelivering(r) : filter === 'stale' ? isStale(r) : filter === 'sim' ? isSimRider(r.riderId) : true));
            const mapRiders: MapRider[] = items.flatMap((r) =>
              r.location?.lat != null && r.location.lng != null
                ? [{ riderId: r.riderId, lat: r.location.lat, lng: r.location.lng, tone: isStale(r) ? 'stale' : isDelivering(r) ? 'delivering' : 'ok', label: r.nameMasked ?? r.riderId }]
                : [],
            );
            return (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard label={cx.onDuty} value={cx.people(all.length)} to={filterLink('all')} hint={ops.dashboard.asOf(when(b.asOf))} testId="control-stat-all" />
                  <StatCard label={cx.delivering} value={cx.people(all.filter(isDelivering).length)} to={filterLink('delivering')} testId="control-stat-delivering" />
                  <StatCard label={cx.staleOrNone} value={cx.people(staleOrNone)} to={filterLink('stale')} {...(staleOrNone > 0 ? { tone: 'error' as const } : {})} testId="control-stat-stale" />
                </div>
                <Section
                  title={cx.map}
                  aside={
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusBadge tone="success">{cx.legend.ok}</StatusBadge>
                      <StatusBadge tone="info">{cx.legend.delivering}</StatusBadge>
                      <StatusBadge tone="warning">{cx.legend.stale}</StatusBadge>
                    </span>
                  }
                >
                  {/* 지도 + 오른쪽 상세 칸: 실시간 위치와 고른 라이더의 픽업지·주문 내역·도착 예정을 한 화면에서 */}
                  <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
                    <KakaoRiderMap center={centerPoint} riders={mapRiders} onSelect={select} selectedId={selectedId} routes={routes} />
                    <ControlRiderPanel rider={all.find((r) => r.riderId === selectedId)} selectedId={selectedId} focusDeliveryId={focusDeliveryId} onClose={() => select('')} asOf={b.asOf} />
                  </div>
                </Section>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <p className="flex items-center gap-2 text-sm">
                    <span>
                      <span className="font-semibold text-primary">{items.length}</span>명
                    </span>
                    {staleFlag > 0 && <StatusBadge tone="error">{c.staleCount(staleFlag)}</StatusBadge>}
                  </p>
                  <span className="text-xs text-base-content/50">{cx.refresh}</span>
                </div>
                {items.length === 0 ? (
                  <p data-state="empty" className="rounded-box border border-base-300 bg-base-100 p-6 text-center text-sm text-base-content/60">
                    {c.emptyFiltered}
                  </p>
                ) : (
                  <DataTable>
                    <thead>
                      <tr>
                        <th>{c.col.rider}</th>
                        <th>{c.col.vehicle}</th>
                        <th>{c.col.dispatch}</th>
                        <th>{c.col.location}</th>
                        <th>{c.col.updated}</th>
                        <th>{c.col.deliveries}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr
                          key={r.riderId}
                          id={`control-${r.riderId}`}
                          data-testid="control-row"
                          aria-selected={r.riderId === selectedId}
                          className={`cursor-pointer ${r.riderId === selectedId ? 'bg-primary/10' : isStale(r) ? 'bg-error/5' : ''}`}
                          onClick={() => select(r.riderId)}
                        >
                          <td>
                            <span className="flex flex-wrap items-center gap-1">
                              <Link className="font-mono font-semibold hover:underline" to={`/riders/${encodeURIComponent(r.riderId)}`}>
                                {r.riderId}
                              </Link>
                              {r.nameMasked && <span className="text-xs text-base-content/60">{r.nameMasked}</span>}
                          <SimBadge riderId={r.riderId} />
                              {r.restriction && r.restriction !== 'NORMAL' && <StatusBadge tone="warning">{label(n.restriction, r.restriction)}</StatusBadge>}
                            </span>
                          </td>
                          <td>{label(n.vehicle, r.vehicleType)}</td>
                          <td>{r.newDispatchEnabled ? <StatusBadge tone="success">{c.on}</StatusBadge> : <StatusBadge>{c.off}</StatusBadge>}</td>
                          <td>
                            <span className="flex flex-wrap items-center gap-2">
                              <LocationBadge r={r} />
                              {r.location && <span className="font-mono text-xs text-base-content/70">{`${Number(r.location.lat).toFixed(5)}, ${Number(r.location.lng).toFixed(5)}`}</span>}
                            </span>
                          </td>
                          <td className="whitespace-nowrap">{r.staleSinceSeconds === null || r.staleSinceSeconds === undefined ? none : c.seconds(r.staleSinceSeconds)}</td>
                          <td>
                            {r.activeDeliveries.length === 0 ? (
                              <span className="text-base-content/40">{none}</span>
                            ) : (
                              <ul className="space-y-0.5">
                                {r.activeDeliveries.map((x) => (
                                  <li key={x.deliveryId}>
                                    <ActiveDeliverySummary active={x} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                )}
              </div>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}
