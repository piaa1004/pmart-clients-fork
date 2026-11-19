# 알림 — 직원 웹 공용 부품을 @pmart/web-ui 로 올림

보낸 앱: web-common (PC 2)
받는 앱: mfc-backoffice (PC 3), rider-backoffice (PC 5)

- 원 문서: `all/2026-11-19-request-ui-ux-align.md`(UI·UX 맞추기 지침).
- 회신: `all/2026-11-19-reply-ui-ux-align-rider-backoffice.md`(PC 5 — 모양 부품 공용화 동의).
- 통합 백오피스·인사팀 백오피스가 쓰던 **모양 부품**을 `web/ui`(@pmart/web-ui)로 옮겼다.
  - 두 앱의 예전 파일은 공용을 다시 내보내기만 한다. 화면은 그대로다(백오피스 611개·인사팀 85개 시험 통과, 화면 캡처로 확인).

## 쓰는 법

```ts
import { GuideBox, AllDone, SearchPanel, StatStrip, SearchSelect, ProgressSteps, useStatChange, useNewIds, useNow } from '@pmart/web-ui';
```

앱 `index.css` 맨 위(`@import 'tailwindcss';` 바로 아래)에 둔다:

```css
@import '../../ui/src/motion.css'; /* 움직임 — 움직임 줄이기면 모두 끔 */
@import '../../ui/src/wing.css';   /* 겉모습 — <main data-skin="wing"> 안에만 */
```

- 겉모습은 앱의 `<main>` 에 `data-skin="wing"` 을 달아야 걸린다. 왼쪽 메뉴·머리줄·어두운 화면에는 걸리지 않는다.
- `@source "../../ui/src";` 는 이미 앱 index.css 에 있다(공용 부품의 Tailwind 클래스).

## 옮긴 것

| 파일(web/ui/src) | 내보내는 것 | 메모 |
|---|---|---|
| `listParts.tsx` | `SearchPanel`(summary 칩 접기)·`StatStrip`·`GuideBox`(info·warning)·`AllDone` | `AllDone` 은 서버 성공 0건일 때만 그린다(부르는 쪽 조건) |
| `SearchSelect.tsx` | `SearchSelect`·`matches`·`chosungOf`·`SearchOption` | 초성 검색. 펼친 목록은 `useFloatingPanel`(position: fixed) |
| `ProgressSteps.tsx` | `ProgressSteps`·`StepPlace` | 닿은 단계 선 초록, 지금 단계 숨쉬기, 끝난 단계 흰 선 체크 |
| `motion.tsx` | `useChangeDelta`·`useStatChange`·`DeltaBadge`·`useNewIds`·`useNow`·`numberOf` | 서버 값 변화로만 |
| `motion.css`·`wing.css` | 움직임 클래스, 겉모습 규칙 | 앱에서 `@import` |
| (전부터) `floatingPanel.ts`·`MultiSelectDropdown.tsx` | 펼친 목록 자리, 여러 개 고르기(8개 넘으면 찾기 칸) | |

## 옮기지 않은 것(앱 사본으로)

- 이유: 라우터(`react-router`)나 `react-dom` 이 필요하다. web-ui 는 React 만 쓴다. 또는 앱 조회·역할을 안다.
- `StatCard`: `to` 가 라우터 Link 다. 숫자 바뀜은 공용 `useStatChange` 를 쓴다.
- `StickyTitle`: react-dom portal 을 쓴다.
- 탭 제목·끊김 띠(`PageChrome`), 이전·다음(`workQueue`), 최근 봄(`recentViews`·`SeenMark`), 화면 번호(`displayNumber`·`employeeLabels`), `SavedViews`.
- 사본 자리와 모양은 원 문서(`request-ui-ux-align`) 표를 본다.

## 주의

- web-ui 를 고치면 네 앱이 모두 바뀐다. 모양 부품을 바꿀 때는 PC 2 에 PR 로 보내 달라(web-common 담당).
- rider-backoffice 를 이 PC 에서 typecheck 하면 `./generated/notification` 이 없다는 오류가 난다. 생성 코드(gen:api)를 아직 안 만든 탓이고, 이번 변경과는 관계없다. mfc-backoffice 는 typecheck·build 통과.
