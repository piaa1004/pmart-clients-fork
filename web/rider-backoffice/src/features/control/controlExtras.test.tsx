// 관제 보탬 — 거르기(배송 중·위치 끊김)·지도 자리 — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { API_BASE } from '../../api/client';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const at = '2026-11-17T05:00:00.000Z';
/** 관제 목록 기준 시각(asOf = at)에서 sec 초 전 */
const ago = (sec: number) => new Date(Date.parse(at) - sec * 1000).toISOString();
const board = {
  asOf: at,
  items: [
    { riderId: 'RD-7', nameMasked: '김*수', location: { lat: 35.15, lng: 129.06, recordedAt: at, receivedAt: at, quality: 'GOOD' }, stale: false, staleSinceSeconds: 5, onDutySince: ago(125 * 60), waitingSince: null, activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_CUSTOMER' }] },
    { riderId: 'RD-8', nameMasked: '이*희', location: { lat: 35.16, lng: 129.04, recordedAt: at, receivedAt: at, quality: 'GOOD' }, stale: true, staleSinceSeconds: 305, activeDeliveries: [] },
    { riderId: 'RD-9', nameMasked: '박*민', location: null, stale: true, staleSinceSeconds: null, activeDeliveries: [] },
    // 대기 중(운행 + 신규배차 켬 + 배송 0건) — tracking 0.9.0 waitingSince
    { riderId: 'RD-10', nameMasked: '최*영', location: { lat: 35.17, lng: 129.05, recordedAt: at, receivedAt: at, quality: 'GOOD' }, stale: false, staleSinceSeconds: 3, onDutySince: ago(50 * 60), waitingSince: ago(12 * 60 + 5), activeDeliveries: [] },
  ],
};

describe('관제 — 거르기·지도', () => {
  it('배송 중·위치 끊김(서버 stale 또는 위치 없음)으로 거르고 주소에 남긴다', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    expect(await screen.findAllByTestId('control-row')).toHaveLength(4);
    await userEvent.click(screen.getByRole('radio', { name: '배송 중' }));
    expect(screen.getAllByTestId('control-row').map((r) => r.id)).toEqual(['control-RD-7']);
    await userEvent.click(screen.getByRole('radio', { name: '위치 끊김·없음' }));
    expect(screen.getAllByTestId('control-row').map((r) => r.id)).toEqual(['control-RD-8', 'control-RD-9']);
    expect(screen.getByRole('radio', { name: '위치 끊김·없음' })).toHaveAttribute('aria-checked', 'true');
  });

  it('주소의 filter 로 바로 열리고, 맞는 라이더가 없으면 "없어요"', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json({ asOf: at, items: [board.items[3]] })));
    renderAt('/control?mfcId=MFC-BSJ-01&filter=delivering', as.riderOps);
    expect(await screen.findByText('조건에 맞는 라이더가 없어요.')).toBeInTheDocument();
  });

  it('지도 키가 없는 환경에서는 지도 대신 안내, 표는 그대로', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    expect(await screen.findByTestId('map-unavailable')).toHaveTextContent('카카오 지도 키가 없어');
    expect(screen.getAllByTestId('control-row')).toHaveLength(4);
  });
});

describe('관제 — 처음 열 때', () => {
  it('센터를 안 골랐으면 첫 센터로 열린다', async () => {
    renderAt('/control', as.riderOps);
    expect(await screen.findAllByTestId('control-row')).not.toHaveLength(0);
    expect(screen.queryByText('센터를 고르면 그 센터의 운행 중 라이더가 보여요.')).not.toBeInTheDocument();
  });
});

const sentTo = (view: ReturnType<typeof renderAt>, suffix: string) => view.sent.filter((r) => new URL(r.url).pathname.endsWith(suffix));

describe('관제 — 라이더 한눈에', () => {
  it('라이더 줄을 누르면 위치·전달 상황·오늘 운행시간·대기 + 배송: 단계·도착 예정·픽업 → 전달지·주문', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    expect(await screen.findByTestId('control-panel-empty')).toBeInTheDocument();
    const row = (await screen.findAllByTestId('control-row'))[0]!;
    await userEvent.click(within(row).getByText('김*수'));

    const panel = await screen.findByTestId('control-panel');
    expect(panel).toHaveTextContent('RD-7');
    expect(within(panel).getByTestId('tile-location')).toHaveTextContent('수신 중 · 5초 전');
    expect(within(panel).getByTestId('tile-delivery')).toHaveTextContent('배송 중 1건');
    // 세 시간은 따로: 운행시간(수락~완료 5400초) · 접속(운행 켬 9000초, 운행 시작 2시간 5분째) · 대기(1800초)
    expect(await within(panel).findByText('1시간 30분')).toBeInTheDocument();
    expect(within(panel).getByTestId('tile-operating')).toHaveTextContent('배차 수락 ~ 전달 완료');
    expect(within(panel).getByTestId('tile-connected')).toHaveTextContent('2시간 5분째');
    expect(within(panel).getByTestId('tile-connected')).toHaveTextContent('오늘 2시간 30분');
    expect(within(panel).getByTestId('tile-connected')).toHaveTextContent('운행 시작 오전 11:55'); // asOf 14:00(서울) − 2시간 5분
    expect(within(panel).getByTestId('tile-waiting')).toHaveTextContent('30분');
    expect(within(panel).getByTestId('tile-waiting')).toHaveTextContent('오늘 합계');
    // 단계는 관제 값(TO_CUSTOMER) — 위 칸·표와 같은 원천
    expect(within(panel).getByTestId('stage-steps').querySelector('[aria-current="step"]')).toHaveTextContent('고객에게');
    const order = await within(panel).findByTestId('panel-order');
    expect(order).toHaveTextContent('PMart 부산진구지점');
    expect(order).toHaveTextContent('051-000-0000');
    expect(await within(order).findByTestId('drop-address')).toHaveTextContent('부산 부산진구 서면로 00(목 주소) 101동 1001호');
    expect(order).toHaveTextContent('열람 기록이 남아요');
    expect(order).toHaveTextContent('그릭요거트 플레인 400g × 3');
    expect(order).toHaveTextContent('문 앞에 두고 벨 눌러 주세요');
    expect(within(panel).getByText('#48213075')).toBeInTheDocument();
    expect(await within(panel).findByTestId('panel-eta')).toHaveTextContent('5분 늦음');
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('전달지는 열 때 한 번만 — 10초 새로 고침에도 다시 부르지 않는다(배송·도착 예정은 다시)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
      const view = renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-7', as.riderOps);
      await screen.findByTestId('drop-address');
      const [d0, e0] = [sentTo(view, '/deliveries/DLV-1').length, sentTo(view, '/deliveries/DLV-1/eta').length];
      expect(sentTo(view, '/drop-location')).toHaveLength(1); // 지도 경로와 상세 칸이 같은 요청을 나눠 씀
      await vi.advanceTimersByTimeAsync(21_000);
      await waitFor(() => expect(sentTo(view, '/deliveries/DLV-1').length).toBeGreaterThan(d0));
      expect(sentTo(view, '/deliveries/DLV-1/eta').length).toBeGreaterThan(e0);
      expect(sentTo(view, '/drop-location')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('전달지를 못 주는 이유를 그대로: 고객 전달지 없음(409) / 열람 기록 실패(503)는 다시 불러오기', async () => {
    let code: 'NO_CUSTOMER_DROP' | 'UNAVAILABLE' = 'NO_CUSTOMER_DROP';
    server.use(
      http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)),
      http.get(`${API_BASE}/deliveries/:deliveryId/drop-location`, () =>
        code === 'NO_CUSTOMER_DROP'
          ? HttpResponse.json({ code, status: 409, title: 'x', traceId: 't' }, { status: 409 })
          : HttpResponse.json({ code: 'DEPENDENCY_UNAVAILABLE', status: 503, title: 'x', traceId: 't' }, { status: 503 }),
      ),
    );
    const first = renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-7', as.riderOps);
    expect(await screen.findByTestId('drop-unavailable')).toHaveTextContent('고객 전달지가 없는 배송이에요');
    expect(within(screen.getByTestId('drop-unavailable')).queryByRole('button')).not.toBeInTheDocument();
    first.unmount();

    code = 'UNAVAILABLE';
    renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-7', as.riderOps);
    const note = await screen.findByTestId('drop-unavailable');
    expect(note).toHaveTextContent('열람 기록을 남기지 못해');
    expect(within(note).getByRole('button', { name: '다시 불러오기' })).toBeInTheDocument();
  });

  it('대기 중인 라이더: 진행 중 배송 없음, 전달지는 부르지 않는다 · 닫기', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    const view = renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-10', as.riderOps);
    const panel = await screen.findByTestId('control-panel');
    expect(within(panel).getByTestId('tile-delivery')).toHaveTextContent('대기 12분째');
    expect(within(panel).getByTestId('tile-connected')).toHaveTextContent('50분째');
    expect(sentTo(view, '/drop-location')).toHaveLength(0);
    await userEvent.click(within(panel).getByRole('button', { name: '닫기' }));
    expect(await screen.findByTestId('control-panel-empty')).toBeInTheDocument();
  });

  it('신규배차를 꺼 두면 대기로 세지 않고, 접속·대기 합을 못 받으면(null) 0 이 아니라 "못 불러옴"', async () => {
    server.use(
      http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)),
      http.get(`${API_BASE}/rider-operating-time`, () => HttpResponse.json({ from: '2026-11-18', to: '2026-11-18', totalSeconds: 600, connectedSeconds: null, waitingSeconds: null, days: [] })),
    );
    renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-8', as.riderOps);
    const panel = await screen.findByTestId('control-panel');
    expect(within(panel).getByTestId('tile-delivery')).toHaveTextContent('대기 아님');
    expect(within(panel).getByTestId('tile-connected')).toHaveTextContent('운행 중 아님');
    expect(await within(panel).findByText('10분')).toBeInTheDocument(); // 운행시간은 그대로
    expect(within(panel).getByTestId('tile-waiting')).toHaveTextContent('못 불러옴');
    expect(within(panel).getByTestId('tile-connected')).toHaveTextContent('못 불러옴');
  });

  it('배송 내역을 못 읽으면 그 칸만 오류(다시 시도), 빈 값으로 보이지 않는다', async () => {
    server.use(
      http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)),
      http.get(`${API_BASE}/deliveries/:deliveryId`, () => HttpResponse.json({ code: 'INTERNAL_ERROR', status: 500, title: 'x', traceId: 't' }, { status: 500 })),
    );
    renderAt('/control?mfcId=MFC-BSJ-01&rider=RD-7', as.riderOps);
    const card = await screen.findByTestId('panel-delivery');
    expect(await within(card).findAllByRole('button', { name: /다시/ })).not.toHaveLength(0);
    expect(within(card).queryByTestId('panel-order')).not.toBeInTheDocument();
  });

  it('표의 진행 중 배송 칸에 주문번호·픽업 지점·도착 예정이 한눈에', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json({ asOf: at, items: [{ ...board.items[0], activeDeliveries: [{ deliveryId: 'DLV-1', stage: 'TO_CUSTOMER', etaDrop: at }] }] })));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    const cell = await screen.findByTestId('row-delivery');
    expect(await within(cell).findByText(/#48213075/)).toHaveTextContent('픽업 PMart 부산진구지점');
    expect(cell).toHaveTextContent('도착 예정');
  });
});

describe('관제 — 주문번호·라이더 찾기', () => {
  it('주문번호 8자리면 그 배송의 라이더·센터를 바로 연다(그 배송을 강조)', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    const view = renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    await screen.findAllByTestId('control-row');
    await userEvent.type(screen.getByRole('textbox', { name: '주문번호·라이더 찾기' }), '48213075');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByTestId('control-search-note')).toHaveTextContent('주문 48213075 → 라이더 RD-7');
    const panel = await screen.findByTestId('control-panel');
    expect(panel).toHaveTextContent('RD-7');
    const search = sentTo(view, '/deliveries').find((r) => new URL(r.url).searchParams.get('orderNumber'));
    expect(new URL(search!.url).searchParams.get('orderNumber')).toBe('48213075');
    expect((await within(panel).findAllByTestId('panel-delivery'))[0]).toHaveClass('ring-1');
  });

  it('없는 주문번호는 그렇다고, 라이더 ID 는 그 라이더를 연다', async () => {
    server.use(http.get(`${API_BASE}/rider-locations`, () => HttpResponse.json(board)));
    renderAt('/control?mfcId=MFC-BSJ-01', as.riderOps);
    await screen.findAllByTestId('control-row');
    const box = screen.getByRole('textbox', { name: '주문번호·라이더 찾기' });
    await userEvent.type(box, '99999999');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByTestId('control-search-note')).toHaveTextContent('주문번호 99999999 로 배정된 배송이 없어요');
    expect(screen.queryByTestId('control-panel')).not.toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, 'RD-10');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByTestId('control-panel')).toHaveTextContent('RD-10');
  });
});

