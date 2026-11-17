# 알림: 고객앱 주소 검색(카카오 우편번호) 옛 도메인 — 2026-11-30 종료

- 보낸 앱: rider-app (PC 5)
- 받는 곳: PC 1 (customer-app). 백엔드 변경 없음.
- 작성: 2026-11-17
- 상태: 라이더앱은 반영함. 고객앱은 PC 1 담당이라 고치지 않았다.

## 무엇
- 카카오 우편번호 서비스의 스크립트 주소와 이름이 바뀌었다.
  - 주소: `t1.daumcdn.net` → `t1.kakaocdn.net`
  - 이름: `daum.Postcode` → `kakao.Postcode`
- 옛 주소로 불러오면 검색 창 위에 개발자용 공지가 사용자에게 보인다.
  > "t1.daumcdn.net 도메인 종료 안내 - 2026년 11월 30일까지 t1.kakaocdn.net으로 변경해 주세요."
- 이 공지는 스크립트(버전 261109)가 옛 주소로 불렸을 때만 띄운다. `_legacyCdn_` 이 참일 때 `noticeText` 를 채우는 방식이다.
- **11월 30일 뒤에는 옛 주소가 종료돼 주소 검색이 안 될 수 있다.** 공지 문구 기준이다.
- 라이더앱에서 이 공지를 사용자가 발견했다(2026-11-17).

## 고객앱 위치
`apps/customer_app/lib/features/address/presentation/postcode_screen.dart:47·50`
- 47행: `<script src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js">`
- 50행: `new daum.Postcode({`

## 라이더앱에서 바꾼 것 (참고)
```html
<script src="https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"></script>
...
var Postcode = (window.kakao && kakao.Postcode) || daum.Postcode;
new Postcode({ oncomplete: ..., banner: false, width: '100%', height: '100%' })
```
- 새 주소가 200 으로 열리는 것을 확인했다(2026-11-17).
- `banner: false` 는 서비스 배너를 끄는 옵션이다. 기본값은 켜짐이다.
- 참고: https://github.com/daumPostcode/QnA , https://devtalk.kakao.com/t/topic/149327
