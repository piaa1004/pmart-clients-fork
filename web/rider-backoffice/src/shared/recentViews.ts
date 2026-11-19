// 사본: web/backoffice/src/shared/recentViews.ts (main 06afd68) — 이 앱에서 따로 고친다(앱 경로를 아는 부품, 지침 §0 "각 앱에 사본").
// 이 앱은 목록 줄의 "최근 봄" 표시에만 쓴다(최근 본 항목 목록 화면은 없다) — 그래서 이름(label)도 남기지 않고 상세 주소와 본 시각만.
// 이 브라우저에만, 로그인한 직원마다 따로 8개까지. 시스템 ID 가 든 주소지만 화면에 보이지 않고, 이름·전화 같은 개인정보는 없다.
// 저장이 막힌 브라우저(사생활 보호 창 등)에서는 조용히 아무것도 남기지 않는다 — 화면은 그대로 동작. 토큰은 여기 두지 않는다(BR-03).
import { useEffect, useState } from 'react';

import { useSession } from '../app/SessionContext';

interface RecentEntry {
  readonly path: string;
  readonly at: number;
}

const MAX = 8;
const EVENT = 'pmart:rider-recent-views';
const keyOf = (subject: string) => `pmart.rider-backoffice.recent.${subject}`;

function readRecent(subject: string): RecentEntry[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(keyOf(subject)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is RecentEntry => typeof e === 'object' && e !== null && typeof (e as RecentEntry).path === 'string' && typeof (e as RecentEntry).at === 'number');
  } catch {
    return [];
  }
}

function write(subject: string, list: readonly RecentEntry[]) {
  try {
    window.localStorage.setItem(keyOf(subject), JSON.stringify(list));
  } catch {
    /* 저장이 막힌 브라우저 — 남기지 않는다 */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** 상세 화면에서 부른다 — 서버 응답을 받은 뒤(ready) 한 번 남긴다 */
export function useRecordRecent(path: string, ready: boolean) {
  const subject = useSession().session?.subject;
  useEffect(() => {
    if (!subject || !path || !ready) return;
    const rest = readRecent(subject).filter((e) => e.path !== path);
    write(subject, [{ path, at: Date.now() }, ...rest].slice(0, MAX));
  }, [subject, path, ready]);
}

/** 최근 열어 본 상세 주소(목록에서 "최근 봄" 표시) — 다른 탭·화면에서 바뀌어도 따라간다 */
export function useSeenPaths(): ReadonlySet<string> {
  const subject = useSession().session?.subject ?? '';
  const [items, setItems] = useState(() => (subject ? readRecent(subject) : []));
  useEffect(() => {
    const sync = () => setItems(subject ? readRecent(subject) : []);
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [subject]);
  return new Set(items.map((e) => e.path));
}
