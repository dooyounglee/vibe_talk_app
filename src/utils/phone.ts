// 전화번호 검사 (서버 db.js normalizePhone과 같은 규칙)
// 0으로 시작, 숫자 9~11자리, 하이픈 선택(쓰면 자리까지 맞아야 함) (02 지역번호는 9~10자리, 그 외 10~11자리).
// 유효하면 하이픈 형식(010-1234-5678 / 02-123-4567)으로 돌려주고, 아니면 null.
export const normalizePhone = (v: string): string | null => {
  const raw = v.trim();
  // 하이픈을 쓰면 위치까지 맞아야 한다 (010-1234-5678 / 02-123-4567)
  if (!/^\d+$/.test(raw) && !/^0\d{1,2}-\d{3,4}-\d{4}$/.test(raw)) return null;
  const digits = raw.replace(/-/g, "");
  const area = digits.startsWith("02") ? 2 : 3;
  const ok = area === 2 ? /^02\d{7,8}$/.test(digits) : /^0\d{9,10}$/.test(digits);
  if (!ok) return null;
  return `${digits.slice(0, area)}-${digits.slice(area, -4)}-${digits.slice(-4)}`;
};
