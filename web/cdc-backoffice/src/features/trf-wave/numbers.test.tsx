// 화면 번호로 찾기(현장은 번호만 안다)·출발 번호·LPN 온도대 한글·MFC 이름(2026-11-26 점검).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderAt } from '../../test/render';

describe('화면 번호로 찾기', () => {
  it('TRF·Wave 위 "열기" — W4821 로 그 Wave 를, 없는 번호는 못 찾음', async () => {
    renderAt('/c/CDC01/trf-wave');
    const form = await screen.findByTestId('wave-open');
    await userEvent.type(within(form).getByRole('textbox'), 'W9999');
    await userEvent.click(within(form).getByRole('button'));
    expect(await within(form).findByText('W9999 를 찾지 못했어요')).toBeInTheDocument();
    await userEvent.clear(within(form).getByRole('textbox'));
    await userEvent.type(within(form).getByRole('textbox'), '4821');
    await userEvent.click(within(form).getByRole('button'));
    expect(await screen.findByTestId('wave-system-id')).toHaveTextContent('WAVE-20261126-01');
  });

  it('TRF 목록 번호 거르기 — T771204 하나만', async () => {
    const view = renderAt('/c/CDC01/trf-wave');
    await screen.findByTestId('trf-number');
    await userEvent.type(screen.getByTestId('trf-number'), 'T771204');
    await userEvent.click(screen.getByRole('button', { name: '조회' }));
    await waitFor(() => expect(view.gets('/transfers').some((r) => new URL(r.url).searchParams.get('number') === 'T771204')).toBe(true));
    await waitFor(() => expect(screen.getAllByTestId('trf-row')).toHaveLength(1));
    expect(screen.getByTestId('trf-row')).toHaveTextContent('부산남구 MFC');
  });

  it('작업관리 Wave 칸에 번호 — 고른 Wave 의 작업, 칸엔 시스템 ID 를 남기지 않음', async () => {
    renderAt('/c/CDC01/tasks');
    await userEvent.type(await screen.findByTestId('task-wave-input'), 'W4821');
    await userEvent.click(screen.getByRole('button', { name: '열기' }));
    expect(await screen.findByTestId('task-wave-head')).toHaveTextContent('W4821');
    expect(screen.getByTestId('task-wave-input')).toHaveValue('');
  });

  it('LPN TRF 칸에 번호 — T482913 의 LPN, 온도대는 한글', async () => {
    const view = renderAt('/c/CDC01/shipping?v=lpns');
    await userEvent.type(await screen.findByTestId('lpn-trf'), 'T482913');
    await userEvent.click(screen.getByRole('button', { name: '찾기' }));
    await waitFor(() => expect(view.gets('/lpns').some((r) => new URL(r.url).searchParams.get('trfId') === 'TRF-20261126-0001')).toBe(true));
    expect((await screen.findAllByText('상온')).length).toBeGreaterThan(0);
    expect(screen.queryByText('AMBIENT')).not.toBeInTheDocument();
  });
});

describe('출발 번호·MFC 이름', () => {
  it('출발 검증 목록은 출발 번호(S…), MFC 재고 이동 최근 출발은 지난 날 TRF 도 MFC 이름', async () => {
    renderAt('/c/CDC01/shipping');
    expect(await screen.findByText('S240518')).toBeInTheDocument();
    expect(screen.queryByText('DEP-0002')).not.toBeInTheDocument();
  });
});

describe('번호 없는 출발(시뮬레이터)', () => {
  it('긴 출발 ID 대신 운행 번호, 펼치면 무슨 뜻인지 한 문장', async () => {
    renderAt('/c/CDC01/shipping');
    const row = (await screen.findAllByTestId('departure-row')).find((r) => r.textContent.includes('운행 TO-20261126-001'))!;
    expect(row).not.toHaveTextContent('c5b97d11');
    await userEvent.click(row);
    expect(await screen.findByTestId('departure-story')).toHaveTextContent('차량 VH-5T-04A 가 TRF 1건을 싣고');
    expect(screen.getByTestId('departure-story')).toHaveTextContent('모두 TRF 와 맞았어요');
  });
});
