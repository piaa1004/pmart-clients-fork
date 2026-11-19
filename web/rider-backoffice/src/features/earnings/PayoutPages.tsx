// 지급 관리(2026-11-19, PC 5 — 백엔드 execution 0.29.0, 사용자 "결과 받는 창구 + 수동 표시").
// 지급 실행은 외부 회계 — 이 화면은 회계 결과를 수동으로 표시한다. 묶음 = 라이더 1명 × 지급 예정일(확정 수행료).
// - 보기: `GET /rider-payouts?payoutDate&riderId&state`(RIDER_OPS·OPERATOR_ADMIN). payoutDate 기본 = 오늘(서버, Asia/Seoul).
// - 결과 표시: `POST /rider-payouts/{riderId}/{payoutDate}/results`(OPERATOR_ADMIN 만) — PAYING·PAID·FAILED(사유 필수).
//   예정일 전 PAYING·PAID 는 422 PAYOUT_NOT_DUE, 바꿀 줄이 없으면 409. 라이더 알림함은 PAID·PAYMENT_FAILED 를 묶음마다 한 번(서버).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { request } from '@pmart/web-core';
import { CommandFeedback, QueryState, toUiState, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import { useApi } from '../../app/ApiContext';
import { isOperatorAdmin } from '../../app/nav';
import { useSession } from '../../app/SessionContext';
import { ChipGroup, DataTable, PageHeader, ResultBar, SearchPanel, SearchRow, StatusBadge, type Tone } from '../../shared/admin';
import { SavedViews } from '../../shared/SavedViews';
import { resolveRiderId, RiderName, searchHint, StaffName, useRiderSummaries } from '../../shared/displayNumbers';
import { when, won } from '../../shared/opsUi';

export const payoutText = {
  title: '지급 관리',
  intro: '지급은 외부 회계가 해요. 회계 결과를 여기서 표시하면 라이더 정산 내역과 알림에 반영돼요. 묶음 = 라이더 한 명의 같은 지급 예정일 수행료.',
  date: '지급 예정일',
  dateHint: '비우면 오늘',
  rider: searchHint.rider,
  state: '상태',
  all: '전체',
  search: '조회',
  reset: '초기화',
  empty: '이 조건의 지급 묶음이 없어요.',
  col: { rider: '라이더', date: '지급 예정일', count: '건수', total: '합계', state: '상태', last: '마지막 표시', act: '결과 표시' },
  stateName: { CONFIRMED: '확정(지급 전)', PAYING: '지급 중', PAID: '지급 완료', PAYMENT_FAILED: '지급 실패', MIXED: '섞임' } as Readonly<Record<string, string>>,
  resultName: { PAYING: '지급 중', PAID: '지급 완료', FAILED: '지급 실패' } as Readonly<Record<string, string>>,
  pick: '결과',
  reference: '회계 처리 번호(있으면)',
  failureReason: '실패 사유(필수, 계좌번호 등 개인정보 금지)',
  record: '표시',
  recorded: (s: string) => `${s}(으)로 표시했어요.`,
  doneLine: (rider: string, date: string, s: string) => `${rider} · ${date} 묶음을 ${s}(으)로 표시했어요.`,
  adminOnly: '관리자만 표시할 수 있어요',
  compensations: (n: number) => `(보상 ${n})`,
  lastLine: (result: string, at: string) => `${result} · ${at} ·`,
} as const;

type PayoutState = 'CONFIRMED' | 'PAYING' | 'PAID' | 'PAYMENT_FAILED';
const STATES: readonly PayoutState[] = ['CONFIRMED', 'PAYING', 'PAID', 'PAYMENT_FAILED'];
type Result = 'PAYING' | 'PAID' | 'FAILED';

const stateTone = (s: string): Tone => (s === 'PAID' ? 'success' : s === 'PAYMENT_FAILED' ? 'error' : s === 'PAYING' ? 'info' : s === 'MIXED' ? 'warning' : 'ghost');

export function PayoutsMenu() {
  const api = useApi();
  const { session } = useSession();
  const admin = isOperatorAdmin(session?.roles ?? []);
  const t = payoutText;
  const [params, setParams] = useSearchParams();
  const payoutDate = params.get('payoutDate') ?? '';
  const riderId = params.get('riderId') ?? '';
  const rawState = params.get('state');
  const state = STATES.find((s) => s === rawState) ?? 'ALL';
  const [dateInput, setDateInput] = useState(payoutDate);
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
    queryKey: ['rider-payouts', payoutDate, riderId, state],
    queryFn: async () => {
      // 라이더 번호 6자리로도 찾는다(ADR-0070) — 맞는 라이더가 없으면 빈 목록
      const rid = riderId ? await resolveRiderId(api, riderId) : '';
      if (rid === null) return { items: [] };
      return request(
        'GET',
        api.execution.GET('/rider-payouts', {
          params: { query: { ...(payoutDate ? { payoutDate } : {}), ...(rid ? { riderId: rid } : {}), ...(state === 'ALL' ? {} : { state }) } },
        }),
      );
    },
  });
  // 표시가 끝나면 줄이 바뀌어(지급 완료 → 입력 칸 없음) 줄 안 알림이 사라지므로 위에 남긴다.
  const [done, setDone] = useState<string | null>(null);
  const riders = useRiderSummaries((list.data?.items ?? []).map((p) => p.riderId));
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    patch({ payoutDate: dateInput, riderId: riderInput.trim() });
  };
  const reset = () => {
    setDateInput('');
    setRiderInput('');
    setParams({});
  };
  return (
    <section className="max-w-[1600px] space-y-4">
      <PageHeader title={t.title} description={t.intro} actions={<SavedViews listKey="payouts" />} />
      {done && (
        <p role="status" className="alert alert-success text-sm" data-testid="payout-done">
          {done}
        </p>
      )}
      <SearchPanel
        onSubmit={submit}
        onReset={reset}
        submitLabel={t.search}
        resetLabel={t.reset}
        summary={[
          [t.date, payoutDate],
          [t.state, state === 'ALL' ? '' : (t.stateName[state] ?? state)],
          ['라이더', riderId ? (/^\d{6}$/.test(riderId) ? riderId : '한 라이더') : ''],
        ]}
      >
        <SearchRow label={t.date}>
          <label className="flex items-center gap-2 text-sm">
            <input type="date" className="input input-sm w-44" aria-label={t.date} value={dateInput} onChange={(ev) => setDateInput(ev.target.value)} />
            <span className="text-xs text-base-content/55">{t.dateHint}</span>
          </label>
        </SearchRow>
        <SearchRow label={t.state}>
          <ChipGroup
            label={t.state}
            value={state}
            options={[{ value: 'ALL' as const, label: t.all }, ...STATES.map((s) => ({ value: s, label: t.stateName[s] ?? s }))]}
            onChange={(s) => patch({ state: s === 'ALL' ? '' : s })}
          />
        </SearchRow>
        <SearchRow label="라이더">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-base-content/60">{t.rider}</span>
            <input className="input input-sm w-44" maxLength={64} value={riderInput} onChange={(ev) => setRiderInput(ev.target.value)} />
          </label>
        </SearchRow>
      </SearchPanel>
      <QueryState state={toUiState(list, (x) => x.items.length === 0)} onRetry={() => void list.refetch()} emptyText={t.empty}>
        {(x) => (
          <div className="space-y-3">
            <ResultBar count={x.items.length} />
            <DataTable testId="payouts">
              <thead>
                <tr>
                  <th>{t.col.rider}</th>
                  <th>{t.col.date}</th>
                  <th className="text-right">{t.col.count}</th>
                  <th className="text-right">{t.col.total}</th>
                  <th>{t.col.state}</th>
                  <th>{t.col.last}</th>
                  <th>{t.col.act}</th>
                </tr>
              </thead>
              <tbody>
                {x.items.map((p) => {
                  const s = riders.get(p.riderId);
                  const last = p.lastResult;
                  return (
                    <tr key={`${p.riderId}-${p.payoutDate}`} data-testid="payout-row">
                      <td>
                        <RiderName riderId={p.riderId} nameMasked={s?.nameMasked} riderNumber={s?.riderNumber} />
                      </td>
                      <td className="whitespace-nowrap">{p.payoutDate}</td>
                      <td className="text-right">
                        {p.count}
                        {p.compensationCount ? <span className="ml-1 text-xs text-base-content/60">{t.compensations(p.compensationCount)}</span> : null}
                      </td>
                      <td className="text-right font-semibold">{won(p.total)}</td>
                      <td>
                        <StatusBadge tone={stateTone(p.state)}>{t.stateName[p.state] ?? p.state}</StatusBadge>
                      </td>
                      <td className="text-xs">
                        {last?.result ? (
                          <>
                            <p>
                              {t.lastLine(t.resultName[last.result] ?? last.result, when(last.recordedAt))} <StaffName operatorId={last.recordedBy} me={session?.subject} />
                            </p>
                            {last.reference && <p className="font-mono text-base-content/60">{last.reference}</p>}
                            {last.failureReason && <p className="text-error">{last.failureReason}</p>}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{p.state === 'PAID' ? '—' : admin ? <PayoutResultForm riderId={p.riderId} payoutDate={p.payoutDate} onDone={(r) => setDone(t.doneLine(s?.riderNumber ?? p.riderId, p.payoutDate, t.stateName[r.state] ?? r.state))} /> : <span className="text-xs text-base-content/50">{t.adminOnly}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        )}
      </QueryState>
    </section>
  );
}

function PayoutResultForm({ riderId, payoutDate, onDone }: { readonly riderId: string; readonly payoutDate: string; readonly onDone: (p: { readonly state: string }) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const t = payoutText;
  const [result, setResult] = useState<Result | ''>('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const record = useCommand(async (body: { result: Result; reference?: string; failureReason?: string }, key) => {
    try {
      const res = await request('POST', api.execution.POST('/rider-payouts/{riderId}/{payoutDate}/results', { ...commandParams(key, { path: { riderId, payoutDate } }), body }));
      onDone(res);
      return res;
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['rider-payouts'] });
    }
  });
  const ok = result !== '' && (result !== 'FAILED' || reason.trim().length >= 2);
  const locked = record.busy || record.phase.kind === 'done';
  return (
    <form
      className="min-w-72 space-y-1"
      aria-label={`지급 결과 표시 ${riderId} ${payoutDate}`}
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!ok) return;
        void record.run({
          result,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(result === 'FAILED' ? { failureReason: reason.trim() } : {}),
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select className="select select-xs w-28" aria-label={t.pick} value={result} disabled={locked} onChange={(ev) => setResult(ev.target.value as Result | '')}>
          <option value="">—</option>
          {(['PAYING', 'PAID', 'FAILED'] as const).map((r) => (
            <option key={r} value={r}>
              {t.resultName[r]}
            </option>
          ))}
        </select>
        <input className="input input-xs w-36" aria-label={t.reference} placeholder={t.reference} maxLength={64} value={reference} disabled={locked} onChange={(ev) => setReference(ev.target.value)} />
        <button type="submit" className="btn btn-xs btn-primary" disabled={!ok || locked}>
          {t.record}
        </button>
      </div>
      {result === 'FAILED' && <input className="input input-xs w-full" aria-label={t.failureReason} placeholder={t.failureReason} maxLength={200} value={reason} disabled={locked} onChange={(ev) => setReason(ev.target.value)} />}
      <CommandFeedback command={record}>{(p) => <p className="text-xs text-success">{t.recorded(t.stateName[p.state] ?? p.state)}</p>}</CommandFeedback>
    </form>
  );
}
