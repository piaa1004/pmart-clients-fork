// 메뉴 묶음 — 뼈대(2026-11-17, PC 1)는 자리만 둔다. 이름·순서·기능 목록과 화면은 delivery 영역(PC 5)이 정하고 채운다.
// 라이더 운영(RIDER_OPS)은 모든 센터를 보는 역할이라 센터 고르기가 없다(MFC 백오피스와 다르다). 화면을 만들면 그 메뉴의 `ready` 를 true 로.
import { messages as m } from '../shared/messages';

export type MenuKey = keyof typeof m.menus;
export type GroupKey = keyof typeof m.groups;

export interface MenuItem {
  readonly key: MenuKey;
  /** 경로(`/<segment>`) */
  readonly segment: string;
  /** 화면을 만들었다(false 면 "준비 중") */
  readonly ready: boolean;
  /** 서버 API 가 있는 기능 */
  readonly apiReady: readonly string[];
  /** 서버 API 가 아직 없거나 계약만 있는 기능 */
  readonly apiMissing: readonly string[];
  /** 메뉴 목록에는 안 보이고 주소로만 연다(상세 화면이 있는 옛 목록 — 2026-11-19 상담함으로 합침) */
  readonly hidden?: boolean;
  /** 관리자(OPERATOR_ADMIN)에게만 메뉴에 보인다(판정은 서버 — 다른 역할은 403) */
  readonly adminOnly?: boolean;
}

export interface MenuGroup {
  readonly key: GroupKey;
  readonly items: readonly MenuItem[];
}

const done = (key: MenuKey, segment: string): MenuItem => ({ key, segment, ready: true, apiReady: [], apiMissing: [] });

// 2026-11-17(PC 5): 사용자 "추천대로 1~6번" — 대시보드·관제·라이더(찾기·가입 승인·제한 검토)·배송·지원센터(접수 건·도움요청·라이더 문의)·수행료(조정·추가 배달료).
export const navGroups: readonly MenuGroup[] = [
  { key: 'overview', items: [done('dashboard', 'dashboard')] },
  { key: 'control', items: [done('riderMap', 'control')] },
  { key: 'riders', items: [done('riders', 'riders'), done('signups', 'signups'), done('restrictionReviews', 'restriction-reviews')] },
  { key: 'deliveries', items: [done('deliveries', 'deliveries')] },
  // 2026-11-19: 사용자 "라이더문의랑 도움요청이 둘 다 있는 이유" — 상담함 하나로. 옛 두 목록은 상세 주소만 남긴다(hidden). 접수 건은 운영으로.
  { key: 'support', items: [done('consults', 'consults'), { ...done('helpRequests', 'help-requests'), hidden: true }, { ...done('inquiries', 'inquiries'), hidden: true }, done('appeals', 'appeals')] },
  // 2026-11-19: 지급 관리(execution 0.29.0)·소명·이의(rider 0.15.0)
  { key: 'earnings', items: [done('adjustments', 'adjustments'), done('surcharges', 'surcharges'), done('payouts', 'payouts')] },
  // 2026-11-18(PC 5, 백엔드 notification 0.5.0·rider 0.14.0·execution 0.28.0·dispatch 0.11.0): 라이더 공지·직원 조치 이력(관리자만).
  { key: 'ops', items: [done('cases', 'cases'), done('notices', 'notices'), { ...done('staffActions', 'staff-actions'), adminOnly: true }] },
];
export const allMenus: readonly MenuItem[] = navGroups.flatMap((g) => g.items);

export const menuPath = (segment = allMenus[0]!.segment) => `/${segment}`;

/** 이 앱의 주 역할. 없으면 막지 않고 안내만(판정은 서버, API 마다 403) */
export const RIDER_APP_ROLES: readonly string[] = ['RIDER_OPS', 'OPERATOR_ADMIN'];
export const hasRiderAppRole = (roles: readonly string[]) => roles.some((r) => RIDER_APP_ROLES.includes(r));

/** 운영 관리자 */
export const isOperatorAdmin = (roles: readonly string[]) => roles.includes('OPERATOR_ADMIN');

/** 이 직원에게 보일 메뉴 묶음(관리자 전용 메뉴는 관리자에게만 — 비면 묶음도 뺀다) */
export const visibleGroups = (roles: readonly string[]): readonly MenuGroup[] =>
  navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden && (!i.adminOnly || isOperatorAdmin(roles))) }))
    .filter((g) => g.items.length > 0);
