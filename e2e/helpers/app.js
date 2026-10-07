// 앱(WebView2) 조작 공통 헬퍼
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCurrent } from "./coverage.js";

/**
 * 깨끗한 로그인 화면으로 되돌린다.
 * WebView2 프로필은 실행이 끝나도 남아서, 저장된 로그인 ID가 있으면 앱이 자동으로 입장하기 때문이다.
 * 새로고침하면 window.__coverage__ 가 사라지므로 그 전에 수집한다.
 */
export const resetApp = async () => {
  await collectCurrent();
  await browser.execute(() => localStorage.clear());
  await browser.refresh();
};

/**
 * 입력칸을 비운다. WebView2에서는 clearValue()가 input 이벤트를 내지 않아 Vue v-model이 그대로 남으므로
 * 키보드로 전체 선택 후 지운다.
 */
export const clearInput = async (el) => {
  await el.click();
  await browser.keys(["Control", "a"]);
  await browser.keys("Backspace");
};

/** 로그인 화면에 아이디/비밀번호를 넣고 입장 버튼을 누른다 (결과는 기다리지 않는다) */
export const submitLogin = async (loginId, password) => {
  // 비밀번호 칸도 nickname-input 클래스를 함께 쓰므로 아이디 칸만 고른다
  const idInput = $(".nickname-input:not(.password-input)");
  await idInput.waitForDisplayed({ timeout: 10_000 });
  await idInput.setValue(loginId);
  await $(".password-input").setValue(password);
  await $(".start-button").click();
};

/** 깨끗한 상태에서 로그인하고 메인 화면이 뜰 때까지 기다린다 */
export const loginAs = async (loginId, password) => {
  await resetApp();
  await submitLogin(loginId, password);
  await $(".main-screen").waitForDisplayed({ timeout: 10_000 });
};

/** 팝업 창 대신 같은 창에서 방을 연다 (라우트 이동 → 소켓 직접 사용 모드) */
export const openRoomHere = async (roomId) => {
  await browser.execute((id) => {
    window.location.hash = `#/room/${id}`;
  }, roomId);
  await $(".chat-body").waitForDisplayed({ timeout: 10_000 });
};

/** E2E_SHOT_DIR 환경변수를 주면 그 폴더에 스크린샷을 남긴다 */
export const shot = async (name) => {
  const dir = process.env.E2E_SHOT_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await browser.saveScreenshot(path.join(dir, `${name}.png`));
};

// ─── 창 전환 ───
// Tauri의 방 창(#/room/:id), 이미지 창(#/image/:id), 토스트 창(#/toast)도 각각 WebDriver window handle로 보인다.

/** URL(hash)이 조건에 맞는 창으로 전환한다. 창이 늦게 뜰 수 있어 잠시 기다린다 */
export const switchToWindowWhere = async (pred, { timeout = 10_000, what = "창" } = {}) => {
  let found = null;
  await browser.waitUntil(
    async () => {
      for (const h of await browser.getWindowHandles()) {
        try {
          await browser.switchToWindow(h);
          if (pred(await browser.getUrl())) {
            found = h;
            return true;
          }
        } catch {
          // 닫히는 중인 창은 건너뛴다
        }
      }
      return false;
    },
    { timeout, timeoutMsg: `${what}을(를) 찾지 못함` },
  );
  return found;
};

/** 메인 창(#/)으로 전환 */
export const switchToMain = () =>
  switchToWindowWhere((url) => /#\/?$/.test(url) || !url.includes("#/"), { what: "메인 창" });

/** 방 창(#/room/:id)으로 전환하고 채팅 영역이 뜰 때까지 기다린다 */
export const switchToRoom = async (roomId) => {
  const h = await switchToWindowWhere((url) => url.includes(`#/room/${roomId}?`) || url.endsWith(`#/room/${roomId}`), {
    what: `방 #${roomId} 창`,
  });
  await $(".chat-body").waitForDisplayed({ timeout: 10_000 });
  return h;
};

/** 방/이미지 창을 앱의 닫기로 닫고 메인 창으로 돌아온다 */
export const closeCurrentWindow = () => closeExtraWindows();

/** 메인 창 '내 채팅방' 목록에서 이름(또는 미리보기)에 text가 들어간 방 항목 */
export const roomItem = (text) => $(`.room-item*=${text}`);

/** 탭 전환: "채팅방" / "사용자" / "설정" 등 버튼 텍스트로 */
export const openTab = async (label) => {
  await $(".tab-row").$(`button*=${label}`).click();
};

/**
 * 방/이미지 창을 모두 닫고(커버리지 수집 후) 메인 창으로 돌아온다. 토스트 창은 앱이 계속 쓰므로 둔다.
 * WebDriver closeWindow()로 닫으면 앱이 창이 닫힌 걸 몰라 같은 방을 다시 열지 못하므로,
 * 사용자처럼 앱의 닫기(✕ / Esc)로 닫고 사라질 때까지 기다린다.
 */
export const closeExtraWindows = async () => {
  for (const h of await browser.getWindowHandles()) {
    try {
      await browser.switchToWindow(h);
      const url = await browser.getUrl();
      const isRoom = url.includes("#/room/");
      if (!isRoom && !url.includes("#/image/")) continue;
      await collectCurrent();
      // 열린 모달이 있으면 먼저 닫는다
      if (isRoom && (await $(".modal-backdrop").isExisting())) await browser.keys("Escape");
      if (isRoom) await $(".chat-header .close-btn").click();
      else await browser.keys("Escape");
      await browser.waitUntil(async () => !(await browser.getWindowHandles()).includes(h), {
        timeout: 5_000,
        timeoutMsg: "창이 닫히지 않음",
      });
    } catch {
      // 이미 닫혔거나 앱 닫기가 안 먹으면 강제로 닫는다
      await browser.closeWindow().catch(() => {});
    }
  }
  await switchToMain();
};

/** 지금 창 URL의 방 번호 */
export const currentRoomId = async () => Number(/#\/room\/(\d+)/.exec(await browser.getUrl())?.[1] ?? 0);

/** 로컬 fixture 파일의 절대 경로 */
export const fixture = (name) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures", name);

/** 숨겨진(display:none) file input에 파일을 넣는다. WebDriver는 보이지 않는 요소에 값을 넣지 못한다 */
export const setFileInput = async (el, filePath) => {
  // $()가 돌려주는 체이닝 객체는 execute 인자로 못 넘기므로 실제 요소로 풀어 둔다
  const input = await el;
  await input.waitForExist({ timeout: 10_000 });
  await browser.execute((node) => {
    node.style.setProperty("display", "block", "important");
  }, input);
  await input.setValue(filePath);
};

/** 현재 창 채팅 영역에서 text가 들어간 메시지 본문 */
export const messageContent = (text) => $(".chat-body").$(`.message-content*=${text}`);

/** 헤더 ⋮ 메뉴의 항목을 누른다 (내정보 / 내 닉네임 변경 / 프로필이미지 설정 / 비번변경 / 비번초기화 / 나가기) */
export const headerMenu = async (label) => {
  await $(".main-header .header-menu-wrap .more-btn").click();
  await $(".header-menu").$(`button=${label}`).click();
};

/** 헤더 ⋮ 메뉴에서 '나가기'(로그아웃) */
export const logout = async () => {
  await headerMenu("나가기");
  await $(".nickname-screen").waitForDisplayed({ timeout: 10_000 });
};
