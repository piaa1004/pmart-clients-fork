// 도움요청 상세 보탬 — 증빙 사진·처리함·가리기(execution 계약) — 목(MSW) 기준. 실서버 확인은 아니다.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { http, HttpResponse } from 'msw';

import { API_BASE } from '../../api/client';
import { mockDeliveries } from '../../mocks/deliveryHandlers';
import { as, renderAt } from '../../test/render';
import { server } from '../../test/server';

const sentTo = (sent: readonly Request[], tail: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(tail));

beforeEach(() => {
  // jsdom 에는 object URL 이 없다 — 사진 칸이 그려지는지만 본다
  URL.createObjectURL = vi.fn(() => 'blob:evidence');
  URL.revokeObjectURL = vi.fn();
});

describe('도움요청 상세 — 증빙 사진·처리함·가리기', () => {
  it('증빙 사진: 받은 사진은 보이고, 못 받은 사진은 빈칸이 아니라 "불러오지 못함"', async () => {
    renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    expect(await screen.findByRole('heading', { name: '증빙 사진 2장' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '증빙 사진 1 크게 보기' })).toBeInTheDocument();
    expect(await screen.findByTestId('photo-error')).toHaveTextContent('사진을 불러오지 못했어요');
  });

  it('상담 완료(접수 건 없음): 확인 창 → 멱등 키로 도움요청을 닫고 "상담을 완료했어요"', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '상담 완료' }));
    const dialog = screen.getByRole('dialog', { name: '상담을 완료할까요?' });
    await userEvent.type(within(dialog).getByLabelText(/처리 내용/), '주소 안내함');
    await userEvent.click(within(dialog).getByRole('button', { name: '완료' }));
    expect(await screen.findByTestId('resolve-done')).toHaveTextContent('상담을 완료했어요');
    const posts = sentTo(view.sent, '/resolutions');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(posts[0]!.headers.get('X-Source-System')).toBeTruthy();
  });

  it('확인 창에서 취소하면 보내지 않는다', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '상담 완료' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sentTo(view.sent, '/resolutions')).toHaveLength(0);
  });

  it('접수 건이 붙은 도움요청도 같은 "상담 완료" 버튼 — 접수 건 화면으로 넘어가지 않고 그 접수 건을 닫는다(사용자 2026-11-19)', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-CASE', as.riderOps);
    await userEvent.click(await screen.findByRole('button', { name: '상담 완료' }));
    const dialog = screen.getByRole('dialog', { name: '상담을 완료할까요?' });
    await userEvent.click(within(dialog).getByRole('button', { name: '완료' }));
    expect(await screen.findByTestId('resolve-done')).toHaveTextContent('상담을 완료했어요');
    const posts = sentTo(view.sent, '/cases/CASE-9/closures');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    // 처리 내용을 비우면 결과 이름으로 남긴다(접수 건 종결은 처리 내용이 꼭 필요)
    expect((await posts[0]!.clone().json()) as unknown).toEqual({ resolution: 'RESOLVED', summary: '상담 완료 — 해결' });
    expect(sentTo(view.sent, '/resolutions')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: '접수 건 보기' })).not.toBeInTheDocument();
  });

  it('가리기는 관리자에게만 — 사유와 함께 보내면 대화가 가려져 다시 보인다', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.admin);
    const chat = await screen.findByTestId('help-messages');
    await userEvent.click(within(chat).getByRole('button', { name: '가리기' }));
    await userEvent.type(screen.getByLabelText('가리는 사유(2~500자)'), '출입 비밀번호');
    await userEvent.click(within(screen.getByRole('form', { name: '가리기' })).getByRole('button', { name: '가리기' }));
    // 가린 메시지는 다시 읽으면 masked — 글 대신 '(가린 메시지)', 그 메시지의 가리기 칸은 사라짐
    expect(await within(screen.getByTestId('help-messages')).findByText('(가린 메시지)')).toBeInTheDocument();
    expect(screen.queryByText('공동현관 비밀번호가 틀려요')).not.toBeInTheDocument();
    expect(sentTo(view.sent, '/maskings')).toHaveLength(1);
  });

  it('라이더 운영(RIDER_OPS)에게는 가리기 버튼이 없다', async () => {
    renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    expect(await screen.findByTestId('help-messages')).toHaveTextContent('공동현관 비밀번호가 틀려요');
    expect(screen.queryByRole('button', { name: '가리기' })).not.toBeInTheDocument();
  });
});

describe('상담함 — 배송 도움요청과 일반 문의를 한 목록에(사용자 2026-11-19)', () => {
  it('두 종류가 함께 보이고 배송 도움요청이 먼저, 누르면 각자 대화로', async () => {
    renderAt('/consults', as.riderOps);
    const rows = await screen.findAllByTestId('consult-row');
    const kinds = rows.map((r) => r.getAttribute('data-kind'));
    expect(kinds).toContain('help');
    expect(kinds).toContain('inquiry');
    expect(kinds.indexOf('inquiry')).toBeGreaterThan(kinds.lastIndexOf('help'));
    expect(rows[0]).toHaveTextContent('배송 도움요청');
    const inquiry = rows.find((r) => r.getAttribute('data-kind') === 'inquiry')!;
    expect(inquiry).toHaveTextContent('일반 문의');
    expect(within(inquiry).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^\/inquiries\//));
  });
});

describe('상담 화면에서 바로 배송 조치(사용자 2026-11-19 "배송찾기에서 운영조치로 해줘야 하게 불편하게")', () => {
  it('전달 불가 신고가 들어온 배송은 상담 화면에서 반려할 수 있다 — 배송 상세와 같은 요청', async () => {
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    const form = await screen.findByRole('form', { name: '전달 실패 확정·반려' });
    await userEvent.click(within(form).getByLabelText('반려'));
    await userEvent.click(within(form).getByRole('button', { name: '보내기' }));
    expect(await within(form).findByTestId('action-result')).toHaveTextContent('반영했어요.');
    const post = sentTo(view.sent, '/failure-decisions')[0]!;
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(((await post.clone().json()) as { decision: string }).decision).toBe('REJECT');
  });
});

describe('반려 직후 "직접 실패 처리"가 같은 자리에 떠도 두 번 눌림으로 확정되지 않는다(28767701-1, 사용자 2026-11-19)', () => {
  it('직접 실패 처리는 확인 칸을 체크해야 보낼 수 있다', async () => {
    // 반려되면 서버가 픽업으로 되돌린다 — 그 뒤 상태를 흉내
    server.use(http.get(`${API_BASE}/deliveries/DLV-1`, () => HttpResponse.json({ ...mockDeliveries[0]!, state: 'PICKED_UP', failure: null })));
    const view = renderAt('/help-requests/DLV-1/HR-1', as.riderOps);
    const direct = await screen.findByRole('form', { name: '지원센터 직접 실패 처리' });
    const send = within(direct).getByRole('button', { name: '보내기' });
    expect(send).toBeDisabled();
    await userEvent.click(send); // 두 번째 눌림 자리 — 아무것도 보내지 않는다
    expect(sentTo(view.sent, '/failure-decisions')).toHaveLength(0);
    await userEvent.click(within(direct).getByRole('checkbox'));
    expect(send).toBeEnabled();
  });
});
