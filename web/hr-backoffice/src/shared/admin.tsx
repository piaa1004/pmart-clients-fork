// 사본: web/backoffice/src/shared/admin.tsx (2026-11-18 인사팀 백오피스에 같은 화면 규칙 — 사용자 "인사 쪽도 적용") — 이 앱에서 따로 고친다.
// 다른 점: 메뉴 묶음이 하나(인사)라 쪽 제목 아이콘은 늘 사람 모양.
// 운영 관리자 화면 공통 부품(2026-11-18, PC 5 — 사용자 "배민 장보기·쇼핑 관리자 가이드의 화면 구성 참고").
// 참고한 구성: 배민 주문접수 주문내역(목록 카드 + 상세 구역 상자), 셀프서비스 가게관리(밑줄 탭 + 구역 상자, 제목 오른쪽 안내).
// - 쪽 머리말: 제목 + 한 줄 설명 + 오른쪽 동작
// - 검색 조건 상자: 왼쪽 회색 항목명 칸 + 입력, 아래 [초기화][조회]
// - 결과 줄: "N건" + 최신순/과거순 토글
// - 표: 회색 머리줄, 줄 전체 누르면 상세
// - 상세: 제목·표시·요약 + 오른쪽 동작 버튼, 그 아래 구역 상자(제목 줄 + 항목명/값 줄), 구역으로 가는 밑줄 탭
// 목록 부품 SearchPanel·StatStrip 는 공용(@pmart/web-ui listParts, 2026-11-19)으로 옮김 — 이 파일에서 그대로 가져다 쓰게 다시 내보낸다
export { SearchPanel, StatStrip } from '@pmart/web-ui';
import { useStatChange } from './motion';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

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
          {/* 쪽 제목 아이콘 — 왼쪽 메뉴 묶음과 같은 아이콘(2026-11-18 화면 다듬기) */}
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6.5 6.5 0 0 0-2.5-5.1" />
            </svg>
          </span>
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
export function ChipGroup<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>; readonly onChange: (v: T) => void; readonly label: string }) {
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
        </button>
      ))}
    </div>
  );
}

/** 결과 줄: 건수 + 정렬 토글 */
/** unit: 세는 말(직원은 "명") */
export function ResultBar({ count, more, sort, extra, unit = '건' }: { readonly count: number; readonly more?: boolean; readonly unit?: string; readonly sort?: { readonly oldest: boolean; readonly onChange: (oldest: boolean) => void; readonly newest?: string; readonly oldestLabel?: string }; readonly extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 bg-base-100 px-4 py-2.5 shadow-sm" data-list-part="mid">
      <p className="text-sm" data-testid="result-count">
        <span className="font-semibold text-primary">{count}</span>
        {more ? `${unit} 이상` : unit}
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
export function DetailHeader({ back, title, badges, summary, actions }: { readonly back: { readonly to: string; readonly label: string }; readonly title: ReactNode; readonly badges?: ReactNode; readonly summary?: ReactNode; readonly actions?: ReactNode }) {
  return (
    <header className="space-y-2">
      <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-base-content/60 hover:text-base-content">
        <span aria-hidden>‹</span>
        {back.label}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
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
export function StatCard({ label, value, hint, to, tone, testId, active = false }: { readonly label: ReactNode; readonly value: ReactNode; readonly hint?: ReactNode; readonly to?: string; readonly tone?: 'warning' | 'error' | 'info' | 'success' | undefined; readonly testId?: string; readonly active?: boolean }) {
  const bar = tone ? { error: 'bg-error', warning: 'bg-warning', info: 'bg-info', success: 'bg-success' }[tone] : 'bg-base-300';
  const ch = useStatChange(value); // 방금 바뀐 칸만 잠깐 빛남 + ▲▼(2026-11-19)
  const body = (
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
  const cls = `relative block space-y-0.5 overflow-hidden rounded-box border bg-base-100 py-3 pl-4 pr-3 shadow-sm ${active ? 'border-primary ring-1 ring-primary/30' : 'border-base-300'} ${ch.cls}`;
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
