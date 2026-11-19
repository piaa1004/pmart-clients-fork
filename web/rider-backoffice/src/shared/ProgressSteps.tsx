// 사본: web/backoffice/src/shared/ProgressSteps.tsx (main 21561b2) — 이 앱에서 따로 고친다. web-ui 로 옮겨질 예정(지침 §0).
// 진행 단계 줄(2026-11-18) — 주문 진행(OrderProgress)과 승인 진행이 같이 쓴다(Refine·Saleor 타임라인 참고).
// 서버 상태를 단계 자리로 바꾸는 일은 부르는 쪽이 한다. 모르는 상태는 단계를 칠하지 않고 아래에 그 값을 그대로 적는다.
export interface StepPlace {
  readonly step: number;
  readonly done: boolean;
  readonly note?: string;
  readonly warn?: boolean;
}

export function ProgressSteps({
  steps,
  place,
  ended,
  unknownText,
  label,
  testId,
  endedTestId,
}: {
  readonly steps: readonly string[];
  readonly place: StepPlace | null;
  /** 단계 밖으로 끝남(취소·반려 등) — 오른쪽에 ✕ 갈래 */
  readonly ended?: string | undefined;
  readonly unknownText?: string | undefined;
  readonly label: string;
  readonly testId: string;
  readonly endedTestId: string;
}) {
  return (
    <section aria-label={label} className="rounded-box border border-base-300 bg-base-100 px-5 py-4 shadow-sm" data-testid={testId}>
      <ol className="flex items-start">
        {steps.map((name, i) => {
          const state = !place ? 'todo' : i < place.step || (i === place.step && place.done) ? 'done' : i === place.step ? 'now' : 'todo';
          const circle =
            state === 'done'
              ? 'bg-success text-white'
              : state === 'now'
                ? place?.warn
                  ? 'bg-warning text-warning-content ring-4 ring-warning/20'
                  : 'bg-primary text-primary-content ring-4 ring-primary/20'
                : 'bg-base-200 text-base-content/40';
          // 이 단계로 들어오는 선(앞 단계 → 이 단계) — 이 단계에 닿았으면 초록(2026-11-19 사용자 "완료인데 막대가 끝까지 안 간다": `<` 라 마지막 단계 앞 반쪽이 회색이었다)
          const line = place && i <= place.step ? 'bg-success' : 'bg-base-300';
          return (
            <li key={name} className="relative flex flex-1 flex-col items-center text-center" aria-current={state === 'now' ? 'step' : undefined} data-step-state={state}>
              {i > 0 && <span className={`absolute left-0 right-1/2 top-4 -z-0 h-0.5 -translate-y-1/2 ${line}`} aria-hidden="true" />}
              {i < steps.length - 1 && <span className={`absolute left-1/2 right-0 top-4 -z-0 h-0.5 -translate-y-1/2 ${place && i < place.step ? 'bg-success' : 'bg-base-300'}`} aria-hidden="true" />}
              <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${circle}`} aria-hidden="true">
                {/* 진행 중 표시(2026-11-19) — 지금 단계에서만 고리가 천천히 퍼진다(움직임 줄이기면 없음) */}
                {state === 'now' && <span className={`step-pulse ${place?.warn ? 'text-warning' : 'text-primary'}`} data-testid="step-pulse" />}
                {/* 끝난 단계 — 글자 ✓ 대신 굵은 흰 선 체크(2026-11-19 사용자 "체크가 조잡해 보인다") */}
                {state === 'done' ? <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-testid="step-check"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> : i + 1}
              </span>
              <span className={`mt-2 text-xs ${state === 'now' ? 'font-bold' : state === 'done' ? 'text-base-content/80' : 'text-base-content/45'}`}>{name}</span>
              {state === 'now' && place?.note && <span className={`mt-0.5 text-[11px] ${place.warn ? 'text-warning' : 'text-base-content/55'}`}>{place.note}</span>}
            </li>
          );
        })}
        {ended && (
          <li className="flex flex-col items-center pl-3 text-center" data-testid={endedTestId}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-error text-sm font-bold text-error-content" aria-hidden="true">
              ✕
            </span>
            <span className="mt-2 text-xs font-bold text-error">{ended}</span>
          </li>
        )}
      </ol>
      {!place && !ended && unknownText && <p className="mt-2 text-center text-xs text-base-content/50">{unknownText}</p>}
    </section>
  );
}
