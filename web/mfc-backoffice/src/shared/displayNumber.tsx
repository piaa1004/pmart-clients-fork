// 화면 번호(ADR-0070, bff 0.14.0·0.15.0 — 백엔드 알림 clients/all/2026-11-18-notice-display-numbers). web/backoffice displayNumber.tsx 와 같은 규칙.
// - 목록·표에는 화면 번호만: 주문 orderNumber(8자리), 배송 deliveryNumber("주문번호-순번") + 종류, 라이더 가린 이름 + 라이더 번호 6자리.
// - 시스템 ID(orderId·deliveryId·riderId·packageId)는 접힌 "시스템 번호" 칸에만(복사 단추).
// - 화면 번호가 null(옛 기록·번호 전 주문)이면 "번호 없음"만(ADR-0070 덧붙임 2026-11-19 — 끝 8자리도 쓰지 않는다). 번호를 화면에서 만들지 않는다.
// - 라이더: 센터 관리자는 rider-service 가 403 이라 bff 가 번호·이름을 null 로 준다(0.15.0, unavailableSources 아님) — "번호 없음"이 아니라
//   "라이더 정보 비공개"로 보인다(없는 것과 못 보는 것을 섞지 않는다). 번호가 오면 그대로 보인다.
import type { components } from '../api/generated/backoffice-bff';
import { CopyButton } from './CopyButton';
import { messages } from './messages';

const m = messages.displayNumber;

export type RiderDisplay = components['schemas']['RiderDisplay'];

/** 번호가 없을 때 — 시스템 ID 도 "끝 8자리 회색"도 보이지 않는다(ADR-0070 덧붙임 2026-11-19). 시스템 ID 는 상세의 시스템 번호 칸에서 */
function Fallback({ note, kind }: { readonly note: string; readonly kind: string }) {
  return (
    <span data-testid="display-number" data-fallback={kind} className="text-xs text-base-content/50">
      {note}
    </span>
  );
}

/** 주문·배송 화면 번호 한 칸. 번호를 읽는 원천이 실패했으면(failed) "번호 확인 불가" — 없는 것과 못 읽은 것을 섞지 않는다 */
export function DisplayNumber({ number, systemId, failed = false }: { readonly number?: string | null | undefined; readonly systemId?: string | null | undefined; readonly failed?: boolean }) {
  if (number)
    return (
      <span className="font-mono" data-testid="display-number">
        {number}
      </span>
    );
  if (!systemId) return <span>{messages.none}</span>;
  return failed ? <Fallback note={m.failed} kind="failed" /> : <Fallback note={m.missing} kind="missing" />;
}

/** 라이더 한 칸 — "김*수 · 482913". 번호가 없으면 "라이더 정보 비공개". 라이더가 없으면 부르는 쪽이 정한다. */
export function RiderLabel({ rider, riderId }: { readonly rider?: RiderDisplay | null | undefined; readonly riderId?: string | null | undefined }) {
  const id = rider?.riderId ?? riderId ?? null;
  if (rider?.riderNumber)
    return (
      <span data-testid="rider-label">
        {rider.nameMasked ? `${rider.nameMasked} · ` : ''}
        <span className="font-mono">{rider.riderNumber}</span>
      </span>
    );
  if (!id) return <span>{messages.none}</span>;
  return (
    <span data-testid="rider-label">
      <Fallback note={m.riderHidden} kind="hidden" />
    </span>
  );
}

/** 접힌 "시스템 번호" 칸 — 값이 있는 것만 */
export function SystemNumbers({ ids }: { readonly ids: ReadonlyArray<{ readonly label: string; readonly id: string | null | undefined }> }) {
  const shown = ids.filter((x): x is { readonly label: string; readonly id: string } => typeof x.id === 'string' && x.id !== '');
  if (shown.length === 0) return null;
  return (
    <details className="text-xs" data-testid="system-numbers">
      <summary className="cursor-pointer text-base-content/60">{m.systemNumbers}</summary>
      <dl className="mt-1 grid grid-cols-[4rem_1fr] gap-x-3 gap-y-0.5">
        {shown.map((x) => (
          <div key={`${x.label}:${x.id}`} className="contents">
            <dt className="text-base-content/60">{x.label}</dt>
            <dd className="flex items-center gap-1 break-all font-mono">
              {x.id}
              <CopyButton value={x.id} label={`${x.label} ${x.id}`} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
