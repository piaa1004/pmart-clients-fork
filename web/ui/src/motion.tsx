// 공용(2026-11-19 PC 2 web-common — 직원 웹 UI·UX 맞추기, docs/handoff/all/2026-11-19-request-ui-ux-align.md). 처음 자리: web/backoffice/src/shared/motion.tsx
// 움직임 효과 공통(2026-11-19 사용자 "이런 효과를 넣을 만한 곳 — 다 넣어"). 원칙: 지금 일이 벌어지고 있거나 방금 바뀐 곳에만.
// 바뀜 판단은 서버가 준 값의 변화만 본다(화면이 숫자를 만들지 않는다). 움직임 줄이기 설정이면 CSS 가 끈다(index.css).
import { type ReactNode, useEffect, useRef, useState } from 'react';

const CHANGE_MS = 4_000;
const NEW_MS = 5_000;

/** 숫자가 방금 바뀌었는지와 얼마나(처음 값은 바뀜이 아니다). 4초 뒤 사라진다 */
export function useChangeDelta(n: number | undefined): { readonly delta: number; readonly changed: boolean } {
  const prev = useRef<number | undefined>(undefined);
  const [delta, setDelta] = useState(0);
  useEffect(() => {
    if (n === undefined) return;
    const before = prev.current;
    prev.current = n;
    if (before === undefined || before === n) return;
    setDelta(n - before);
    const t = setTimeout(() => setDelta(0), CHANGE_MS);
    return () => clearTimeout(t);
  }, [n]);
  return { delta, changed: delta !== 0 };
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * 목록에 새로 들어온 ID — 5초 동안만. 처음 읽은 목록은 새것이 아니다.
 * scope(탭·거르기 등)가 바뀌면 처음부터 다시 센다(탭을 바꿨다고 줄이 다 "새로"가 되지 않게).
 */
export function useNewIds(ids: readonly string[] | undefined, scope = ''): ReadonlySet<string> {
  const seen = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(EMPTY);
  const key = ids?.join('|');
  useEffect(() => {
    if (!ids) return;
    if (seen.current === null || seen.current.scope !== scope) {
      seen.current = { scope, ids: new Set(ids) };
      setFresh(EMPTY);
      return;
    }
    const known = seen.current.ids;
    const added = ids.filter((id) => !known.has(id));
    for (const id of ids) known.add(id);
    if (added.length > 0) setFresh(new Set(added));
    // key·scope 가 바뀔 때만(같은 목록을 다시 받으면 그대로)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope]);
  useEffect(() => {
    if (fresh.size === 0) return;
    const t = setTimeout(() => setFresh(EMPTY), NEW_MS);
    return () => clearTimeout(t);
  }, [fresh]);
  return fresh;
}

/** 지금 시각(표시용 남은 시간 셈) — intervalMs 마다 다시 그린다 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** "12" "50+" 같은 칸 글자에서 숫자(못 읽음 "?"·읽는 중 "…" 은 undefined) */
export const numberOf = (v: unknown): number | undefined => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/,/g, '');
  return /^\d+/.test(t) ? Number.parseInt(t, 10) : undefined;
};

/** 방금 바뀐 만큼(▲3 / ▼1) — 4초 뒤 사라진다. 숫자 자체가 읽히므로 화면 읽기 프로그램에는 숨긴다 */
export function DeltaBadge({ delta }: { readonly delta: number }) {
  if (delta === 0) return null;
  return (
    <span className="ml-1.5 align-middle text-xs font-semibold text-primary" aria-hidden="true" data-testid="stat-delta">
      {delta > 0 ? '▲' : '▼'}
      {Math.abs(delta)}
    </span>
  );
}

/** 숫자 칸 하나의 바뀜 — 칸에 붙일 class 와 ▲▼ 표시 */
export function useStatChange(value: unknown): { readonly cls: string; readonly badge: ReactNode } {
  const { delta, changed } = useChangeDelta(numberOf(value));
  return { cls: changed ? 'stat-changed' : '', badge: <DeltaBadge delta={delta} /> };
}
