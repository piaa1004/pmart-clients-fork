// 배송 찾기(execution 0.4.0)·상세(수행 + 배차) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../../test/render';

const searchCalls = (sent: readonly Request[]) => sent.filter((r) => new URL(r.url).pathname.endsWith('/deliveries')).map((r) => new URL(r.url).searchParams);

describe('배송 찾기', () => {
  it('비워 두면 최근 배송부터, 행을 누르면 상세', async () => {
    const view = renderAt('/deliveries', as.riderOps);
    const rows = await screen.findAllByTestId('delivery-row');
    expect(rows).toHaveLength(4);
    // 화면 배송 번호(ADR-0070) "48213075-1" 로 보이고 링크는 내부 ID 로
    const failed = rows.find((r) => r.textContent?.includes('48213075-1'))!;
    expect(within(failed).getByText('전달 실패 등록')).toBeInTheDocument();
    expect(within(failed).getByRole('link', { name: '48213075-1' })).toHaveAttribute('href', '/deliveries/DLV-1');
    // 번호가 없으면(배정 전) ID 끝 8자리 + "번호 없음"
    const unassigned = rows.find((r) => r.textContent?.includes('DLV-2'))!;
    expect(within(unassigned).getByText('배정 전')).toBeInTheDocument();
    expect(unassigned).toHaveTextContent('번호 없음');
    const q = searchCalls(view.sent)[0]!;
    expect([q.get('orderId'), q.get('state'), q.get('sort'), q.get('size')]).toEqual([null, null, null, '20']);
  });

  it('주문 ID 완전 일치·상태로 거르고 주소에 남긴다, 없으면 "없어요"(실패와 구분)', async () => {
    const view = renderAt('/deliveries', as.riderOps);
    await screen.findAllByTestId('delivery-row');
    await userEvent.type(screen.getByLabelText('주문 ID'), 'ORD-1');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findAllByTestId('delivery-row')).toHaveLength(2); // 원래 배송 + 반납 배송
    expect(searchCalls(view.sent).at(-1)!.get('orderId')).toBe('ORD-1');

    // 찾으면 검색 조건이 칩 한 줄로 접힌다(2026-11-19 통합 백오피스처럼) — 칩에 건 조건, '검색 열기'로 다시 펼친다
    expect(screen.getByRole('button', { name: '주문 한 주문 조건 바꾸기' })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('search-toggle'));
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '수행 상태' })).getByRole('radio', { name: '전달 완료' }));
    expect(await screen.findByText('조건에 맞는 배송이 없어요.')).toBeInTheDocument();
    const q = searchCalls(view.sent).at(-1)!;
    expect([q.get('orderId'), q.get('state')]).toEqual(['ORD-1', 'COMPLETED']);
  });
});

describe('배송 상세', () => {
  it('수행·배차를 따로 — 전달 실패 사유, 주문 품목, 수행 이력', async () => {
    renderAt('/deliveries/DLV-1', as.riderOps);
    const exec = await screen.findByTestId('execution-detail');
    expect(exec).toHaveTextContent('전달 실패 등록');
    expect(exec).toHaveTextContent('48213075');
    expect(exec).toHaveTextContent('PMart 부산진구지점');
    expect(screen.getByTestId('failure-detail')).toHaveTextContent('연락 안 됨');
    expect(screen.getByTestId('order-items')).toHaveTextContent(/그릭요거트 플레인 400g\s*3/);
    expect(screen.getByTestId('execution-history')).toHaveTextContent(/픽업.*· 라이더/);
    const dispatch = await screen.findByTestId('dispatch-detail');
    expect(dispatch).toHaveTextContent('배정');
    // 라이더는 화면 번호(ADR-0070) "김*수 · 482913" — 내부 ID 는 접힌 "시스템 번호"에만
    expect(await within(dispatch).findByText('482913')).toBeInTheDocument();
    expect(dispatch).toHaveTextContent('김*수');
    expect(dispatch).not.toHaveTextContent('RD-7');
    expect(screen.getByTestId('system-ids')).toHaveTextContent('RD-7');
    // 전달 실패 등록 상태 — 확정·반려 폼이 있다(2026-11-17 조치 붙임)
    expect(await screen.findByRole('form', { name: '전달 실패 확정·반려' })).toBeInTheDocument();
  });

  it('배차를 못 읽어도 수행은 보이고, 배차 칸만 오류(0·빈 값으로 바꾸지 않음)', async () => {
    renderAt('/deliveries/DLV-4', as.riderOps);
    const exec = await screen.findByTestId('execution-detail');
    expect(exec).toHaveTextContent('전달 실패 반납');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('dispatch-detail')).not.toBeInTheDocument();
  });
  it('배차 시도 표(계기·상태·제안별 라이더 응답)와 도착 예정(tracking eta — 남은 분·지연은 서버 값)', async () => {
    renderAt('/deliveries/DLV-1', as.riderOps);
    const attempts = await screen.findAllByTestId('dispatch-attempt');
    expect(attempts).toHaveLength(1);
    // 제안받은 라이더는 화면 번호(ADR-0070) — RD-7 은 "김*수 · 482913", 조회에 없는 RD-9 는 ID 끝 + "번호 없음"
    const offers = within(attempts[0]!).getAllByRole('listitem');
    expect(offers.find((o) => o.textContent?.includes('거절'))).toHaveTextContent('번호 없음');
    const accepted = offers.find((o) => o.textContent?.includes('수락'))!;
    expect(await within(accepted).findByText('482913')).toBeInTheDocument();
    expect(accepted).toHaveTextContent('김*수');
    const eta = await screen.findByTestId('eta-detail');
    expect(within(eta).getByText('고객 도착')).toBeInTheDocument();
    expect(within(eta).getByText(/35분 남음 · 5.4km/)).toBeInTheDocument();
    expect(within(eta).getByText('약속보다 5분 늦음')).toBeInTheDocument();
  });

  it('배차 실패한 배송은 시도마다 실패 사유', async () => {
    renderAt('/deliveries/DLV-2', as.riderOps);
    const attempts = await screen.findAllByTestId('dispatch-attempt');
    expect(attempts).toHaveLength(3);
    expect(within(attempts[2]!).getByText('라이더 없음')).toBeInTheDocument();
    expect(within(await screen.findByTestId('eta-detail')).getAllByText('도착 예정 확인 중')).toHaveLength(2);
  });
});