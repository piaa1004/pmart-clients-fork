// 화면 번호 정리(ADR-0070, 사용자 2026-11-19 "겉에선 다 정돈된 걸로") — 목(MSW) 기준.
// 목록·카드에는 화면 번호만, 시스템 ID(ERN-·DLV-·RD-·OP-)는 접힌 "시스템 번호" 칸에만.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { as, renderAt } from '../test/render';

/** 접힌 "시스템 번호"를 뺀 보이는 글자 */
const visibleText = (el: HTMLElement) => {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-testid="system-ids"]').forEach((n) => n.remove());
  return clone.textContent ?? '';
};

describe('화면 번호 — 시스템 ID 는 겉에 없다', () => {
  it('수행료 조정 카드: 배송 번호·라이더 번호, ERN·DLV·RD 는 접힌 시스템 번호에만', async () => {
    renderAt('/adjustments', as.riderOps);
    const card = (await screen.findAllByTestId('adjustment-row'))[0]!;
    expect(await within(card).findByText('48213075-1')).toBeInTheDocument();
    expect(await within(card).findByText('482913')).toBeInTheDocument();
    const shown = visibleText(card);
    expect(shown).not.toMatch(/ERN-|DLV-|RD-/);
    expect(within(card).getByTestId('system-ids')).toHaveTextContent('ERN-1');
  });

  it('추가 배달료 처리자는 OP-… 대신(로그인한 본인이면 "나")', async () => {
    renderAt('/surcharges?state=APPROVED', as.riderOps);
    const rows = await screen.findAllByTestId('surcharge-row');
    for (const r of rows) expect(visibleText(r)).not.toMatch(/OP-/);
  });

  it('라이더 번호 6자리로 찾으면 그 라이더 ID 로 서버에 묻는다', async () => {
    const view = renderAt('/surcharges', as.riderOps);
    await screen.findAllByTestId('surcharge-row');
    await userEvent.type(screen.getByLabelText('라이더 번호 6자리(또는 라이더 ID)'), '482913');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    await screen.findAllByTestId('surcharge-row');
    const calls = view.sent.filter((r) => r.method === 'GET' && new URL(r.url).pathname.endsWith('/surcharge-requests'));
    expect(new URL(calls.at(-1)!.url).searchParams.get('riderId')).toBe('RD-7');
  });

  it('없는 라이더 번호면 서버에 묻지 않고 "없어요"', async () => {
    const view = renderAt('/surcharges', as.riderOps);
    await screen.findAllByTestId('surcharge-row');
    const before = view.sent.filter((r) => new URL(r.url).pathname.endsWith('/surcharge-requests')).length;
    await userEvent.type(screen.getByLabelText('라이더 번호 6자리(또는 라이더 ID)'), '000000');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByText(/없어요/)).toBeInTheDocument();
    expect(view.sent.filter((r) => new URL(r.url).pathname.endsWith('/surcharge-requests')).length).toBe(before);
  });
});
