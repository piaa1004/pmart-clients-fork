// 화면 틀·목록·상세 공통 문구(2026-11-19 통합 백오피스와 맞추기 — 지침 all/2026-11-19-request-ui-ux-align).
// 문구는 web/backoffice/src/shared/messages.ts 의 chrome·queue·savedViews·theme 와 같게, 앱 이름만 이 앱으로.
export const ui = {
  appName: 'PMart 라이더 백오피스',
  chrome: {
    offline: '인터넷 연결이 끊겼어요.',
    offlineHint: '지금 화면의 숫자·목록은 끊기기 전 것이에요. 다시 이어지면 저절로 새로 읽어요.',
    onlineAgain: '다시 연결됐어요 — 화면을 새로 읽는 중이에요.',
    /** 목록에서 최근 열어 본 줄 */
    seen: '최근 봄',
    seenTitle: '이 브라우저에서 최근 열어 본 것이에요(최근 8개).',
    /** 상세 제목 띠 */
    toTop: '↑ 맨 위로',
  },
  queue: {
    label: '목록 순서대로 넘기기',
    backToList: '‹ 보던 목록으로',
    prev: '이전',
    next: '다음',
    position: (at: number, total: number) => `${at} / ${total}`,
  },
  savedViews: {
    title: '내 보기',
    empty: '저장한 보기 없음', // "…없어요"는 목록 빈 안내와 겹쳐 '없음'으로
    add: '+ 지금 조건 저장',
    noFilter: '조건을 먼저 고르세요',
    nameLabel: '보기 이름',
    namePlaceholder: '예: 제한 검토 대기',
    save: '저장',
    cancel: '취소',
    remove: (n: string) => `${n} 보기 지우기`,
  },
  theme: { toDark: '어두운 화면으로', toLight: '밝은 화면으로' },
  /** 숫자 띠(서버가 센 값만) */
  strip: {
    unknown: '?',
    loading: '…',
    /** 서버가 한 쪽(최대 N건)만 돌려줘 전체를 다 세지 못했을 때 */
    atLeast: (n: number) => `${n}건 이상`,
    count: (n: number) => `${n}건`,
    loadedHint: '불러온 것 기준',
  },
  /** 상담함 기다린 시간 — 기한 임박 숨쉬기 */
  waitMinutes: (m: number) => `${m}분째`,
  newMessage: '새 메시지',
  /** 할 일 0건 띠(AllDone) 제목 — 본문은 화면의 빈 안내 그대로 */
  allDone: '수고하셨어요!',
  /** 안내 상자(GuideBox) 제목 — 글머리는 화면에 원래 있던 설명 문장 */
  guideTitle: '화면 안내',
} as const;
