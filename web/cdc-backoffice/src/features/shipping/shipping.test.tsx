// 출고관리(출발 검증 0.16.0)·TRF 출발 준비·칸별 재고(0.9.0)·실사(0.8.0).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('출발 검증', () => {
  it('최신 순 목록 — 펼치면 TRF 별 결과·재고 반영·해제 실패 사유와 불일치', async () => {
    renderAt('/c/CDC01/shipping');
    const rows = await screen.findAllByTestId('departure-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('일부 일치')).toBeInTheDocument();
    await userEvent.click(rows[0]!);
    const detail = screen.getByTestId('departure-detail');
    expect(within(detail).getByText('409 INVALID_STATE')).toBeInTheDocument();
    expect(within(screen.getByTestId('departure-mismatches')).getByText('실리지 않은 LPN')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'T482913' })).toHaveAttribute('href', '/c/CDC01/trf-wave/trf/TRF-20261126-0001');
  });

  it('결과 거르기는 서버로', async () => {
    const view = renderAt('/c/CDC01/shipping');
    await screen.findAllByTestId('departure-row');
    await userEvent.selectOptions(screen.getByTestId('departure-result'), 'MATCHED');
    await waitFor(() => expect(screen.getAllByTestId('departure-row')).toHaveLength(2));
    expect(view.gets('/departures').some((r) => new URL(r.url).searchParams.get('result') === 'MATCHED')).toBe(true);
  });
});

describe('TRF 출발 준비', () => {
  it('TRF 상세에 단계·준비 수량·막힌 이유', async () => {
    renderAt('/c/CDC01/trf-wave/trf/TRF-20261126-0001');
    const r = await screen.findByTestId('trf-readiness');
    expect(r).toHaveTextContent('피킹 중');
    expect(r).toHaveTextContent('피킹 부족 재할당 중');
  });
});

describe('칸별 재고', () => {
  it('로케이션 상세에 그 칸 재고', async () => {
    const view = renderAt('/c/CDC01/master/locations/CDC01-A-5-63-01-2-1');
    const rows = await screen.findAllByTestId('location-stock-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText('SKU-1001')).toBeInTheDocument();
    expect(new URL(view.gets('/location-stocks')[0]!.url).searchParams.get('locationPrefix')).toBe('CDC01-A-5-63-01-2-1');
  });

  it('재고관리 [칸별 재고] — 칸 코드 앞부분으로', async () => {
    renderAt('/c/CDC01/inventory?tab=places');
    const input = await screen.findByTestId('places-prefix');
    await userEvent.clear(input);
    await userEvent.type(input, 'CDC01-A-5');
    await userEvent.click(screen.getByRole('button', { name: '조회' }));
    expect(await screen.findAllByTestId('location-stock-row')).toHaveLength(3);
  });
});

describe('실사', () => {
  it('구역·층으로 칸을 불러 체크해서 시작 → 계수표(칸·상품·LOT)마다 수량 칸, 장부 수량은 없음', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=count');
    await userEvent.selectOptions(await screen.findByTestId('count-area'), 'A');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'CDC01-A-5-03-02-1-1 고르기' }));
    expect(screen.getByTestId('count-picked')).toHaveTextContent('고른 칸 1');
    await userEvent.click(screen.getByTestId('count-start-go'));
    expect(await screen.findByRole('heading', { name: '실사 CNT-0002' })).toBeInTheDocument();
    const sheet = await screen.findByTestId('count-sheet');
    expect(within(sheet).getByText('LOT-A1')).toBeInTheDocument();
    expect(within(sheet).queryByText('700')).not.toBeInTheDocument();
    const post = view.sent.find((r) => r.method === 'POST')!;
    expect(await post.json()).toEqual({ locationCodes: ['CDC01-A-5-03-02-1-1'] });
  });

  it('수량을 다 넣어야 보내고(빈 칸 ≠ 0), 장부와 다르면 재계수 — 같은 사람은 재계수 못 함', async () => {
    const view = renderAt('/c/CDC01/inventory?tab=count');
    await userEvent.selectOptions(await screen.findByTestId('count-area'), 'A');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'CDC01-A-5-03-02-1-1 고르기' }));
    await userEvent.click(screen.getByTestId('count-start-go'));
    await screen.findByTestId('count-sheet');
    await userEvent.click(screen.getByTestId('count-submit'));
    expect(screen.getByText('수량을 넣지 않은 줄이 1개 있어요. 없으면 0 을 넣어 주세요.')).toBeInTheDocument();
    expect(view.sent.filter((r) => r.method === 'POST')).toHaveLength(1);
    await userEvent.type(screen.getByRole('textbox', { name: 'CDC01-A-5-03-02-1-1 SKU-1001 LOT-A1 센 수량' }), '690');
    await userEvent.click(screen.getByTestId('count-submit'));
    expect(await screen.findByText('재계수 입력')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'CDC01-A-5-03-02-1-1 SKU-1001 LOT-A1 센 수량' }), '695');
    await userEvent.click(screen.getByTestId('count-submit'));
    expect(await screen.findByText('첫 계수한 사람은 재계수할 수 없어요. 다른 사람이 넣어 주세요.')).toBeInTheDocument();
  });

  it('장부와 같게 세면 바로 일치 — 결과 줄(장부·첫 계수·최종·차이 0)', async () => {
    renderAt('/c/CDC01/inventory?tab=count');
    await userEvent.selectOptions(await screen.findByTestId('count-area'), 'A');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'CDC01-A-5-03-02-1-1 고르기' }));
    await userEvent.click(screen.getByTestId('count-start-go'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'CDC01-A-5-03-02-1-1 SKU-1001 LOT-A1 센 수량' }), '700');
    await userEvent.click(screen.getByTestId('count-submit'));
    const lines = await screen.findByTestId('count-lines');
    expect(lines).toHaveTextContent('700');
    expect(screen.getAllByText('일치').length).toBeGreaterThan(0);
  });

  it('결정 대기 실사를 번호로 열어 승인 — 결과 줄(장부·최종·차이)', async () => {
    renderAt('/c/CDC01/inventory?tab=count&session=CNT-0001');
    await screen.findByTestId('count-decide');
    expect(screen.getByTestId('count-approve')).toBeDisabled();
    await userEvent.type(screen.getByTestId('count-decision-reason'), '재계수 맞음');
    await userEvent.click(screen.getByTestId('count-approve'));
    // 결정 뒤에는 결정 칸이 사라지고 서버 상태(조정 승인)와 결과 줄만 남는다
    await screen.findByTestId('count-lines');
    expect(await screen.findByText('조정 승인')).toBeInTheDocument();
    expect(screen.queryByTestId('count-decide')).not.toBeInTheDocument();
    expect(await screen.findByTestId('count-lines')).toHaveTextContent('-2');
  });
});

describe('LPN', () => {
  it('출고관리 LPN 탭 — 어디까지(상차·분류), 펼치면 내용', async () => {
    renderAt('/c/CDC01/shipping?v=lpns');
    const rows = await screen.findAllByTestId('lpn-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('상차')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('분류됨')).toBeInTheDocument();
    await userEvent.click(rows[2]!);
    expect(await screen.findByTestId('lpn-detail')).toHaveTextContent('LOT-B7');
  });
});
