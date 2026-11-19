// 라이더 백오피스 뼈대(2026-11-17, PC 1): 직원 로그인·세션·메뉴 자리. 메뉴 화면(관제 등)은 delivery 영역(PC 5)이 채운다.
import { UiTextProvider } from '@pmart/web-ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { createBrowserRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router';

import { env } from '../env';
import { CasesMenu } from '../features/cases/CasePages';
import { ControlPage } from '../features/control/ControlPage';
import { ControlSearch } from '../features/control/ControlSearch';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AdjustmentsMenu, SurchargesMenu } from '../features/earnings/EarningPages';
import { PayoutsMenu } from '../features/earnings/PayoutPages';
import { AppealsMenu } from '../features/support/AppealPages';
import { NoticesMenu } from '../features/ops/NoticePages';
import { StaffActionsMenu } from '../features/ops/StaffActionsPage';
import { RestrictionReviewsMenu, RidersMenu, SignupsMenu } from '../features/riders/RiderPages';
import { ConsultsMenu, HelpRequestsMenu, InquiriesMenu } from '../features/support/SupportPages';
import { DeliveriesMenu } from '../features/deliveries/DeliveryPages';
import { PreparingPage } from '../features/menus/PreparingPage';
import { LoginCallbackPage, LoginPage } from '../features/session/LoginPage';
import { SessionPage } from '../features/session/SessionPage';
import { messages as m } from '../shared/messages';
import { StaffName } from '../shared/displayNumbers';
import { Icon, type IconName } from '../shared/icons';
import { SimulatorLink } from '../shared/sim';
import { allMenus, hasRiderAppRole, isOperatorAdmin, menuPath, navGroups, visibleGroups, type GroupKey, type MenuItem } from './nav';
import { RequireSession, SessionProvider, useSession } from './SessionContext';

/** 지금 주소의 메뉴(머리줄 "묶음 › 메뉴") */
function useCurrentMenu() {
  const { pathname } = useLocation();
  const seg = pathname.split('/')[1] ?? '';
  const group = navGroups.find((g) => g.items.some((i) => i.segment === seg));
  const item = group?.items.find((i) => i.segment === seg);
  return group && item ? { group: m.groups[group.key], menu: m.menus[item.key] } : null;
}

/** 메뉴 묶음 아이콘(카페24 관리자처럼 묶음마다 하나) */
const groupIcon: Record<GroupKey, IconName> = {
  overview: 'home',
  control: 'radar',
  riders: 'rider',
  deliveries: 'truck',
  support: 'headset',
  earnings: 'won',
  ops: 'megaphone',
};

/**
 * 메뉴 접기 — 화면 틀(Layout)은 메뉴를 옮겨도 그대로라 이 창에서 계속 유지된다.
 * 브라우저 저장소에는 두지 않는다(이 앱 규칙: 브라우저 저장소 사용 금지 — BR-03, lint).
 */
function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = () => setCollapsed((c) => !c);
  return [collapsed, toggle] as const;
}

/** 머리줄 통합 찾기 — 주문번호·라이더 번호로 어느 화면에서나 관제의 그 라이더로 */
function HeaderSearch() {
  const navigate = useNavigate();
  return (
    <ControlSearch
      compact
      onFound={(hit) => {
        const p = new URLSearchParams();
        if (hit.mfcId) p.set('mfcId', hit.mfcId);
        p.set('rider', hit.riderId);
        if (hit.deliveryId) p.set('delivery', hit.deliveryId);
        void navigate(`/control?${p.toString()}`);
      }}
    />
  );
}

// 화면 틀(2026-11-19 — 카페24 관리자·배민 주문접수 참고): 진한 남색 왼쪽 메뉴(묶음 아이콘 + 메뉴, 접으면 아이콘만),
// 흰 머리줄(위치 · 통합 찾기 · 로그인 직원·역할), 연회색 본문은 넓은 화면을 다 쓴다.
function Layout() {
  const { session } = useSession();
  const current = useCurrentMenu();
  const [collapsed, toggle] = useNavCollapsed();
  const { pathname } = useLocation();
  const seg = pathname.split('/')[1] ?? '';
  return (
    <div className="flex min-h-screen bg-base-200">
      <aside className={`sticky top-0 flex h-screen shrink-0 flex-col bg-neutral text-neutral-content transition-[width] ${collapsed ? 'w-16' : 'w-60'}`} data-collapsed={collapsed}>
        <div className={`flex h-14 shrink-0 items-center gap-2 border-b border-neutral-content/10 ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
          <Link to="/" className="flex items-center gap-2 font-bold text-neutral-content" aria-label={m.goHome}>
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm text-accent-content">P</span>
            {!collapsed && <span className="whitespace-nowrap text-[15px]">{m.appTitle}</span>}
          </Link>
          {!collapsed && env.isMock && <span className="badge badge-accent badge-xs whitespace-nowrap">{m.mockBadge}</span>}
        </div>
        <nav aria-label="메뉴" className={`flex-1 py-3 ${collapsed ? 'overflow-visible' : 'overflow-y-auto'}`}>
          {session &&
            visibleGroups(session.roles).map((g) => {
              const groupActive = g.items.some((i) => i.segment === seg);
              if (collapsed) {
                // 접힌 메뉴: 묶음 아이콘 하나 = 그 묶음 첫 메뉴(이름은 툴팁)
                const first = g.items[0]!;
                return (
                  <div key={g.key} className="tooltip tooltip-right block" data-tip={m.groups[g.key]}>
                    <NavLink
                      to={menuPath(first.segment)}
                      aria-label={m.groups[g.key]}
                      className={`mx-2 mb-1 flex h-10 items-center justify-center rounded-md ${groupActive ? 'bg-primary text-primary-content' : 'text-neutral-content/70 hover:bg-neutral-content/10'}`}
                    >
                      <Icon name={groupIcon[g.key]} />
                    </NavLink>
                  </div>
                );
              }
              return (
                <div key={g.key} className="mb-2">
                  <p className={`flex items-center gap-2.5 px-5 py-1.5 text-[13px] font-semibold ${groupActive ? 'text-neutral-content' : 'text-neutral-content/55'}`}>
                    <Icon name={groupIcon[g.key]} className="h-[18px] w-[18px]" />
                    {m.groups[g.key]}
                  </p>
                  <ul>
                    {g.items.map((item) => (
                      <li key={item.key}>
                        <NavLink
                          to={menuPath(item.segment)}
                          className={({ isActive }) =>
                            `mx-2 flex items-center rounded-md py-1.5 pl-10 pr-3 text-sm ${isActive ? 'bg-primary font-semibold text-primary-content' : 'text-neutral-content/75 hover:bg-neutral-content/10 hover:text-neutral-content'}`
                          }
                        >
                          {m.menus[item.key]}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
        </nav>
        <button
          type="button"
          onClick={toggle}
          className="flex h-11 shrink-0 items-center justify-center gap-2 border-t border-neutral-content/10 text-xs text-neutral-content/60 hover:text-neutral-content"
          aria-label={collapsed ? m.nav.expand : m.nav.collapse}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? 'expand' : 'collapse'} className="h-4 w-4" />
          {!collapsed && m.nav.collapse}
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-4 border-b border-base-300 bg-base-100/95 px-6 backdrop-blur">
          <p className="w-56 shrink-0 truncate text-sm text-base-content/60" data-testid="page-title">
            {current ? (
              <>
                {current.group} <span className="px-1 text-base-content/30">›</span>
                <span className="font-semibold text-base-content">{current.menu}</span>
              </>
            ) : null}
          </p>
          <div className="flex min-w-0 flex-1 justify-center">{session && <HeaderSearch />}</div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <SimulatorLink />
            {session ? (
              <>
                <span className="text-xs" data-testid="operator">
                  <StaffName operatorId={session.subject} />
                </span>
                {session.roles.map((r) => (
                  <span key={r} className="badge badge-outline badge-sm">
                    {r}
                  </span>
                ))}
                <NavLink to="/session" className="btn btn-ghost btn-xs">
                  {m.nav.session}
                </NavLink>
              </>
            ) : (
              <NavLink to="/login" className="btn btn-primary btn-xs">
                {m.nav.login}
              </NavLink>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1 space-y-5 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** 메뉴 하나. 주 역할(RIDER_OPS·OPERATOR_ADMIN)이 없으면 막지 않고 안내만 — 판정은 서버 */
function MenuScope({ menu }: { readonly menu: MenuItem }) {
  const { session } = useSession();
  if (!session) return null;
  return (
    <>
      {!hasRiderAppRole(session.roles) && (
        <p role="note" className="alert alert-warning text-sm" data-testid="no-rider-role">
          {m.noRiderRole}
        </p>
      )}
      {menu.adminOnly && !isOperatorAdmin(session.roles) ? (
        <p role="note" className="alert alert-warning text-sm" data-testid="admin-only">
          {m.adminOnly}
        </p>
      ) : (
        <MenuPage menu={menu} />
      )}
    </>
  );
}

/** 만든 메뉴는 그 화면, 아직이면 "준비 중"(PC 5 — 2026-11-17 접수 건·배송 찾기부터) */
function MenuPage({ menu }: { readonly menu: MenuItem }) {
  if (!menu.ready) return <PreparingPage menu={menu} />;
  switch (menu.key) {
    case 'cases':
      return <CasesMenu />;
    case 'deliveries':
      return <DeliveriesMenu />;
    case 'dashboard':
      return <DashboardPage />;
    case 'riderMap':
      return <ControlPage />;
    case 'riders':
      return <RidersMenu />;
    case 'signups':
      return <SignupsMenu />;
    case 'restrictionReviews':
      return <RestrictionReviewsMenu />;
    case 'consults':
      return <ConsultsMenu />;
    case 'helpRequests':
      return <HelpRequestsMenu />;
    case 'inquiries':
      return <InquiriesMenu />;
    case 'adjustments':
      return <AdjustmentsMenu />;
    case 'surcharges':
      return <SurchargesMenu />;
    case 'payouts':
      return <PayoutsMenu />;
    case 'appeals':
      return <AppealsMenu />;
    case 'notices':
      return <NoticesMenu />;
    case 'staffActions':
      return <StaffActionsMenu />;
    default:
      return <PreparingPage menu={menu} />;
  }
}

const guarded = (element: ReactNode) => <RequireSession>{element}</RequireSession>;

const routes = [
  { path: '/login', element: <LoginPage /> },
  // employee-auth 복귀 주소(백엔드 허용 목록의 <출처>/auth/callback)
  { path: '/auth/callback', element: <LoginCallbackPage /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: guarded(<Navigate to={menuPath()} replace />) },
      { path: 'session', element: guarded(<SessionPage />) },
      // 메뉴 아래 화면(목록·상세)은 메뉴 화면이 자기 Routes 로 나눈다
      ...allMenus.map((menu) => ({ path: `${menu.segment}/*`, element: guarded(<MenuScope menu={menu} />) })),
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

/** 재시도는 pmartFetch(429·retryable) 규칙만 따른다. TanStack Query 의 자동 재시도는 끈다. */
export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

export function App({
  queryClient = createQueryClient(),
  memory = false,
  initialPath = '/',
  initialToken,
}: {
  readonly queryClient?: QueryClient;
  readonly memory?: boolean;
  readonly initialPath?: string;
  /** 테스트에서 바로 세션을 시작한다. */
  readonly initialToken?: string;
}) {
  const router = memory ? createMemoryRouter(routes, { initialEntries: [initialPath] }) : createBrowserRouter(routes);
  return (
    <QueryClientProvider client={queryClient}>
      <UiTextProvider problem={m.problem} reason={m.reason}>
        <SessionProvider {...(initialToken ? { initialToken } : {})}>
          <RouterProvider router={router} />
        </SessionProvider>
      </UiTextProvider>
    </QueryClientProvider>
  );
}
