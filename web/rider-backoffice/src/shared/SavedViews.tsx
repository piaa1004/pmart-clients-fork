// 사본: web/backoffice/src/shared/SavedViews.tsx (main 8b6ba49) — 이 앱에서 따로 고친다.
// 목록 "내 보기"(2026-11-18 사용자 "참고 사이트 조합" — Saleor 대시보드의 저장된 필터 참고).
// 목록 필터는 이미 주소(URL 쿼리)에 있으니, 지금 주소의 조건에 이름을 붙여 저장하고 한 번에 다시 연다.
// 저장은 이 브라우저에만(localStorage — 보는 사람 한 명의 편의, 서버·다른 사람과 나누지 않음). 못 쓰는 환경이면 조용히 빈 목록.
// 개인정보: 주소 쿼리에 연락처 같은 값이 있으면 저장하지 않는다(PII_PARAMS).
import { useState } from 'react';
import { Link, useLocation } from 'react-router';

import { ui } from './uiMessages';

const m = ui.savedViews;
const MAX = 12;
/** 주소에 있어도 내 보기로 저장하지 않는 조건(개인정보·한 건만 가리키는 값) */
const PII_PARAMS = ['phone', 'riderPhone', 'contact', 'q', 'keyword', 'orderNumber'];

export interface SavedView {
  readonly name: string;
  readonly search: string;
}

const storeKey = (listKey: string) => `pmart.rider-backoffice.views.${listKey}`;

export function loadViews(listKey: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(storeKey(listKey));
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v.filter((x: unknown): x is SavedView => {
      if (typeof x !== 'object' || x === null) return false;
      const o = x as Record<string, unknown>;
      return typeof o['name'] === 'string' && typeof o['search'] === 'string';
    });
  } catch {
    return [];
  }
}

function saveViews(listKey: string, views: readonly SavedView[]): void {
  try {
    window.localStorage.setItem(storeKey(listKey), JSON.stringify(views));
  } catch {
    // 저장 못 하는 환경(사생활 보호 창 등) — 이번 화면에서만 보인다
  }
}

/** 저장할 주소 조건 — 쪽(cursor·page)과 개인정보 조건은 뺀다. 남는 게 없으면 빈 문자열 */
export function cleanSearch(search: string): string {
  const p = new URLSearchParams(search);
  for (const k of ['cursor', 'page', 'preview', ...PII_PARAMS]) p.delete(k);
  p.sort();
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function SavedViews({ listKey }: { readonly listKey: string }) {
  const { pathname, search } = useLocation();
  const [views, setViews] = useState<SavedView[]>(() => loadViews(listKey));
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const current = cleanSearch(search);
  const update = (next: SavedView[]) => {
    setViews(next);
    saveViews(listKey, next);
  };
  const add = () => {
    const n = name.trim();
    if (!n || !current) return;
    update([...views.filter((v) => v.name !== n), { name: n, search: current }].slice(-MAX));
    setName('');
    setNaming(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="saved-views" aria-label={m.title}>
      <span className="text-xs font-medium text-base-content/55">{m.title}</span>
      {views.length === 0 && !naming && <span className="text-xs text-base-content/40">{m.empty}</span>}
      {views.map((v) => {
        const on = v.search === current;
        return (
          <span key={v.name} className={`inline-flex items-center rounded-full border text-xs ${on ? 'border-primary bg-primary/10 text-primary' : 'border-base-300 bg-base-100'}`}>
            <Link to={`${pathname}${v.search}`} className="py-1 pl-3 pr-1 font-medium hover:underline" aria-current={on ? 'true' : undefined}>
              {v.name}
            </Link>
            <button type="button" className="px-2 py-1 text-base-content/40 hover:text-error" aria-label={m.remove(v.name)} onClick={() => update(views.filter((x) => x.name !== v.name))}>
              ✕
            </button>
          </span>
        );
      })}
      {naming ? (
        <span className="inline-flex items-center gap-1">
          <input
            className="input input-xs w-36"
            aria-label={m.nameLabel}
            placeholder={m.namePlaceholder}
            value={name}
            maxLength={20}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
              if (e.key === 'Escape') setNaming(false);
            }}
          />
          <button type="button" className="btn btn-primary btn-xs" disabled={!name.trim()} onClick={add}>
            {m.save}
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNaming(false)}>
            {m.cancel}
          </button>
        </span>
      ) : (
        <button type="button" className="btn btn-ghost btn-xs" disabled={!current} title={current ? undefined : m.noFilter} onClick={() => setNaming(true)}>
          {m.add}
        </button>
      )}
    </div>
  );
}
