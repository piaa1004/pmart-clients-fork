// MFC 백오피스 기반(handoff mfc-backoffice/2026-11-15-request-mfc-backoffice §1·§2) — 로그인 앱 이름, 센터 고르기, 메뉴 자리, 역할 안내.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TokenStore } from '@pmart/web-core';
import { API_BASE } from '../api/client';
import { SOURCE_SYSTEM } from '../api/command';
import { beginEmployeeLogin, browser, LOGIN_SILENT_KEY } from '../api/employeeAuth';
import { env } from '../env';
import { as, renderAt } from '../test/render';
import { server } from '../test/server';
import { PreparingPage } from '../features/menus/PreparingPage';
import { allMenus } from './nav';

afterEach(() => {
  vi.restoreAllMocks();
  env.isMock = true;
});

describe('로그인', () => {
  it('app=mfc-backoffice, 복귀 주소 <출처>/auth/callback, X-Source-System mfc-backoffice-web', async () => {
    const url = new URL(await beginEmployeeLogin('https://192.168.0.40:8443/api/v1', '/', new TokenStore(), { origin: 'https://192.168.0.40:8445' }));
    expect(url.searchParams.get('app')).toBe('mfc-backoffice');
    expect(url.searchParams.get('returnUri')).toBe('https://192.168.0.40:8445/auth/callback');
    expect(SOURCE_SYSTEM).toBe('mfc-backoffice-web');
  });

  it('실서버 모드: 버튼은 게이트웨이 로그인 시작 주소로 옮긴다', async () => {
    env.isMock = false;
    sessionStorage.setItem(LOGIN_SILENT_KEY, '1');
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderAt('/login', null);
    await userEvent.click(screen.getByRole('button', { name: '직원 계정으로 로그인' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0]![0]).toContain('/api/v1/employee-auth/logins?app=mfc-backoffice');
  });

  it('목 모드: 목 계정 버튼 → 티켓 교환 → 맡은 센터의 첫 메뉴', async () => {
    renderAt('/', null);
    await userEvent.click(await screen.findByRole('button', { name: '센터 관리자(MFC 1곳)' }));
    // 센터 첫 화면은 센터 운영판(2026-11-19)
    expect(await screen.findByRole('heading', { name: '오늘 센터 현황' })).toBeInTheDocument();
    expect(await screen.findByText('부산진구 MFC (MFC-BSN-01)')).toBeInTheDocument();
  });
});

describe('센터', () => {
  it('센터가 하나면 고르지 않고 그 센터로 — 이름은 세션 응답 centerDetails(0.9.0)에서, GET /centers 는 부르지 않는다', async () => {
    const view = renderAt('/');
    expect(await screen.findByRole('heading', { name: '오늘 센터 현황' })).toBeInTheDocument();
    expect(await screen.findByText('부산진구 MFC (MFC-BSN-01)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '센터 고르기' })).not.toBeInTheDocument();
    expect(view.gets('/centers')).toHaveLength(0);
  });

  it('센터가 둘 이상이면 위에서 고른다 — 세션 centers 만(전체 목록의 다른 센터는 없다), 바꾸면 같은 메뉴', async () => {
    renderAt('/c/MFC-BSN-01/inventory', as.sup2);
    const select = await screen.findByRole('combobox', { name: '센터 고르기' });
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['부산진구 MFC (MFC-BSN-01)', '송파 MFC (MFC-SEL-01)']));
    await userEvent.selectOptions(select, 'MFC-SEL-01');
    expect(await screen.findByRole('heading', { name: '재고' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '센터 고르기' })).toHaveValue('MFC-SEL-01');
    expect(screen.getByRole('link', { name: '품질' })).toHaveAttribute('href', '/c/MFC-SEL-01/quality');
  });

  it('서버가 센터 이름을 못 읽으면(name: null) 그 센터는 코드로 보인다(빈 목록 아님)', async () => {
    server.use(
      http.get(`${API_BASE}/employee-auth/sessions/current`, () =>
        HttpResponse.json({
          sessionId: 'SES-1',
          operatorId: 'OP-sup-2',
          app: 'mfc-backoffice',
          issuedAt: '2026-11-16T00:00:00Z',
          expiresAt: '2026-11-16T00:15:00Z',
          roles: ['MFC_SUPERVISOR'],
          centers: ['MFC-BSN-01', 'MFC-SEL-01'],
          centerDetails: [
            { centerId: 'MFC-BSN-01', name: '부산진구 MFC' },
            { centerId: 'MFC-SEL-01', name: null },
          ],
        }),
      ),
    );
    renderAt('/c/MFC-BSN-01/workers', as.sup2);
    const select = await screen.findByRole('combobox', { name: '센터 고르기' });
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['부산진구 MFC (MFC-BSN-01)', 'MFC-SEL-01']));
    expect(screen.getByText('센터 이름을 불러오지 못해 센터 코드로만 보여요.')).toBeInTheDocument();
  });

  it('맡지 않은 센터 주소는 "이 센터 권한이 없습니다" + 맡은 센터로 가는 링크', async () => {
    renderAt('/c/MFC-SEL-02/workers');
    expect(await screen.findByRole('alert')).toHaveTextContent('이 센터 권한이 없습니다');
    expect(screen.getByRole('link', { name: 'MFC-BSN-01' })).toHaveAttribute('href', '/c/MFC-BSN-01/workers');
    expect(screen.queryByRole('heading', { name: '작업자' })).not.toBeInTheDocument();
  });
});

describe('세션 응답(sessions/current 0.6.0) — 토큰을 풀지 않는다', () => {
  it('응답의 역할·센터가 토큰과 다르면 응답을 따른다(승인 직후 등)', async () => {
    // 토큰은 센터 1곳인데 서버는 지금 2곳이라고 답한다 → 센터 고르기가 보인다.
    server.use(
      http.get(`${API_BASE}/employee-auth/sessions/current`, () =>
        HttpResponse.json({
          sessionId: 'SES-1',
          operatorId: 'OP-sup-1',
          app: 'mfc-backoffice',
          issuedAt: '2026-11-15T00:00:00Z',
          expiresAt: '2026-11-15T00:15:00Z',
          roles: ['MFC_SUPERVISOR'],
          centers: ['MFC-BSN-01', 'MFC-SEL-01'],
        }),
      ),
    );
    renderAt('/c/MFC-BSN-01/workers', as.sup);
    const select = await screen.findByRole('combobox', { name: '센터 고르기' });
    expect(within(select).getAllByRole('option')).toHaveLength(2);
  });

  it('처음 받기가 실패하면 메뉴를 그리지 않고 오류 + 다시 시도', async () => {
    let fail = true;
    server.use(
      http.get(`${API_BASE}/employee-auth/sessions/current`, () =>
        fail ? HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500, title: 'x', traceId: 't' }, { status: 500 }) : undefined,
      ),
    );
    renderAt('/', null);
    await userEvent.click(await screen.findByRole('button', { name: '센터 관리자(MFC 1곳)' }));
    expect(await screen.findByText('정보를 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.queryByText('작업자 관리')).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('heading', { name: '오늘 센터 현황' })).toBeInTheDocument();
  });
});

describe('역할', () => {
  it('MFC_WORKER 만 있으면 "센터 관리자만 쓰는 화면" — 메뉴 없음', async () => {
    renderAt('/', as.worker);
    expect(await screen.findByRole('alert')).toHaveTextContent('센터 관리자만 쓰는 화면입니다');
    expect(screen.queryByText('작업자 관리')).not.toBeInTheDocument();
    renderAt('/c/MFC-BSN-01/workers', as.worker);
    expect(screen.queryByRole('heading', { name: '작업자' })).not.toBeInTheDocument();
  });

  it('센터가 없는 운영 관리자: 맡은 센터가 없다는 안내 — 메뉴 없음', async () => {
    renderAt('/', as.admin);
    expect(await screen.findByRole('alert')).toHaveTextContent('맡은 센터가 없어요');
    expect(screen.queryByText('작업자 관리')).not.toBeInTheDocument();
  });

  it('센터 관리자가 아닌 역할 + 센터: 막지 않고 안내만(판정은 서버)', async () => {
    renderAt('/c/MFC-BSN-01/locations', as.adminWithCenter);
    expect(await screen.findByRole('heading', { name: '위치(칸)' })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('센터 관리자(MFC_SUPERVISOR) 권한이 없어요');
  });
});

describe('메뉴', () => {
  it('홈 + 묶음 5개 · 메뉴 15개가 모두 보이고 센터 주소 아래로 간다', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: '오늘 센터 현황' });
    // 묶음 제목(홈은 제목 없이 맨 위)
    const menu = screen.getByRole('navigation', { name: '메뉴' });
    for (const group of ['작업자 관리', '작업', '배송', '재고·품질', '센터']) expect(within(menu).getByText(group, { selector: '[data-group-label]' })).toBeInTheDocument();
    expect(allMenus).toHaveLength(15);
    for (const label of ['홈', '작업자', '배정', '작업 현황', '이동·보충', '입고', '재고', '품질', '위치(칸)', '운영 제한', '포장 인계', '배송 현황', '배차 실패', '배차 지연', '반납 인증번호']) {
      // 작업 현황 옆에는 늦음·막힘 수 배지가 붙을 수 있다
      const link = screen.getByRole('link', { name: (name) => name === label || (label === '작업 현황' && /^작업 현황 \d+\+?$/.test(name)) });
      expect(link.getAttribute('href')).toMatch(/^\/c\/MFC-BSN-01\//);
    }
  });

  it('9개 메뉴가 모두 화면을 가진다(2026-11-16) — "준비 중"이 아니다', () => {
    expect(allMenus.filter((menu) => !menu.ready).map((menu) => menu.key)).toEqual([]);
  });

  // 메뉴가 모두 만들어져 "준비 중" 화면은 메뉴로 열 수 없다 — 앞으로 생길 메뉴를 위해 부품을 직접 확인한다
  it('준비 중 화면: 서버 API 가 있는 기능과 없는 기능을 나눠 보인다', () => {
    render(<PreparingPage menu={{ key: 'quality', segment: 'quality', ready: false, apiReady: ['단건 조회'], apiMissing: ['목록'] }} />);
    expect(screen.getByText('화면 준비 중')).toBeInTheDocument();
    expect(within(screen.getByTestId('api-missing')).getByText('목록')).toBeInTheDocument();
    cleanup();
    render(<PreparingPage menu={{ key: 'quality', segment: 'quality', ready: false, apiReady: ['단건 조회'], apiMissing: [] }} />);
    expect(screen.queryByTestId('api-missing')).not.toBeInTheDocument();
  });

  it('세션이 없으면 로그인으로(돌아올 경로를 들고)', async () => {
    renderAt('/c/MFC-BSN-01/quality', null);
    expect(await screen.findByRole('button', { name: '센터 관리자(MFC 1곳)' })).toBeInTheDocument();
  });
});
