// 로그인 화면의 "비밀번호 저장" / "자동로그인" 설정 (localStorage).
// localStorage 접근은 저장을 막은 환경에서 예외가 날 수 있어 전부 try/catch로 감싼다.
// 주의: 비밀번호는 이 기기의 localStorage에 평문으로 남는다.
import { AUTO_LOGIN_STORAGE_KEY, SAVED_LOGIN_STORAGE_KEY } from "./constants";

export interface SavedLogin {
  loginId: string;
  password: string;
}

/** 저장된 아이디/비밀번호. 없거나 손상됐으면 null */
export const loadSavedLogin = (): SavedLogin | null => {
  try {
    const raw = localStorage.getItem(SAVED_LOGIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.loginId !== "string" || typeof parsed?.password !== "string") return null;
    return { loginId: parsed.loginId, password: parsed.password };
  } catch {
    return null;
  }
};

/** null이면 저장값을 지운다 */
export const saveLogin = (login: SavedLogin | null) => {
  try {
    if (login) localStorage.setItem(SAVED_LOGIN_STORAGE_KEY, JSON.stringify(login));
    else localStorage.removeItem(SAVED_LOGIN_STORAGE_KEY);
  } catch {
    // 무시
  }
};

export const isAutoLogin = (): boolean => {
  try {
    return localStorage.getItem(AUTO_LOGIN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

export const setAutoLogin = (on: boolean) => {
  try {
    if (on) localStorage.setItem(AUTO_LOGIN_STORAGE_KEY, "1");
    else localStorage.removeItem(AUTO_LOGIN_STORAGE_KEY);
  } catch {
    // 무시
  }
};
