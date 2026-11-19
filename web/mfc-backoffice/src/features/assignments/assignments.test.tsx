// 배정 화면 — mfc-capacity-service 0.14.0 assignments·assignment-plans 목.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { API_BASE } from '../../api/client';
import { db } from '../../mocks/db';
import { renderAt } from '../../test/render';
import { server } from '../../test/server';

const rows = () => screen.getAllByTestId('assignment-row');
const sentBody = async (r: Request) => (await r.clone().json()) as Record<string, unknown>;
const postsTo = (sent: Request[], path: string) => sent.filter((r) => r.method === 'POST' && new URL(r.url).pathname.endsWith(path));

async function checkAndPick(taskId: string, worker: string, taskType?: string) {
  const form = await screen.findByRole('form', { name: '직접 배정' });
  const id = within(form).getByRole('textbox', { name: '작업 ID' });
  if ((id as HTMLInputElement).value !== taskId) {
    await userEvent.clear(id);
    await userEvent.type(id, taskId);
  }
  if (taskType) await userEvent.selectOptions(within(form).getByRole('combobox', { name: '작업 유형' }), taskType);
  await userEvent.click(within(form).getByRole('button', { name: '지금 담당 확인' }));
  await screen.findByTestId('current-assignee');
  const select = within(form).getByRole('combobox', { name: '맡길 작업자' });
  await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
  await userEvent.selectOptions(select, worker);
  return form;
}

describe('배정 목록', () => {
  it('기본은 진행 중(state 를 보내지 않는다), 최근 순. 지금 맡을 수 없는 배정·근무 밖 경고는 서버 값', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments');
    await waitFor(() => expect(rows()).toHaveLength(3));
    // 작업 칸은 시스템 ID 대신 작업 상세 링크(ADR-0070 덧붙임)
    expect(rows().map((r) => within(r).getByTestId('task-link').getAttribute('href'))).toEqual(['/c/MFC-BSN-01/tasks/TASK-PACK-1', '/c/MFC-BSN-01/tasks/TASK-PICK-3', '/c/MFC-BSN-01/tasks/TASK-PICK-1']);
    expect(rows()[0]).not.toHaveTextContent('TASK-PACK-1');
    expect(within(rows()[0]!).getByText('근무 밖')).toBeInTheDocument();
    expect(within(rows()[0]!).getByText('다음 작업 받기')).toBeInTheDocument();
    expect(within(rows()[1]!).getByText('지금은 맡을 수 없음(재직 중이 아님)')).toBeInTheDocument();
    expect(new URL(view.gets('/assignments')[0]!.url).searchParams.get('state')).toBeNull();
  });

  it('상태(바뀜) 거르기는 URL 쿼리 → 서버로', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '상태' }), 'SUPERSEDED');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(new URL(view.gets('/assignments').at(-1)!.url).searchParams.get('state')).toBe('SUPERSEDED');
  });

  it('조회 실패는 빈 목록이 아니라 오류', async () => {
    server.use(http.get(`${API_BASE}/assignments`, () => new HttpResponse(null, { status: 500 })));
    renderAt('/c/MFC-BSN-01/assignments');
    await waitFor(() => expect(document.querySelector('[data-state="error"]')).not.toBeNull());
    expect(screen.queryByText('조건에 맞는 배정이 없어요.')).not.toBeInTheDocument();
  });
});

describe('직접 배정', () => {
  it('목록의 "다시 배정" → 지금 담당 확인(버전 2) → 그 버전으로 보낸다', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(within(rows()[1]!).getByRole('button', { name: '다시 배정' }));
    const form = await checkAndPick('TASK-PICK-3', 'OP-wkr-1');
    expect(screen.getByTestId('current-assignee')).toHaveTextContent('지금 담당 OP-wkr-3 (버전 2)');
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    expect(await screen.findByText(/OP-wkr-1 에게 배정했어요\(버전 3\)/)).toBeInTheDocument();
    const post = postsTo(view.sent, '/assignments')[0]!;
    expect(post.headers.get('X-Expected-Version')).toBe('2');
    expect(await sentBody(post)).toEqual({ mfcId: 'MFC-BSN-01', taskId: 'TASK-PICK-3', taskType: 'PICK', workerId: 'OP-wkr-1' });
  });

  it('지금 담당을 확인하기 전에는 배정 단추가 꺼져 있다', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=manual');
    const form = await screen.findByRole('form', { name: '직접 배정' });
    await userEvent.type(within(form).getByRole('textbox', { name: '작업 ID' }), 'TASK-PICK-2');
    expect(within(form).getByRole('button', { name: '배정' })).toBeDisabled();
  });

  it('같은 사람에게 다시 정하면 "바뀐 것 없음"', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=manual');
    const form = await checkAndPick('TASK-PICK-1', 'OP-wkr-1');
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    expect(await screen.findByText('이미 그 작업자가 담당이에요. 바뀐 것이 없어요.')).toBeInTheDocument();
  });

  it('업무에 없는 작업 유형이면 DUTY_NOT_ALLOWED 문구', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=manual');
    const form = await checkAndPick('TASK-PACK-9', 'OP-wkr-2', 'PACK');
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    expect(await screen.findByText('이 작업자의 업무에 없는 작업 유형이에요.')).toBeInTheDocument();
  });

  it('확인한 뒤 누가 먼저 바꿨으면 VERSION_CONFLICT 문구', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=manual');
    const form = await checkAndPick('TASK-PICK-2', 'OP-wkr-1');
    expect(screen.getByTestId('current-assignee')).toHaveTextContent('지금 담당이 없어요(버전 0).');
    db.assignments = [
      ...db.assignments,
      { assignmentId: 'ASG-X', mfcId: 'MFC-BSN-01', taskId: 'TASK-PICK-2', taskType: 'PICK', workerId: 'OP-wkr-2', assignmentVersion: 1, state: 'ACTIVE', assignedAt: '2026-11-16T01:00:00.000Z' },
    ];
    await userEvent.click(within(form).getByRole('button', { name: '배정' }));
    expect(await screen.findByText('다른 사람이 먼저 바꿨어요. 새로 고침한 뒤 다시 해 주세요.')).toBeInTheDocument();
  });
});

describe('작업 시작(capacity 0.22.0) — 누르면 추천대로 바로 배정', () => {
  it('commit: true 로 보내고, 결과 요약(배정·남은 작업), 지금 배정·작업 목록에 보인다', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments');
    const card = await screen.findByTestId('start-work');
    await userEvent.selectOptions(within(card).getByRole('combobox', { name: '나눌 일감' }), '120');
    await userEvent.click(within(card).getByRole('button', { name: '작업 시작' }));
    const result = await within(card).findByTestId('start-result');
    expect(result).toHaveTextContent('1건 배정했어요');
    const post = postsTo(view.sent, '/assignment-plans')[0]!;
    expect(await sentBody(post)).toEqual({ mfcId: 'MFC-BSN-01', horizonMinutes: 120, commit: true });
    expect(post.headers.get('Idempotency-Key')).toBeTruthy();
    expect(db.assignments.some((a) => a.taskId === 'TASK-PICK-2' && a.state === 'ACTIVE' && a.source === 'PLAN')).toBe(true);
    expect(db.tasks.get('TASK-PICK-2')!.state).toBe('ASSIGNED');
    // 지금 배정 목록을 다시 읽어 새 배정이 보인다
    await waitFor(() => expect(rows().some((r) => within(r).queryByTestId('task-link')?.getAttribute('href') === '/c/MFC-BSN-01/tasks/TASK-PICK-2')).toBe(true));
  });

  it('서버가 STALE 이면 "다시 시작" 안내, 배정할 것이 없으면 그렇게', async () => {
    server.use(http.post(`${API_BASE}/assignment-plans`, () => HttpResponse.json({ planId: 'PLAN-S', mfcId: 'MFC-BSN-01', state: 'STALE', staleReasons: ['TASK_CHANGED:TASK-PICK-2'], assignments: [], unassigned: [] }, { status: 201 })));
    renderAt('/c/MFC-BSN-01/assignments');
    const card = await screen.findByTestId('start-work');
    await userEvent.click(within(card).getByRole('button', { name: '작업 시작' }));
    expect(await within(card).findByTestId('start-result')).toHaveTextContent('다시 눌러 주세요');
    server.use(
      http.post(`${API_BASE}/assignment-plans`, () =>
        HttpResponse.json({ planId: 'PLAN-N', mfcId: 'MFC-BSN-01', state: 'NO_SOLUTION', assignments: [], unassigned: [{ taskId: 'T-1', taskType: 'PACK', reason: 'CONFIG_REQUIRED' }] }, { status: 201 }),
      ),
    );
    await userEvent.click(within(card).getByRole('button', { name: '작업 시작' }));
    const r = await within(card).findByText('지금 배정할 수 있는 작업·작업자가 없어요.');
    expect(r.closest('[data-testid="start-result"]')).toHaveTextContent('작업 시간 설정 필요 1건');
  });

  it('담당 없는 작업: 대기 작업마다 "담당 정하기" — 버전 0 으로 배정', async () => {
    const view = renderAt('/c/MFC-BSN-01/assignments?tab=unassigned');
    const box = await screen.findByTestId('unassigned-tasks');
    const row = (await within(box).findAllByTestId('unassigned-row'))[0]!;
    expect(row).toHaveTextContent('피킹');
    await userEvent.click(within(row).getByRole('button', { name: '담당 정하기' }));
    const form = await screen.findByRole('form', { name: /담당 바꾸기/ });
    const combo = within(form).getByRole('combobox', { name: '새 담당' });
    await userEvent.click(combo);
    await userEvent.click(within(screen.getByRole('listbox', { name: '새 담당' })).getAllByRole('option')[0]!);
    await userEvent.type(within(form).getByRole('textbox', { name: '사유' }), '대기 정리');
    await userEvent.click(within(form).getByRole('button', { name: '담당 바꾸기' }));
    await within(form).findByRole('status');
    const post = postsTo(view.sent, '/assignments').at(-1)!;
    expect(post.headers.get('X-Expected-Version')).toBe('0');
    expect((await sentBody(post))['taskId']).toBe('TASK-PICK-2');
  });

  it('지난 작업 시작은 보기만 — 추천만 계산하는 단추는 없다', async () => {
    renderAt('/c/MFC-BSN-01/assignments?tab=plan');
    expect(await screen.findByTestId('list-plans')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '추천 계산' })).not.toBeInTheDocument();
  });
});
