// 도움요청 상세 보탬(PC 5, 2026-11-17 — #88 위). 모두 execution 계약 그대로:
// - 증빙 사진 `GET /deliveries/{deliveryId}/evidence-photos/{photoRef}` — 공통 AuthedPhotos(토큰 붙여 받기·해제·못 받으면 "불러오지 못함").
// - 처리함 `POST …/resolutions` — OPEN·IN_PROGRESS → RESOLVED. 접수 건(caseId)이 붙은 건 서버가 409 HELP_REQUEST_HAS_CASE 이므로 버튼 대신 접수 건 링크.
//   "닫았어요"는 서버가 돌려준 resolvedAt 으로만. 메모에는 개인정보를 적지 않는다(안내).
// - 가리기 `POST …/messages/{messageId}/maskings` — OPERATOR_ADMIN 만(그 밖 403), 사유 2~500자. 가린 뒤 대화를 다시 읽는다.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { request } from '@pmart/web-core';
import { CommandFeedback, failureCode, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { AuthedPhotos } from '../../shared/AuthedPhotos';
import { useEvidenceLoader } from '../../shared/evidenceLoader';
import { when } from '../../shared/opsUi';

type HelpRequest = components['schemas']['HelpRequest'];

export const helpExtrasMessages = {
  photos: { label: '증빙 사진', inquiryLabel: '문의 사진' },
  resolve: {
    title: '상담 완료',
    button: '상담 완료',
    resolved: '상담이 끝난 요청이에요.',
    confirmTitle: '상담을 완료할까요?',
    confirmBody: '이 도움요청의 상담을 끝내요. 라이더 앱에는 "지원센터가 처리를 마쳤어요"로 보여요. 배송 상태는 바뀌지 않아요.',
    resultLabel: '결과',
    openObligations: '아직 끝나지 않은 후속 처리가 있어서 완료할 수 없어요. 그것부터 끝내 주세요.',
    forbidden: '완료할 권한이 없어요 — 다른 상담사가 맡은 건은 관리자만 완료할 수 있어요.',
    noteLabel: '처리 내용(선택, 300자까지)',
    piiHint: '메모에 고객 전화번호·주소·출입 비밀번호를 적지 마세요.',
    cancel: '취소',
    confirm: '완료',
    done: (at: string) => `상담을 완료했어요 · ${at}`,
  },
  mask: {
    button: '가리기',
    reason: '가리는 사유(2~500자)',
    cancel: '취소',
    done: '가렸어요',
    adminOnly: '대화 가리기는 관리자(OPERATOR_ADMIN)만 할 수 있어요.',
  },
} as const;

const m = helpExtrasMessages;
const NOTE_MAX = 300;

export function EvidencePhotos({ deliveryId, refs, heading = true }: { readonly deliveryId: string; readonly refs: readonly string[]; readonly heading?: boolean }) {
  const load = useEvidenceLoader(deliveryId);
  return <AuthedPhotos refs={refs} load={load} label={m.photos.label} heading={heading} />;
}

/** 라이더 문의 사진(case 0.14.0) — `GET /inquiry-photos/{photoId}`(RIDER_OPS·OPERATOR_ADMIN 은 라이더 문의 사진을 본다, 공유 캐시 금지) */
export function InquiryPhotos({ photoIds, heading = true }: { readonly photoIds: readonly string[]; readonly heading?: boolean }) {
  const api = useApi();
  const load = useCallback(
    (photoId: string) => request('GET', api.cases.GET('/inquiry-photos/{photoId}', { params: { path: { photoId } }, parseAs: 'blob' })),
    [api],
  );
  return <AuthedPhotos refs={photoIds} load={load} label={m.photos.inquiryLabel} heading={heading} />;
}

const RESOLUTIONS = ['RESOLVED', 'NO_ACTION_REQUIRED', 'NOT_REPRODUCIBLE', 'DUPLICATE', 'ESCALATED_EXTERNAL'] as const;
type Resolution = (typeof RESOLUTIONS)[number];
const resolutionName: Readonly<Record<Resolution, string>> = {
  RESOLVED: '해결',
  NO_ACTION_REQUIRED: '조치 필요 없음',
  NOT_REPRODUCIBLE: '재현 안 됨',
  DUPLICATE: '중복',
  ESCALATED_EXTERNAL: '외부로 넘김',
};

/**
 * 상담 완료 — 상담사가 대화 화면에서 바로 끝낸다(사용자 2026-11-19 "상담사가 상담 완료할 수 있게 하라니까 왜 접수건으로 넘어가냐").
 * 접수 건이 붙은 도움요청은 서버가 도움요청 쪽 닫기를 막으므로(409 HELP_REQUEST_HAS_CASE) 버튼 하나로 그 접수 건을 닫는다
 * (case `POST /cases/{caseId}/closures` — 서버가 도움요청도 RESOLVED). 접수 건이 없으면 도움요청을 직접 닫는다(execution resolutions).
 * 상담사는 둘의 차이를 몰라도 된다.
 */
export function ResolvePanel({ help, deliveryId, requestId }: { readonly help: HelpRequest; readonly deliveryId: string; readonly requestId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState<Resolution>('RESOLVED');
  const caseId = help.caseId ?? null;
  const resolve = useCommand(async (body: { note: string; resolution: Resolution }, key) => {
    try {
      if (caseId) {
        const r = await request(
          'POST',
          api.cases.POST('/cases/{caseId}/closures', {
            ...commandParams(key, { path: { caseId } }),
            // 접수 건 종결은 처리 내용이 꼭 필요하다 — 비우면 결과 이름으로 남긴다
            body: { resolution: body.resolution, summary: body.note || `상담 완료 — ${resolutionName[body.resolution]}` },
          }),
        );
        setOpen(false);
        return { resolvedAt: r.closure?.closedAt ?? new Date().toISOString() };
      }
      const r = await request(
        'POST',
        api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/resolutions', {
          ...commandParams(key, { path: { deliveryId, requestId } }),
          body: body.note ? { note: body.note } : {},
        }),
      );
      setOpen(false);
      return { resolvedAt: r.resolvedAt ?? new Date().toISOString() };
    } finally {
      void client.invalidateQueries({ queryKey: ['help', deliveryId, requestId] });
      void client.invalidateQueries({ queryKey: ['help-queue'] });
      void client.invalidateQueries({ queryKey: ['help-messages', deliveryId, requestId] });
      if (caseId) {
        void client.invalidateQueries({ queryKey: ['case', caseId] });
        void client.invalidateQueries({ queryKey: ['cases'] });
      }
    }
  });
  const done = resolve.phase.kind === 'done';
  const code = resolve.phase.kind === 'rejected' ? failureCode(resolve.phase.failure) : undefined;
  return (
    // 제목은 감싸는 구역 상자가 단다 — 여기는 내용만
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={m.resolve.title}>
      {help.state === 'RESOLVED' && !done ? (
        <span className="badge badge-ghost" data-testid="resolve-already">
          {m.resolve.resolved}
        </span>
      ) : (
        !done && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={resolve.busy}
            onClick={() => {
              if (resolve.phase.kind === 'rejected') resolve.reset();
              setOpen(true);
            }}
          >
            {m.resolve.button}
          </button>
        )
      )}
      {code === 'OPEN_OBLIGATIONS' ? (
        <p role="alert" className="text-sm text-error">{m.resolve.openObligations}</p>
      ) : code === 'FORBIDDEN' ? (
        <p role="alert" className="text-sm text-error">{m.resolve.forbidden}</p>
      ) : (
        <CommandFeedback command={resolve}>
          {(r) => (
            <p className="text-sm text-success" data-testid="resolve-done">
              {m.resolve.done(when(r.resolvedAt))}
            </p>
          )}
        </CommandFeedback>
      )}
      {open && (
        <div className="modal modal-open" role="dialog" aria-modal="true" aria-label={m.resolve.confirmTitle}>
          <form
            className="modal-box space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void resolve.run({ note: note.trim(), resolution });
            }}
          >
            <h3 className="text-lg font-bold">{m.resolve.confirmTitle}</h3>
            <p className="text-sm">{m.resolve.confirmBody}</p>
            <label className="flex flex-col gap-1 text-sm">
              {m.resolve.resultLabel}
              <select className="select select-sm w-60" value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
                {RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {resolutionName[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {m.resolve.noteLabel}
              <textarea className="textarea textarea-sm w-full" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="rounded-box bg-warning/15 px-3 py-2 text-xs">{m.resolve.piiHint}</p>
            <div className="modal-action">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
                {m.resolve.cancel}
              </button>
              <button type="submit" className="btn btn-sm btn-primary" disabled={resolve.busy}>
                {m.resolve.confirm}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function MaskMessage({ deliveryId, requestId, messageId }: { readonly deliveryId: string; readonly requestId: string; readonly messageId: string }) {
  const api = useApi();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mask = useCommand(async (r: string, key) => {
    const res = await request(
      'POST',
      api.execution.POST('/deliveries/{deliveryId}/help-requests/{requestId}/messages/{messageId}/maskings', {
        ...commandParams(key, { path: { deliveryId, requestId, messageId } }),
        body: { reason: r },
      }),
    );
    void client.invalidateQueries({ queryKey: ['help-messages', deliveryId, requestId] });
    return res;
  });
  const ok = reason.trim().length >= 2 && reason.trim().length <= 500;
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-xs text-base-content/60" onClick={() => setOpen(true)}>
        {m.mask.button}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-1 rounded-box border border-base-300 bg-base-100 p-2"
      aria-label={m.mask.button}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (mask.phase.kind === 'rejected') mask.reset();
        void mask.run(reason.trim());
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        {m.mask.reason}
        <input className="input input-xs w-56" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-xs btn-warning" disabled={!ok || mask.busy}>
        {m.mask.button}
      </button>
      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>
        {m.mask.cancel}
      </button>
      <CommandFeedback command={mask}>{() => <span className="text-xs text-success">{m.mask.done}</span>}</CommandFeedback>
    </form>
  );
}
