/** 로그인 ID 저장 키 (새 창으로 ID 전달용) */
export const LOGIN_ID_STORAGE_KEY = "vibe_talk_login_id";
/** 탭별 메인 창 ID 키 (sessionStorage, 탭 격리용) */
export const MAIN_ID_STORAGE_KEY = "vibe_talk_main_id";
/**
 * 내 상태 저장 키 (localStorage).
 * status_set으로 서버에도 전파되지만, 새로고침 후 드롭다운 복원을 위해
 * 이 브라우저에도 남긴다.
 */
export const MY_STATUS_STORAGE_KEY = "vibe_talk_my_status";
/** 로그인 화면 "비밀번호 저장" 값 ({ loginId, password } JSON, localStorage) */
export const SAVED_LOGIN_STORAGE_KEY = "vibe_talk_saved_login";
/** 로그인 화면 "자동로그인" 여부 ("1"이면 켜짐, localStorage) */
export const AUTO_LOGIN_STORAGE_KEY = "vibe_talk_auto_login";

