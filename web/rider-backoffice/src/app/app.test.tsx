// 라이더 백오피스 뼈대(2026-11-17, PC 1) — 로그인 앱 이름·복귀 주소, 세션 응답, 역할 안내, 메뉴 자리.
import { screen, waitFor, within } from '@testing-library/react';
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
import { allMenus, navGroups } from './nav';

afterEach(() => {
  vi.restoreAllMocks();
  env.isMock = true;
});

describe('로그인', () => {
  it('app=rider-backoffice, 복귀 주소 <출처>/auth/callback, X-Source-System rider-backoffice-web', async () => {
    const url = new URL(await beginEmployeeLogin('https://192.168.0.40:8443/api/v1', '/', new TokenStore(), { origin: 'https://192.168.0.40:8446' }));
    expect(url.searchParams.get('app')).toBe('rider-backoffice');
    expect(url.searchParams.get('returnUri')).toBe('https://192.168.0.40:8446/auth/callback');
    expect(SOURCE_SYSTEM).toBe('rider-backoffice-web');
  });

  it('실서버 모드: 조용한 로그인 확인을 이미 했으면 버튼 → 게이트웨이 로그인 시작 주소', async () => {
    env.isMock = false;
    sessionStorage.setItem(LOGIN_SILENT_KEY, '1');
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderAt('/login', null);
    await userEvent.click(screen.getByRole('button', { name: '직원 계정으로 로그인' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0]![0]).toContain('/api/v1/employee-auth/logins?app=rider-backoffice');
  });

  it('실서버 모드: 처음 열면 버튼 없이 조용한 로그인 확인(silent=true)부터 — 다른 백오피스 Keycloak 세션으로 들어온다', async () => {
    env.isMock = false;
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderAt('/login', null);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(assign.mock.calls[0]![0]);
    expect(url.searchParams.get('app')).toBe('rider-backoffice');
    expect(url.searchParams.get('silent')).toBe('true');
  });

  it('목 모드: 목 계정 버튼 → 티켓 교환 → 첫 메뉴(대시보드)', async () => {
    renderAt('/', null);
    await userEvent.click(await screen.findByRole('button', { name: '라이더 운영(RIDER_OPS)' }));
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument();
  });

  it('세션이 없으면 로그인으로(돌아올 경로를 들고) — 로그인 뒤 그 메뉴', async () => {
    renderAt('/riders', null);
    await userEvent.click(await screen.findByRole('button', { name: '라이더 운영(RIDER_OPS)' }));
    expect(await screen.findByRole('heading', { name: '라이더 찾기' })).toBeInTheDocument();
  });

  it('내 세션: 서버 세션의 app 이 rider-backoffice', async () => {
    renderAt('/session');
    expect(await screen.findByText('rider-backoffice')).toBeInTheDocument();
  });
});

describe('세션 응답(sessions/current) — 토큰을 풀지 않는다', () => {
  it('응답의 역할이 토큰과 다르면 응답을 따른다 — 토큰은 RIDER_OPS 인데 서버가 CS_AGENT 라고 하면 안내', async () => {
    server.use(
      http.get(`${API_BASE}/employee-auth/sessions/current`, () =>
        HttpResponse.json({
          sessionId: 'SES-1',
          operatorId: 'OP-rops-1',
          app: 'rider-backoffice',
          issuedAt: '2026-11-17T00:00:00Z',
          expiresAt: '2026-11-17T00:15:00Z',
          roles: ['CS_AGENT'],
          centers: [],
        }),
      ),
    );
    renderAt('/control', as.riderOps);
    expect(await screen.findByTestId('no-rider-role')).toHaveTextContent('라이더 운영(RIDER_OPS) 권한이 없어요');
  });

  it('처음 받기가 실패하면 메뉴를 그리지 않고 오류 + 다시 시도', async () => {
    let fail = true;
    server.use(
      http.get(`${API_BASE}/employee-auth/sessions/current`, () =>
        fail ? HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500, title: 'x', traceId: 't' }, { status: 500 }) : undefined,
      ),
    );
    renderAt('/', null);
    await userEvent.click(await screen.findByRole('button', { name: '라이더 운영(RIDER_OPS)' }));
    expect(await screen.findByText('정보를 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.queryByText('관제')).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument();
  });
});

describe('역할', () => {
  it('RIDER_OPS·OPERATOR_ADMIN 은 안내 없음', async () => {
    for (const token of [as.riderOps, as.admin]) {
      const view = renderAt('/control', token);
      expect(await screen.findByRole('heading', { name: '라이더 관제' })).toBeInTheDocument();
      expect(screen.queryByTestId('no-rider-role')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('그 밖 역할(CS_AGENT)은 막지 않고 안내만 — 판정은 서버', async () => {
    renderAt('/control', as.cs);
    expect(await screen.findByTestId('no-rider-role')).toHaveTextContent('라이더 운영(RIDER_OPS) 권한이 없어요');
    expect(screen.getByRole('heading', { name: '라이더 관제' })).toBeInTheDocument();
  });
});

describe('메뉴 자리', () => {
  it(`묶음 ${navGroups.length}개 · 메뉴 ${allMenus.length}개 — 모두 화면이 있다(2026-11-17 PC 5)`, async () => {
    renderAt('/');
    const nav = await screen.findByRole('navigation', { name: '메뉴' });
    for (const g of ['현황', '관제', '배송·배차', '지원센터', '수행료']) expect(within(nav).getByText(g)).toBeInTheDocument();
    expect(screen.getAllByText('라이더').length).toBeGreaterThan(0);
    for (const name of ['대시보드', '라이더 관제', '라이더 찾기', '가입 승인', '제한 검토', '배송 찾기', '상담함', '접수 건', '수행료 조정', '추가 배달료']) {
      await userEvent.click(screen.getByRole('link', { name }));
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
      expect(screen.queryByText('화면 준비 중')).not.toBeInTheDocument();
    }
    expect(allMenus.every((menu) => menu.ready)).toBe(true);
  });
});

describe('지원센터 메뉴 정리(사용자 2026-11-19 "라이더문의랑 도움요청이 둘 다 있는 이유")', () => {
  it('도움요청·라이더 문의 메뉴는 없고 상담함 하나 — 옛 목록 주소는 상담함으로', async () => {
    renderAt('/help-requests', as.riderOps);
    expect(await screen.findByRole('heading', { name: '상담함' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '메뉴' });
    expect(within(nav).queryByRole('link', { name: '도움요청' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: '라이더 문의' })).not.toBeInTheDocument();
  });
});
