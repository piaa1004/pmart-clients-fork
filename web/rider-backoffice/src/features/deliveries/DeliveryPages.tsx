// 배송 찾기 — 라이더 운영(RIDER_OPS)·운영 관리자.
// - 찾기: delivery-execution `GET /deliveries`(주문 ID·라이더 ID 완전 일치, 상태·종류, 정렬, cursor — execution 0.4.0 BOD-5). 개인정보 없음.
// - 상세: 수행 `GET /deliveries/{id}`(execution) + 배차 `GET /deliveries/{id}/dispatch`(dispatch) — 서로 다른 서비스의 값이라 따로 보인다.
// 1차(2026-11-17, PC 5): 보기만 — 배차 취소·전달 실패 확정은 다음 차례. 필터·쪽은 주소 쿼리에 둔다.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { formatSeoul, QueryState, toUiState } from '@pmart/web-ui';
import type { components } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { isLiveDelivery, LIVE } from '../../shared/liveRefresh';
import { messages } from '../../shared/messages';
import { ChipGroup, CursorPager, DataTable, DetailHeader, FieldList, PageHeader, ResultBar, SearchPanel, SearchRow, Section, SectionTabs, StatCard, StatStrip, StatusBadge, type Tone } from '../../shared/admin';
import { DeliveryNo, DeliveryRef, resolveRiderId, RiderName, SystemIds, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { ops } from '../../shared/opsMessages';
import { statText, useListRows } from '../../shared/listKit';
import { ProgressSteps, type StepPlace } from '../../shared/ProgressSteps';
import { SavedViews } from '../../shared/SavedViews';
import { DeliveryActions } from './DeliveryActions';

/** 이 화면에서 더한 문구(2026-11-19 통합 백오피스와 맞추기) */
const dx = {
  stripLabel: '배송 상태별 수',
  inProgressAll: '진행 중 전체',
  stateCard: (s: string) => s,
  failedToday: '오늘 전달 실패',
  today: '오늘',
} as const;
import { DeliveryEarning, DeliveryProof, DispatchAttempts, EtaPanel, extrasMessages } from './DeliveryExtras';

const m = messages.deliveries;
const n = messages.names;
const none = messages.none;
const name = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : none);
const when = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : none);

type ExecutionState = components['schemas']['ExecutionState'];
const STATES = Object.keys(n.executionState) as ExecutionState[];
const TYPES = ['FORWARD', 'RETURN', 'RESHIPMENT'] as const;
type DeliveryType = (typeof TYPES)[number];
const PAGE_SIZE = 20;

export function DeliveriesMenu() {
  return (
    <Routes>
      <Route index element={<DeliverySearchPage />} />
      <Route path=":deliveryId" element={<DeliveryDetailPage />} />
    </Routes>
  );
}

function DeliverySearchPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const orderId = params.get('orderId') ?? '';
  const orderNumber = params.get('orderNumber') ?? '';
  const riderId = params.get('riderId') ?? '';
  const rawState = params.get('state') ?? '';
  const state = (STATES as readonly string[]).includes(rawState) ? (rawState as ExecutionState) : undefined;
  const rawType = params.get('type') ?? '';
  const type = (TYPES as readonly string[]).includes(rawType) ? (rawType as DeliveryType) : undefined;
  const oldest = params.get('sort') === 'OLDEST';
  const cursor = params.get('cursor') ?? '';
  const [draft, setDraft] = useState({ orderId, orderNumber, riderId });
  const navigate = useNavigate();

  const set = (next: Partial<{ orderId: string; orderNumber: string; riderId: string; state: string; type: string; oldest: boolean; cursor: string }>) => {
    const v = { orderId, orderNumber, riderId, state: state ?? '', type: type ?? '', oldest, cursor: '', ...next };
    setParams({
      ...(v.orderId ? { orderId: v.orderId } : {}),
      ...(v.orderNumber ? { orderNumber: v.orderNumber } : {}),
      ...(v.riderId ? { riderId: v.riderId } : {}),
      ...(v.state ? { state: v.state } : {}),
      ...(v.type ? { type: v.type } : {}),
      ...(v.oldest ? { sort: 'OLDEST' } : {}),
      ...(v.cursor ? { cursor: v.cursor } : {}),
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ orderId: draft.orderId.trim(), orderNumber: draft.orderNumber.trim(), riderId: draft.riderId.trim() });
  };

  const query = useQuery({
    queryKey: ['deliveries', orderId, orderNumber, riderId, state, type, oldest, cursor],
    // 20초마다 다시 — 새로 받는 동안 이전 목록을 그대로 둬 깜빡이지 않게
    refetchInterval: LIVE.deliveryList,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // 라이더 번호 6자리로도 찾는다(ADR-0070) — 맞는 라이더가 없으면 빈 목록
      const rid = riderId ? await resolveRiderId(api, riderId) : '';
      if (rid === null) return { items: [], page: { nextCursor: null } };
      return request(
        'GET',
        api.execution.GET('/deliveries', {
          params: {
            query: {
              size: PAGE_SIZE,
              ...(orderId ? { orderId } : {}),
              ...(orderNumber ? { orderNumber } : {}),
              ...(rid ? { riderId: rid } : {}),
              ...(state ? { state } : {}),
              ...(type ? { type } : {}),
              ...(oldest ? { sort: 'OLDEST' as const } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      );
    },
  });

  // 라이더 칸: 가린 이름 · 라이더 번호(GET /riders?riderIds= 한 번에 — ADR-0070)
  const riders = useRiderSummaries((query.data?.items ?? []).map((d) => d.riderId));

  const reset = () => {
    setDraft({ orderId: '', orderNumber: '', riderId: '' });
    setParams({});
  };
  const stateTone = (s: string | undefined): Tone =>
    s === 'COMPLETED' ? 'success' : s === 'FAILURE_REPORTED' || s === 'FAILED' ? 'error' : s === 'UNASSIGNED' ? 'warning' : s === 'CANCELLED' ? 'ghost' : 'info';

  // 상태 숫자 띠(2026-11-19 통합 백오피스처럼) — 서버가 센 끝나지 않은 배송 상태별 수(delivery-stats). 누르면 그 상태로 거른다.
  const stats = useQuery({
    queryKey: ['delivery-stats', ''],
    refetchInterval: LIVE.deliveryList,
    queryFn: () => request('GET', api.execution.GET('/delivery-stats', { params: { query: {} } })),
  });
  const inProgress = stats.data?.inProgress;
  const liveStates = STATES.filter((s) => inProgress && s in inProgress);
  const stateLink = (s: string) => `/deliveries?state=${encodeURIComponent(s)}`;
  const listRows = useListRows(
    query.data?.items?.map((d) => `/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`),
    [orderId, orderNumber, riderId, state, type, oldest, cursor].join('|'),
  );

  return (
    <section className="space-y-4">
      <PageHeader title={m.title} description={m.intro} actions={<SavedViews listKey="deliveries" />} />
      <StatStrip label={dx.stripLabel} testId="delivery-strip">
        <StatCard layout="row" label={dx.inProgressAll} value={statText(inProgress ? Object.values(inProgress).reduce((a, b) => a + b, 0) : undefined, stats.isError)} to="/deliveries" active={!state} testId="strip-all" />
        {(stats.isError || !inProgress ? (['UNASSIGNED', 'FAILURE_REPORTED'] as const) : liveStates).map((s) => (
          <StatCard layout="row"
            key={s}
            label={dx.stateCard(name(n.executionState, s))}
            value={statText(inProgress?.[s], stats.isError)}
            to={stateLink(s)}
            active={state === s}
            tone={(inProgress?.[s] ?? 0) > 0 ? (s === 'FAILURE_REPORTED' ? 'error' : s === 'UNASSIGNED' ? 'warning' : undefined) : undefined}
            testId={`strip-${s}`}
          />
        ))}
        <StatCard layout="row" label={dx.failedToday} value={statText(stats.data?.failedToday, stats.isError)} tone={(stats.data?.failedToday ?? 0) > 0 ? 'error' : undefined} hint={dx.today} testId="strip-failed-today" />
      </StatStrip>
      {/* 검색 조건 칩으로 접기(2026-11-19 통합 백오피스처럼) — 시스템 ID 조건은 "한 주문/한 라이더" */}
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        submitLabel={m.search}
        resetLabel={m.reset}
        summary={[
          ['주문', orderNumber || (orderId ? '한 주문' : '')],
          ['라이더', riderId ? (/^\d{6}$/.test(riderId) ? riderId : '한 라이더') : ''],
          [m.state, state ? name(n.executionState, state) : ''],
          [m.type, type ? name(n.deliveryType, type) : ''],
        ]}
      >
        <SearchRow label="번호로 찾기">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-base-content/60">{ops.actions.orderNumber}</span>
            <input className="input input-sm w-32" value={draft.orderNumber} maxLength={8} inputMode="numeric" placeholder="8자리" onChange={(e) => setDraft({ ...draft, orderNumber: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-base-content/60">{m.riderId}</span>
            <input className="input input-sm w-40" value={draft.riderId} maxLength={64} placeholder="6자리" onChange={(e) => setDraft({ ...draft, riderId: e.target.value })} />
          </label>
          {/* 시스템 ID(ORD-…)는 겉에 두지 않는다(ADR-0070) — 서버 로그 대조용으로만 접어 둔다 */}
          <details className="text-sm">
            <summary className="cursor-pointer select-none text-xs text-base-content/50">시스템 번호로 찾기</summary>
            <label className="mt-1 flex items-center gap-2">
              <span className="text-base-content/60">{m.orderId}</span>
              <input className="input input-sm w-44" value={draft.orderId} maxLength={64} onChange={(e) => setDraft({ ...draft, orderId: e.target.value })} />
            </label>
          </details>
        </SearchRow>
        <SearchRow label={m.state}>
          <ChipGroup
            label={m.state}
            value={state ?? ''}
            options={[{ value: '', label: m.allStates }, ...STATES.map((s) => ({ value: s, label: name(n.executionState, s) }))]}
            onChange={(v) => set({ state: v })}
          />
        </SearchRow>
        <SearchRow label={m.type}>
          <ChipGroup
            label={m.type}
            value={type ?? ''}
            options={[{ value: '', label: m.allTypes }, ...TYPES.map((x) => ({ value: x, label: name(n.deliveryType, x) }))]}
            onChange={(v) => set({ type: v })}
          />
        </SearchRow>
      </SearchPanel>
      <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={m.empty}>
        {(r) => {
          const nextCursor = r.page?.nextCursor ?? null;
          const items = r.items ?? [];
          return (
            <div className="space-y-3">
              <ResultBar count={items.length} more={!!nextCursor} sort={{ oldest, onChange: (o) => set({ oldest: o }) }} />
              <DataTable>
                <thead>
                  <tr>
                    <th>{m.col.delivery}</th>
                    <th>{ops.actions.orderNumber}</th>
                    <th>{m.col.type}</th>
                    <th>{m.col.state}</th>
                    <th>{m.col.rider}</th>
                    <th>{m.col.mfc}</th>
                    <th>{m.col.createdAt}</th>
                    <th>{m.col.completedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d, i) => (
                    <tr key={d.deliveryId ?? `d-${i}`} data-testid="delivery-row" className={`cursor-pointer ${listRows.rowClass(`/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`)}`} onClick={() => void navigate(`/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`)}>
                      <td>
                        <Link className="hover:underline" to={`/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`} onClick={(e) => e.stopPropagation()}>
                          <DeliveryNo deliveryId={d.deliveryId ?? ''} deliveryNumber={d.deliveryNumber} orderNumber={d.orderNumber} />
                        </Link>
                        {listRows.seenMark(`/deliveries/${encodeURIComponent(d.deliveryId ?? '')}`)}
                      </td>
                      <td className="font-mono">{d.orderNumber ?? <span className="text-base-content/40">{none}</span>}</td>
                      <td>{name(n.deliveryType, d.type)}</td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1">
                          <StatusBadge tone={stateTone(d.state)}>{name(n.executionState, d.state)}</StatusBadge>
                          {d.resumeRequestedAt && <StatusBadge tone="warning">{m.resumeRequested}</StatusBadge>}
                        </span>
                      </td>
                      <td>
                        {d.riderId ? (
                          <RiderName riderId={d.riderId} nameMasked={riders.get(d.riderId)?.nameMasked} riderNumber={riders.get(d.riderId)?.riderNumber} />
                        ) : (
                          <span className="text-base-content/40">{m.noRider}</span>
                        )}
                      </td>
                      <td className="font-mono">{d.mfcId ?? none}</td>
                      <td className="whitespace-nowrap">{when(d.createdAt)}</td>
                      <td className="whitespace-nowrap">{when(d.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <CursorPager hasPrev={!!cursor} nextCursor={nextCursor} onFirst={() => set({})} onNext={(c) => set({ cursor: c })} />
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}
// 배송 진행 단계(2026-11-19 통합 백오피스 ProgressSteps 처럼) — 서버 상태를 단계 자리로만 바꾼다(지금 단계만 숨쉬기, 끝난 단계는 체크).
// 단계 밖 상태(회수·중지 등)는 칠하지 않고 그 이름을 그대로 적는다. 전달 실패 확정·취소는 오른쪽 ✕ 갈래.
const STEP_STATES = ['UNASSIGNED', 'ASSIGNED', 'ARRIVED_AT_STORE', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'COMPLETED'] as const;
function deliveryStepPlace(state: string | null | undefined): { readonly place: StepPlace | null; readonly ended?: string } {
  if (!state) return { place: null };
  if (state === 'COMPLETED') return { place: { step: STEP_STATES.length - 1, done: true } };
  if (state === 'FAILURE_REPORTED') return { place: { step: 4, done: false, warn: true, note: name(n.executionState, state) } };
  if (state === 'FAILED' || state === 'CANCELLED') return { place: null, ended: name(n.executionState, state) };
  const i = (STEP_STATES as readonly string[]).indexOf(state);
  return { place: i >= 0 ? { step: i, done: false } : null };
}

function DeliverySteps({ state }: { readonly state: string | null | undefined }) {
  const { place, ended } = deliveryStepPlace(state);
  return (
    <ProgressSteps
      steps={STEP_STATES.map((s) => name(n.executionState, s))}
      place={place}
      ended={ended}
      unknownText={state ? `지금 상태: ${name(n.executionState, state)} — 배달 단계 밖이에요` : undefined}
      label="배송 진행 단계"
      testId="delivery-steps"
      endedTestId="delivery-steps-ended"
    />
  );
}

const executionTone = (s: string | undefined): Tone =>
  s === 'COMPLETED' ? 'success' : s === 'FAILURE_REPORTED' || s === 'FAILED' ? 'error' : s === 'UNASSIGNED' ? 'warning' : s === 'CANCELLED' ? 'ghost' : 'info';

// 상세(2026-11-18 — 배민 주문내역 상세 참고): 머리(번호·상태·요약) → 구역 이동 탭 → 구역 상자(항목명/값).
// 수행(execution)·배차(dispatch)·도착 예정(tracking)은 서로 다른 서비스 값이라 구역도 따로, 못 읽은 구역만 오류.
function DeliveryDetailPage() {
  const api = useApi();
  const { deliveryId = '' } = useParams();
  // 진행 중 배송이면 10초마다(배정·픽업이 바로 보이게), 끝난 배송은 새로 고치지 않는다.
  const execution = useQuery({
    queryKey: ['delivery', deliveryId],
    refetchInterval: (q) => (isLiveDelivery(q.state.data?.state) ? LIVE.delivery : false),
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}', { params: { path: { deliveryId } } })),
  });
  const live = isLiveDelivery(execution.data?.state);
  const dispatch = useQuery({
    queryKey: ['delivery-dispatch', deliveryId],
    refetchInterval: live ? LIVE.delivery : false,
    queryFn: () => request('GET', api.dispatch.GET('/deliveries/{deliveryId}/dispatch', { params: { path: { deliveryId } } })),
  });
  const d = execution.data;
  // 라이더 표시: 가린 이름 · 라이더 번호(수행·배차 라이더를 한 번에)
  const riders = useRiderSummaries([d?.riderId, dispatch.data?.assignment?.riderId]);
  const tabs = [
    { id: 'sec-execution', label: '수행 정보' },
    { id: 'sec-dispatch', label: '배차' },
    { id: 'sec-eta', label: '도착 예정' },
    { id: 'sec-proof', label: '완료 증빙' },
    { id: 'sec-earning', label: '수행료' },
    { id: 'sec-history', label: '이력' },
    { id: 'sec-actions', label: '운영 조치' },
  ];
  return (
    <section className="max-w-[1600px] space-y-4">
      <DetailHeader
        seen={!!d}
        back={{ to: '/deliveries', label: m.back }}
        title={
          <>
            배송 <DeliveryNo deliveryId={deliveryId} deliveryNumber={d?.deliveryNumber} orderNumber={d?.orderNumber ?? d?.orderSummary?.orderNumber} />
          </>
        }
        badges={
          d && (
            <>
              <StatusBadge tone={executionTone(d.state)}>{name(n.executionState, d.state)}</StatusBadge>
              <StatusBadge tone="accent">{name(n.deliveryType, d.type)}</StatusBadge>
              {d.purpose && d.purpose !== 'DELIVERY' && <StatusBadge>{name(n.purpose, d.purpose)}</StatusBadge>}
            </>
          )
        }
        summary={
          d && (
            <span className="inline-flex flex-wrap items-center gap-1">
              {[d.orderNumber ? `주문번호 ${d.orderNumber}` : null, d.mfcName ?? d.mfcId].filter(Boolean).join(' · ')}
              <span className="text-base-content/30">·</span>
              {d.riderId ? (
                <>
                  라이더 <RiderName riderId={d.riderId} nameMasked={riders.get(d.riderId)?.nameMasked} riderNumber={riders.get(d.riderId)?.riderNumber} />
                </>
              ) : (
                m.noRider
              )}
            </span>
          )
        }
      />
      {d && <DeliverySteps state={d.state} />}
      {d && (
        <SystemIds
          ids={[
            ['배송 ID', deliveryId],
            ['주문 ID', d.orderId],
            ['라이더 ID', d.riderId],
          ]}
        />
      )}
      <SectionTabs items={tabs} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="sec-execution" title={m.execution}>
          <QueryState state={toUiState(execution)} onRetry={() => void execution.refetch()}>
            {(x) => (
              <div className="space-y-4">
                <FieldList
                  testId="execution-detail"
                  rows={[
                    [m.col.state, name(n.executionState, x.state)],
                    [m.col.type, name(n.deliveryType, x.type)],
                    [m.purpose, name(n.purpose, x.purpose)],
                    [m.orderNumber, <span className="font-mono">{x.orderNumber ?? none}</span>],
                    [m.col.mfc, x.mfcName ?? x.mfcId ?? none],
                    [m.col.rider, x.riderId ? <RiderName riderId={x.riderId} nameMasked={riders.get(x.riderId)?.nameMasked} riderNumber={riders.get(x.riderId)?.riderNumber} /> : m.noRider],
                    [m.col.assignedAt, when(x.assignedAt)],
                    [m.col.completedAt, when(x.completedAt)],
                  ]}
                />
                {x.failure && (
                  <div className="rounded-box bg-error/5 p-4">
                    <p className="mb-2 text-sm font-semibold text-error">{m.failure}</p>
                    <FieldList
                      testId="failure-detail"
                      rows={[
                        [m.failureReason, name(n.failureReason, x.failure.reason)],
                        [m.decision, x.failure.decision ? `${name(n.decision, x.failure.decision)} (${when(x.failure.decidedAt)})` : none],
                        [m.custody, name(n.custody, x.failure.custody)],
                        x.failure.returnDeliveryId
                          ? [
                              m.returnDelivery,
                              <ReturnDeliveryRef deliveryId={x.failure.returnDeliveryId} />,
                            ]
                          : null,
                      ]}
                    />
                  </div>
                )}
                {(x.orderSummary?.items ?? []).length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold">{m.items}</p>
                    <ul className="divide-y divide-base-200 rounded-box border border-base-300 text-sm" data-testid="order-items">
                      {(x.orderSummary?.items ?? []).map((it, i) => (
                        <li key={`${it.name ?? ''}-${i}`} className="flex justify-between gap-3 px-3 py-2">
                          <span>{[it.name, it.optionLabel].filter(Boolean).join(' ')}</span>
                          <span className="tabular-nums">{it.qty ?? 0}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </QueryState>
        </Section>
        <Section id="sec-dispatch" title={m.dispatch}>
          <QueryState state={toUiState(dispatch)} onRetry={() => void dispatch.refetch()}>
            {(p) => (
              <div className="space-y-4">
                <FieldList
                  testId="dispatch-detail"
                  rows={[
                    ['배차 상태', name(n.dispatchState, p.state)],
                    [
                      m.col.rider,
                      p.assignment?.riderId ? (
                        <RiderName riderId={p.assignment.riderId} nameMasked={riders.get(p.assignment.riderId)?.nameMasked} riderNumber={riders.get(p.assignment.riderId)?.riderNumber} />
                      ) : (
                        m.noRider
                      ),
                    ],
                    [m.attempts, m.attemptsCount((p.attempts ?? []).length)],
                    [m.arrivalWindow, p.arrivalWindow ? [p.arrivalWindow.date, [p.arrivalWindow.start, p.arrivalWindow.end].filter(Boolean).join('~')].filter(Boolean).join(' ') || none : none],
                  ]}
                />
                <DispatchAttempts attempts={p.attempts ?? []} />
              </div>
            )}
          </QueryState>
        </Section>
        <Section id="sec-eta" title={extrasMessages.eta}>
          <EtaPanel deliveryId={deliveryId} />
        </Section>
        <Section id="sec-proof" title={extrasMessages.proof}>
          {d ? <DeliveryProof delivery={d} /> : <QueryState state={toUiState(execution)} onRetry={() => void execution.refetch()}>{() => null}</QueryState>}
        </Section>
        <Section id="sec-earning" title={extrasMessages.earning}>
          {d ? <DeliveryEarning delivery={d} /> : <QueryState state={toUiState(execution)} onRetry={() => void execution.refetch()}>{() => null}</QueryState>}
        </Section>
        <Section id="sec-history" title={m.history}>
          {d && ((d.history ?? []).length === 0 ? (
            <p className="text-sm text-base-content/50">{none}</p>
          ) : (
            <ol className="relative space-y-3 border-l-2 border-base-300 pl-4 text-sm" data-testid="execution-history">
              {(d.history ?? []).map((h, i) => (
                <li key={`${h.occurredAt ?? ''}-${i}`} className="relative">
                  <span className="absolute -left-[1.4rem] top-1 size-2.5 rounded-full bg-accent" aria-hidden />
                  <span className="font-medium">{name(n.executionState, h.state)}</span>
                  <span className="ml-2 text-base-content/55">{`${when(h.occurredAt)} · ${name(n.actor, h.actor)}`}</span>
                </li>
              ))}
            </ol>
          ))}
        </Section>
      </div>
      <Section id="sec-actions" title="운영 조치" aside={<span className="text-xs text-base-content/50">지금 상태에서 계약이 허락하는 조치만 보여요</span>}>
        {d ? <DeliveryActions delivery={d} dispatch={dispatch.data} /> : null}
      </Section>
    </section>
  );
}
/** 반납 배송 — 배송 번호로(시스템 ID 는 그 배송 상세의 "시스템 번호") */
function ReturnDeliveryRef({ deliveryId }: { readonly deliveryId: string }) {
  const no = useDeliveryNumbers([deliveryId]).get(deliveryId);
  return <DeliveryRef deliveryId={deliveryId} numbers={no} />;
}
