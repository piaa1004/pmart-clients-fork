// 지원센터(2026-11-17, PC 5 — ADR-0068 로 옮겨 오는 화면): 도움요청 대화(execution), 라이더 문의 대화(case 0.21.0).
// 대화는 몇 초마다 새로 불러온다(도움요청 4초, 문의 5초 — 라이더 앱과 비슷하게). 메시지 내용은 화면에만, 로그 안 함.
// 2026-11-18: 배민 주문접수 모양 — 목록(쪽 머리 → 검색 조건/상태 탭 → 결과 줄 → 표, 줄 누르면 상세),
// 상세(머리: 번호·상태·요약 → 구역 이동 탭 → 왼쪽 요청 내용·사진·처리 / 오른쪽 대화).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { useSession } from '../../app/SessionContext';
import { photoMessages } from '../../shared/AuthedPhotos';
import { ChipGroup, CursorPager, DataTable, DetailHeader, FieldList, PageHeader, ResultBar, SearchPanel, SearchRow, Section, SectionTabs, StatusBadge } from '../../shared/admin';
import { DeliveryNo, DeliveryRef, resolveRiderId, RiderName, RiderRef, StaffName, SystemIds, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, none, when } from '../../shared/opsUi';
import { useNow, waited } from '../../shared/useNow';
import { EvidencePhotos, helpExtrasMessages, InquiryPhotos, MaskMessage, ResolvePanel } from './HelpExtras';
import { ChatBox, ChatBubble, helpTone, inquiryTone, StateTabs } from './supportUi';

const h = ops.help;
const q = ops.inquiries;
const n = messages.names;

/** 이 화면에서만 쓰는 문구(공통 문구 파일은 다른 PC 와 같이 고치므로 여기에 둔다) */
const sm = {
  helpCol: { stage: '배송 단계', photos: '사진', case: '접수 건' },
  helpSearch: { state: '상태', category: '종류', allCategories: '모든 종류', rider: '라이더', riderHint: '라이더 번호 6자리' },
  autoRefresh: (s: number) => `${s}초마다 새로 불러와요`,
  photoCount: (k: number) => (k > 0 ? `${k}장` : none),
  hasCase: '접수 건 있음',
  help: {
    request: '요청 내용',
    photos: '사진',
    chat: '대화',
    resolve: '처리',
    riderSaid: '라이더가 쓴 내용',
    lastRider: '라이더 마지막 말',
    lastSupport: '지원센터 마지막 말',
    resolvedAt: '닫은 때',
    resolvedBy: '닫은 직원',
    resolutionNote: '처리 메모',
    goDelivery: '배송 상세',
  },
  inquiry: {
    content: '문의 내용',
    photos: '사진',
    chat: '대화',
    close: '닫기',
    rider: '라이더',
    answeredAt: '답한 때',
    closedAt: '닫힌 때',
    closedBy: '닫은 쪽',
    closeReason: '닫은 사유',
    closedByName: { CUSTOMER: '고객', RIDER: '라이더', STAFF: '지원센터' } as Readonly<Record<string, string>>,
    alreadyClosed: '닫힌 문의예요. 더 답할 수 없어요.',
  },
} as const;

/** 도움요청 종류 — 계약(execution HelpCategory) 값 이름. 공통 이름표에 없는 값은 여기서 채운다 */
const HELP_CATEGORIES = ['CUSTOMER_UNREACHABLE', 'ADDRESS_ISSUE', 'GOODS_ISSUE', 'PHOTO_UPLOAD_FAILED', 'ACCIDENT', 'APP_ERROR', 'STORE_WAITING', 'STATUS_CORRECTION', 'DELIVERY_FAILURE', 'OTHER'] as const satisfies readonly components['schemas']['HelpCategory'][];
const helpCategoryName: Readonly<Record<string, string>> = n.helpCategory;
const HELP_STATES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
type HelpState = (typeof HELP_STATES)[number];
const HELP_PAGE_SIZE = 50;

// ---------------- 도움요청

export function HelpRequestsMenu() {
  return (
    <Routes>
      <Route index element={<HelpQueuePage />} />
      <Route path=":deliveryId/:requestId" element={<HelpChatPage />} />
    </Routes>
  );
}

const helpPath = (deliveryId: string | undefined, requestId: string | undefined) => `/help-requests/${encodeURIComponent(deliveryId ?? '')}/${encodeURIComponent(requestId ?? '')}`;

function HelpQueuePage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawState = params.get('state') ?? '';
  // 계약 기본값은 OPEN — 주소에 없으면 OPEN
  const state: HelpState = (HELP_STATES as readonly string[]).includes(rawState) ? (rawState as HelpState) : 'OPEN';
  const rawCategory = params.get('category') ?? '';
  const category = (HELP_CATEGORIES as readonly string[]).includes(rawCategory) ? (rawCategory as (typeof HELP_CATEGORIES)[number]) : undefined;
  const riderId = params.get('riderId') ?? '';
  const cursor = params.get('cursor') ?? '';
  const [draftRider, setDraftRider] = useState(riderId);
  const set = (next: Partial<{ state: string; category: string; riderId: string; cursor: string }>) => {
    const v = { state: state === 'OPEN' ? '' : state, category: category ?? '', riderId, cursor: '', ...next };
    setParams({
      ...(v.state && v.state !== 'OPEN' ? { state: v.state } : {}),
      ...(v.category ? { category: v.category } : {}),
      ...(v.riderId ? { riderId: v.riderId } : {}),
      ...(v.cursor ? { cursor: v.cursor } : {}),
    });
  };
  const queue = useQuery({
    queryKey: ['help-queue', state, category, riderId, cursor],
    refetchInterval: 15_000,
    queryFn: async () => {
      // 라이더 번호 6자리로도 찾는다(ADR-0070) — 맞는 라이더가 없으면 빈 목록
      const rid = riderId ? await resolveRiderId(api, riderId) : '';
      if (rid === null) return { items: [], page: { nextCursor: null } };
      return request(
        'GET',
        api.execution.GET('/delivery-help-requests', {
          params: { query: { size: HELP_PAGE_SIZE, state, ...(category ? { category } : {}), ...(rid ? { riderId: rid } : {}), ...(cursor ? { cursor } : {}) } },
        }),
      );
    },
  });
  // 라이더는 화면 번호로(ADR-0070), 기다린 시간은 30초마다(급한 건이 먼저 눈에 띄게 — 2026-11-19)
  const riders = useRiderSummaries((queue.data?.items ?? []).map((it) => it.riderId));
  const deliveryNos = useDeliveryNumbers((queue.data?.items ?? []).map((it) => it.deliveryId));
  const now = useNow();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ riderId: draftRider.trim() });
  };
  const reset = () => {
    setDraftRider('');
    setParams({});
  };
  return (
    <section className="space-y-4">
      <PageHeader title={h.title} description={h.intro} />
      <SearchPanel onSubmit={submit} onReset={reset}>
        <SearchRow label={sm.helpSearch.state}>
          <ChipGroup label={sm.helpSearch.state} value={state} options={HELP_STATES.map((s) => ({ value: s, label: label(n.helpState, s) }))} onChange={(v) => set({ state: v })} />
        </SearchRow>
        <SearchRow label={sm.helpSearch.category}>
          <ChipGroup
            label={sm.helpSearch.category}
            value={category ?? ''}
            options={[{ value: '', label: sm.helpSearch.allCategories }, ...HELP_CATEGORIES.map((c) => ({ value: c, label: label(helpCategoryName, c) }))]}
            onChange={(v) => set({ category: v })}
          />
        </SearchRow>
        <SearchRow label={sm.helpSearch.rider}>
          <input className="input input-sm w-48" aria-label={sm.helpSearch.rider} value={draftRider} maxLength={64} placeholder={sm.helpSearch.riderHint} onChange={(e) => setDraftRider(e.target.value)} />
        </SearchRow>
      </SearchPanel>
      <QueryState state={toUiState(queue, (x) => (x.items ?? []).length === 0)} onRetry={() => void queue.refetch()} emptyText={h.empty}>
        {(x) => {
          const items = x.items ?? [];
          const nextCursor = x.page?.nextCursor ?? null;
          return (
            <div className="space-y-3">
              <ResultBar count={items.length} more={!!nextCursor} extra={<span className="text-xs text-base-content/50">{`오래된 것부터 · ${sm.autoRefresh(15)}`}</span>} />
              <DataTable>
                <thead>
                  <tr>
                    <th>{h.col.category}</th>
                    <th>{h.col.state}</th>
                    <th>{h.col.delivery}</th>
                    <th>{sm.helpCol.stage}</th>
                    <th>{h.col.rider}</th>
                    <th>{sm.helpCol.photos}</th>
                    <th>{h.col.createdAt}</th>
                    <th>{waitCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={`${it.deliveryId}:${it.requestId}`} data-testid="help-row" className="cursor-pointer" onClick={() => void navigate(helpPath(it.deliveryId, it.requestId))}>
                      {/* 요청 ID(시스템 ID)는 목록에 내지 않는다(ADR-0070) — 종류를 누르면 대화, ID 는 대화 화면의 접힌 "시스템 번호" */}
                      <td className="whitespace-nowrap font-semibold">
                        <Link className="hover:underline" to={helpPath(it.deliveryId, it.requestId)} onClick={(e) => e.stopPropagation()}>
                          {label(helpCategoryName, it.category)}
                        </Link>
                      </td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1">
                          <StatusBadge tone={helpTone(it.state)}>{label(n.helpState, it.state)}</StatusBadge>
                          {it.caseId && <StatusBadge tone="accent">{sm.hasCase}</StatusBadge>}
                        </span>
                      </td>
                      <td>
                        <DeliveryRef deliveryId={it.deliveryId} numbers={deliveryNos.get(it.deliveryId ?? '')} />
                      </td>
                      <td className="whitespace-nowrap">{label(n.executionState, it.stage)}</td>
                      <td>{it.riderId ? <RiderName riderId={it.riderId} nameMasked={riders.get(it.riderId)?.nameMasked} riderNumber={riders.get(it.riderId)?.riderNumber} /> : none}</td>
                      <td className="tabular-nums">{sm.photoCount(it.photoCount ?? 0)}</td>
                      <td className="whitespace-nowrap">{when(it.createdAt)}</td>
                      <td className="whitespace-nowrap">{it.state === 'RESOLVED' ? none : <WaitBadge from={it.createdAt} now={now} />}</td>
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

function HelpChatPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { deliveryId = '', requestId = '' } = useParams();
  const path = { deliveryId, requestId };
  const detail = useQuery({
    queryKey: ['help', deliveryId, requestId],
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}', { params: { path } })),
  });
  const chat = useQuery({
    queryKey: ['help-messages', deliveryId, requestId],
    refetchInterval: 4_000,
    queryFn: () => request('GET', api.execution.GET('/deliveries/{deliveryId}/help-requests/{requestId}/messages', { params: { path } })),
  });
  const [text, setText] = useState('');
  const send = useCommand(async (body: { body: string }, key) => {
    try {
      return await request('POST', api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/messages', { ...commandParams(key, { path }), body }));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['help-messages', deliveryId, requestId] });
    }
  });
  const closed = chat.data?.helpState === 'RESOLVED';
  const { session } = useSession();
  const isAdmin = (session?.roles ?? []).includes('OPERATOR_ADMIN');
  const d = detail.data;
  const photoRefs = d?.evidenceRefs ?? [];
  // 화면 번호(ADR-0070): 배송 번호 — 시스템 ID 는 아래 접힌 "시스템 번호"
  const no = useDeliveryNumbers([deliveryId]).get(deliveryId);
  const deliveryLabel = no?.deliveryNumber ?? (no?.orderNumber ? `주문 ${no.orderNumber}` : `…${deliveryId.slice(-8)}`);
  const tabs = [
    { id: 'sec-request', label: sm.help.request },
    { id: 'sec-photos', label: sm.help.photos },
    { id: 'sec-chat', label: sm.help.chat },
  ];
  return (
    <section className="max-w-[1600px] space-y-4">
      <DetailHeader
        back={{ to: '/help-requests', label: h.back }}
        title={d ? `${label(helpCategoryName, d.category)} 도움요청` : h.chatTitle('')}
        badges={
          d && (
            <>
              <StatusBadge tone={helpTone(d.state)}>{label(n.helpState, d.state)}</StatusBadge>
              <StatusBadge tone="accent">{label(helpCategoryName, d.category)}</StatusBadge>
              {d.caseId && <StatusBadge>{sm.hasCase}</StatusBadge>}
            </>
          )
        }
        summary={d && [`배송 ${deliveryLabel}`, d.stage ? `${sm.helpCol.stage} ${label(n.executionState, d.stage)}` : null, `${h.col.createdAt} ${when(d.createdAt)}`].filter(Boolean).join(' · ')}
        actions={
          <>
            {d && <ResolvePanel help={d} deliveryId={deliveryId} requestId={requestId} />}
            <Link className="btn btn-sm border-base-300 bg-base-100" to={`/deliveries/${encodeURIComponent(deliveryId)}`}>
            {sm.help.goDelivery}
          </Link>
          </>
        }
      />
      <SectionTabs items={tabs} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <Section id="sec-request" title={sm.help.request}>
            <QueryState state={toUiState(detail)} onRetry={() => void detail.refetch()}>
              {(x) => (
                <div className="space-y-4">
                  {x.detail && (
                    <div className="rounded-box bg-base-200/60 px-4 py-3">
                      <p className="mb-1 text-xs text-base-content/55">{sm.help.riderSaid}</p>
                      <p className="whitespace-pre-wrap text-sm">{x.detail}</p>
                    </div>
                  )}
                  <FieldList
                    testId="help-detail"
                    rows={[
                      [h.col.category, label(helpCategoryName, x.category)],
                      [h.col.state, label(n.helpState, x.state)],
                      [sm.helpCol.stage, label(n.executionState, x.stage)],
                      [h.col.delivery, <DeliveryNo deliveryId={x.deliveryId ?? deliveryId} deliveryNumber={no?.deliveryNumber} orderNumber={no?.orderNumber} />],
                      [h.col.createdAt, when(x.createdAt)],
                      [sm.help.lastRider, when(x.lastRiderMessageAt)],
                      [sm.help.lastSupport, when(x.lastSupportMessageAt)],
                      !!x.resolvedAt && [sm.help.resolvedAt, when(x.resolvedAt)],
                      !!x.resolvedBy && [sm.help.resolvedBy, <StaffName operatorId={x.resolvedBy} me={session?.subject} />],
                      !!x.resolutionNote && [sm.help.resolutionNote, <span className="whitespace-pre-wrap">{x.resolutionNote}</span>],
                    ]}
                  />
                  <SystemIds
                    ids={[
                      ['도움요청', requestId],
                      ['배송', deliveryId],
                      ['접수 건', x.caseId],
                    ]}
                  />
                </div>
              )}
            </QueryState>
          </Section>
          {d && (
            <>
              <Section id="sec-photos" title={photoMessages.title(helpExtrasMessages.photos.label, photoRefs.length)}>
                <EvidencePhotos deliveryId={deliveryId} refs={photoRefs} heading={false} />
              </Section>
            </>
          )}
        </div>
        <Section id="sec-chat" title={sm.help.chat} aside={<span className="text-xs text-base-content/50">{sm.autoRefresh(4)}</span>}>
          <div className="space-y-3">
            <QueryState state={toUiState(chat)} onRetry={() => void chat.refetch()}>
              {(c) => (
                <ChatBox testId="help-messages" empty={(c.items ?? []).length === 0}>
                  {(c.items ?? []).map((msg) => (
                    <ChatBubble
                      key={msg.messageId}
                      mine={msg.senderType === 'SUPPORT'}
                      who={msg.senderType === 'SUPPORT' ? h.support : h.rider}
                      at={when(msg.createdAt)}
                      footer={isAdmin && !msg.masked && msg.messageId ? <MaskMessage deliveryId={deliveryId} requestId={requestId} messageId={msg.messageId} /> : undefined}
                    >
                      {msg.masked ? <span className="italic opacity-70">{h.masked}</span> : (msg.body ?? none)}
                    </ChatBubble>
                  ))}
                </ChatBox>
              )}
            </QueryState>
            {closed ? (
              <p className="rounded-box bg-base-200/60 px-4 py-3 text-center text-sm text-base-content/60">{h.closed}</p>
            ) : (
              <form
                className="flex gap-2 border-t border-base-300 pt-3"
                aria-label={h.write}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  void send.run({ body: text.trim() }).then(() => setText(''));
                }}
              >
                <input className="input input-sm flex-1" aria-label={h.write} placeholder="라이더에게 보낼 말" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
                <button type="submit" className="btn btn-sm btn-primary w-20" disabled={!text.trim() || send.busy}>
                  {h.send}
                </button>
              </form>
            )}
            <CommandFeedback command={send}>{() => <span className="text-xs text-success">{h.sent}</span>}</CommandFeedback>
          </div>
        </Section>
      </div>
    </section>
  );
}

// ---------------- 라이더 문의

type InquiryStatus = 'RECEIVED' | 'ANSWERED' | 'CLOSED';
const INQUIRY_STATUSES = ['RECEIVED', 'ANSWERED', 'CLOSED'] as const;
const INQUIRY_PAGE_SIZE = 50;

export function InquiriesMenu() {
  return (
    <Routes>
      <Route index element={<InquiryListPage />} />
      <Route path=":inquiryId" element={<InquiryDetailPage />} />
    </Routes>
  );
}

function InquiryListPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status') ?? 'RECEIVED';
  const status = (INQUIRY_STATUSES as readonly string[]).includes(raw) ? (raw as InquiryStatus) : 'RECEIVED';
  const cursor = params.get('cursor') ?? '';
  const list = useQuery({
    queryKey: ['rider-inquiries', status, cursor],
    queryFn: () => request('GET', api.cases.GET('/inquiries', { params: { query: { requesterType: 'RIDER', status, size: INQUIRY_PAGE_SIZE, ...(cursor ? { cursor } : {}) } } })),
  });
  const go = (inquiryId: string | undefined) => `/inquiries/${encodeURIComponent(inquiryId ?? '')}`;
  return (
    <section className="space-y-4">
      <PageHeader title={q.title} description={q.intro} />
      <StateTabs label={q.status} value={status} options={INQUIRY_STATUSES.map((s) => ({ value: s, label: q.statusName[s] }))} onChange={(s) => setParams({ status: s })} />
      <QueryState state={toUiState(list, (x) => (x.items ?? []).length === 0)} onRetry={() => void list.refetch()} emptyText={q.empty}>
        {(x) => {
          const items = x.items ?? [];
          const nextCursor = x.page?.nextCursor ?? null;
          return (
            <div className="space-y-3">
              <ResultBar count={items.length} more={!!nextCursor} />
              <DataTable>
                <thead>
                  <tr>
                    <th>{q.col.title}</th>
                    <th>{q.col.status}</th>
                    <th>{q.col.category}</th>
                    <th>{q.col.createdAt}</th>
                    <th>{sm.inquiry.answeredAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.inquiryId} data-testid="inquiry-row" className="cursor-pointer" onClick={() => void navigate(go(it.inquiryId))}>
                      {/* 문의 ID(시스템 ID)는 목록에 내지 않는다(ADR-0070) — 제목을 누르면 대화 */}
                      <td className="font-medium">
                        <Link className="hover:underline" to={go(it.inquiryId)} onClick={(e) => e.stopPropagation()}>
                          {it.title ?? label(n.inquiryCategory, it.category)}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge tone={inquiryTone(it.status)}>{label(q.statusName, it.status)}</StatusBadge>
                      </td>
                      <td className="whitespace-nowrap">{label(n.inquiryCategory, it.category)}</td>

                      <td className="whitespace-nowrap">{when(it.createdAt)}</td>
                      <td className="whitespace-nowrap">{when(it.answeredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <CursorPager hasPrev={!!cursor} nextCursor={nextCursor} onFirst={() => setParams({ status })} onNext={(c) => setParams({ status, cursor: c })} />
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

function InquiryDetailPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { inquiryId = '' } = useParams();
  const path = { inquiryId };
  const inquiry = useQuery({
    queryKey: ['inquiry', inquiryId],
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}', { params: { path } })),
  });
  const chat = useQuery({
    queryKey: ['inquiry-messages', inquiryId],
    refetchInterval: 5_000,
    queryFn: () => request('GET', api.cases.GET('/inquiries/{inquiryId}/messages', { params: { path } })),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inquiry', inquiryId] });
    void queryClient.invalidateQueries({ queryKey: ['inquiry-messages', inquiryId] });
  };
  const [text, setText] = useState('');
  const reply = useCommand(async (body: { body: string }, key) => {
    try {
      return await request(
        'POST',
        api.cases.POST('/inquiries/{inquiryId}/replies', {
          ...commandParams(key, { path, ...(inquiry.data?.version !== undefined ? { version: inquiry.data.version } : {}) }),
          body,
        }),
      );
    } finally {
      refresh();
    }
  });
  const [closeReason, setCloseReason] = useState('');
  const close = useCommand(async (body: { reason: string }, key) => {
    try {
      return await request('POST', api.cases.POST('/inquiries/{inquiryId}/closures', { ...commandParams(key, { path }), body }));
    } finally {
      refresh();
    }
  });
  const status = chat.data?.status ?? inquiry.data?.status;
  const closed = status === 'CLOSED';
  const d = inquiry.data;
  const riderSummary = useRiderSummaries([d?.riderId]).get(d?.riderId ?? '');
  const photoIds = (d?.photos ?? []).map((p) => p.photoId);
  const tabs = [
    { id: 'sec-content', label: sm.inquiry.content },
    { id: 'sec-photos', label: sm.inquiry.photos },
    { id: 'sec-chat', label: sm.inquiry.chat },
    ...(closed ? [] : [{ id: 'sec-close', label: sm.inquiry.close }]),
  ];
  return (
    <section className="max-w-[1600px] space-y-4">
      <DetailHeader
        back={{ to: '/inquiries', label: q.back }}
        title={d?.title ?? q.detailTitle('')}
        badges={
          d && (
            <>
              <StatusBadge tone={inquiryTone(status)}>{label(q.statusName, status)}</StatusBadge>
              <StatusBadge tone="accent">{label(n.inquiryCategory, d.category)}</StatusBadge>
            </>
          )
        }
        summary={d && [d.title, d.riderId && riderSummary?.riderNumber ? `${sm.inquiry.rider} ${riderSummary.nameMasked ?? ''} ${riderSummary.riderNumber}` : null, `${q.col.createdAt} ${when(d.createdAt)}`].filter(Boolean).join(' · ')}
      />
      <SectionTabs items={tabs} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <Section id="sec-content" title={sm.inquiry.content}>
            <QueryState state={toUiState(inquiry)} onRetry={() => void inquiry.refetch()}>
              {(x) => (
                <div className="space-y-4">
                  <div className="rounded-box bg-base-200/60 px-4 py-3">
                    <p className="mb-1 text-xs text-base-content/55">{q.first}</p>
                    {x.title && <p className="mb-1 font-semibold">{x.title}</p>}
                    <p className="whitespace-pre-wrap text-sm">{x.body}</p>
                  </div>
                  <FieldList
                    testId="inquiry-detail"
                    rows={[
                      [q.col.category, label(n.inquiryCategory, x.category)],
                      [q.col.status, label(q.statusName, x.status)],
                      [sm.inquiry.rider, <RiderRef riderId={x.riderId} summary={riderSummary} />],
                      [q.col.createdAt, when(x.createdAt)],
                      [sm.inquiry.answeredAt, when(x.answeredAt)],
                      !!x.closedAt && [sm.inquiry.closedAt, when(x.closedAt)],
                      !!x.closedByType && [sm.inquiry.closedBy, label(sm.inquiry.closedByName, x.closedByType)],
                      !!x.closeReason && [sm.inquiry.closeReason, <span className="whitespace-pre-wrap">{x.closeReason}</span>],
                    ]}
                  />
                  <SystemIds ids={[['문의', inquiryId], ['라이더', x.riderId]]} />
                </div>
              )}
            </QueryState>
          </Section>
          {d && (
            <Section id="sec-photos" title={photoMessages.title(helpExtrasMessages.photos.inquiryLabel, photoIds.length)}>
              <InquiryPhotos photoIds={photoIds} heading={false} />
            </Section>
          )}
        </div>
        <div className="space-y-4">
          <Section id="sec-chat" title={sm.inquiry.chat} aside={<span className="text-xs text-base-content/50">{sm.autoRefresh(5)}</span>}>
            <div className="space-y-3">
              <QueryState state={toUiState(chat)} onRetry={() => void chat.refetch()}>
                {(c) => (
                  <ChatBox testId="inquiry-messages" empty={(c.items ?? []).length === 0}>
                    {(c.items ?? []).map((msg) => (
                      <ChatBubble key={msg.messageId} mine={msg.senderType === 'SUPPORT'} who={msg.senderType === 'SUPPORT' ? h.support : h.rider} at={when(msg.createdAt)}>
                        {msg.body}
                      </ChatBubble>
                    ))}
                  </ChatBox>
                )}
              </QueryState>
              {closed ? (
                <p className="rounded-box bg-base-200/60 px-4 py-3 text-center text-sm text-base-content/60">{sm.inquiry.alreadyClosed}</p>
              ) : (
                <form
                  className="flex gap-2 border-t border-base-300 pt-3"
                  aria-label={q.reply}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!text.trim()) return;
                    void reply.run({ body: text.trim() }).then(() => setText(''));
                  }}
                >
                  <input className="input input-sm flex-1" aria-label={q.reply} placeholder="라이더에게 보낼 답변" maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
                  <button type="submit" className="btn btn-sm btn-primary w-20" disabled={!text.trim() || reply.busy}>
                    {q.send}
                  </button>
                </form>
              )}
              <CommandFeedback command={reply}>{() => <span className="text-xs text-success">{q.sent}</span>}</CommandFeedback>
            </div>
          </Section>
          {!closed && (
            <Section id="sec-close" title={q.close}>
              <form
                className="flex flex-wrap items-end gap-2 text-sm"
                aria-label={q.close}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (closeReason.trim().length >= 2) void close.run({ reason: closeReason.trim() });
                }}
              >
                <label className="flex min-w-60 flex-1 flex-col gap-1">
                  <span className="text-base-content/70">{q.closeReason}</span>
                  <input className="input input-sm w-full" maxLength={500} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
                </label>
                <button type="submit" className="btn btn-sm border-base-300 bg-base-100" disabled={closeReason.trim().length < 2 || close.busy}>
                  {q.close}
                </button>
              </form>
              <CommandFeedback command={close}>{() => <span className="text-xs text-success">{q.closed}</span>}</CommandFeedback>
            </Section>
          )}
        </div>
      </div>
    </section>
  );
}

const waitCol = '기다린 시간';

/** 받은 뒤 지난 시간 — 10분 넘으면 주의, 30분 넘으면 경고 */
function WaitBadge({ from, now }: { readonly from: string | null | undefined; readonly now: number | null }) {
  const w = waited(from, now);
  if (!w) return <span className="text-base-content/40">—</span>;
  return <StatusBadge tone={w.tone}>{w.text}</StatusBadge>;
}
