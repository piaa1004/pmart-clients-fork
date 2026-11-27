// 재고관리 — 재고 현황(안전량 미설정은 "미설정", 펼치면 그 SKU 만 withPlaces), 재계수 대기 풀기(사유 필수).
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('재고 현황', () => {
  it('안전량·가용 미설정은 0 이 아니라 "미설정"', async () => {
    renderAt('/c/CDC01/inventory');
    const rows = await screen.findAllByTestId('stock-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getAllByText('미설정')).toHaveLength(2);
  });

  it('줄을 펼치면 그 SKU 만 withPlaces=true 로 LOT·위치별', async () => {
    const view = renderAt('/c/CDC01/inventory');
    const rows = await screen.findAllByTestId('stock-row');
    await userEvent.click(rows[0]!);
    const places = await screen.findByTestId('stock-places');
    expect(within(places).getByText('CDC01-A-5-63-01-2-1')).toBeInTheDocument();
    expect(within(places).getByText('보류')).toBeInTheDocument();
    const req = view.gets('/stock-snapshot').find((r) => new URL(r.url).searchParams.get('withPlaces') === 'true')!;
    expect(new URL(req.url).searchParams.get('sku')).toBe('SKU-1001');
  });
});

describe('실사 목록', () => {
  it('최근 실사(서버 목록)를 누르면 그 실사, 화면 번호로도 연다', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=count');
    const rows = await screen.findAllByTestId('count-recent-row');
    expect(rows[0]).toHaveTextContent('C1001');
    expect(rows[0]).toHaveTextContent('1칸');
    await userEvent.type(screen.getByRole('textbox', { name: '실사 번호로 열기' }), '1001');
    await userEvent.click(screen.getByRole('button', { name: '열기' }));
    expect(await screen.findByTestId('count-steps')).toBeInTheDocument();
    expect(view.gets('/cdcs/CDC01/count-sessions').some((r) => new URL(r.url).searchParams.get('number') === '1001')).toBe(true);
  });
});

describe('재계수 대기', () => {
  it('[이 칸 실사] — 그 칸을 미리 고른 실사 시작으로', async () => {
    renderAt('/c/CDC01/inventory?tab=recount');
    await userEvent.click(await screen.findByTestId('recount-count-RCH-1'));
    expect(await screen.findByTestId('count-picked')).toHaveTextContent('고른 칸 1');
    expect(screen.getByTestId('count-area')).toHaveValue('B');
    expect(screen.getByTestId('count-floor')).toHaveValue('6');
  });

  it('대기 중만 기본, 사유를 적어 풀면 목록에서 빠진다', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=recount');
    const rows = await screen.findAllByTestId('recount-row');
    expect(rows).toHaveLength(1);
    await userEvent.click(screen.getByTestId('recount-open-RCH-1'));
    expect(screen.getByTestId('recount-go')).toBeDisabled();
    await userEvent.type(screen.getByTestId('recount-reason'), '다시 세어 맞음');
    await userEvent.click(screen.getByTestId('recount-go'));
    expect(await screen.findByText('RCH-1 를 풀었어요.')).toBeInTheDocument();
    expect(await screen.findByText('재계수 대기가 없어요.')).toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(await post.json()).toEqual({ reason: '다시 세어 맞음' });
  });
});

describe('전체 재고', () => {
  it('합계 카드·상품 이름, 거르기 버튼은 서버 값으로', async () => {
    renderAt('/c/CDC01/inventory');
    const cards = await screen.findByTestId('stock-cards');
    expect(within(cards).getByText('총 현물')).toBeInTheDocument();
    expect(await screen.findByText('냉동 만두 1kg')).toBeInTheDocument();
    await userEvent.click(within(screen.getByTestId('stock-filters')).getByRole('button', { name: /보류 있음/ }));
    const rows = screen.getAllByTestId('stock-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getByTestId('stock-shown')).toHaveTextContent(`${rows.length} / 3 SKU`);
  });

  it('상품 이름으로 찾기', async () => {
    renderAt('/c/CDC01/inventory');
    await screen.findAllByTestId('stock-row');
    await userEvent.type(screen.getByTestId('stock-find'), '양파');
    expect(screen.getAllByTestId('stock-row')).toHaveLength(1);
  });
});
