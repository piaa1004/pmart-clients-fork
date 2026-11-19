// 사본: web/backoffice/src/shared/StickyTitle.tsx (main a28b21a) — 이 앱에서 따로 고친다. web-ui 로 옮겨질 예정(지침 §0).
// 상세 제목 띠(2026-11-19 "계속 넣어") — 상세를 내려 제목 카드가 화면 밖으로 나가면 위에 얇은 띠(제목·배지·맨 위로)가 붙는다.
// 단추(명령)는 띠에 복제하지 않는다 — 같은 명령 단추가 둘이 되면 상태가 갈린다. 띠는 앱 틀의 자리(#detail-bar-slot)에 그린다.
// IntersectionObserver 가 없는 곳(시험 환경 등)에서는 띠를 그리지 않는다.
import { type ReactNode, type RefObject, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { ui } from './uiMessages';

export const DETAIL_BAR_SLOT = 'detail-bar-slot';

/** 제목 카드가 위로 지나갔나(아래로 내려 화면 밖) */
export function useScrolledPast(ref: RefObject<HTMLElement | null>): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPast(!!e && !e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return past;
}

export function StickyTitle({ show, title, badges }: { readonly show: boolean; readonly title: ReactNode; readonly badges?: ReactNode }) {
  const slot = typeof document === 'undefined' ? null : document.getElementById(DETAIL_BAR_SLOT);
  if (!show || !slot) return null;
  return createPortal(
    <div className="flex items-center gap-3 border-b border-base-300 bg-base-100/95 px-6 py-2 shadow-sm backdrop-blur" data-testid="sticky-title">
      <p className="min-w-0 truncate text-sm font-semibold">{title}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{badges}</div>
      <button
        type="button"
        className="btn btn-ghost btn-xs ml-auto shrink-0"
        onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}
      >
        {ui.chrome.toTop}
      </button>
    </div>,
    slot,
  );
}
