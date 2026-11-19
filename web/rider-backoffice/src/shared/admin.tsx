// 사본: web/backoffice/src/shared/admin.tsx (main 87c0403) — 이 앱에서 따로 고친다. 모양만인 부품은 web-ui 로 옮겨질 예정(지침 all/2026-11-19-request-ui-ux-align §0).
// (원래 이 앱 admin.tsx(PR #93)를 통합 백오피스가 베껴 다듬은 것을 2026-11-19 다시 가져왔다 — 세 직원 웹이 같은 느낌이 되게.)
// 운영 관리자 화면 공통 부품(2026-11-18, PC 5 — 사용자 "배민 장보기·쇼핑 관리자 가이드의 화면 구성 참고").
// - 쪽 머리말: 제목 + 한 줄 설명 + 오른쪽 동작
// - 검색 조건: 목록 카드 맨 위 필터 줄(항목명은 칸 위에 작게, [초기화][조회] 오른쪽) → 결과 줄 → 표가 한 카드로(index.css data-list-part). summary 를 주면 조건을 건 뒤 칩 한 줄로 접힌다
// - 표: 옅은 머리줄, 줄 전체 누르면 상세
// - 상세: 제목·표시·요약 + 오른쪽 동작 버튼(내리면 위에 제목 띠), 목록 순서대로 이전·다음, 그 아래 구역 상자
// - 숫자 카드(세로형·가로형), 안내 상자(GuideBox), 다 끝났어요 띠(AllDone)
// 이 앱에서 다른 점: 쪽 제목 옆 묶음 아이콘 없음(본문 겉모습 wing 에서도 숨긴다), DetailHeader 에 이전·다음(QueueNav)·최근 봄 기록(seen).
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { useStatChange } from './motion';
import { useRecordRecent } from './recentViews';
import { StickyTitle, useScrolledPast } from './StickyTitle';
import { QueueNav } from './workQueue';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent' | 'ghost';

const toneClass: Record<Tone, string> = {
  neutral: 'badge-neutral badge-soft',
  info: 'badge-info badge-soft',
  success: 'badge-success badge-soft',
  warning: 'badge-warning badge-soft',
  error: 'badge-error badge-soft',
  accent: 'badge-accent badge-soft',
  ghost: 'badge-ghost',
};

/** 상태 표시(작은 둥근 꼬리표) */
export function StatusBadge({ tone = 'ghost', children, testId }: { readonly tone?: Tone; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <span className={`badge badge-sm gap-1.5 whitespace-nowrap font-medium ${toneClass[tone]}`} data-testid={testId}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * 목록 줄 전체를 누르면 상세로(2026-11-18 사용자 작업 따라 해 보기 — "굵은 제목은 안 눌리고 작은 번호만 눌린다").
 * 줄 안의 링크·버튼·입력·체크박스를 누르면 그쪽 동작만. 키보드는 줄 안의 링크(번호)로 그대로 간다.
 */
export function useRowLink() {
  const navigate = useNavigate();
  return (to: string) => ({
    className: 'cursor-pointer',
    onClick: (e: { readonly target: EventTarget | null }) => {
      if (e.target instanceof Element && e.target.closest('a,button,input,select,textarea,label,summary')) return;
      void navigate(to);
    },
  });
}

/** 쪽 머리말 — h1 은 화면마다 하나 */
export function PageHeader({ title, description, actions, back }: { readonly title: ReactNode; readonly description?: ReactNode; readonly actions?: ReactNode; readonly back?: { readonly to: string; readonly label: string } }) {
  return (
    <header className="space-y-1">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">
          <span aria-hidden>‹</span>
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-bold tracking-tight">{title}</h1>
            {/* 설명은 한 줄만 — 누르면 다 보인다(2026-11-18 사용자 "설명이 많아 값이 묻힌다") */}
            {description && (
              <details className="group max-w-3xl text-sm text-base-content/60">
                <summary className="line-clamp-1 cursor-pointer list-none group-open:line-clamp-none hover:text-base-content/80">{description}</summary>
              </details>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

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
            // 이 앱: 칩 이름이 거르기 값으로 끝나면 그 값 이름의 단추로 오해된다(예: "승인") — 칩은 "… 조건 바꾸기"로 읽힌다
            aria-label={`${k} ${v || '전체'} 조건 바꾸기`}
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

/** 검색 조건 한 줄 */
export function SearchRow({ label, children }: { readonly label: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-xs font-medium text-base-content/55">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** 칩 모양 하나 고르기(상태·종류 등) */
/** count 를 주면 이름 옆에 작게(2026-11-18 — 서버가 센 값만, 읽기 도구에는 이름만) */
export function ChipGroup<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: string; readonly count?: string | undefined }>; readonly onChange: (v: T) => void; readonly label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`btn btn-xs rounded-full px-3 ${o.value === value ? 'btn-neutral' : 'border-base-300 bg-base-100 font-normal'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={`ml-1 tabular-nums ${o.value === value ? 'opacity-70' : 'text-base-content/50'}`} aria-hidden="true" data-testid={`chip-count-${o.value}`}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** 결과 줄: 건수 + 정렬 토글 */
export function ResultBar({ count, more, sort, extra }: { readonly count: number; readonly more?: boolean; readonly sort?: { readonly oldest: boolean; readonly onChange: (oldest: boolean) => void; readonly newest?: string; readonly oldestLabel?: string }; readonly extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 bg-base-100 px-4 py-2.5 shadow-sm" data-list-part="mid">
      <p className="text-sm" data-testid="result-count">
        <span className="font-semibold text-primary">{count}</span>
        {more ? '건 이상' : '건'}
      </p>
      <div className="flex items-center gap-3">
        {extra}
        {sort && (
          <div role="radiogroup" aria-label="정렬" className="flex items-center gap-2 text-sm">
            <button type="button" role="radio" aria-checked={!sort.oldest} className={!sort.oldest ? 'font-semibold' : 'text-base-content/50'} onClick={() => sort.onChange(false)}>
              {sort.newest ?? '최신순'}
            </button>
            <span className="text-base-content/30">|</span>
            <button type="button" role="radio" aria-checked={sort.oldest} className={sort.oldest ? 'font-semibold' : 'text-base-content/50'} onClick={() => sort.onChange(true)}>
              {sort.oldestLabel ?? '과거순'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 표 상자 — 머리줄은 옅은 작은 글씨, 줄은 넉넉히, 첫 칸은 굵게(목록의 주인공), 링크는 밑줄 없이 */
export function DataTable({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100 shadow-sm" data-testid={testId} data-list-part="table">
      <table className="table [&_tbody_td:first-child]:font-medium [&_tbody_td]:py-3 [&_tbody_tr:hover]:bg-base-200/60 [&_tbody_tr]:border-base-300/70 [&_td_a.link]:no-underline [&_td_a.link]:text-primary [&_td_a.link:hover]:underline [&_thead_th]:bg-base-200/50 [&_thead_th]:text-xs [&_thead_th]:font-medium [&_thead_th]:text-base-content/50">{children}</table>
    </div>
  );
}

/** 쪽 넘기기(커서) — 처음으로 / 다음 */
export function CursorPager({ hasPrev, nextCursor, onFirst, onNext, page }: { readonly hasPrev: boolean; readonly nextCursor: string | null | undefined; readonly onFirst: () => void; readonly onNext: (cursor: string) => void; readonly page?: number }) {
  if (!hasPrev && !nextCursor) return null;
  return (
    <nav aria-label="쪽" className="flex items-center justify-center gap-2">
      <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={!hasPrev} onClick={onFirst}>
        « 처음으로
      </button>
      {page !== undefined && <span className="px-2 text-sm text-base-content/60">{page}쪽</span>}
      <button type="button" className="btn btn-sm border-base-300 bg-base-100" disabled={!nextCursor} onClick={() => nextCursor && onNext(nextCursor)}>
        다음 ›
      </button>
    </nav>
  );
}

/** 상세 머리: 제목 + 표시 + 요약, 오른쪽 동작 */
// seen: 서버에서 이 건을 읽었다 — 그때 이 상세 주소를 '최근 봄'으로 남긴다(목록 줄 표시, shared/recentViews)
export function DetailHeader({ back, title, badges, summary, actions, seen = false }: { readonly back: { readonly to: string; readonly label: string }; readonly title: ReactNode; readonly badges?: ReactNode; readonly summary?: ReactNode; readonly actions?: ReactNode; readonly seen?: boolean }) {
  // 제목 카드가 화면 위로 지나가면 위에 얇은 제목 띠(2026-11-19)
  const card = useRef<HTMLDivElement>(null);
  const past = useScrolledPast(card);
  const { pathname } = useLocation();
  useRecordRecent(pathname, seen);
  return (
    <header className="space-y-2">
      <StickyTitle show={past} title={title} badges={badges} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">
          <span aria-hidden>‹</span>
          {back.label}
        </Link>
        {/* 목록 순서대로 이전·n/N·다음([ ] 키) — 마지막으로 본 목록에 이 건이 있을 때만 */}
        <QueueNav />
      </div>
      <div ref={card} className="flex flex-wrap items-start justify-between gap-3 rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{title}</h1>
            {badges}
          </div>
          {summary && <p className="text-sm text-base-content/70">{summary}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** 구역으로 가는 밑줄 탭(같은 쪽 안 이동) */
export function SectionTabs({ items }: { readonly items: ReadonlyArray<{ readonly id: string; readonly label: string }> }) {
  return (
    <nav aria-label="구역" className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-base-300 bg-base-200/95 px-1 backdrop-blur">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-base-content/70 hover:border-base-content/40 hover:text-base-content">
          {i.label}
        </a>
      ))}
    </nav>
  );
}

/** 구역 상자 — 제목 줄(오른쪽 덧붙임) + 내용 */
export function Section({ id, title, aside, children, testId }: { readonly id?: string; readonly title: ReactNode; readonly aside?: ReactNode; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <section id={id} className="scroll-mt-12 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm" data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b border-base-300 bg-base-200/40 px-5 py-3">
        <h2 className="font-bold">{title}</h2>
        {aside && <div className="flex items-center gap-2 text-sm">{aside}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** 항목명/값 줄 묶음 */
export function FieldList({ rows, testId }: { readonly rows: ReadonlyArray<readonly [ReactNode, ReactNode] | false | null | undefined>; readonly testId?: string }) {
  return (
    // 상세 항목(2026-11-18): 이름은 위에 작게, 값은 아래 굵게 — 넓으면 2~3칸으로(Shopify 상세처럼)
    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3" data-testid={testId}>
      {rows.map((r, i) =>
        r ? (
          <div key={i} className="min-w-0 space-y-0.5">
            <dt className="text-xs text-base-content/50">{r[0]}</dt>
            <dd className="min-w-0 break-words font-medium">{r[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

/**
 * 통계 카드 — 관제 형식(2026-11-19 사용자가 보여 준 배송 관제 화면): 왼쪽 색 막대 + 이름 + 큰 숫자 + 설명 한 줄.
 * 색은 tone 이 있을 때만(0 이거나 평범하면 회색 막대). active 면 지금 고른 거르기라는 테두리.
 */
// layout 'row'(2026-11-19 쿠팡 윙 가격관리 참고): 이름·도움말 왼쪽, 큰 숫자 오른쪽. 기본 'stack' 은 이름 아래 숫자
export function StatCard({ label, value, hint, to, tone, testId, active = false, layout = 'stack' }: { readonly label: ReactNode; readonly value: ReactNode; readonly hint?: ReactNode; readonly to?: string; readonly tone?: 'warning' | 'error' | 'info' | 'success' | undefined; readonly testId?: string; readonly active?: boolean; readonly layout?: 'stack' | 'row' }) {
  const bar = tone ? { error: 'bg-error', warning: 'bg-warning', info: 'bg-info', success: 'bg-success' }[tone] : 'bg-base-300';
  const ch = useStatChange(value); // 방금 바뀐 칸만 잠깐 빛남 + ▲▼(2026-11-19)
  const valueCls = tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : '';
  const body =
    layout === 'row' ? (
      <>
        <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden="true" />
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{label}</span>
            {hint && <span className="mt-0.5 block text-[11px] text-base-content/50">{hint}</span>}
          </span>
          <span className={`shrink-0 text-3xl font-bold leading-none tabular-nums ${valueCls}`}>
            {value}
            {ch.badge}
          </span>
        </span>
      </>
    ) : (
    <>
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden="true" />
      <p className="text-xs font-medium text-base-content/60">{label}</p>
      <p className={`text-2xl font-bold leading-tight tabular-nums ${tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : ''}`}>
        {value}
        {ch.badge}
      </p>
      {hint && <p className="text-[11px] text-base-content/50">{hint}</p>}
    </>
  );
  // 고른 카드: 테두리 + 옅은 바탕(쿠팡 윙처럼 어느 상태를 보는지 한눈에)
  const cls = `relative block space-y-0.5 overflow-hidden rounded-box border py-3 pl-4 pr-3 shadow-sm ${layout === 'row' ? 'min-h-20 py-4' : ''} ${active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-base-300 bg-base-100'} ${ch.cls}`;
  return to ? (
    <Link to={to} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`} data-testid={testId} aria-current={active ? 'true' : undefined}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid={testId}>
      {body}
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

/** 숫자 칸 글자 — 서버 개수(50 넘으면 "N+"), 읽는 중 "…", 못 읽음 "?"(0 이 아님) */
export const countCell = (q: { readonly data?: { readonly n: number; readonly more: boolean } | undefined; readonly isError: boolean }): string => (q.data ? `${q.data.n}${q.data.more ? '+' : ''}` : q.isError ? '?' : '…');

/**
 * 다음 할 일 — 상세 화면 맨 위에 하나만(2026-11-18 사용자 "지금 뭘 해야 하는지 안 보인다").
 * 무엇을 보일지는 화면이 서버 상태로만 고른다(클라이언트가 판정을 새로 만들지 않는다). 할 일이 없으면 그리지 않는다.
 */
export function NextAction({ tone = 'info', title, body, children, testId = 'next-action' }: { readonly tone?: 'info' | 'warning' | 'error' | 'success'; readonly title: ReactNode; readonly body?: ReactNode; readonly children?: ReactNode; readonly testId?: string }) {
  const bar = { info: 'border-l-info', warning: 'border-l-warning', error: 'border-l-error', success: 'border-l-success' }[tone];
  const dot = { info: 'bg-info/15 text-info', warning: 'bg-warning/15 text-warning', error: 'bg-error/15 text-error', success: 'bg-success/15 text-success' }[tone];
  return (
    <section aria-label="다음 할 일" className={`flex flex-wrap items-center gap-4 rounded-box border border-l-4 border-base-300 ${bar} bg-base-100 px-5 py-4 shadow-sm`} data-testid={testId}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${dot}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14m-5-5 5 5-5 5" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-base-content/50">다음 할 일</p>
        <p className="font-semibold">{title}</p>
        {body && <p className="text-sm text-base-content/65">{body}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </section>
  );
}

/** 코드 값 — 한국어 이름을 보이고 원래 코드는 마우스를 올리면(이름이 없으면 코드 그대로) */
export function CodeLabel({ code, names }: { readonly code: string; readonly names: Readonly<Record<string, string>> }) {
  const name = names[code];
  return name ? <span title={code}>{name}</span> : <span className="font-mono text-xs">{code}</span>;
}

/** 안내 상자(회색) — 화면 맨 위 설명·서버 대기 안내 */
export function Notice({ children, tone = 'muted' }: { readonly children: ReactNode; readonly tone?: 'muted' | 'warning' }) {
  return (
    <p role="note" className={`rounded-box px-4 py-3 text-sm ${tone === 'warning' ? 'bg-warning/15' : 'bg-base-300/50 text-base-content/75'}`}>
      {children}
    </p>
  );
}

/**
 * 안내 상자(2026-11-19 쿠팡 윙 "반품 정보안내"처럼) — ⓘ 제목 + 글머리 몇 줄, 접기. 이 브라우저에서 접은 것은 기억(화면마다 key).
 * 규칙 문구는 화면이 이미 쓰는 업무 문구만 — 새 규칙을 만들지 않는다.
 */
// tone 'warning' = 올리기 전 주의(쿠팡 윙 일괄등록의 주황 띠처럼)
export function GuideBox({ title, items, storeKey, testId, tone = 'info' }: { readonly title: string; readonly items: readonly ReactNode[]; readonly storeKey: string; readonly testId?: string; readonly tone?: 'info' | 'warning' }) {
  const k = `pmart.rider-backoffice.guide.${storeKey}`;
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
