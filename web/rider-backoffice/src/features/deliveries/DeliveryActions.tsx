// 배송 상세 조치(2026-11-17, PC 5): 상태 정정(execution 0.17.0 — 근거 사진 0.22.0), 전달 실패 확정·반려 + 반납할 사람(0.18.0), 지원센터 직접 실패 처리(0.18.0),
// 배차 취소(dispatch). 권한·상태 판정은 서버 — 화면은 지금 상태에 맞는 폼만 보인다.
// 2026-11-18: 관리자 화면 모양(구역 안 작은 상자 — 제목 줄 + 항목명/값 줄 + 아래 버튼)으로.
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { request, type PmartFailure } from '@pmart/web-core';
import { CommandFeedback, failureCode, useCommand } from '@pmart/web-ui';
import { commandParams } from '../../api/command';
import type { components as Dispatch } from '../../api/generated/delivery-dispatch';
import type { components as Execution } from '../../api/generated/delivery-execution';
import { useApi } from '../../app/ApiContext';
import { AuthedPhotos } from '../../shared/AuthedPhotos';
import { useEvidenceLoader } from '../../shared/evidenceLoader';
import { messages } from '../../shared/messages';
import { ops } from '../../shared/opsMessages';
import { label, settled } from '../../shared/opsUi';
import { STAFF_PHOTO_MAX_COUNT, STAFF_PHOTO_TYPES, staffPhotoHint, uploadStaffEvidence } from './staffEvidenceUpload';

type DeliveryExecution = Execution['schemas']['DeliveryExecution'];
type DispatchView = Dispatch['schemas']['Delivery'];
const a = ops.actions;
const n = messages.names;

/** 근거 사진(0.22.0) 문구 — 이 화면에서만 쓴다 */
export const evidenceMessages = {
  label: '근거 사진',
  optional: '(선택)',
  intro: 'JPEG·PNG·WEBP, 10MB 까지 — 최대 10장. 올린 사진은 이 배송에만 쓸 수 있어요.',
  pick: '사진 올리기',
  uploading: '올리는 중…',
  uploaded: (count: number) => `${count}장 올림`,
  remove: (i: number) => `근거 사진 ${i} 빼기`,
  removeShort: (i: number) => `${i} 빼기`,
  hint: {
    type: '이 형식은 받지 않을 수 있어요(JPEG·PNG·WEBP 만) — 서버가 판정해요.',
    size: '10MB 를 넘으면 받지 않을 수 있어요 — 서버가 판정해요.',
  },
  photoInvalid: '사진을 받지 않았어요 — JPEG·PNG·WEBP, 10MB 이하인지 확인해 주세요.',
  photoNotFound: '근거 사진이 이 배송의 사진이 아니라고 해요. 사진을 빼거나 다시 올린 뒤 정정해 주세요.',
  max: '10장까지 넣을 수 있어요.',
} as const;
const ev = evidenceMessages;

const CORRECTABLE: Readonly<Record<string, readonly string[]>> = {
  ASSIGNED: ['ARRIVED_AT_STORE'],
  ARRIVED_AT_STORE: ['ASSIGNED'],
  PICKED_UP: ['ARRIVED_AT_CUSTOMER'],
  ARRIVED_AT_CUSTOMER: ['PICKED_UP'],
};
const FAILURE_REASONS = ['CUSTOMER_ABSENT', 'ADDRESS_ERROR', 'UNREACHABLE', 'REFUSED', 'DAMAGED', 'RIDER_INCIDENT', 'OTHER'] as const;

function Result({ applied }: { readonly applied: boolean }) {
  return (
    <p role="status" className={applied ? 'text-sm text-success' : 'text-sm text-info'} data-testid="action-result">
      {applied ? a.decided : a.accepted}
    </p>
  );
}

/** 조치 상자 — 제목 줄(회색) + 항목 줄 + 아래 버튼·결과 */
function ActionBox({ title, intro, onSubmit, footer, children }: { readonly title: string; readonly intro: string; readonly onSubmit: () => void; readonly footer: ReactNode; readonly children: ReactNode }) {
  return (
    <form
      className="overflow-hidden rounded-box border border-base-300 text-sm"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="border-b border-base-300 bg-base-200/60 px-4 py-2.5">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-base-content/60">{intro}</p>
      </div>
      <div className="space-y-3 px-4 py-3">{children}</div>
      <div className="space-y-2 border-t border-base-300 px-4 py-3">{footer}</div>
    </form>
  );
}

/** 항목명/입력 한 줄 — label 로 감싸 이름으로 찾을 수 있게 */
function Field({ name, children, wide }: { readonly name: ReactNode; readonly children: ReactNode; readonly wide?: boolean }) {
  return (
    <label className="grid items-center gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <span className="text-base-content/60">{name}</span>
      <span className={wide ? 'block' : 'block w-fit'}>{children}</span>
    </label>
  );
}

export function DeliveryActions({ delivery, dispatch }: { readonly delivery: DeliveryExecution; readonly dispatch: DispatchView | undefined }) {
  const state = delivery.state ?? '';
  const forward = delivery.type !== 'RETURN';
  const forms = [
    forward && CORRECTABLE[state] && <CorrectionForm key="correction" delivery={delivery} />,
    state === 'FAILURE_REPORTED' && <FailureDecisionForm key="decide" delivery={delivery} direct={false} />,
    forward && (state === 'PICKED_UP' || state === 'ARRIVED_AT_CUSTOMER') && <FailureDecisionForm key="direct" delivery={delivery} direct />,
    dispatch && (dispatch.state === 'ASSIGNED' || dispatch.state === 'DISPATCHING') && <CancellationForm key="cancel" dispatch={dispatch} />,
  ].filter(Boolean);
  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="delivery-actions">
      {forms.length === 0 ? <p className="text-sm text-base-content/50">{messages.none}</p> : forms}
    </div>
  );
}

function useRefresh(deliveryId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['delivery', deliveryId] });
    void queryClient.invalidateQueries({ queryKey: ['delivery-dispatch', deliveryId] });
  };
}

const codeOf = (phase: { readonly kind: string; readonly failure?: PmartFailure }) => (phase.kind === 'rejected' && phase.failure ? failureCode(phase.failure) : undefined);

function CorrectionForm({ delivery }: { readonly delivery: DeliveryExecution }) {
  const api = useApi();
  const deliveryId = delivery.deliveryId ?? '';
  const refresh = useRefresh(deliveryId);
  const targets = CORRECTABLE[delivery.state ?? ''] ?? [];
  const [target, setTarget] = useState(targets[0] ?? '');
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<readonly string[]>([]);
  const [hint, setHint] = useState<'type' | 'size' | null>(null);
  const loadPhoto = useEvidenceLoader(deliveryId);
  // 한 장씩 올린다 — 결과 불명이면 같은 키로 다시 보내기(같은 사진)
  const upload = useCommand(async (file: File, key) => {
    const photo = await uploadStaffEvidence(api, deliveryId, file, key);
    setPhotos((prev) => (prev.includes(photo.photoRef) ? prev : [...prev, photo.photoRef]));
    return photo;
  });
  const correct = useCommand(
    async (body: { targetState: 'ASSIGNED' | 'ARRIVED_AT_STORE' | 'PICKED_UP' | 'ARRIVED_AT_CUSTOMER'; reason: string; evidenceRefs?: string[] }, key) => {
      try {
        return settled(
          await request(
            'POST',
            api.execution.POST('/deliveries/{deliveryId}/status-corrections', {
              ...commandParams(key, { path: { deliveryId }, ...(delivery.version !== undefined ? { version: delivery.version } : {}) }),
              body,
            }),
          ),
        );
      } finally {
        refresh();
      }
    },
  );
  const sentOrSending = correct.busy || correct.phase.kind === 'done';
  const ok = reason.trim().length >= 2 && target !== '' && !upload.busy;
  const full = photos.length >= STAFF_PHOTO_MAX_COUNT;
  return (
    <ActionBox
      title={a.correction}
      intro={a.correctionIntro}
      onSubmit={() => {
        if (ok) void correct.run({ targetState: target as 'ASSIGNED', reason: reason.trim(), ...(photos.length > 0 ? { evidenceRefs: [...photos] } : {}) });
      }}
      footer={
        <>
          <div className="flex justify-end">
            <button type="submit" className="btn btn-sm btn-primary w-24" disabled={!ok || sentOrSending}>
              {a.correct}
            </button>
          </div>
          <CommandFeedback command={correct} unknown={{ body: a.unknown }}>
            {(r) => <Result applied={r.status === 'APPLIED'} />}
          </CommandFeedback>
          {codeOf(correct.phase) === 'PHOTO_NOT_FOUND' && (
            <p className="text-sm text-error" data-testid="photo-not-found">
              {ev.photoNotFound}
            </p>
          )}
        </>
      }
    >
      <Field name={a.targetState}>
        <select className="select select-sm w-48" value={target} onChange={(e) => setTarget(e.target.value)}>
          {targets.map((t) => (
            <option key={t} value={t}>
              {label(n.executionState, t)}
            </option>
          ))}
        </select>
      </Field>
      <Field name={a.reason} wide>
        <input className="input input-sm w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3" data-testid="staff-evidence">
        <span className="pt-1 text-base-content/60">
          {ev.label} <span className="text-xs text-base-content/40">{ev.optional}</span>
        </span>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className={`btn btn-sm border-base-300 bg-base-100 ${upload.busy || full || sentOrSending ? 'btn-disabled' : ''}`}>
              {upload.phase.kind === 'running' ? ev.uploading : ev.pick}
              <input
                type="file"
                className="sr-only"
                aria-label={ev.label}
                accept={STAFF_PHOTO_TYPES.join(',')}
                disabled={upload.busy || full || sentOrSending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setHint(staffPhotoHint(file));
                  void upload.run(file);
                }}
              />
            </label>
            {photos.length > 0 && <span className="text-xs text-base-content/60">{ev.uploaded(photos.length)}</span>}
            {full && <span className="text-xs text-base-content/60">{ev.max}</span>}
          </div>
          <p className="text-xs text-base-content/50">{ev.intro}</p>
          {hint && (
            <p className="text-xs text-warning" data-testid="photo-hint">
              {ev.hint[hint]}
            </p>
          )}
          <CommandFeedback command={upload} unknown={{ body: a.unknown }} />
          {codeOf(upload.phase) === 'PHOTO_INVALID' && <p className="text-sm text-error">{ev.photoInvalid}</p>}
          {photos.length > 0 && (
            <div className="space-y-1">
              <AuthedPhotos refs={photos} load={loadPhoto} label={ev.label} heading={false} />
              {!sentOrSending && (
                <div className="flex flex-wrap gap-1">
                  {photos.map((ref, i) => (
                    <button key={ref} type="button" className="btn btn-ghost btn-xs" aria-label={ev.remove(i + 1)} onClick={() => setPhotos((prev) => prev.filter((x) => x !== ref))}>
                      {ev.removeShort(i + 1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ActionBox>
  );
}

function FailureDecisionForm({ delivery, direct }: { readonly delivery: DeliveryExecution; readonly direct: boolean }) {
  const api = useApi();
  const deliveryId = delivery.deliveryId ?? '';
  const refresh = useRefresh(deliveryId);
  const [decision, setDecision] = useState<'CONFIRM' | 'REJECT' | ''>(direct ? 'CONFIRM' : '');
  const [custody, setCustody] = useState<'RIDER' | 'STORE'>('RIDER');
  const [returnBy, setReturnBy] = useState<'SAME_RIDER' | 'OTHER_RIDER'>(direct ? 'OTHER_RIDER' : 'SAME_RIDER');
  const [reason, setReason] = useState<(typeof FAILURE_REASONS)[number]>('RIDER_INCIDENT');
  const [note, setNote] = useState('');
  const decide = useCommand(async (body: Record<string, unknown>, key) => {
    try {
      return settled(
        await request(
          'POST',
          api.execution.POST('/deliveries/{deliveryId}/failure-decisions', {
            ...commandParams(key, { path: { deliveryId }, ...(delivery.version !== undefined ? { version: delivery.version } : {}) }),
            body: body as never,
          }),
        ),
      );
    } finally {
      refresh();
    }
  });
  // 직접 확정은 확인 칸을 체크해야 보낼 수 있다 — 반려 직후 같은 자리에 이 양식이 떠서 두 번 누르면
  // "확정·다른 라이더 반납"으로 들어갔다(사용자 2026-11-19 28767701-1).
  const [sure, setSure] = useState(false);
  const title = direct ? a.directTitle : a.decideTitle;
  return (
    <ActionBox
      title={title}
      intro={direct ? a.directIntro : a.decideIntro}
      onSubmit={() => {
        if (!decision || (direct && !sure)) return;
        void decide.run({
          decision,
          ...(decision === 'CONFIRM' ? { custody, ...(custody === 'RIDER' ? { returnBy } : {}) } : {}),
          ...(direct ? { reason } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }}
      footer={
        <>
          <div className="flex justify-end">
            <button type="submit" className="btn btn-sm btn-primary w-24" disabled={!decision || (direct && !sure) || decide.busy || decide.phase.kind === 'done'}>
              {a.decide}
            </button>
          </div>
          <CommandFeedback command={decide} unknown={{ body: a.unknown }}>
            {(r) => <Result applied={r.status === 'APPLIED'} />}
          </CommandFeedback>
        </>
      }
    >
      {!direct && (
        <fieldset className="grid items-center gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
          <legend className="sr-only">{a.decision}</legend>
          <span className="text-base-content/60" aria-hidden>
            {a.decision}
          </span>
          <span className="flex gap-4">
            {(['CONFIRM', 'REJECT'] as const).map((d) => (
              <label key={d} className="flex items-center gap-1.5">
                <input type="radio" className="radio radio-sm radio-primary" name={`decision-${deliveryId}`} checked={decision === d} onChange={() => setDecision(d)} />
                {label(n.decision, d)}
              </label>
            ))}
          </span>
        </fieldset>
      )}
      {direct && (
        <Field name={a.failureReason}>
          <select className="select select-sm w-48" value={reason} onChange={(e) => setReason(e.target.value as (typeof FAILURE_REASONS)[number])}>
            {FAILURE_REASONS.map((x) => (
              <option key={x} value={x}>
                {label(n.failureReason, x)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {decision === 'CONFIRM' && (
        <>
          <Field name={a.custody}>
            <select className="select select-sm w-48" value={custody} onChange={(e) => setCustody(e.target.value as 'RIDER' | 'STORE')}>
              {(['RIDER', 'STORE'] as const).map((x) => (
                <option key={x} value={x}>
                  {label(n.custody, x)}
                </option>
              ))}
            </select>
          </Field>
          {custody === 'RIDER' && (
            <Field name={a.returnBy}>
              <select className="select select-sm w-56" value={returnBy} onChange={(e) => setReturnBy(e.target.value as 'SAME_RIDER' | 'OTHER_RIDER')}>
                {(['SAME_RIDER', 'OTHER_RIDER'] as const).map((x) => (
                  <option key={x} value={x}>
                    {a.returnByName[x]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      <Field name={a.note} wide>
        <textarea className="textarea w-full" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {direct && (
        <label className="flex items-start gap-2 rounded-box bg-warning/15 px-3 py-2 text-sm">
          <input type="checkbox" className="checkbox checkbox-sm mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          <span>{a.directSure}</span>
        </label>
      )}
    </ActionBox>
  );
}

type CancelReason = 'RIDER_UNABLE' | 'STORE_REQUEST' | 'NO_SHOW' | 'OPERATOR';

function CancellationForm({ dispatch }: { readonly dispatch: DispatchView }) {
  const api = useApi();
  const deliveryId = dispatch.deliveryId ?? '';
  const refresh = useRefresh(deliveryId);
  const [reason, setReason] = useState<CancelReason>('OPERATOR');
  const [reassign, setReassign] = useState(true);
  const cancel = useCommand(async (body: { requestedBy: 'OPERATOR'; reason: CancelReason; reassign: boolean }, key) => {
    try {
      return settled(
        await request(
          'POST',
          api.dispatch.POST('/deliveries/{deliveryId}/assignment-cancellations', {
            ...commandParams(key, { path: { deliveryId } }),
            body: body as never,
          }),
        ),
      );
    } finally {
      refresh();
    }
  });
  return (
    <ActionBox
      title={a.cancelTitle}
      intro={a.cancelIntro}
      onSubmit={() => void cancel.run({ requestedBy: 'OPERATOR', reason, reassign })}
      footer={
        <>
          <div className="flex justify-end">
            <button type="submit" className="btn btn-sm btn-warning w-24" disabled={cancel.busy || cancel.phase.kind === 'done'}>
              {a.cancel}
            </button>
          </div>
          <CommandFeedback command={cancel} unknown={{ body: a.unknown }}>
            {(r) => <Result applied={r.status === 'APPLIED'} />}
          </CommandFeedback>
        </>
      }
    >
      <Field name={a.cancelReason}>
        <select className="select select-sm w-48" value={reason} onChange={(e) => setReason(e.target.value as CancelReason)}>
          {(Object.keys(a.cancelReasonName) as CancelReason[]).map((x) => (
            <option key={x} value={x}>
              {a.cancelReasonName[x]}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex items-center gap-2 sm:pl-[8.75rem]">
        <input type="checkbox" className="checkbox checkbox-sm" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />
        {a.reassign}
      </label>
    </ActionBox>
  );
}
