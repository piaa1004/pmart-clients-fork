// 관제 오른쪽 "라이더 한눈에"(2026-11-18 사용자: "주문번호에 해당하는 라이더를 바로 볼 수 있고, 그 라이더의 위치와 전달 상황과
// 대기 및 운영 시간을 바로 볼 수 있게 — 직관적으로").
// - 맨 위 칸: 위치(관제) · 전달 상황(관제 진행 중 배송, 대기면 tracking 0.9.0 `waitingSince` "대기 N분째") ·
//   접속 시간(운행을 켜 둔 시간 — `onDutySince` "운행 시작 HH:MM · N시간째" + execution 0.25.0 오늘 `connectedSeconds`) ·
//   대기 시간(운행 중 + 신규배차 켬 + 맡은 배송 0건 — 오늘 `waitingSeconds`) · 오늘 운행시간(배차 수락 ~ 전달 완료 `totalSeconds`).
//   세 시간(운행·접속·대기)은 뜻이 달라 섞지 않는다(백엔드 회신 2026-11-18 reply-rider-waiting-time, 사용자 정의).
//   "N분째"는 서버 시각에서 지금까지 지난 시간을 보이기만 한다(합계는 서버 값).
// - 배송마다: 단계 진행 줄, 도착 예정·지연(tracking eta), 픽업지 → 전달지(drop-location — 열 때 한 번), 주문번호·품목·요청사항(execution).
// - 관제 값·배송·도착 예정은 10초마다 새로, 전달지는 열람 기록이 남아 한 번만(dropLocation.ts).
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { request } from '@pmart/web-core';
import { QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/delivery-tracking';
import { useApi } from '../../app/ApiContext';
import { StatusBadge } from '../../shared/admin';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, none, when, won } from '../../shared/opsUi';
import { SimBadge } from '../../shared/sim';
import { extrasMessages } from '../deliveries/DeliveryExtras';
import { dropFailureText, dropMessages, useDropLocation } from './dropLocation';
import { CONTROL_REFRESH_MS } from './refresh';

type Rider = components['schemas']['ControlRider'];
type ActiveDelivery = Rider['activeDeliveries'][number];
type EtaLeg = components['schemas']['EtaLeg'];

const n = messages.names;
const c = ops.control;

export const panelMessages = {
  title: '라이더 한눈에',
  pick: '주문번호나 라이더 ID 로 찾거나, 지도·아래 표에서 라이더를 고르면 위치·전달 상황·운행 시간이 여기에 보여요.',
  gone: '이 라이더는 지금 이 센터의 운행 목록에 없어요(운행 종료·다른 센터).',
  close: '닫기',
  tile: { location: '위치', delivery: '전달 상황', connected: '접속 시간', waiting: '대기 시간', operating: '오늘 운행시간' },
  receiving: (s: string) => `수신 중 · ${s}`,
  delivering: (k: number) => `배송 중 ${k}건`,
  waitingFor: (m: string) => `대기 ${m}째`,
  waitingSinceAt: (t: string) => `${t}부터`,
  notWaiting: '대기 아님',
  notWaitingHint: '신규배차 꺼짐 — 대기로 세지 않아요',
  elapsedNow: (d: string) => `${d}째`,
  dutyStartAt: (t: string) => `운행 시작 ${t}`,
  offDuty: '운행 중 아님',
  todaySum: (s: string) => `오늘 ${s}`,
  connectedHint: '운행을 켜 둔 시간',
  waitingHint: '오늘 합계 · 운행 중 · 신규배차 켬 · 맡은 배송 0건',
  operatingHint: '배차 수락 ~ 전달 완료 합계',
  hm: (sec: number) => (sec < 3600 ? `${Math.floor(sec / 60)}분` : `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분`),
  elapsed: (sec: number) => (sec < 3600 ? `${Math.max(0, Math.floor(sec / 60))}분` : `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분`),
  steps: ['TO_STORE', 'AT_STORE', 'TO_CUSTOMER', 'AT_CUSTOMER'] as const,
  order: '주문번호',
  purpose: '목적',
  pickup: '픽업',
  items: '품목',
  itemLine: (name: string, opt: string | null | undefined, qty: number | undefined) => `${name}${opt ? ` (${opt})` : ''} × ${qty ?? '?'}`,
  itemAmount: '상품 합계',
  note: '요청사항',
  pickupEta: '가게 도착',
  dropEta: '고객 도착',
  eta: (t: string, min: number | null) => `${t}${min === null ? '' : ` · ${min}분 남음`}`,
  late: (min: number) => `${min}분 늦음`,
  delayAlert: '지연 알림',
  open: '배송 상세 · 조치',
  orderFailed: '주문 정보 못 불러옴',
  pickupShort: '픽업',
  loadFailed: '못 불러옴',
} as const;
const p = panelMessages;

/** 시:분만(Asia/Seoul) — 칸 안에서 날짜까지 쓰면 줄이 넘친다 */
const clockFmt = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' });
const clock = (iso: string) => clockFmt.format(new Date(iso));

const seoulToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const minutes = (s: number | undefined | null) => (s == null ? null : Math.max(0, Math.round(s / 60)));

function Tile({ label: l, value, hint, tone, testId }: { readonly label: string; readonly value: React.ReactNode; readonly hint?: React.ReactNode; readonly tone?: 'error' | 'info' | 'success'; readonly testId: string }) {
  const color = tone === 'error' ? 'text-error' : tone === 'info' ? 'text-info' : tone === 'success' ? 'text-success' : '';
  return (
    <div className="rounded-box border border-base-300 px-3 py-2" data-testid={testId}>
      <p className="text-xs text-base-content/60">{l}</p>
      <p className={`text-base font-bold ${color}`}>{value}</p>
      {hint && <p className="text-[11px] leading-tight text-base-content/50">{hint}</p>}
    </div>
  );
}

export function ControlRiderPanel({
  rider,
  selectedId,
  focusDeliveryId,
  onClose,
  asOf,
}: {
  readonly rider: Rider | undefined;
  readonly selectedId: string;
  /** 주문번호로 찾았으면 그 배송(라이더가 운행 목록에 없어도 보인다) */
  readonly focusDeliveryId: string;
  readonly onClose: () => void;
  /** 관제 목록의 서버 기준 시각 — "N분째" 계산 기준 */
  readonly asOf?: string | undefined;
}) {
  if (!selectedId) {
    return (
      <aside className="rounded-box border border-dashed border-base-300 bg-base-100 p-5 text-sm text-base-content/60" data-testid="control-panel-empty">
        {p.pick}
      </aside>
    );
  }
  const deliveries: readonly ActiveDelivery[] = rider?.activeDeliveries.length
    ? rider.activeDeliveries
    : focusDeliveryId
      ? [{ deliveryId: focusDeliveryId }]
      : [];
  return (
    <aside className="space-y-3 rounded-box border border-base-300 bg-base-100 p-4" aria-label={p.title} data-testid="control-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1">
            <Link className="font-mono text-lg font-bold hover:underline" to={`/riders/${encodeURIComponent(selectedId)}`}>
              {selectedId}
            </Link>
            {rider?.nameMasked && <span className="text-sm text-base-content/60">{rider.nameMasked}</span>}
            <SimBadge riderId={selectedId} />
          </p>
          {rider && (
            <p className="text-xs text-base-content/60">
              {[label(n.vehicle, rider.vehicleType), `신규배차 ${rider.newDispatchEnabled ? c.on : c.off}`].join(' · ')}
            </p>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
          {p.close}
        </button>
      </div>
      {!rider && <p className="rounded-box bg-warning/15 px-3 py-2 text-sm">{p.gone}</p>}
      <SummaryTiles rider={rider} riderId={selectedId} asOf={asOf} />
      {deliveries.length > 0 && (
        <ul className="space-y-3">
          {deliveries.map((d) => (
            <li key={d.deliveryId}>
              <DeliveryCard active={d} focused={d.deliveryId === focusDeliveryId} />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function SummaryTiles({ rider, riderId, asOf }: { readonly rider: Rider | undefined; readonly riderId: string; readonly asOf: string | undefined }) {
  const api = useApi();
  const today = seoulToday();
  const time = useQuery({
    queryKey: ['rider-operating-time', riderId, today, today],
    refetchInterval: CONTROL_REFRESH_MS * 6,
    queryFn: () => request('GET', api.execution.GET('/rider-operating-time', { params: { query: { riderId, from: today, to: today } } })),
  });
  const active = rider?.activeDeliveries ?? [];
  // "N분째" = 관제 목록의 서버 기준 시각(asOf, 10초마다 새로) − 시작 시각. 화면 시계는 쓰지 않는다(합계는 서버 값).
  const since = (iso: string) => (asOf ? (new Date(asOf).getTime() - new Date(iso).getTime()) / 1000 : 0);
  const sums = time.data;
  // 운행시간 합계(totalSeconds)는 늘 오고, 접속·대기 합은 rider 를 못 부르면 null — "못 불러옴"
  const sum = (v: number | null | undefined) => (time.isError ? p.loadFailed : !sums ? '…' : v == null ? p.loadFailed : p.hm(v));
  const location = !rider ? (
    <Tile label={p.tile.location} value={none} testId="tile-location" />
  ) : !rider.location ? (
    <Tile label={p.tile.location} value={c.noLocation} tone="error" testId="tile-location" />
  ) : rider.stale ? (
    <Tile label={p.tile.location} value={c.stale} tone="error" hint={rider.staleSinceSeconds == null ? undefined : c.seconds(rider.staleSinceSeconds)} testId="tile-location" />
  ) : (
    <Tile label={p.tile.location} value={p.receiving(rider.staleSinceSeconds == null ? none : c.seconds(rider.staleSinceSeconds))} tone="success" testId="tile-location" />
  );
  return (
    <div className="grid grid-cols-2 gap-2">
      {location}
      {rider ? (
        active.length > 0 ? (
          <Tile label={p.tile.delivery} value={p.delivering(active.length)} tone="info" hint={active.map((a) => label(n.stage, a.stage)).join(' · ')} testId="tile-delivery" />
        ) : rider.waitingSince ? (
          <Tile label={p.tile.delivery} value={p.waitingFor(p.elapsed(since(rider.waitingSince)))} tone="success" hint={p.waitingSinceAt(clock(rider.waitingSince))} testId="tile-delivery" />
        ) : (
          <Tile label={p.tile.delivery} value={p.notWaiting} hint={p.notWaitingHint} testId="tile-delivery" />
        )
      ) : (
        <Tile label={p.tile.delivery} value={none} testId="tile-delivery" />
      )}
      <Tile
        label={p.tile.connected}
        value={rider?.onDutySince ? p.elapsedNow(p.elapsed(since(rider.onDutySince))) : <span className="text-sm text-base-content/50">{p.offDuty}</span>}
        hint={[rider?.onDutySince ? p.dutyStartAt(clock(rider.onDutySince)) : null, p.todaySum(sum(sums?.connectedSeconds)), p.connectedHint].filter(Boolean).join(' · ')}
        testId="tile-connected"
      />
      <Tile label={p.tile.waiting} value={sum(sums?.waitingSeconds)} hint={p.waitingHint} testId="tile-waiting" />
      <div className="col-span-2">
        <Tile
          label={p.tile.operating}
          value={time.isError ? <span className="text-sm text-error">{p.loadFailed}</span> : sums ? p.hm(sums.totalSeconds) : '…'}
          hint={p.operatingHint}
          testId="tile-operating"
        />
      </div>
    </div>
  );
}

/** 배송 수행 조회 — 위치 목록과 같은 간격으로 다시(상세 칸·표가 같은 캐시를 나눠 씀). */
function useLiveDelivery(deliveryId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['delivery', deliveryId],
    refetchInterval: CONTROL_REFRESH_MS,
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
}

function useLiveEta(deliveryId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['delivery', deliveryId, 'eta'],
    refetchInterval: CONTROL_REFRESH_MS,
    queryFn: () => request('GET', api.tracking.GET('/deliveries/{deliveryId}/eta', { params: { path: { deliveryId } } })),
  });
}

/** 표의 "진행 중 배송" 칸 한 줄 — 배송·단계·도착 예정(관제 값) + 주문번호·픽업 지점(배송 조회). 못 읽으면 "주문 정보 못 불러옴". */
export function ActiveDeliverySummary({ active }: { readonly active: ActiveDelivery }) {
  const detail = useLiveDelivery(active.deliveryId);
  const x = detail.data;
  const orderNo = x?.orderNumber ?? x?.orderSummary?.orderNumber;
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="row-delivery">
      <Link className="font-mono text-xs font-semibold hover:underline" to={`/deliveries/${encodeURIComponent(active.deliveryId)}`} onClick={(e) => e.stopPropagation()}>
        {active.deliveryId}
      </Link>
      <StatusBadge tone="info">{label(n.stage, active.stage)}</StatusBadge>
      {x && <span className="text-xs text-base-content/70">{[orderNo ? `#${orderNo}` : null, x.mfcName ? `${p.pickupShort} ${x.mfcName}` : null].filter(Boolean).join(' · ')}</span>}
      {detail.isError && !x && <span className="text-xs text-error">{p.orderFailed}</span>}
      {active.etaDrop && <span className="text-xs text-base-content/60">{c.eta(when(active.etaDrop))}</span>}
    </span>
  );
}

function Steps({ stage }: { readonly stage: string | null | undefined }) {
  const at = p.steps.findIndex((s) => s === stage);
  return (
    <ol className="flex items-center gap-1 text-[11px]" aria-label="진행 단계" data-testid="stage-steps">
      {p.steps.map((s, i) => (
        <li key={s} className="flex items-center gap-1" aria-current={i === at ? 'step' : undefined}>
          <span className={`rounded-full px-2 py-0.5 ${i === at ? 'bg-primary font-bold text-primary-content' : i < at ? 'bg-primary/15 text-primary' : 'bg-base-200 text-base-content/50'}`}>{label(n.stage, s)}</span>
          {i < p.steps.length - 1 && <span className="text-base-content/30">›</span>}
        </li>
      ))}
    </ol>
  );
}

function Leg({ name, leg }: { readonly name: string; readonly leg: EtaLeg | undefined }) {
  if (!leg) return null;
  const late = leg.delayedBySeconds !== undefined && leg.delayedBySeconds > 0 ? minutes(leg.delayedBySeconds) : null;
  return (
    <p className="flex flex-wrap items-center gap-1 text-sm">
      <span className="w-16 shrink-0 text-base-content/55">{name}</span>
      {leg.status === 'AVAILABLE' ? <span>{p.eta(when(leg.etaAt), minutes(leg.remainingSeconds))}</span> : <span className="text-base-content/60">{label(extrasMessages.etaStatus, leg.status)}</span>}
      {late !== null && <StatusBadge tone="warning">{p.late(late)}</StatusBadge>}
    </p>
  );
}

function DropLine({ deliveryId }: { readonly deliveryId: string }) {
  const drop = useDropLocation(deliveryId);
  if (drop.isPending) return <span className="loading loading-dots loading-xs" />;
  if (drop.isError) {
    const f = dropFailureText(drop.error);
    if (!f)
      return (
        <QueryState state={toUiState(drop)} onRetry={() => void drop.refetch()}>
          {() => null}
        </QueryState>
      );
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs text-base-content/60" data-testid="drop-unavailable">
        {f.text}
        {f.retry && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void drop.refetch()}>
            {dropMessages.retry}
          </button>
        )}
      </span>
    );
  }
  const d = drop.data;
  return (
    <span className="flex flex-col" data-testid="drop-address">
      <span className="font-medium">{`${d.roadAddress} ${d.detailAddress}`.trim()}</span>
      <span className="text-[11px] text-base-content/50">
        {[label(dropMessages.kind, d.kind), d.postalCode, d.lat == null ? dropMessages.noPoint : null, dropMessages.logged].filter(Boolean).join(' · ')}
      </span>
    </span>
  );
}

function DeliveryCard({ active, focused }: { readonly active: ActiveDelivery; readonly focused: boolean }) {
  const deliveryId = active.deliveryId;
  const detail = useLiveDelivery(deliveryId);
  const eta = useLiveEta(deliveryId);
  // 단계는 관제 값(표·위 칸과 같은 원천)으로 — 관제 목록에 없는 배송(주문번호로 찾음)만 도착 예정의 단계로
  const stage = active.stage ?? eta.data?.stage;
  return (
    <div className={`space-y-3 rounded-box border p-3 ${focused ? 'border-primary ring-1 ring-primary' : 'border-base-300'}`} data-testid="panel-delivery">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1">
          <Link className="font-mono text-sm font-semibold hover:underline" to={`/deliveries/${encodeURIComponent(deliveryId)}`}>
            {deliveryId}
          </Link>
          {detail.data && (detail.data.orderNumber ?? detail.data.orderSummary?.orderNumber) && (
            <span className="font-mono text-sm">{`#${detail.data.orderNumber ?? detail.data.orderSummary?.orderNumber}`}</span>
          )}
          {eta.data?.delayAlertTriggered && <StatusBadge tone="error">{p.delayAlert}</StatusBadge>}
        </span>
      </div>
      <Steps stage={stage} />
      {eta.isError ? (
        <QueryState state={toUiState(eta)} onRetry={() => void eta.refetch()}>
          {() => null}
        </QueryState>
      ) : (
        eta.data && (
          <div className="space-y-1" data-testid="panel-eta">
            <Leg name={p.pickupEta} leg={eta.data.pickupEta} />
            <Leg name={p.dropEta} leg={eta.data.dropEta} />
          </div>
        )
      )}
      <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
        {(x) => {
          const s = x.orderSummary;
          const items = s?.items ?? [];
          return (
            <div className="space-y-2 text-sm" data-testid="panel-order">
              {/* 픽업 → 전달지 */}
              <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                <span className="mt-1 size-2 rounded-full bg-neutral" aria-hidden />
                <span className="flex flex-col">
                  <span className="font-medium">{`${p.pickup} · ${x.mfcName ?? x.mfcId ?? none}`}</span>
                  {x.mfcPhone && <span className="font-mono text-[11px] text-base-content/55">{x.mfcPhone}</span>}
                </span>
                <span className="mt-1 size-2 rounded-full bg-primary" aria-hidden />
                <DropLine deliveryId={deliveryId} />
              </div>
              {x.purpose && x.purpose !== 'DELIVERY' && <p className="text-xs">{`${p.purpose}: ${label(n.purpose, x.purpose)}`}</p>}
              {items.length > 0 && (
                <p className="text-xs text-base-content/70">
                  {items.map((it) => p.itemLine(it.name ?? none, it.optionLabel, it.qty)).join(', ')}
                  {s?.itemAmount !== undefined && ` · ${won(s.itemAmount)}`}
                </p>
              )}
              {s?.deliveryNote && <p className="rounded bg-base-200 px-2 py-1 text-xs">{`${p.note}: ${s.deliveryNote}`}</p>}
            </div>
          );
        }}
      </QueryState>
      <div className="flex justify-end">
        <Link className="btn btn-xs border-base-300 bg-base-100" to={`/deliveries/${encodeURIComponent(deliveryId)}`}>
          {p.open}
        </Link>
      </div>
    </div>
  );
}
