// 공용(2026-11-19 PC 2 web-common — 직원 웹 UI·UX 맞추기, docs/handoff/all/2026-11-19-request-ui-ux-align.md). 처음 자리: web/backoffice/src/shared/SearchSelect.tsx
// 쳐서 찾는 고르기 칸(2026-11-19 사용자 "콘텐츠 등록 같은 데서 고를 때 검색으로 찾는 것도 필요 — 데이터가 많아지면 일일이 찾기 힘들다").
// 드롭다운(select) 대신: 칸에 글자를 치면 목록이 좁혀지고 ↑↓ 로 옮기고 Enter 로 고른다. Esc 는 닫기.
// 찾기: 띄어쓰기·대소문자 무시, 이름·보조 글자·숨은 낱말(시스템 ID 등 — 붙여 넣기용)에서. 한글 초성도("ㅅㄱ" → 사과).
// 화면에서 거르는 것 — 서버 검색이 아니다(불러온 목록 안에서만). 고른 값·바뀜은 부모가 정한다.
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useFloatingPanel } from './floatingPanel';

export interface SearchOption {
  readonly value: string;
  /** 목록·칸에 보이는 이름 */
  readonly label: string;
  /** 이름 옆 작은 글자(상태 등) */
  readonly hint?: string;
  /** 보이지 않지만 찾기에 쓰는 낱말(시스템 ID 등) */
  readonly keywords?: string;
}

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
/** 한글 음절 → 초성(그 밖 글자는 그대로) */
export const chosungOf = (s: string) =>
  [...s]
    .map((ch) => {
      const c = ch.charCodeAt(0) - 0xac00;
      return c >= 0 && c <= 11171 ? CHO[Math.floor(c / 588)] : ch;
    })
    .join('');
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const isJamoOnly = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);

/** 넣은 말이 이 고르기 항목에 맞나 */
export function matches(o: SearchOption, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const hay = norm(`${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`);
  if (hay.includes(q)) return true;
  return isJamoOnly(q) && chosungOf(norm(o.label)).includes(q);
}

const MAX_SHOWN = 100;

export function SearchSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  loading = false,
  loadingText = '불러오는 중…',
  emptyText = '맞는 것이 없어요.',
  disabled = false,
  allowEmpty,
  footer,
  className = '',
  testId,
}: {
  /** 칸 이름(화면 읽기·시험은 이 이름으로 찾는다) */
  readonly label: string;
  readonly value: string;
  readonly options: readonly SearchOption[];
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly loading?: boolean;
  readonly loadingText?: string;
  readonly emptyText?: string;
  readonly disabled?: boolean;
  /** 비우기 항목(예: "모든 센터") — 있으면 목록 맨 위 */
  readonly allowEmpty?: string;
  /** 목록 아래 덧붙임(예: "더 불러오기") */
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.value === value);
  const all = useMemo<SearchOption[]>(() => (allowEmpty !== undefined ? [{ value: '', label: allowEmpty }, ...options] : [...options]), [allowEmpty, options]);
  const shown = useMemo(() => all.filter((o) => matches(o, text)), [all, text]);
  const visible = shown.slice(0, MAX_SHOWN);
  // 목록은 화면 고정 자리(position: fixed)에 띄운다 — 카드(overflow-hidden) 가장자리에서 잘리지 않게(2026-11-19 사용자 캡처). 모달 안에서도 그 위에 보이도록 다른 곳으로 옮기지는 않는다
  const float = useFloatingPanel(box, open && !loading);
  // ↑↓ 로 옮기면 그 항목이 보이게
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, listId]);

  // 바깥을 누르면 닫는다(고르지 않고 닫으면 넣던 글자는 버린다)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current && !box.current.contains(t) && !panel.current?.contains(t)) {
        setOpen(false);
        setText('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (o: SearchOption) => {
    onChange(o.value);
    setOpen(false);
    setText('');
    input.current?.blur();
  };
  // 닫혀 있으면 고른 것의 이름(목록에 없는 값이면 값 그대로 — 상품 상세에서 넘어온 ID 등)
  const shownText = open ? text : (selected?.label ?? value);

  return (
    <div ref={box} className={`relative ${className}`} data-testid={testId}>
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
        className="input input-sm w-full pr-8"
        placeholder={loading ? loadingText : open && selected ? selected.label : (placeholder ?? allowEmpty ?? '')}
        value={shownText}
        disabled={disabled || loading}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(visible.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && visible[active]) {
              e.preventDefault();
              choose(visible[active]);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
            setText('');
          }
        }}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-base-content/40" aria-hidden="true">
        ▾
      </span>
      {open &&
        !loading &&
        (
        <div ref={panel} style={float ?? { position: 'fixed', visibility: 'hidden' }} className="flex flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-lg">
          <ul id={listId} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto py-1 text-sm">
            {visible.length === 0 && <li className="px-3 py-2 text-base-content/50">{emptyText}</li>}
            {visible.map((o, i) => (
              <li
                key={o.value || '__empty'}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 ${i === active ? 'bg-primary/10' : ''} ${o.value === value ? 'font-semibold' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
              >
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-xs text-base-content/50">{o.hint}</span>}
              </li>
            ))}
            {shown.length > MAX_SHOWN && <li className="px-3 py-1.5 text-xs text-base-content/50">{`${shown.length - MAX_SHOWN}개 더 — 글자를 더 넣어 좁혀 보세요`}</li>}
          </ul>
          {footer && <div className="shrink-0 border-t border-base-300 px-2 py-1.5">{footer}</div>}
        </div>
      )}
    </div>
  );
}
