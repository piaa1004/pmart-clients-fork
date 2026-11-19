// 소명·이의(2026-11-19, PC 5 — 백엔드 rider 0.15.0, 사용자 "앱에서 신청 → 백오피스 결정").
// - 목록: `GET /rider-appeals?state(기본 OPEN)&riderId&targetType` — 오래된 것 먼저, 최대 200건(RIDER_OPS·OPERATOR_ADMIN).
// - 결정: `POST /rider-appeals/{id}/decisions {decision UPHELD|ACCEPTED, note 1~300}` — note 는 라이더가 보는 결과 설명(개인정보 금지).
//   계정 제한 소명을 인정하면 서버가 바로 제한을 풀어 정상으로. 수행료 이의를 인정하면 결정만 — 금액은 수행료 조정에서 따로(응답 adjustmentRequired).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { AllDone, ChipGroup, FieldList, PageHeader, ResultBar, SearchPanel, SearchRow, StatusBadge, type Tone } from '../../shared/admin';
import { SavedViews } from '../../shared/SavedViews';
import { ui } from '../../shared/uiMessages';
import { DeliveryNo, resolveRiderId, RiderName, searchHint, StaffName, SystemIds, useDeliveryNumbers, useRiderSummaries } from '../../shared/displayNumbers';
import { useSession } from '../../app/SessionContext';
import { when, won } from '../../shared/opsUi';

export const appealText = {
  title: '소명·이의',
  intro: '라이더가 앱에서 낸 계정 제한 소명과 수행료 이의 신청이에요. 결정 메모는 라이더 앱에 그대로 보여요(개인정보를 적지 마세요).',
  state: '상태',
  type: '종류',
  all: '전체',
  rider: searchHint.rider,
  search: '조회',
  reset: '초기화',
  empty: '이 조건의 신청이 없어요.',
  stateName: { OPEN: '결정 대기', UPHELD: '유지', ACCEPTED: '인정' } as Readonly<Record<string, string>>,
  typeName: { RESTRICTION: '계정 제한 소명', EARNING: '수행료 이의' } as Readonly<Record<string, string>>,
  col: { rider: '라이더', target: '대상', restriction: '신청 당시 제한', body: '라이더가 쓴 내용', submitted: '신청', decided: '결정' },
  restrictionName: { NORMAL: '정상', DISPATCH_RESTRICTED: '신규배차 제한', SUSPENDED: '일시 중지', TERMINATED: '계약 종료' } as Readonly<Record<string, string>>,
  note: '결정 메모(라이더에게 보임, 1~300자)',
  uphold: '유지',
  accept: '인정',
  acceptHint: { RESTRICTION: '인정하면 이 라이더의 계정 제한이 바로 풀려요.', EARNING: '인정해도 원래 수행료는 그대로예요 — 인정한 뒤 보상금을 따로 줘요.' } as Readonly<Record<string, string>>,
  decided: (s: string) => `${s}(으)로 결정했어요.`,
  doneLine: (type: string, rider: string, s: string) => `${type}(${rider})을 ${s}(으)로 결정했어요.`,
  sys: { appeal: '신청', delivery: '배송', restriction: '제한 기록', rider: '라이더' },
  toAdjustUncalculable: '산정 불가 수행료라면 수행료 조정 화면에서 바로 조정할 수도 있어요',
  decidedLine: (s: string, at: string) => `${s} · ${at} ·`,
} as const;

type AppealState = 'OPEN' | 'UPHELD' | 'ACCEPTED';
type TargetType = 'RESTRICTION' | 'EARNING';
const STATES: readonly AppealState[] = ['OPEN', 'UPHELD', 'ACCEPTED'];
const TYPES: readonly TargetType[] = ['RESTRICTION', 'EARNING'];
const tone = (s: string): Tone => (s === 'OPEN' ? 'warning' : s === 'ACCEPTED' ? 'success' : 'ghost');

/** 수행료 조정 화면으로(그 배송만 보이게) */
export const adjustmentLink = (deliveryId: string) => `/adjustments?deliveryId=${encodeURIComponent(deliveryId)}`;

export function AppealsMenu() {
  const api = useApi();
  const t = appealText;
  const [params, setParams] = useSearchParams();
  const rawState = params.get('state');
  const state: AppealState | 'ALL' = rawState === 'ALL' ? 'ALL' : (STATES.find((s) => s === rawState) ?? 'OPEN');
  const rawType = params.get('targetType');
  const targetType = TYPES.find((x) => x === rawType) ?? 'ALL';
  const riderId = params.get('riderId') ?? '';
  const [riderInput, setRiderInput] = useState(riderId);
  const patch = (next: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p);
  };
  const list = useQuery({
    queryKey: ['rider-appeals', state, targetType, riderId],
    queryFn: async () => {
      // 라이더 번호 6자리로도 찾는다(ADR-0070) — 맞는 라이더가 없으면 빈 목록
      const rid = riderId ? await resolveRiderId(api, riderId) : '';
      if (rid === null) return { items: [] };
      return request(
        'GET',
        api.riders.GET('/rider-appeals', {
          params: { query: { ...(state === 'ALL' ? {} : { state }), ...(targetType === 'ALL' ? {} : { targetType }), ...(rid ? { riderId: rid } : {}) } },
        }),
      );
    },
  });
  // 결정하면 신청이 "결정 대기" 목록에서 빠져 줄 안 알림이 사라지므로 위에 남긴다(수행료 인정이면 조정으로 가는 버튼도).
  const [done, setDone] = useState<{ readonly text: string; readonly compensate: { readonly appealId: string; readonly deliveryId: string } | null } | null>(null);
  const riders = useRiderSummaries((list.data?.items ?? []).map((a) => a.riderId));
  const deliveryNos = useDeliveryNumbers((list.data?.items ?? []).filter((a) => a.targetType === 'EARNING').map((a) => a.targetRef));
  const me = useSession().session?.subject;
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    patch({ riderId: riderInput.trim() });
  };
  const reset = () => {
    setRiderInput('');
    setParams({});
  };
  return (
    <section className="max-w-[1600px] space-y-4">
      <PageHeader title={t.title} description={t.intro} actions={<SavedViews listKey="appeals" />} />
      {done && (
        <div role="status" className="alert alert-success flex flex-col items-stretch gap-2 text-sm" data-testid="appeal-done">
          <span>{done.text}</span>
          {done.compensate && (
            <>
              {/* 수행료 이의 인정 → 보상금 한 줄(사용자 2026-11-19). 산정 불가 수행료면 기존 조정도 쓸 수 있다. */}
              <CompensationBox appealId={done.compensate.appealId} />
              <Link to={adjustmentLink(done.compensate.deliveryId)} className="link text-xs" data-testid="to-adjustment">
                {t.toAdjustUncalculable}
              </Link>
            </>
          )}
        </div>
      )}
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        submitLabel={t.search}
        resetLabel={t.reset}
        summary={[
          [t.state, state === 'OPEN' ? '' : state === 'ALL' ? t.all : (t.stateName[state] ?? state)],
          [t.type, targetType === 'ALL' ? '' : (t.typeName[targetType] ?? targetType)],
          ['라이더', riderId ? (/^\d{6}$/.test(riderId) ? riderId : '한 라이더') : ''],
        ]}
      >
        <SearchRow label={t.state}>
          <ChipGroup
            label={t.state}
            value={state}
            options={[...STATES.map((s) => ({ value: s, label: t.stateName[s] ?? s })), { value: 'ALL' as const, label: t.all }]}
            onChange={(s) => patch({ state: s === 'OPEN' ? '' : s })}
          />
        </SearchRow>
        <SearchRow label={t.type}>
          <ChipGroup
            label={t.type}
            value={targetType}
            options={[{ value: 'ALL' as const, label: t.all }, ...TYPES.map((x) => ({ value: x, label: t.typeName[x] ?? x }))]}
            onChange={(x) => patch({ targetType: x === 'ALL' ? '' : x })}
          />
        </SearchRow>
        <SearchRow label="라이더">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-base-content/60">{t.rider}</span>
            <input className="input input-sm w-44" maxLength={64} value={riderInput} onChange={(ev) => setRiderInput(ev.target.value)} />
          </label>
        </SearchRow>
      </SearchPanel>
      {/* 할 일이 서버 0건이면 "수고하셨어요"(2026-11-19 통합 백오피스 AllDone) — 읽는 중·실패·거르기를 건 때는 그리지 않는다 */}
      {state === 'OPEN' && targetType === 'ALL' && !riderId && list.isSuccess && list.data.items.length === 0 ? (
        <AllDone title={ui.allDone} body={t.empty} testId="appeals-all-done" />
      ) : (
        <QueryState state={toUiState(list, (x) => x.items.length === 0)} onRetry={() => void list.refetch()} emptyText={t.empty}>
          {(x) => (
            <div className="space-y-3">
              <ResultBar count={x.items.length} />
              <ul className="space-y-3">
                {x.items.map((a) => {
                  const s = riders.get(a.riderId);
                  return (
                    <li key={a.appealId} className="overflow-hidden rounded-box border border-base-300 bg-base-100 text-sm" data-testid="appeal-row">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={tone(a.state)}>{t.stateName[a.state] ?? a.state}</StatusBadge>
                          <span className="font-semibold">{t.typeName[a.targetType] ?? a.targetType}</span>
                          <Link to={`/riders/${encodeURIComponent(a.riderId)}`} className="hover:underline">
                            <RiderName riderId={a.riderId} nameMasked={s?.nameMasked} riderNumber={s?.riderNumber} />
                          </Link>
                        </div>
                        <span className="text-xs text-base-content/55">
                          {t.col.submitted} {when(a.submittedAt)}
                        </span>
                      </div>
                      <div className="space-y-3 px-5 py-3">
                        <FieldList
                          rows={[
                            a.targetType === 'EARNING'
                              ? [
                                  t.col.target,
                                  <Link to={`/deliveries/${encodeURIComponent(a.targetRef)}`} className="hover:underline">
                                    <DeliveryNo deliveryId={a.targetRef} deliveryNumber={deliveryNos.get(a.targetRef)?.deliveryNumber} orderNumber={deliveryNos.get(a.targetRef)?.orderNumber} />
                                  </Link>,
                                ]
                              : null,
                            a.targetType === 'RESTRICTION' && a.restriction ? [t.col.restriction, t.restrictionName[a.restriction] ?? a.restriction] : null,
                            [t.col.body, <p className="whitespace-pre-wrap">{a.body}</p>],
                          ]}
                        />
                        <SystemIds ids={[[t.sys.appeal, a.appealId], [a.targetType === 'EARNING' ? t.sys.delivery : t.sys.restriction, a.targetRef], [t.sys.rider, a.riderId]]} />
                      </div>
                      <div className="border-t border-base-200 bg-base-200/50 px-5 py-3">
                        {a.state === 'OPEN' ? (
                          <AppealDecision
                            appealId={a.appealId}
                            targetType={a.targetType}
                            onDone={(r) => setDone({ text: t.doneLine(t.typeName[a.targetType] ?? a.targetType, s?.riderNumber ?? a.riderId, t.stateName[r.state] ?? r.state), compensate: r.adjustmentRequired ? { appealId: a.appealId, deliveryId: a.targetRef } : null })}
                          />
                        ) : (
                          <div data-testid="appeal-decided">
                            <p className="text-base-content/70">{t.decidedLine(t.stateName[a.state] ?? a.state, when(a.decidedAt))} <StaffName operatorId={a.decidedBy} me={me} /></p>
                            {a.decisionNote && <p className="mt-1 whitespace-pre-wrap">{a.decisionNote}</p>}
                            {a.targetType === 'EARNING' && a.state === 'ACCEPTED' && (
                              <div className="mt-2 space-y-1">
                                <CompensationBox appealId={a.appealId} />
                                <Link to={adjustmentLink(a.targetRef)} className="link text-xs">
                                  {t.toAdjustUncalculable}
                                </Link>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </QueryState>
      )}
    </section>
  );
}

function AppealDecision({ appealId, targetType, onDone }: { readonly appealId: string; readonly targetType: TargetType; readonly onDone: (a: { readonly state: string; readonly adjustmentRequired?: boolean | undefined }) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const t = appealText;
  const [note, setNote] = useState('');
  const decide = useCommand(async (body: { decision: 'UPHELD' | 'ACCEPTED'; note: string }, key) => {
    try {
      const res = await request('POST', api.riders.POST('/rider-appeals/{appealId}/decisions', { ...commandParams(key, { path: { appealId } }), body }));
      onDone(res);
      return res;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['rider-appeals'] });
    }
  });
  const ok = note.trim().length >= 1;
  const locked = decide.busy || decide.phase.kind === 'done';
  return (
    <form className="space-y-2" aria-label={`소명·이의 결정 ${appealId}`} onSubmit={(ev) => ev.preventDefault()}>
      <label className="flex flex-col gap-1">
        <span className="text-base-content/60">{t.note}</span>
        <input className="input input-sm w-full" maxLength={300} value={note} disabled={locked} onChange={(ev) => setNote(ev.target.value)} />
      </label>
      <p className="text-xs text-base-content/60">{t.acceptHint[targetType]}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm w-20 border-base-300 bg-base-100" disabled={!ok || locked} onClick={() => void decide.run({ decision: 'UPHELD', note: note.trim() })}>
          {t.uphold}
        </button>
        <button type="button" className="btn btn-sm btn-primary w-20" disabled={!ok || locked} onClick={() => void decide.run({ decision: 'ACCEPTED', note: note.trim() })}>
          {t.accept}
        </button>
      </div>
      <CommandFeedback command={decide}>
        {(a) => <p className="text-success">{t.decided(t.stateName[a.state] ?? a.state)}</p>}
      </CommandFeedback>
    </form>
  );
}

export const compensationText = {
  title: '이의 인정 보상금',
  intro: '원래 수행료는 그대로 두고, 이 이의에 보상금 한 줄을 따로 기록해요. 지급 예정일은 서버가 정해요(오늘 + 3영업일).',
  amount: '금액(원, 1~100,000)',
  reason: '사유(라이더에게도 전달돼요, 1~300자, 개인정보 금지)',
  give: '보상금 주기',
  given: (won: string, date: string) => `${won} 보상금을 기록했어요 · 지급 예정일 ${date}`,
  line: (won: string, state: string, date: string) => `${won} · ${state} · 지급 예정일 ${date} ·`,
  loadFailed: '보상금 기록을 불러오지 못했어요 — 이미 줬는지 모르니 다시 시도한 뒤에 주세요.',
  retry: '다시 시도',
  stateName: { CONFIRMED: '확정(지급 전)', PAYING: '지급 중', PAID: '지급 완료', PAYMENT_FAILED: '지급 실패', ADJUSTED: '조정됨', ESTIMATED: '예상', PENDING_CONFIRMATION: '확정 대기' } as Readonly<Record<string, string>>,
} as const;

/**
 * 인정한 수행료 이의의 보상금(execution 0.30.0 — 사용자 2026-11-19 "보상금 한 줄 따로").
 * 이미 줬으면 그 줄을, 아니면 "보상금 주기"(금액·사유). 이미 줬는지 못 읽으면 주기를 막는다(두 번 주지 않게).
 */
export function CompensationBox({ appealId }: { readonly appealId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const c = compensationText;
  const me = useSession().session?.subject;
  const given = useQuery({
    queryKey: ['rider-compensations', appealId],
    queryFn: () => request('GET', api.execution.GET('/rider-compensations', { params: { query: { appealId } } })),
  });
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const record = useCommand(async (body: { appealId: string; amount: number; reason: string }, key) => {
    try {
      return await request('POST', api.execution.POST('/rider-compensations', { ...commandParams(key), body }));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['rider-compensations', appealId] });
    }
  });
  const n = Number(amount);
  const ok = Number.isInteger(n) && n >= 1 && n <= 100_000 && reason.trim().length >= 1;
  const locked = record.busy || record.phase.kind === 'done';
  if (given.isPending) return <p className="text-xs text-base-content/60">…</p>;
  if (given.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-error" data-testid="compensation-load-failed">
        {c.loadFailed}
        <button type="button" className="btn btn-xs" onClick={() => void given.refetch()}>
          {c.retry}
        </button>
      </div>
    );
  }
  const existing = given.data.items[0];
  return (
    <div className="space-y-2 rounded-box border border-base-300 bg-base-100 p-3" data-testid="compensation">
      <p className="font-semibold">{c.title}</p>
      {existing ? (
        <div data-testid="compensation-given">
          <p>{c.line(won(existing.amount), c.stateName[existing.settlementState] ?? existing.settlementState, existing.payoutDate)} <StaffName operatorId={existing.recordedBy} me={me} /></p>
          <p className="whitespace-pre-wrap text-xs text-base-content/60">{existing.reason}</p>
        </div>
      ) : (
        <form
          className="space-y-2"
          aria-label={`${c.give} ${appealId}`}
          onSubmit={(ev) => {
            ev.preventDefault();
            if (ok) void record.run({ appealId, amount: n, reason: reason.trim() });
          }}
        >
          <p className="text-xs text-base-content/60">{c.intro}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input input-sm w-40" inputMode="numeric" aria-label={c.amount} placeholder={c.amount} value={amount} disabled={locked} onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9]/g, ''))} />
            <input className="input input-sm min-w-64 flex-1" aria-label={c.reason} placeholder={c.reason} maxLength={300} value={reason} disabled={locked} onChange={(ev) => setReason(ev.target.value)} />
            <button type="submit" className="btn btn-sm btn-primary" disabled={!ok || locked}>
              {c.give}
            </button>
          </div>
          <CommandFeedback command={record}>{(r) => <p className="text-success">{c.given(won(r.amount), r.payoutDate)}</p>}</CommandFeedback>
        </form>
      )}
    </div>
  );
}
