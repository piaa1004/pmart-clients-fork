// 배차 지연(우리 센터) — delivery-dispatch 0.12.0 `GET /dispatch-delays` + 배송 번호 묶음(delivery-execution 0.31.0). 목(MSW) 기준.
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const rows = () => screen.getAllByTestId('dispatch-delay-row');

describe('배차 지연', () => {
  it('우리 센터 것만, 약속 이른 순 — 배송 번호(묶음 조회), 라이더 없음, 약속 대비 지난 분', async () => {
    const view = renderAt('/c/MFC-BSN-01/dispatch-delays');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await waitFor(() => expect(within(rows()[0]!).getAllByTestId('display-number')[0]).toHaveTextContent('35726513-1'));
    expect(rows()[0]).toHaveTextContent('라이더 찾는 중');
    expect(rows()[0]).toHaveTextContent('라이더 없음');
    expect(within(rows()[0]!).getByTestId('delay-minutes')).toHaveTextContent(/7[45]분 지남/);
    // 번호가 없는 배송은 "번호 없음"만(시스템 ID 는 시스템 번호 칸)
    expect(within(rows()[1]!).getAllByTestId('display-number')[0]).toHaveTextContent(/^번호 없음$/);
    expect(within(rows()[1]!).getByTestId('delay-minutes')).toHaveTextContent(/분 남음/);
    const q = new URL(view.gets('/dispatch-delays')[0]!.url).searchParams;
    expect(q.get('mfcId')).toBe('MFC-BSN-01');
    const n = new URL(view.gets('/deliveries')[0]!.url).searchParams;
    expect([n.get('mfcId'), n.get('deliveryIds')]).toEqual(['MFC-BSN-01', 'DLV-DD-1,DLV-DD-2']);
  });

  it('배차 불가로 취소는 막혀 있고 이유를 보인다(센터 관리자가 주문 행을 읽을 API 없음)', async () => {
    renderAt('/c/MFC-BSN-01/dispatch-delays');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[0]!).getByRole('button', { name: '배차 불가로 취소' })).toBeDisabled();
    expect(screen.getByTestId('cancel-blocked')).toHaveTextContent('백엔드에 요청');
  });

  it('번호 조회가 실패하면 "번호 확인 불가"(번호 없음과 구분), 목록 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/deliveries`, () => HttpResponse.json({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', type: 'about:blank' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/c/MFC-BSN-01/dispatch-delays');
    await waitFor(() => expect(within(rows()[0]!).getAllByTestId('display-number')[0]).toHaveTextContent('번호 확인 불가'));
    server.use(http.get(`${API_BASE}/dispatch-delays`, () => HttpResponse.json({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', type: 'about:blank' }, { status: 503, headers: { 'content-type': 'application/problem+json' } })));
    renderAt('/c/MFC-BSN-01/dispatch-delays');
    await waitFor(() => expect(screen.getAllByRole('button', { name: /다시/ }).length).toBeGreaterThan(0));
  });

  it('없으면 "수고하셨어요"', async () => {
    server.use(http.get(`${API_BASE}/dispatch-delays`, () => HttpResponse.json({ items: [] })));
    renderAt('/c/MFC-BSN-01/dispatch-delays');
    expect(await screen.findByTestId('all-done')).toHaveTextContent('배차가 늦어지는 배송이 없어요');
  });
});

describe('홈 배차 지연 칸', () => {
  it('서버 배차 지연 수, 누르면 배차 지연 메뉴', async () => {
    renderAt('/c/MFC-BSN-01/ops');
    expect(await screen.findByTestId('tile-dispatch-delay-value')).toHaveTextContent(/^2건$/);
    expect(screen.getByTestId('tile-dispatch-delay')).toHaveAttribute('href', '/c/MFC-BSN-01/dispatch-delays');
  });
});
