// 접수 건 — 라이더 운영(RIDER_OPS)·운영 관리자. case-service `GET /cases`·`GET /cases/{caseId}`(case 0.22.0).
// 보이는 범위는 서버가 정한다(RIDER_OPS = 배송 쪽 사건만 — RIDER_HELP·DELIVERY_INCIDENT·RIDER_LOCATION_STALE·MISDELIVERY·DISPATCH_FAILED).
// 1차(2026-11-17, PC 5): 보기만 — 맡기·이관·처리 끝내기는 다음 차례. 필터·쪽은 주소 쿼리에 둔다.
// 2026-11-18: 배민 주문접수 목록·상세 모양 — 처리 중/끝남 밑줄 탭 → 검색 조건 상자 → 결과 줄 → 표(줄 누르면 상세) / 상세 머리 → 구역 상자.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, failureCode, formatSeoul, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/case';
import { useApi } from '../../app/ApiContext';
import { messages } from '../../shared/messages';
import { DeliveryRef, RiderRef, StaffName, SystemIds, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { useSession } from '../../app/SessionContext';
import { AllDone, ChipGroup, GuideBox, CursorPager, DataTable, DetailHeader, FieldList, Notice, PageHeader, ResultBar, SearchPanel, SearchRow, Section, StatCard, StatStrip, StatusBadge } from '../../shared/admin';
import { ui } from '../../shared/uiMessages';
import { listCountText, useListRows } from '../../shared/listKit';
import { SavedViews } from '../../shared/SavedViews';
import { useNow } from '../../shared/useNow';
import { caseTone, StateTabs } from '../support/supportUi';

const m = messages.cases;
const n = messages.names;
const none = messages.none;
const name = (map: Readonly<Record<string, string>>, v: string | null | undefined) => (v ? (map[v] ?? v) : none);
const when = (iso: string | null | undefined) => (iso ? formatSeoul(iso) : none);

type CaseKind = components['schemas']['CaseKind'];
type CaseSummary = components['schemas']['CaseSummary'];

/** 라이더 운영이 다루는 배송 쪽 종류(서버 보이는 범위와 같다) */
export const DELIVERY_KINDS: readonly CaseKind[] = ['RIDER_HELP', 'DISPATCH_FAILED', 'RIDER_LOCATION_STALE', 'MISDELIVERY', 'DELIVERY_INCIDENT'];
const PAGE_SIZE = 50;

export function CasesMenu() {
  return (
    <Routes>
      <Route index element={<CaseListPage />} />
      <Route path=":caseId" element={<CaseDetailPage />} />
    </Routes>
  );
}

/** 기한 15분 안 — 남은 분(서버 기한 slaDueAt 과 지금 시각의 차, 넘김 판정은 서버 overdue). 2026-11-19 통합 백오피스처럼 숨쉬기 */
const SOON_MIN = 15;
function Sla({ slaDueAt, overdue, now }: { readonly slaDueAt: string | null | undefined; readonly overdue: boolean | null | undefined; readonly now?: number | null }) {
  if (!slaDueAt) return <>{none}</>;
  const left = !overdue && now != null ? Math.ceil((new Date(slaDueAt).getTime() - now) / 60_000) : null;
  const soon = left !== null && left > 0 && left <= SOON_MIN;
  return (
    <span className={`whitespace-nowrap ${overdue ? 'font-semibold text-error' : ''}`} data-overdue={overdue ? 'true' : 'false'}>
      {when(slaDueAt)}
      {overdue && ` · ${m.overdue}`}
      {soon && (
        <span className="breathe ml-1 font-semibold text-warning" data-testid="sla-soon">
          · {cx.minutesLeft(left)}
        </span>
      )}
    </span>
  );
}

/** 이 화면에서 더한 문구(2026-11-19 통합 백오피스와 맞추기) */
const cx = {
  stripLabel: '처리 중 접수 건 수',
  unassigned: '아무도 안 맡음',
  overdue: '기한 넘김',
  listHint: '불러온 것 기준',
  minutesLeft: (n: number) => `${n}분 남음`,
} as const;

/** 관련 대상 — 배송·라이더는 화면 번호(ADR-0070), 주문은 시스템 ID 라 목록에 내지 않는다(배송 번호 안에 주문번호가 있다) */
function Refs({ refs }: { readonly refs: CaseSummary['refs'] }) {
  const deliveryIds = (refs ?? []).filter((r) => r.refType === 'deliveryId' && r.refId).map((r) => r.refId!);
  const riderIds = (refs ?? []).filter((r) => r.refType === 'riderId' && r.refId).map((r) => r.refId!);
  const nos = useDeliveryNumbers(deliveryIds);
  const riders = useRiderSummaries(riderIds);
  if (deliveryIds.length === 0 && riderIds.length === 0) return <>{none}</>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      {deliveryIds.map((id) => (
        <span key={`d-${id}`} className="inline-flex items-center gap-1">
          <span className="text-base-content/50">{name(n.refType, 'deliveryId')}</span>
          <DeliveryRef deliveryId={id} numbers={nos.get(id)} />
        </span>
      ))}
      {riderIds.map((id) => (
        <span key={`r-${id}`} className="inline-flex items-center gap-1">
          <span className="text-base-content/50">{name(n.refType, 'riderId')}</span>
          <RiderRef riderId={id} summary={riders.get(id)} />
        </span>
      ))}
    </span>
  );
}

function PriorityBadge({ priority }: { readonly priority: string | null | undefined }) {
  return <StatusBadge tone={priority === 'P1' ? 'error' : priority === 'P2' ? 'warning' : 'ghost'}>{priority ?? none}</StatusBadge>;
}

function CaseListPage() {
  const api = useApi();
  const me = useSession().session?.subject;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const closed = params.get('state') === 'CLOSED';
  const rawKind = params.get('kind') ?? '';
  const kind = (DELIVERY_KINDS as readonly string[]).includes(rawKind) ? (rawKind as CaseKind) : undefined;
  const overdue = params.get('overdue') === 'true';
  const unassigned = params.get('unassigned') === 'true';
  const cursor = params.get('cursor') ?? '';
  const set = (next: Partial<{ state: string; kind: string; overdue: boolean; unassigned: boolean; cursor: string }>) => {
    const v = { state: closed ? 'CLOSED' : '', kind: kind ?? '', overdue, unassigned, cursor: '', ...next };
    setParams({
      ...(v.state ? { state: v.state } : {}),
      ...(v.kind ? { kind: v.kind } : {}),
      ...(v.overdue ? { overdue: 'true' } : {}),
      ...(v.unassigned ? { unassigned: 'true' } : {}),
      ...(v.cursor ? { cursor: v.cursor } : {}),
    });
  };
  const query = useQuery({
    queryKey: ['cases', closed, kind, overdue, unassigned, cursor],
    queryFn: () =>
      request(
        'GET',
        api.cases.GET('/cases', {
          params: {
            query: {
              size: PAGE_SIZE,
              ...(closed ? { state: 'CLOSED' as const } : {}),
              ...(kind ? { kind } : {}),
              ...(overdue ? { overdue: true } : {}),
              ...(unassigned ? { unassigned: true } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        }),
      ),
  });
  // 거르기는 고르는 즉시 주소에 반영된다 — [조회]는 지금 조건으로 다시 불러오기, [초기화]는 거르기 비우기(탭은 그대로)
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void query.refetch();
  };
  const reset = () => set({ kind: '', overdue: false, unassigned: false });
  const open = (caseId: string | undefined) => void navigate(`/cases/${encodeURIComponent(caseId ?? '')}`);
  const casePath = (caseId: string | undefined) => `/cases/${encodeURIComponent(caseId ?? '')}`;
  // 숫자 띠(2026-11-19) — 처리 중인 건 중 안 맡은 것·기한 넘긴 것. 서버 목록 한 쪽(50건)으로 세고, 다음 쪽이 있으면 "N건 이상"
  const countQuery = (flag: 'unassigned' | 'overdue') => ({
    queryKey: ['cases-count', flag],
    refetchInterval: 30_000,
    queryFn: async () => {
      const r = await request('GET', api.cases.GET('/cases', { params: { query: { size: PAGE_SIZE, [flag]: true } } }));
      return { n: (r.items ?? []).length, more: !!r.page?.nextCursor };
    },
  });
  const unassignedCount = useQuery(countQuery('unassigned'));
  const overdueCount = useQuery(countQuery('overdue'));
  const listRows = useListRows(query.data?.items?.map((c) => casePath(c.caseId)), [closed, kind, overdue, unassigned, cursor].join('|'));
  const now = useNow();

  return (
    <section className="space-y-4">
      <PageHeader title={m.title} actions={<SavedViews listKey="cases" />} />
      <GuideBox title={ui.guideTitle} items={[m.intro]} storeKey="cases" testId="cases-guide" />
      <StatStrip label={cx.stripLabel} testId="case-strip">
        <StatCard layout="row" label={cx.unassigned} value={listCountText(unassignedCount.data, unassignedCount.isError)} hint={cx.listHint} to="/cases?unassigned=true" active={!closed && unassigned && !overdue} tone={(unassignedCount.data?.n ?? 0) > 0 ? 'warning' : undefined} testId="strip-unassigned" />
        <StatCard layout="row" label={cx.overdue} value={listCountText(overdueCount.data, overdueCount.isError)} hint={cx.listHint} to="/cases?overdue=true" active={!closed && overdue && !unassigned} tone={(overdueCount.data?.n ?? 0) > 0 ? 'error' : undefined} testId="strip-overdue" />
      </StatStrip>
      <StateTabs
        label="처리 상태"
        value={closed ? 'CLOSED' : 'OPEN'}
        options={[
          { value: 'OPEN', label: m.tabOpen },
          { value: 'CLOSED', label: m.tabClosed },
        ]}
        onChange={(v) => set({ state: v === 'CLOSED' ? 'CLOSED' : '' })}
      />
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        summary={[
          [m.kind, kind ? name(n.caseKind, kind) : ''],
          ['조건', [overdue ? m.overdueOnly : '', unassigned ? m.unassignedOnly : ''].filter(Boolean).join(' · ')],
        ]}
      >
        <SearchRow label={m.kind}>
          <ChipGroup label={m.kind} value={kind ?? ''} options={[{ value: '', label: m.allKinds }, ...DELIVERY_KINDS.map((k) => ({ value: k, label: name(n.caseKind, k) }))]} onChange={(v) => set({ kind: v })} />
        </SearchRow>
        {!closed && (
          <SearchRow label="조건">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={overdue} onChange={(e) => set({ overdue: e.target.checked })} />
              {m.overdueOnly}
            </label>
            <label className="ml-4 flex items-center gap-2 text-sm">
              <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={unassigned} onChange={(e) => set({ unassigned: e.target.checked })} />
              {m.unassignedOnly}
            </label>
          </SearchRow>
        )}
      </SearchPanel>
      {/* 할 일이 서버 0건이면 "수고하셨어요"(2026-11-19 통합 백오피스 AllDone) — 읽는 중·실패·거르기를 건 때는 그리지 않는다 */}
      {query.isSuccess && (query.data.items ?? []).length === 0 && !closed && !kind && !overdue && !unassigned && !cursor ? (
        <AllDone title={ui.allDone} body={m.emptyOpen} testId="cases-all-done" />
      ) : (
        <QueryState state={toUiState(query, (r) => (r.items ?? []).length === 0)} onRetry={() => void query.refetch()} emptyText={closed ? m.emptyClosed : m.emptyOpen}>
          {(r) => {
            const nextCursor = r.page?.nextCursor ?? null;
            const items = r.items ?? [];
            return (
              <div className="space-y-3">
                <ResultBar count={items.length} more={!!nextCursor} />
                <DataTable>
                  <thead>
                    <tr>
                      <th className="w-16">{m.col.priority}</th>
                      <th>{m.col.kind}</th>
                      <th>{m.col.summary}</th>
                      <th>{m.col.refs}</th>
                      <th>{m.col.sla}</th>
                      <th>{m.col.state}</th>
                      <th>{m.col.assignee}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c, i) => (
                      <tr key={c.caseId ?? `case-${i}`} data-testid="case-row" className={`cursor-pointer ${c.overdue ? 'bg-error/5' : ''} ${listRows.rowClass(casePath(c.caseId))}`} onClick={() => open(c.caseId)}>
                        <td>
                          <PriorityBadge priority={c.priority} />
                        </td>
                        <td className="whitespace-nowrap">{name(n.caseKind, c.kind)}</td>
                        <td className="font-medium">
                          <Link className="hover:underline" to={`/cases/${encodeURIComponent(c.caseId ?? '')}`} onClick={(e) => e.stopPropagation()}>
                            {c.summary || name(n.caseKind, c.kind)}
                          </Link>
                          {listRows.seenMark(casePath(c.caseId))}
                        </td>
                        <td>
                          <Refs refs={c.refs} />
                        </td>
                        <td>
                          <Sla slaDueAt={c.slaDueAt} overdue={c.overdue} now={c.state === 'CLOSED' ? null : now} />
                        </td>
                        <td>
                          <StatusBadge tone={caseTone(c.state)}>{name(n.caseState, c.state)}</StatusBadge>
                        </td>
                        <td>{c.assigneeId ? <StaffName operatorId={c.assigneeId} me={me} /> : <span className="text-base-content/45">{m.unassigned}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <CursorPager hasPrev={!!cursor} nextCursor={nextCursor} onFirst={() => set({})} onNext={(c) => set({ cursor: c })} />
              </div>
            );
          }}
        </QueryState>
      )}
    </section>
  );
}

// 상세(배민 주문내역 상세 참고): 머리(번호·긴급도·상태·요약) → 보기만 안내 → 구역 상자(접수 내용 / 이력).
function CaseDetailPage() {
  const api = useApi();
  const me = useSession().session?.subject;
  const { caseId = '' } = useParams();
  const query = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => request('GET', api.cases.GET('/cases/{caseId}', { params: { path: { caseId } } })),
  });
  const [closedNow, setClosedNow] = useState(false);
  const c = query.data;
  return (
    <section className="max-w-[1600px] space-y-4">
      <DetailHeader
        seen={!!c}
        back={{ to: '/cases', label: m.back }}
        title={c ? c.summary || name(n.caseKind, c.kind) : m.detailTitle('')}
        badges={
          c && (
            <>
              <PriorityBadge priority={c.priority} />
              <StatusBadge tone={caseTone(c.state)}>{name(n.caseState, c.state)}</StatusBadge>
              {c.overdue && <StatusBadge tone="error">{m.overdue}</StatusBadge>}
            </>
          )
        }
        summary={c && [name(n.caseKind, c.kind), c.summary, `${m.col.openedAt} ${when(c.openedAt)}`].filter(Boolean).join(' · ')}
      />
      <Notice>{m.viewOnlyNote}</Notice>
      {closedNow && (
        <p role="status" className="rounded-box bg-success/10 px-4 py-3 text-sm text-success" data-testid="case-closed-now">
          {closeText.done}
        </p>
      )}
      <QueryState state={toUiState(query)} onRetry={() => void query.refetch()}>
        {(x) => (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Section id="sec-case" title="접수 내용">
              <FieldList
                testId="case-detail"
                rows={[
                  [m.col.kind, name(n.caseKind, x.kind)],
                  [m.col.summary, x.summary || none],
                  [m.col.priority, x.priority ?? none],
                  [m.col.state, name(n.caseState, x.state)],
                  [m.col.refs, <Refs refs={x.refs} />],
                  [m.col.openedAt, when(x.openedAt)],
                  [m.col.sla, <Sla slaDueAt={x.slaDueAt} overdue={x.overdue} />],
                  [m.col.assignee, x.assigneeId ? <StaffName operatorId={x.assigneeId} me={me} /> : m.unassigned],
                  x.closure && [m.closure, `${name(n.resolution, x.closure.resolution)}${x.closure.summary ? ` — ${x.closure.summary}` : ''} (${when(x.closure.closedAt)})`],
                ]}
              />
              <SystemIds ids={[['접수 건', caseId], ...(x.refs ?? []).filter((r) => r.refId).map((r) => [name(n.refType, r.refType), r.refId] as const)]} />
            </Section>
            {x.state !== 'CLOSED' && (
              <Section id="sec-close" title={closeText.title}>
                <CaseClose caseId={caseId} version={(x as { version?: number }).version} onClosed={() => setClosedNow(true)} />
              </Section>
            )}
            <Section id="sec-history" title={m.history}>
              {(x.history ?? []).length === 0 ? (
                <p className="text-sm text-base-content/50">{none}</p>
              ) : (
                <ol className="relative space-y-3 border-l-2 border-base-300 pl-4 text-sm" data-testid="case-history">
                  {(x.history ?? []).map((h, i) => (
                    <li key={`${h.at ?? ''}-${i}`} className="relative">
                      <span className="absolute -left-[1.4rem] top-1 size-2.5 rounded-full bg-accent" aria-hidden />
                      <span className="font-medium">{`${name(n.caseAction, h.action)}${h.toState ? ` → ${name(n.caseState, h.toState)}` : ''}`}</span>
                      <span className="ml-2 text-base-content/55">{when(h.at)}</span>
                      {h.note && <p className="mt-0.5 text-base-content/70">{h.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        )}
      </QueryState>
    </section>
  );
}

const closeText = {
  title: '처리 끝내기',
  intro: '상담·처리를 마쳤으면 결과와 처리 내용을 남기고 닫아요. 이 접수 건에 붙은 도움요청도 함께 "처리 끝"이 돼요.',
  resolution: '결과',
  summary: '처리 내용(라이더 개인정보는 적지 않아요, 1~2000자)',
  submit: '처리 끝내기',
  done: '처리를 끝냈어요.',
  openObligations: '아직 끝나지 않은 후속 처리(의무)가 있어서 닫을 수 없어요. 그것부터 끝내 주세요.',
  forbidden: '닫을 권한이 없어요 — 다른 직원이 맡은 건은 관리자만 닫을 수 있어요.',
  unknown: '닫혔는지 확인하지 못했어요. 같은 내용으로 다시 누르면 같은 요청으로 확인해요.',
} as const;

const RESOLUTIONS = ['RESOLVED', 'NOT_REPRODUCIBLE', 'DUPLICATE', 'NO_ACTION_REQUIRED', 'ESCALATED_EXTERNAL'] as const;

/**
 * 접수 건 처리 끝내기(case `POST /cases/{caseId}/closures` — 배송 쪽은 RIDER_OPS·OPERATOR_ADMIN).
 * 도움요청이 붙은 건은 도움요청 화면에서 닫지 못한다(409 HELP_REQUEST_HAS_CASE) — 여기서 닫으면 도움요청도 RESOLVED
 * (사용자 2026-11-19 "백오피스에 처리 완료 버튼이 없네").
 */
function CaseClose({ caseId, version, onClosed }: { readonly caseId: string; readonly version: number | undefined; readonly onClosed: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>('RESOLVED');
  const [summary, setSummary] = useState('');
  const close = useCommand(async (body: { resolution: (typeof RESOLUTIONS)[number]; summary: string }, key) => {
    try {
      const res = await request(
        'POST',
        api.cases.POST('/cases/{caseId}/closures', {
          ...commandParams(key, { path: { caseId }, ...(version !== undefined ? { version } : {}) }),
          body,
        }),
      );
      onClosed();
      return res;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      void queryClient.invalidateQueries({ queryKey: ['help-queue'] });
    }
  });
  const locked = close.busy || close.phase.kind === 'done';
  const ok = summary.trim().length >= 1;
  const code = close.phase.kind === 'rejected' ? failureCode(close.phase.failure) : undefined;
  return (
    <form
      className="space-y-3"
      aria-label={closeText.title}
      data-testid="case-close"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (ok) void close.run({ resolution, summary: summary.trim() });
      }}
    >
      <p className="text-sm text-base-content/70">{closeText.intro}</p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-base-content/60">{closeText.resolution}</span>
        <select className="select select-sm w-60" value={resolution} disabled={locked} onChange={(ev) => setResolution(ev.target.value as (typeof RESOLUTIONS)[number])}>
          {RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {name(n.resolution, r)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-base-content/60">{closeText.summary}</span>
        <textarea className="textarea textarea-sm w-full" rows={3} maxLength={2000} value={summary} disabled={locked} onChange={(ev) => setSummary(ev.target.value)} />
      </label>
      <div className="flex justify-end">
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || locked}>
          {closeText.submit}
        </button>
      </div>
      {code === 'OPEN_OBLIGATIONS' ? (
        <p role="alert" className="text-sm text-error">{closeText.openObligations}</p>
      ) : code === 'FORBIDDEN' ? (
        <p role="alert" className="text-sm text-error">{closeText.forbidden}</p>
      ) : (
        <CommandFeedback command={close} unknown={{ body: closeText.unknown }}>
          {() => <p className="text-sm text-success">{closeText.done}</p>}
        </CommandFeedback>
      )}
    </form>
  );
}
