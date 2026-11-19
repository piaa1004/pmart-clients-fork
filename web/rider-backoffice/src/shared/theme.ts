// 사본: web/backoffice/src/shared/theme.ts (main a7cbe71) — 이 앱에서 따로 고친다. 고른 테마(보는 사람 한 명의 편의)만 이 브라우저에 — 토큰·개인정보는 두지 않는다(BR-03).
// 밝은/어두운 테마(2026-11-18). 고른 값은 이 브라우저에만(보는 사람 한 명의 편의) — 못 쓰는 환경이면 밝은 테마.
// 시작할 때(main.tsx) 그리기 전에 한 번 붙여 깜빡임을 막는다.
import { useState } from 'react';

export type Theme = 'pmart' | 'pmart-dark';
const KEY = 'pmart.rider-backoffice.theme';

export function readTheme(): Theme {
  try {
    return window.localStorage.getItem(KEY) === 'pmart-dark' ? 'pmart-dark' : 'pmart';
  } catch {
    return 'pmart';
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
}

export function useTheme(): readonly [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const toggle = () => {
    const next: Theme = theme === 'pmart' ? 'pmart-dark' : 'pmart';
    applyTheme(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* 기억만 못 할 뿐 바꾸기는 된다 */
    }
    setTheme(next);
  };
  return [theme, toggle];
}
