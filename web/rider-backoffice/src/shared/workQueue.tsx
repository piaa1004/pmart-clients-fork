// 사본: web/backoffice/src/shared/workQueue.tsx (main 0ae6764) — 이 앱에서 따로 고친다(앱 경로를 아는 부품, 지침 §0 "각 앱에 사본").
// 목록 순서대로 상세 넘기기 — 처리할 일을 차례로 볼 때 목록으로 돌아가지 않게.
// 이 앱은 상담함처럼 한 목록에 여러 종류(도움요청·문의·배송)가 섞여 있어, 종류 대신 "마지막으로 본 목록의 상세 주소 순서"
// 하나만 이 탭에(sessionStorage) 기억한다. 상세(DetailHeader)는 지금 주소가 그 안에 있으면 "‹ 이전 · 3 / 12 · 다음 ›"을 보인다.
// 순서는 마지막으로 본 목록 그대로 — 서버 상태가 아니다(열면 상세가 서버의 지금 상태를 보인다).
// 저장하는 것은 상세 주소와 목록 주소뿐(이름·연락처 없음, 찾기 말은 뺀다). 저장이 막힌 브라우저면 조용히 띠를 그리지 않는다.
import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { ui } from './uiMessages';

const m = ui.queue;
const KEY = 'pmart.rider-backoffice.queue';
/** 목록 주소에 있어도 기억하지 않는 조건(찾기 말·연락처) */
const PII_PARAMS = ['phone', 'riderPhone', 'contact', 'q', 'keyword', 'orderNumber'];

/** 목록 주소에서 찾기 말·연락처 조건을 뺀다 — 빼면 '보던 목록으로'는 조건 없는 목록으로 간다 */
export function safeFrom(from: string): string {
  const [path = '', query = ''] = from.split('?');
  const p = new URLSearchParams(query);
  for (const k of PII_PARAMS) p.delete(k);
  const rest = p.toString();
  return rest ? `${path}?${rest}` : path;
}

interface Queue {
  readonly paths: readonly string[];
  readonly from: string;
}

function read(): Queue | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.paths) || typeof o.from !== 'string') return null;
    return { paths: o.paths.filter((x): x is string => typeof x === 'string'), from: o.from };
  } catch {
    return null;
  }
}

/** 목록: 지금 보이는 순서(상세 주소)를 기억 — 바뀔 때만 쓴다 */
export function useRememberQueue(paths: readonly string[] | undefined) {
  const { pathname, search } = useLocation();
  const from = `${pathname}${search}`;
  const key = paths?.join('|');
  useEffect(() => {
    if (!paths || paths.length === 0) return;
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ paths, from: safeFrom(from) }));
    } catch {
      // 저장이 막힌 브라우저 — 띠 없이 동작
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, from]);
}

/** 상세: 기억한 목록 안에 지금 주소가 있으면 이전·다음 띠. [ · ] 키로도 넘긴다 */
export function QueueNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const q = useMemo(() => read(), []);
  const at = q ? q.paths.indexOf(pathname) : -1;
  const prev = q && at > 0 ? q.paths[at - 1] : undefined;
  const next = q && at >= 0 && at < q.paths.length - 1 ? q.paths[at + 1] : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '[' && prev) void navigate(prev);
      else if (e.key === ']' && next) void navigate(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, navigate]);
  if (!q || at < 0 || q.paths.length < 2) return null;
  const btn = 'btn btn-ghost btn-xs';
  return (
    <nav aria-label={m.label} className="flex flex-wrap items-center justify-end gap-1 text-xs text-base-content/60" data-testid="queue-nav">
      <Link to={q.from} className="mr-auto hover:text-base-content">
        {m.backToList}
      </Link>
      {prev ? (
        <Link to={prev} className={btn} title={`${m.prev} ([)`} data-testid="queue-prev">
          ‹ {m.prev}
        </Link>
      ) : (
        <span className={`${btn} btn-disabled`} aria-disabled="true">
          ‹ {m.prev}
        </span>
      )}
      <span className="tabular-nums" data-testid="queue-pos">
        {m.position(at + 1, q.paths.length)}
      </span>
      {next ? (
        <Link to={next} className={btn} title={`${m.next} (])`} data-testid="queue-next">
          {m.next} ›
        </Link>
      ) : (
        <span className={`${btn} btn-disabled`} aria-disabled="true">
          {m.next} ›
        </span>
      )}
    </nav>
  );
}
