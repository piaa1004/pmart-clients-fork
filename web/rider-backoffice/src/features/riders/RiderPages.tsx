// 라이더 찾기·상세·가입 승인·제한 검토(2026-11-17, PC 5 — ADR-0068 로 기본 백오피스에서 옮겨 오는 화면).
// - 찾기: rider `GET /riders`(ID·전화 완전 일치, 제한·운행 거르기, 가입·상태 바뀐 순 — 이름·전화 가림). 가입 승인 = 같은 목록 최근 가입 순 + 승인 상태(지금은 늘 자동 승인).
// - 상세: rider 상세(정산계좌 등록 여부·은행 이름, 지금 동의한 버전 — rider 0.10.0)·원문 열람(사유 → audit 기록)·계정 제한 바꾸기·이력,
//   execution 직원용 수행료·운행시간, dispatch 배정 이력(`GET /rider-assignments` — dispatch 0.8.0), 이 라이더 배송 찾기로 가기.
// - 제한 검토: rider `GET /riders/restriction-reviews`·`POST …/decisions` — 상태 탭(검토 중·제한함·제한 안 함), 결정한 줄은 그 자리에 결과로 남김.
// - 2026-11-18 기본 백오피스에서 마저 옮김(ADR-0068, PC 2 요청): 찾기의 수단 거르기·정렬, 상세의 열린 제한 검토·컴플레인 기록(case `GET /rider-complaints`).
// 꾸밈(2026-11-18): 배민 관리자 구성 — 목록은 검색 조건 상자 → 결과 줄 → 표, 상세는 머리 → 구역 탭 → 구역 상자(DeliveryPages 와 같은 틀).
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/rider';
import { useApi } from '../../app/ApiContext';
import { AllDone, ChipGroup, CursorPager, DataTable, GuideBox, DetailHeader, FieldList, Notice, PageHeader, ResultBar, SearchPanel, SearchRow, Section, SectionTabs, StatCard, StatStrip, StatusBadge, type Tone } from '../../shared/admin';
import { statText, useListRows } from '../../shared/listKit';
import { SavedViews } from '../../shared/SavedViews';
import { ui } from '../../shared/uiMessages';
import { DeliveryRef, RiderName, RiderRef, StaffName, SystemIds, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { SimBadge } from '../../shared/sim';
import { useSession } from '../../app/SessionContext';
import { LIVE } from '../../shared/liveRefresh';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, none, when, won } from '../../shared/opsUi';
import { riderMessages as rm } from './riderMessages';

const r = ops.riders;
const n = messages.names;
type Restriction = components['schemas']['AccountRestriction'];
type OperatingStatus = components['schemas']['OperatingStatus'];
type VehicleType = components['schemas']['VehicleType'];
type Sort = keyof typeof rm.search.sortName;
type Review = components['schemas']['RestrictionReview'];
type ReviewState = NonNullable<Review['state']>;
const RESTRICTIONS: readonly Restriction[] = ['NORMAL', 'DISPATCH_RESTRICTED', 'SUSPENDED', 'TERMINATED'];
const OPERATING: readonly OperatingStatus[] = ['ON_DUTY', 'OFF_DUTY'];
const VEHICLES = ['MOTORCYCLE', 'BICYCLE', 'E_BIKE', 'KICKBOARD', 'CAR', 'WALK'] as const satisfies readonly VehicleType[];
const SORTS = Object.keys(rm.search.sortName) as Sort[];
const REVIEW_STATES = Object.keys(rm.reviews.state) as ReviewState[];
const reviewTone = (s: string | null | undefined): Tone => (s === 'OPEN' ? 'warning' : s === 'RESTRICTED' ? 'error' : 'ghost');
const PAGE_SIZE = 20;
/** 화면 안내 글을 안내 상자 글머리로(문장마다 — 새 문구를 만들지 않는다) */
const splitGuide = (t: string) => t.split(/(?<=[.요]) (?=\S)/).filter(Boolean);

/** 이 화면에서 더한 문구(2026-11-19 통합 백오피스와 맞추기) */
const rx = {
  stripLabel: '라이더 수',
  total: '전체 라이더',
  onDuty: '운행 중',
  accepting: (n: string) => `새 배차 받는 중 ${n}`,
  joinedToday: '오늘 가입',
} as const;

const restrictionTone = (s: string | null | undefined): Tone =>
  s === 'NORMAL' ? 'success' : s === 'DISPATCH_RESTRICTED' ? 'warning' : s === 'SUSPENDED' ? 'error' : s === 'TERMINATED' ? 'neutral' : 'ghost';
const operatingTone = (s: string | null | undefined): Tone => (s === 'ON_DUTY' ? 'info' : 'ghost');
const signupTone = (s: string | null | undefined): Tone => (s === 'APPROVED' ? 'success' : s === 'PENDING' ? 'warning' : s === 'REJECTED' ? 'error' : 'ghost');
const outcomeTone = (s: string | null | undefined): Tone => (s === 'CURRENT' ? 'info' : s === 'DONE' ? 'success' : s === 'RELEASED' ? 'warning' : 'ghost');
const signupText = (status: string | null | undefined, decidedBy?: string | null) =>
  status === 'APPROVED' && (decidedBy === undefined || decidedBy === 'AUTO') ? r.signupAuto : label(n.signupStatus, status);

export function RidersMenu() {
  return (
    <Routes>
      <Route index element={<RiderSearchPage />} />
      <Route path=":riderId" element={<RiderDetailPage />} />
    </Routes>
  );
}

export function SignupsMenu() {
  return <RiderSearchPage signups />;
}

function RiderSearchPage({ signups = false }: { readonly signups?: boolean }) {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // 화면 번호 규칙(ADR-0070, 2026-11-18 사용자 "설마 저 긴 ID를 다 쳐야 한다는 건 아니지?"): 라이더 번호 6자리로 찾는다.
  // 옛 링크 ?riderId=RD-… 는 그대로 받아 그 라이더를 찾는다(화면 칸에는 없음).
  const riderNumber = params.get('riderNumber') ?? '';
  const riderId = params.get('riderId') ?? '';
  const phone = params.get('phone') ?? '';
  const rawR = params.get('restriction') ?? '';
  const restriction = (RESTRICTIONS as readonly string[]).includes(rawR) ? (rawR as Restriction) : undefined;
  const rawO = params.get('operatingStatus') ?? '';
  const operatingStatus = (OPERATING as readonly string[]).includes(rawO) ? (rawO as OperatingStatus) : undefined;
  const rawV = params.get('vehicleType') ?? '';
  const vehicleType = (VEHICLES as readonly string[]).includes(rawV) ? (rawV as VehicleType) : undefined;
  const sort: Sort = SORTS.find((s) => s === params.get('sort')) ?? 'JOINED_DESC';
  const page = Number(params.get('page') ?? '0') || 0;
  const [draft, setDraft] = useState({ riderNumber, phone });

  const set = (next: Partial<Record<'riderNumber' | 'riderId' | 'phone' | 'restriction' | 'operatingStatus' | 'vehicleType' | 'sort' | 'page', string>>) => {
    const v = { riderNumber, riderId, phone, restriction: restriction ?? '', operatingStatus: operatingStatus ?? '', vehicleType: vehicleType ?? '', sort: sort === 'JOINED_DESC' ? '' : sort, page: '', ...next };
    setParams(Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== '' && x !== '0' && !(k === 'sort' && x === 'JOINED_DESC'))));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ riderNumber: draft.riderNumber.replace(/\D/g, ''), riderId: '', phone: draft.phone.trim() });
  };
  const reset = () => {
    setDraft({ riderNumber: '', phone: '' });
    setParams({});
  };
  const query = useQuery({
    queryKey: ['riders', riderNumber, riderId, phone, restriction, operatingStatus, vehicleType, sort, page],
    queryFn: () =>
      request(
        'GET',
        api.riders.GET('/riders', {
          params: {
            query: {
              size: PAGE_SIZE,
              page,
              // 가입 승인 화면은 늘 최근 가입 순
              sort: signups ? 'JOINED_DESC' : sort,
              ...(riderNumber ? { riderNumber } : {}),
              ...(riderId ? { riderId } : {}),
              ...(phone ? { phone } : {}),
              ...(restriction ? { restriction } : {}),
              ...(operatingStatus ? { operatingStatus } : {}),
              ...(vehicleType ? { vehicleType } : {}),
            },
          },
        }),
      ),
  });
  const open = (id: string | undefined) => void navigate(`/riders/${encodeURIComponent(id ?? '')}`);
  // 숫자 띠(2026-11-19 통합 백오피스처럼) — 서버가 센 라이더 수(GET /riders/stats). 누르면 그 조건으로 거른다
  const stats = useQuery({
    queryKey: ['rider-stats', ''],
    refetchInterval: LIVE.dashboard,
    queryFn: () => request('GET', api.riders.GET('/riders/stats', { params: { query: {} } })),
  });
  const st = stats.data;
  const failed = stats.isError;
  const riderPath = (id: string | undefined) => `/riders/${encodeURIComponent(id ?? '')}`;
  const listRows = useListRows(query.data?.items?.map((row) => riderPath(row.riderId)), [signups, riderNumber, riderId, phone, restriction, operatingStatus, vehicleType, sort, page].join('|'));
  const filtered = !!(riderNumber || riderId || phone || operatingStatus || vehicleType);
  return (
    <section className="space-y-4">
      <PageHeader title={signups ? ops.signups.title : r.title} description={signups ? ops.signups.intro : r.intro} actions={signups ? undefined : <SavedViews listKey="riders" />} />
      {signups ? (
        <StatStrip label={rx.stripLabel} testId="signup-strip">
          <StatCard layout="row" label={rx.joinedToday} value={statText(st?.joinedToday, failed)} testId="strip-joined-today" />
          <StatCard layout="row" label={rx.total} value={statText(st?.total, failed)} to="/riders" testId="strip-total" />
        </StatStrip>
      ) : (
        <StatStrip label={rx.stripLabel} testId="rider-strip">
          <StatCard layout="row" label={rx.total} value={statText(st?.total, failed)} to="/riders" active={!restriction && !filtered} testId="strip-total" />
          <StatCard layout="row" label={rx.onDuty} value={statText(st?.onDuty, failed)} hint={rx.accepting(statText(st?.onDutyAcceptingNew, failed))} to="/riders?operatingStatus=ON_DUTY" active={operatingStatus === 'ON_DUTY' && !restriction} testId="strip-on-duty" />
          {RESTRICTIONS.filter((x) => x !== 'NORMAL').map((x) => (
            <StatCard layout="row"
              key={x}
              label={label(n.restriction, x)}
              value={statText(st?.byRestriction[x], failed)}
              to={`/riders?restriction=${x}`}
              active={restriction === x}
              tone={(st?.byRestriction[x] ?? 0) > 0 ? (x === 'SUSPENDED' ? 'error' : x === 'DISPATCH_RESTRICTED' ? 'warning' : undefined) : undefined}
              testId={`strip-${x}`}
            />
          ))}
        </StatStrip>
      )}
      {signups && <Notice>{ops.signups.autoNote}</Notice>}
      {!signups && (
        <SearchPanel
          onSubmit={submit}
          onReset={reset}
          submitLabel={r.search}
          resetLabel={r.reset}
          summary={[
            [rm.riderNumber, riderNumber || (riderId ? '한 라이더' : '')],
            [r.phone, phone ? '입력함' : ''],
            [r.restriction, restriction ? label(n.restriction, restriction) : ''],
            [r.operating, operatingStatus ? label(n.operatingStatus, operatingStatus) : ''],
            [rm.search.vehicle, vehicleType ? label(n.vehicle, vehicleType) : ''],
          ]}
        >
          <SearchRow label={rm.findByNumber}>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-base-content/60">{rm.riderNumber}</span>
              <input
                className="input input-sm w-32 font-mono"
                value={draft.riderNumber}
                maxLength={6}
                inputMode="numeric"
                placeholder="482913"
                aria-label={rm.riderNumber}
                onChange={(e) => setDraft({ ...draft, riderNumber: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-base-content/60">{r.phone}</span>
              <input className="input input-sm w-40" value={draft.phone} maxLength={20} inputMode="tel" onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </label>
          </SearchRow>
          <SearchRow label={r.restriction}>
            <ChipGroup
              label={r.restriction}
              value={restriction ?? ''}
              options={[{ value: '', label: r.allRestrictions }, ...RESTRICTIONS.map((x) => ({ value: x, label: label(n.restriction, x) }))]}
              onChange={(v) => set({ restriction: v })}
            />
          </SearchRow>
          <SearchRow label={r.operating}>
            <ChipGroup
              label={r.operating}
              value={operatingStatus ?? ''}
              options={[{ value: '', label: r.allOperating }, ...OPERATING.map((x) => ({ value: x, label: label(n.operatingStatus, x) }))]}
              onChange={(v) => set({ operatingStatus: v })}
            />
          </SearchRow>
          <SearchRow label={rm.search.vehicle}>
            <ChipGroup
              label={rm.search.vehicle}
              value={vehicleType ?? ''}
              options={[{ value: '', label: rm.search.allVehicles }, ...VEHICLES.map((x) => ({ value: x, label: label(n.vehicle, x) }))]}
              onChange={(v) => set({ vehicleType: v })}
            />
          </SearchRow>
        </SearchPanel>
      )}
      {!signups && (
        <div className="flex justify-end">
          <ChipGroup label={rm.search.sort} value={sort} options={SORTS.map((s) => ({ value: s, label: rm.search.sortName[s] }))} onChange={(v) => set({ sort: v })} />
        </div>
      )}
      <QueryState state={toUiState(query, (x) => (x.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={r.empty}>
        {(x) => {
          const items = x.items ?? [];
          return (
            <div className="space-y-3">
              <ResultBar count={items.length} more={!!x.hasNext} />
              <DataTable>
                <thead>
                  <tr>
                    <th>{r.col.rider}</th>
                    <th>{r.col.name}</th>
                    <th>{r.col.phone}</th>
                    <th>{r.col.vehicle}</th>
                    <th>{r.col.operating}</th>
                    <th>{r.col.restriction}</th>
                    <th>{r.col.signup}</th>
                    <th>{r.col.joinedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.riderId} data-testid="rider-row" className={`cursor-pointer ${listRows.rowClass(riderPath(row.riderId))}`} onClick={() => open(row.riderId)}>
                      <td className="font-mono font-semibold">
                        <Link className="hover:underline" to={`/riders/${encodeURIComponent(row.riderId ?? '')}`} onClick={(e) => e.stopPropagation()}>
                          <RiderName riderId={row.riderId} riderNumber={row.riderNumber} />
                        </Link>
                        {listRows.seenMark(riderPath(row.riderId))}
                      </td>
                      <td>{row.nameMasked ?? none}</td>
                      <td className="font-mono">{row.phoneMasked ?? none}</td>
                      <td>{label(n.vehicle, row.vehicleType)}</td>
                      <td>
                        <StatusBadge tone={operatingTone(row.operatingStatus)}>{label(n.operatingStatus, row.operatingStatus)}</StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={restrictionTone(row.restriction)}>{label(n.restriction, row.restriction)}</StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={signupTone(row.signupStatus)}>{signupText(row.signupStatus)}</StatusBadge>
                      </td>
                      <td className="whitespace-nowrap">{when(row.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <CursorPager
                hasPrev={page > 0}
                nextCursor={x.hasNext ? String(page + 1) : null}
                page={page + 1}
                onFirst={() => set({ page: '' })}
                onNext={(c) => set({ page: c })}
              />
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

function thisWeek(): { from: string; to: string } {
  const now = new Date(Date.now() + 9 * 3600_000); // Asia/Seoul 날짜
  const day = (now.getUTCDay() + 6) % 7; // 월요일 0
  const from = new Date(now.getTime() - day * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(now) };
}

// 상세(2026-11-18 — 배민 주문내역 상세 참고): 머리(ID·제한·운행·가입 표시 + 요약) → 구역 탭 → 구역 상자.
// rider·execution·dispatch 는 서로 다른 서비스 값이라 구역도 따로, 못 읽은 구역만 오류.
function RiderDetailPage() {
  const api = useApi();
  const { riderId = '' } = useParams();
  // 운행 중(ON_DUTY)이면 15초마다(배정·완료가 바로 보이게), 운행 중이 아니면 멈춤.
  // operating.activeDeliveryCount 는 계약에 있지만 rider-service 가 아직 채우지 않아(백엔드 확인 2026-11-18) 쓰지 않는다.
  const detail = useQuery({
    queryKey: ['rider', riderId],
    refetchInterval: (q) => (q.state.data?.operating?.status === 'ON_DUTY' ? LIVE.rider : false),
    queryFn: () => request('GET', api.riders.GET('/riders/{riderId}', { params: { path: { riderId } } })),
  });
  const riderLive = detail.data?.operating?.status === 'ON_DUTY';
  const week = thisWeek();
  const earnings = useQuery({
    queryKey: ['rider-earnings', riderId],
    queryFn: () => request('GET', api.execution.GET('/rider-earnings', { params: { query: { riderId, size: 20 } } })),
  });
  const earningNos = useDeliveryNumbers((earnings.data?.items ?? []).map((it) => it.deliveryId));
  const time = useQuery({
    queryKey: ['rider-operating-time', riderId, week.from],
    queryFn: () => request('GET', api.execution.GET('/rider-operating-time', { params: { query: { riderId, from: week.from, to: week.to } } })),
  });
  const d = detail.data;
  const tabs = [
    { id: 'sec-info', label: rm.tabs.info },
    { id: 'sec-account', label: rm.tabs.account },
    { id: 'sec-time', label: rm.tabs.time },
    { id: 'sec-earnings', label: rm.tabs.earnings },
    { id: 'sec-assignments', label: rm.tabs.assignments },
    { id: 'sec-reviews', label: rm.tabs.reviews },
    { id: 'sec-complaints', label: rm.tabs.complaints },
    { id: 'sec-restriction', label: rm.tabs.restriction },
  ];
  return (
    <section className="max-w-[1600px] space-y-4">
      <DetailHeader
        seen={!!d}
        back={{ to: '/riders', label: r.back }}
        title={d?.riderNumber ? r.detailTitle(d.riderNumber) : r.detailTitle(rm.noNumber)}
        badges={
          d && (
            <>
              <SimBadge riderId={riderId} />
              <StatusBadge tone={restrictionTone(d.restriction?.state)}>{label(n.restriction, d.restriction?.state)}</StatusBadge>
              <StatusBadge tone={operatingTone(d.operating?.status)}>{label(n.operatingStatus, d.operating?.status)}</StatusBadge>
              <StatusBadge tone={signupTone(d.signupStatus)}>{signupText(d.signupStatus, d.signupDecidedBy ?? null)}</StatusBadge>
            </>
          )
        }
        summary={d && [d.nameMasked, d.phoneMasked, d.vehicleType ? label(n.vehicle, d.vehicleType) : null, d.joinedAt ? `${r.col.joinedAt} ${when(d.joinedAt)}` : null].filter(Boolean).join(' · ')}
        actions={
          <Link className="btn btn-sm border-base-300 bg-base-100" to={`/deliveries?riderId=${encodeURIComponent(riderId)}`}>
            {r.deliveries}
          </Link>
        }
      />
      <SystemIds ids={[[rm.systemRiderId, riderId]]} />
      <SectionTabs items={tabs} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="sec-info" title={r.info}>
          <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
            {(x) => (
              <div className="space-y-4">
                <FieldList
                  testId="rider-detail"
                  rows={[
                    [r.col.name, x.nameMasked ?? none],
                    [r.col.phone, <span className="font-mono">{x.phoneMasked ?? none}</span>],
                    [r.col.vehicle, label(n.vehicle, x.vehicleType)],
                    [r.col.operating, label(n.operatingStatus, x.operating?.status)],
                    [r.col.restriction, label(n.restriction, x.restriction?.state)],
                    [r.signupStatus, signupText(x.signupStatus, x.signupDecidedBy ?? null)],
                    [r.areas, (x.deliveryAreas ?? []).map((a) => a.mfcId).join(', ') || none],
                    [r.col.joinedAt, when(x.joinedAt)],
                  ]}
                />
                <RevealForm riderId={riderId} />
              </div>
            )}
          </QueryState>
        </Section>
        <Section id="sec-account" title={rm.bank.title}>
          <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
            {(x) => <AccountAndConsents detail={x} />}
          </QueryState>
        </Section>
        <Section id="sec-time" title={r.operatingTime}>
          <QueryState state={toUiState(time)} onRetry={() => void time.refetch()}>
            {(t) => (
              <p className="text-sm" data-testid="operating-time">
                {r.operatingTotal(`${Math.floor(t.totalSeconds / 3600)}시간 ${Math.floor((t.totalSeconds % 3600) / 60)}분`)}
                <span className="ml-2 text-base-content/50">{`${week.from} ~ ${week.to}`}</span>
              </p>
            )}
          </QueryState>
        </Section>
        <Section id="sec-earnings" title={r.earnings}>
          <QueryState state={toUiState(earnings, (e) => (e.items ?? []).length === 0)} onRetry={() => void earnings.refetch()} emptyText={none}>
            {(e) => (
              <div className="space-y-3">
                <p className="text-sm text-base-content/70">{r.earningsTotals(won(e.totals?.estimated), won(e.totals?.confirmed), won(e.totals?.paid))}</p>
                <DataTable testId="rider-earnings">
                  <thead>
                    <tr>
                      <th>{r.col2.delivery}</th>
                      <th>{r.col2.performedOn}</th>
                      <th>{r.col2.total}</th>
                      <th>{r.col2.state}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(e.items ?? []).map((it) => (
                      <tr key={it.earningId}>
                        <td>
                          <DeliveryRef deliveryId={it.deliveryId} numbers={earningNos.get(it.deliveryId ?? '')} />
                        </td>
                        <td className="whitespace-nowrap">{when(it.recordedAt)}</td>
                        <td className="tabular-nums">{it.calculable ? won(it.total) : <StatusBadge tone="warning">{r.notCalculable}</StatusBadge>}</td>
                        <td>{label(n.settlementState, it.settlementState)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              </div>
            )}
          </QueryState>
        </Section>
      </div>
      <Section id="sec-assignments" title={rm.assignments.title} aside={<span className="text-xs text-base-content/50">{rm.assignments.intro}</span>}>
        <AssignmentHistory riderId={riderId} live={riderLive} />
      </Section>
      <Section id="sec-reviews" title={rm.tabs.reviews} aside={<span className="text-xs text-base-content/50">{rm.detailReviews.intro}</span>}>
        <ReviewTable state="OPEN" riderId={riderId} />
      </Section>
      <Section id="sec-complaints" title={rm.tabs.complaints} aside={<span className="text-xs text-base-content/50">{rm.complaints.intro}</span>}>
        <ComplaintHistory riderId={riderId} />
      </Section>
      <Section id="sec-restriction" title={rm.tabs.restriction} aside={<span className="text-xs text-base-content/50">{rm.restrictionAside}</span>}>
        <RestrictionPanel riderId={riderId} />
      </Section>
    </section>
  );
}

/** 정산계좌 등록 여부·은행 이름(계좌번호는 오지 않는다) + 지금 동의한 버전(항목마다 마지막만) */
function AccountAndConsents({ detail }: { readonly detail: components['schemas']['StaffRiderDetail'] }) {
  const consents = detail.consents ?? [];
  const registered = detail.bankAccountRegistered;
  return (
    <div className="space-y-4">
      <FieldList
        testId="rider-bank"
        rows={[
          [
            rm.bank.registered,
            registered === undefined ? none : <StatusBadge tone={registered ? 'success' : 'warning'}>{registered ? rm.bank.yes : rm.bank.no}</StatusBadge>,
          ],
          [rm.bank.bankName, detail.bankName ?? none],
        ]}
      />
      <p className="text-xs text-base-content/50">{rm.bank.numberNote}</p>
      <div className="space-y-2">
        <p className="text-sm font-semibold">{rm.consents.title}</p>
        <p className="text-xs text-base-content/50">{rm.consents.note}</p>
        {detail.consents === undefined ? (
          <p className="text-sm text-base-content/50">{none}</p>
        ) : consents.length === 0 ? (
          <p className="text-sm text-base-content/50">{rm.consents.empty}</p>
        ) : (
          <DataTable testId="rider-consents">
            <thead>
              <tr>
                <th>{rm.consents.col.type}</th>
                <th>{rm.consents.col.version}</th>
                <th>{rm.consents.col.agreedAt}</th>
              </tr>
            </thead>
            <tbody>
              {consents.map((c) => (
                <tr key={c.consentType}>
                  <td className="font-mono">{c.consentType}</td>
                  <td className="font-mono">{c.version}</td>
                  <td className="whitespace-nowrap">{when(c.agreedAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>
    </div>
  );
}

/** 배정 이력 — dispatch `GET /rider-assignments`(배정 최신순, cursor). 결과(outcome)·취소 기록은 서버 값 그대로 */
function AssignmentHistory({ riderId, live = false }: { readonly riderId: string; readonly live?: boolean }) {
  const api = useApi();
  const [cursor, setCursor] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const a = rm.assignments;
  const query = useQuery({
    queryKey: ['rider-assignments', riderId, cursor],
    // 라이더가 운행 중일 때 첫 쪽(최신 배정)만 15초마다 — 넘긴 쪽은 그대로
    refetchInterval: live && !cursor ? LIVE.rider : false,
    queryFn: () =>
      request('GET', api.dispatch.GET('/rider-assignments', { params: { query: { riderId, size: PAGE_SIZE, ...(cursor ? { cursor } : {}) } } })),
  });
  const assignNos = useDeliveryNumbers((query.data?.items ?? []).map((it) => it.deliveryId));
  return (
    <QueryState state={toUiState(query, (x) => (x.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={a.empty}>
      {(x) => {
        const items = x.items ?? [];
        const nextCursor = x.page?.nextCursor ?? null;
        return (
          <div className="space-y-3">
            <ResultBar count={items.length} more={!!nextCursor} />
            <DataTable testId="rider-assignments">
              <thead>
                <tr>
                  <th>{a.col.assignedAt}</th>
                  <th>{a.col.delivery}</th>
                  <th>{a.col.order}</th>
                  <th>{a.col.kind}</th>
                  <th>{a.col.source}</th>
                  <th>{a.col.fee}</th>
                  <th>{a.col.deliveryState}</th>
                  <th>{a.col.outcome}</th>
                  <th>{a.col.cancellation}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.offerId ?? `${it.deliveryId}-${i}`} data-testid="assignment-row">
                    <td className="whitespace-nowrap">{when(it.assignedAt)}</td>
                    <td className="font-semibold">
                      <DeliveryRef deliveryId={it.deliveryId} numbers={assignNos.get(it.deliveryId)} />
                    </td>
                    <td className="font-mono">{assignNos.get(it.deliveryId)?.orderNumber ?? none}</td>
                    <td>{[it.type ? label(n.deliveryType, it.type) : null, it.purpose && it.purpose !== 'DELIVERY' ? label(n.purpose, it.purpose) : null].filter(Boolean).join(' · ') || none}</td>
                    <td>{label(a.source, it.source)}</td>
                    <td className="tabular-nums">{won(it.fee)}</td>
                    <td>{label(n.dispatchState, it.deliveryState)}</td>
                    <td>
                      <StatusBadge tone={outcomeTone(it.outcome)}>{label(a.outcome, it.outcome)}</StatusBadge>
                    </td>
                    <td className="text-xs">
                      {it.cancellation ? (
                        <span className="flex flex-col">
                          <span>{`${label(a.requestedBy, it.cancellation.requestedBy)} · ${label(a.cancelReason, it.cancellation.reason)}`}</span>
                          {it.cancellation.reasonDetail && <span className="text-base-content/60">{it.cancellation.reasonDetail}</span>}
                          <span className="text-base-content/50">{when(it.cancellation.at)}</span>
                        </span>
                      ) : (
                        none
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <CursorPager
              hasPrev={!!cursor}
              nextCursor={nextCursor}
              page={pageNo}
              onFirst={() => {
                setCursor('');
                setPageNo(1);
              }}
              onNext={(c) => {
                setCursor(c);
                setPageNo((p) => p + 1);
              }}
            />
          </div>
        );
      }}
    </QueryState>
  );
}

function RevealForm({ riderId }: { readonly riderId: string }) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const reveal = useCommand(async (body: { reason: string }, key) =>
    request('POST', api.riders.POST('/riders/{riderId}/pii-reveals', { ...commandParams(key, { path: { riderId } }), body })),
  );
  return (
    <form
      className="space-y-2 rounded-box border border-base-300 bg-base-200/40 p-4 text-sm"
      aria-label={r.reveal}
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 2) void reveal.run({ reason: reason.trim() });
      }}
    >
      <h3 className="font-semibold">{r.reveal}</h3>
      <p className="text-xs text-base-content/60">{r.revealIntro}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-60 flex-1 flex-col gap-1">
          {r.revealReason}
          <input className="input input-sm w-full" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-sm border-base-300 bg-base-100" disabled={reason.trim().length < 2 || reveal.busy}>
          {r.revealDo}
        </button>
      </div>
      <CommandFeedback command={reveal}>
        {(x) => (
          <p role="status" className="text-success" data-testid="pii-revealed">
            {r.revealed(x.name ?? none, x.phone ?? none)}
          </p>
        )}
      </CommandFeedback>
    </form>
  );
}

function RestrictionPanel({ riderId }: { readonly riderId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ['rider-restrictions', riderId],
    queryFn: () => request('GET', api.riders.GET('/riders/{riderId}/restrictions', { params: { path: { riderId } } })),
  });
  const [to, setTo] = useState<Restriction | ''>('');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const change = useCommand(async (body: components['schemas']['RiderRestrictionChange'], key) => {
    try {
      return await request(
        'POST',
        api.riders.POST('/riders/{riderId}/restrictions', {
          ...commandParams(key, { path: { riderId }, ...(history.data?.version !== undefined ? { version: history.data.version } : {}) }),
          body,
        }),
      );
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['rider-restrictions', riderId] });
      void queryClient.invalidateQueries({ queryKey: ['rider', riderId] });
    }
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-3 text-sm"
        aria-label={r.restrict}
        onSubmit={(e) => {
          e.preventDefault();
          if (!to || !reason.trim()) return;
          void change.run({
            restriction: to,
            reason: reason.trim(),
            ...(until && to !== 'NORMAL' ? { until: new Date(`${until}T23:59:59+09:00`).toISOString() } : {}),
          });
        }}
      >
        <h3 className="font-semibold">{r.restrict}</h3>
        <p className="text-xs text-base-content/60">{r.restrictIntro}</p>
        <label className="block">
          {r.restrictTo}
          <select className="select select-sm mt-1 block" value={to} onChange={(e) => setTo(e.target.value as Restriction | '')}>
            <option value="">—</option>
            {RESTRICTIONS.map((x) => (
              <option key={x} value={x}>
                {label(n.restriction, x)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          {r.reason}
          <input className="input input-sm mt-1 w-full" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {to && to !== 'NORMAL' && (
          <label className="block">
            {r.until}
            <input type="date" className="input input-sm mt-1" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        <button type="submit" className="btn btn-sm btn-warning" disabled={!to || !reason.trim() || change.busy}>
          {r.restrictDo}
        </button>
        <CommandFeedback command={change}>
          {() => (
            <p role="status" className="text-success">
              {r.restrictDone}
            </p>
          )}
        </CommandFeedback>
      </form>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{r.restrictionHistory}</h3>
        <QueryState state={toUiState(history, (h) => (h.items ?? []).length === 0)} onRetry={() => void history.refetch()} emptyText={none}>
          {(h) => (
            <ol className="relative space-y-3 border-l-2 border-base-300 pl-4 text-sm" data-testid="restriction-history">
              {(h.items ?? []).map((it, i) => (
                <li key={`${it.changedAt ?? ''}-${i}`} className="relative">
                  <span className="absolute -left-[1.4rem] top-1 size-2.5 rounded-full bg-accent" aria-hidden />
                  <span className="font-medium">{`${label(n.restriction, it.previous)} → ${label(n.restriction, it.restriction)}`}</span>
                  <span className="ml-2 text-base-content/55">{`${when(it.changedAt)} · ${it.reason ?? ''}`}</span>
                </li>
              ))}
            </ol>
          )}
        </QueryState>
      </div>
    </div>
  );
}

// 제한 검토 — 상태 탭(검토 중·제한함·제한 안 함, URL ?state=). 기본 백오피스에서 옮김(2026-11-18, ADR-0068).
export function RestrictionReviewsMenu() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('state');
  const state: ReviewState = REVIEW_STATES.find((s) => s === raw) ?? 'OPEN';
  const v = ops.reviews;
  // 검토 중 개수(2026-11-19 통합 백오피스 칩 옆 개수처럼) — 아래 표와 같은 조회(같은 키)라 한 번만 부른다. 못 읽으면 "?"(0 이 아님)
  const api = useApi();
  const openList = useQuery({
    queryKey: ['restriction-reviews', 'OPEN', ''],
    queryFn: () => request('GET', api.riders.GET('/riders/restriction-reviews', { params: { query: { state: 'OPEN' } } })),
  });
  const openCount = openList.data ? String((openList.data.items ?? []).length) : openList.isError ? '?' : undefined;
  return (
    <section className="space-y-4">
      <PageHeader title={v.title} />
      <GuideBox title={ui.guideTitle} items={splitGuide(v.intro)} storeKey="restriction-reviews" testId="reviews-guide" />
      <ChipGroup
        label={v.title}
        value={state}
        options={REVIEW_STATES.map((s) => ({ value: s, label: rm.reviews.state[s], ...(s === 'OPEN' ? { count: openCount } : {}) }))}
        onChange={(s) => setParams(s === 'OPEN' ? {} : { state: s })}
      />
      <ReviewTable state={state} />
    </section>
  );
}

/** 검토 표 — 제한 검토 메뉴와 라이더 상세(riderId, 열린 것만)가 함께 쓴다. */
function ReviewTable({ state, riderId }: { readonly state: ReviewState; readonly riderId?: string }) {
  const api = useApi();
  const query = useQuery({
    queryKey: ['restriction-reviews', state, riderId ?? ''],
    queryFn: () => request('GET', api.riders.GET('/riders/restriction-reviews', { params: { query: { state, ...(riderId ? { riderId } : {}) } } })),
  });
  const v = ops.reviews;
  const reviewRiders = useRiderSummaries(riderId ? [] : (query.data?.items ?? []).map((it) => it.riderId));
  const complaintNos = useDeliveryNumbers((query.data?.items ?? []).flatMap((it) => (it.complaints ?? []).map((c) => c.deliveryId)));
  const me = useSession().session?.subject;
  return (
    <>
    {/* 할 일이 서버 0건이면 "수고하셨어요"(2026-11-19 통합 백오피스 AllDone) — 읽는 중·실패·거르기를 건 때는 그리지 않는다 */}
    {!riderId && state === 'OPEN' && query.isSuccess && (query.data.items ?? []).length === 0 ? (
      <AllDone title={ui.allDone} body={v.empty} testId="reviews-all-done" />
    ) : (
      <QueryState state={toUiState(query, (x) => (x.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={riderId ? rm.detailReviews.empty : v.empty}>
        {(x) => {
          const items = x.items ?? [];
          return (
            <div className="space-y-3">
              {!riderId && <ResultBar count={items.length} />}
              <DataTable {...(riderId ? { testId: 'rider-reviews' } : {})}>
                <thead>
                  <tr>
                    {!riderId && <th>{v.col.rider}</th>}
                    <th>{v.col.kind}</th>
                    <th>{rm.reviews.complaints}</th>
                    <th>{v.col.openedAt}</th>
                    <th>{state === 'OPEN' ? v.decide : rm.reviews.closedCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    // 결정 뒤에도 같은 줄로 남게 reviewId 를 키로
                    <tr key={it.reviewId ?? `review-${i}`} data-testid="review-row">
                      {!riderId && (
                        <td>
                          <RiderRef riderId={it.riderId} summary={reviewRiders.get(it.riderId ?? '')} />
                        </td>
                      )}
                      <td>
                        <StatusBadge tone="warning">{label(n.complaintType, it.complaintType)}</StatusBadge>
                      </td>
                      <td className="text-xs">
                        <span className="font-semibold tabular-nums">{rm.reviewsCount((it.complaints ?? []).length)}</span>
                        <ul className="mt-1 space-y-0.5 text-base-content/60">
                          {(it.complaints ?? []).map((c, k) => (
                            <li key={c.complaintId ?? `c-${k}`}>
                              <span className="inline-flex flex-wrap items-center gap-1">
                                {c.deliveryId ? <DeliveryRef deliveryId={c.deliveryId} numbers={complaintNos.get(c.deliveryId)} /> : null}
                                {c.recordedAt ? <span>· {when(c.recordedAt)}</span> : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="whitespace-nowrap">{when(it.openedAt)}</td>
                      <td className="min-w-72">
                        {it.state === 'OPEN' ? (
                          <ReviewDecision review={it} />
                        ) : (
                          <span className="flex flex-col gap-1 text-sm">
                            <StatusBadge tone={reviewTone(it.state)}>{label(rm.reviews.state, it.state)}</StatusBadge>
                            <span className="text-xs text-base-content/60">
                              {when(it.decidedAt)} · <StaffName operatorId={it.decidedBy} me={me} />
                              {it.note ? ` — ${it.note}` : ''}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          );
        }}
      </QueryState>
    )}
    </>
  );
}

function ReviewDecision({ review }: { readonly review: Review }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const reviewId = review.reviewId ?? '';
  const [note, setNote] = useState('');
  const v = ops.reviews;
  const decide = useCommand(async (body: { decision: 'RESTRICTED' | 'DISMISSED'; note?: string }, key) => {
    try {
      const closed = await request('POST', api.riders.POST('/riders/restriction-reviews/{reviewId}/decisions', { ...commandParams(key, { path: { reviewId } }), body }));
      // 닫힌 검토를 그 줄에 그대로 둔다(다시 읽으면 열린 목록에서 사라져 결과를 못 본다). 다른 상태 목록은 다음에 열 때 새로 읽는다.
      queryClient.setQueriesData<{ items?: Review[] }>({ queryKey: ['restriction-reviews'] }, (old) =>
        old ? { ...old, items: (old.items ?? []).map((x) => (x.reviewId === closed.reviewId ? { ...x, ...closed } : x)) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['restriction-reviews'], refetchType: 'none' });
      return closed;
    } catch (e) {
      void queryClient.invalidateQueries({ queryKey: ['restriction-reviews'] });
      throw e;
    }
  });
  const locked = decide.busy || decide.phase.kind === 'done';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-base-content/60">{v.note}</span>
          <input className="input input-sm w-48" maxLength={300} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />
        </label>
        {(['RESTRICTED', 'DISMISSED'] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={`btn btn-sm ${d === 'RESTRICTED' ? 'btn-warning' : 'border-base-300 bg-base-100'}`}
            disabled={locked}
            onClick={() => void decide.run({ decision: d, ...(note.trim() ? { note: note.trim() } : {}) })}
          >
            {d === 'RESTRICTED' ? v.restricted : v.dismissed}
          </button>
        ))}
        {review.riderId && (
          <Link className="btn btn-ghost btn-xs" to={`/riders/${encodeURIComponent(review.riderId)}#sec-restriction`}>
            {rm.reviews.goRestrict}
          </Link>
        )}
      </div>
      {/* 성공하면 이 줄이 닫힌 기록으로 바뀐다(setQueriesData) — 여기는 실패·결과 모름만 보인다 */}
      <CommandFeedback command={decide}>
        {(x) => (
          <p role="status" className="text-sm text-success">
            {rm.reviews.resultNow(label(rm.reviews.state, x.state))}
          </p>
        )}
      </CommandFeedback>
    </div>
  );
}

/** 이 라이더 컴플레인 기록 — case `GET /rider-complaints?riderId=`(최근 기록 순, cursor). 상세 글(note)은 목록에 오지 않는다. */
function ComplaintHistory({ riderId }: { readonly riderId: string }) {
  const api = useApi();
  const c = rm.complaints;
  const query = useInfiniteQuery({
    queryKey: ['rider-complaints', riderId],
    queryFn: ({ pageParam }) =>
      request('GET', api.cases.GET('/rider-complaints', { params: { query: { riderId, size: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page?.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const complaintNos = useDeliveryNumbers(items.map((it) => it.deliveryId));
  const me = useSession().session?.subject;
  if (query.isPending) return <QueryState state={{ kind: 'loading' }}>{() => null}</QueryState>;
  if (query.isError && items.length === 0) {
    return (
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {() => null}
      </QueryState>
    );
  }
  if (items.length === 0) return <p className="text-sm text-base-content/60">{c.empty}</p>;
  return (
    <div className="space-y-3">
      <ResultBar count={items.length} more={query.hasNextPage} />
      <DataTable testId="rider-complaints">
        <thead>
          <tr>
            <th>{c.col.type}</th>
            <th>{c.col.delivery}</th>
            <th>{c.col.order}</th>
            <th>{c.col.recordedAt}</th>
            <th>{c.col.recordedBy}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.complaintId} data-testid="complaint-row">
              <td>
                <StatusBadge tone="warning">{label(n.complaintType, it.complaintType)}</StatusBadge>
              </td>
              <td>
                <DeliveryRef deliveryId={it.deliveryId} numbers={complaintNos.get(it.deliveryId)} />
              </td>
              <td className="font-mono text-xs">{complaintNos.get(it.deliveryId)?.orderNumber ?? none}</td>
              <td className="whitespace-nowrap">{when(it.recordedAt)}</td>
              <td>
                <StaffName operatorId={it.recordedBy} me={me} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {query.isError && (
        <Notice tone="warning">{c.moreFailed}</Notice>
      )}
      {query.hasNextPage && (
        <div className="flex justify-center">
          <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {c.more}
          </button>
        </div>
      )}
    </div>
  );
}

