// 화면 틀·대시보드 개편(2026-11-19 — 카페24 관리자·배민 주문접수 참고) — 목(MSW) 기준.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

describe('화면 틀', () => {
  it('메뉴를 접으면 아이콘만(묶음 이름은 링크 이름으로), 다시 펼칠 수 있다', async () => {
    renderAt('/dashboard', as.riderOps);
    const nav = await screen.findByRole('navigation', { name: '메뉴' });
    expect(within(nav).getByRole('link', { name: '상담함' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '메뉴 접기' }));
    expect(within(nav).queryByRole('link', { name: '상담함' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: '지원센터' })).toHaveAttribute('href', '/consults');
    await userEvent.click(screen.getByRole('button', { name: '메뉴 펼치기' }));
    expect(within(nav).getByRole('link', { name: '상담함' })).toBeInTheDocument();
  });

  it('머리줄 통합 찾기: 라이더 번호 6자리면 그 라이더를 관제에서 연다', async () => {
    renderAt('/help-requests', as.riderOps);
    const box = await screen.findByRole('search', { name: '통합 찾기' });
    await userEvent.type(within(box).getByRole('textbox', { name: '통합 찾기' }), '730115');
    await userEvent.click(within(box).getByRole('button', { name: '통합 찾기로 관제에서 열기' }));
    const panel = await screen.findByTestId('control-panel');
    expect(await within(panel).findByText('730115')).toBeInTheDocument();
  });

  it('없는 라이더 번호는 그렇다고 알린다', async () => {
    renderAt('/dashboard', as.riderOps);
    const box = await screen.findByRole('search', { name: '통합 찾기' });
    await userEvent.type(within(box).getByRole('textbox', { name: '통합 찾기' }), '000000');
    await userEvent.click(within(box).getByRole('button', { name: '통합 찾기로 관제에서 열기' }));
    expect(await within(box).findByTestId('control-search-note')).toHaveTextContent('라이더 번호 000000 인 라이더가 없어요');
  });
});

describe('대시보드 — 오늘의 할 일', () => {
  it('처리 목록마다 대기 건수, 누르면 그 목록', async () => {
    renderAt('/dashboard', as.riderOps);
    const strip = await screen.findByTestId('todo-strip');
    expect(await within(strip).findByTestId('stat-open-help')).toHaveTextContent('1');
    expect(await within(strip).findByTestId('todo-appeals')).toHaveTextContent('2');
    expect(within(strip).getByTestId('todo-appeals')).toHaveAttribute('href', '/appeals');
    expect(within(strip).getByTestId('stat-surcharges')).toHaveAttribute('href', '/surcharges');
  });
});
