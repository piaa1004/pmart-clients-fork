// 긴 시스템 ID(UUID 등)를 화면에 그대로 늘어놓지 않기(사용자 2026-11-26 "긴 식별값은 간단한 번호로").
// 화면 번호(서버 값)가 있으면 그걸 쓰고, 없을 때만 이걸로 줄인다 — 앞 글자와 끝 4자리(전체는 마우스 올리면).
export function shortRef(id: string | null | undefined): string {
  if (!id) return '';
  if (id.length <= 16) return id;
  const head = /^[A-Z]+-/.exec(id)?.[0] ?? '';
  return `${head}…${id.slice(-4)}`;
}
