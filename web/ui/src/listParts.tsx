// 공용(2026-11-19 PC 2 web-common — 직원 웹 UI·UX 맞추기, docs/handoff/all/2026-11-19-request-ui-ux-align.md). 처음 자리: web/backoffice/src/shared/admin.tsx
import { type FormEvent, type ReactNode, useState } from 'react';

/** 검색 조건 — 목록 카드 맨 위 필터 줄(2026-11-18 Shopify·Medusa 목록처럼: 항목명은 칸 위에 작게, 버튼은 오른쪽).
 * 바로 뒤의 결과 줄(ResultBar)·표(DataTable)와 한 카드로 붙는다(index.css 의 data-list-part). */
// 기본 백오피스 사본에만 더함(2026-11-18): submitDisabled(입력이 틀리면 조회를 막는 화면), label(화면 안 폼이 여럿일 때 이름)
// summary(2026-11-19 쿠팡 윙 반품관리·고객문의 "검색조건 [기간 지난 30일 ▾] … 검색 열기" 참고): [이름, 값] 목록을 주면
// 조건을 건 뒤에는 한 줄 칩으로 접히고 "검색 열기"로 펼친다. 조건이 없으면 처음부터 펼친다(입력해야 하니까). 칩을 눌러도 펼친다.
export function SearchPanel({ onSubmit, onReset, children, submitLabel = '조회', resetLabel = '초기화', submitDisabled = false, label = '검색 조건', summary }: { readonly onSubmit: (e: FormEvent) => void; readonly onReset: () => void; readonly children: ReactNode; readonly submitLabel?: string; readonly resetLabel?: string; readonly submitDisabled?: boolean; readonly label?: string; readonly summary?: ReadonlyArray<readonly [string, string]> }) {
  const active = (summary ?? []).filter(([, v]) => v !== '');
  const [open, setOpen] = useState(active.length === 0);
  const form = (
    <form
      className={`flex flex-wrap items-end gap-x-5 gap-y-3 rounded-box border border-base-300 bg-base-100 px-4 py-3.5 shadow-sm ${summary ? 'rounded-t-none border-t-0' : ''}`}
      onSubmit={(e) => {
        onSubmit(e);
        if (summary) setOpen(false);
      }}
      aria-label={label}
      data-list-part="top"
      hidden={summary !== undefined && !open}
    >
      {children}
      <div className="ml-auto flex gap-2">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
          {resetLabel}
        </button>
        <button type="submit" className="btn btn-sm btn-primary min-w-20" disabled={submitDisabled}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
  if (!summary) return form;
  return (
    <div data-testid="search-summary-panel">
      <div className={`flex flex-wrap items-center gap-2 rounded-box border border-base-300 bg-base-200/60 px-4 py-2.5 ${open ? 'rounded-b-none' : ''}`}>
        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4" />
          </svg>
          {label}
        </span>
        {summary.map(([k, v]) => (
          <button
            key={k}
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${v ? 'border-primary bg-base-100 text-base-content' : 'border-base-300 bg-base-100 text-base-content/60'}`}
            onClick={() => setOpen(true)}
            data-testid="search-chip"
          >
            <span className="font-semibold">{k}</span>
            <span className={v ? 'text-primary' : ''}>{v || '전체'}</span>
            <span aria-hidden="true">▾</span>
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-xs ml-auto border border-base-300 bg-base-100" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="search-toggle">
          {open ? '검색 닫기 ▴' : '검색 열기 ▾'}
        </button>
      </div>
      {form}
    </div>
  );
}

/** 숫자 띠(목록 맨 위 카드 한 줄, 2026-11-19 관제 형식) */
export function StatStrip({ children, label, testId }: { readonly children: ReactNode; readonly label: string; readonly testId?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" role="group" aria-label={label} data-testid={testId}>
      {children}
    </div>
  );
}

/**
 * 안내 상자(2026-11-19 쿠팡 윙 "반품 정보안내"처럼) — ⓘ 제목 + 글머리 몇 줄, 접기. 이 브라우저에서 접은 것은 기억(화면마다 key).
 * 규칙 문구는 화면이 이미 쓰는 업무 문구만 — 새 규칙을 만들지 않는다.
 */
// tone 'warning' = 올리기 전 주의(쿠팡 윙 일괄등록의 주황 띠처럼)
export function GuideBox({ title, items, storeKey, testId, tone = 'info' }: { readonly title: string; readonly items: readonly ReactNode[]; readonly storeKey: string; readonly testId?: string; readonly tone?: 'info' | 'warning' }) {
  const k = `pmart.backoffice.guide.${storeKey}`;
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(k) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(k, next ? 'open' : 'closed');
    } catch {
      // 저장이 막힌 브라우저 — 이번 화면에서만
    }
  };
  return (
    <div className={`rounded-box border px-5 py-3 ${tone === 'warning' ? 'border-warning/50 bg-warning/10' : 'border-base-300 bg-base-200/50'}`} data-testid={testId}>
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold" aria-expanded={open} onClick={toggle}>
        <span className="inline-flex items-center gap-2">
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${tone === 'warning' ? 'bg-warning text-warning-content' : 'border border-base-content/40'}`} aria-hidden="true">
            {tone === 'warning' ? '!' : 'i'}
          </span>
          {title}
        </span>
        <span className="text-xs text-base-content/50" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-base-content/70">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 다 끝났어요 띠(2026-11-19 쿠팡 윙 배송관리 "수고많으셨습니다! 모든 주문의 발송 처리가 끝났습니다" 참고).
 * 서버가 0건이라고 확인했을 때만 그린다 — 읽는 중·조회 실패에는 그리지 않는다(부르는 쪽이 성공일 때만).
 */
export function AllDone({ title, body, testId = 'all-done' }: { readonly title: string; readonly body?: string; readonly testId?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-box border border-success/30 bg-success/10 px-5 py-3.5" data-testid={testId}>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span>
        <span className="block font-bold">{title}</span>
        {body && <span className="block text-sm text-base-content/65">{body}</span>}
      </span>
    </div>
  );
}
