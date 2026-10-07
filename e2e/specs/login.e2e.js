// 실제 Tauri 앱(mykatalk.exe)을 띄워 로그인 흐름을 검증한다.
// 서버는 wdio.conf.js가 임시 DB로 띄우며, admin 계정(비밀번호 admin)은 서버가 자동으로 만든다.
import { clearInput, loginAs, logout, resetApp, submitLogin } from "../helpers/app.js";
import {
  changedPassword,
  connectClient,
  createActiveUser,
  initialPassword,
  registerUser,
  setPassword,
} from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디를 쓴다
const ACTIVE = "loginactive"; // 첫 로그인(비밀번호 변경)까지 끝낸 사용자
const FRESH = "loginfresh"; // 등록만 된 사용자 → 첫 로그인에 비밀번호 변경 강제
const FRESH_LEAVE = "loginleave"; // 강제 변경 화면에서 '나가기'만 해 볼 사용자
const GONE = "logingone"; // 탈퇴 사용자

const errorText = () => $(".nickname-screen .error");

describe("로그인", () => {
  before(async () => {
    const admin = await connectClient("admin");
    await createActiveUser(admin, ACTIVE);
    await registerUser(admin, FRESH);
    await registerUser(admin, FRESH_LEAVE);
    await registerUser(admin, GONE, { isDeleted: true });
    admin.close();
  });

  beforeEach(async () => {
    await resetApp();
  });

  it("admin으로 입장하면 메인 화면이 뜬다", async () => {
    await expect($(".nickname-screen")).toBeDisplayed();

    await submitLogin("admin", "admin");

    await $(".main-screen").waitForDisplayed({ timeout: 10_000 });
    await expect($(".main-header .me strong")).toHaveText("admin");
    // 연결돼 있으면 재연결 버튼 대신 내 상태 선택이 보인다
    await expect($(".main-header .status-select")).toBeDisplayed();
    // admin(user_no=1)에게만 보이는 탭
    await expect($(".tab-row").$("button=설정")).toBeDisplayed();
  });

  it("아이디나 비밀번호가 비어 있으면 로그인 버튼이 꺼져 있다", async () => {
    const idInput = $(".nickname-input:not(.password-input)");
    await idInput.waitForDisplayed({ timeout: 10_000 });
    await expect($(".start-button")).toBeDisabled();

    await idInput.setValue(ACTIVE);
    await expect($(".start-button")).toBeDisabled();

    await clearInput(idInput);
    await expect(idInput).toHaveValue("");
    await $(".password-input").setValue("whatever1");
    await expect($(".start-button")).toBeDisabled();
  });

  it("비밀번호가 틀리면 오류를 보여주고 로그인 화면에 남는다", async () => {
    await submitLogin(ACTIVE, "wrongPass1");

    await expect(errorText()).toHaveText("아이디 또는 비밀번호가 올바르지 않습니다.");
    await expect($(".nickname-screen")).toBeDisplayed();
    await expect($(".main-screen")).not.toBeExisting();
    // 입력했던 아이디는 남고, 틀린 비밀번호는 비워진다
    await expect($(".nickname-input:not(.password-input)")).toHaveValue(ACTIVE);
    await expect($(".password-input")).toHaveValue("");

    // 재접속을 반복하지 않으므로 잠시 뒤에도 오류가 그대로다
    await browser.pause(4000);
    await expect(errorText()).toHaveText("아이디 또는 비밀번호가 올바르지 않습니다.");
  });

  it("탈퇴한 사용자는 입장할 수 없다", async () => {
    await submitLogin(GONE, initialPassword(GONE));

    await expect(errorText()).toHaveText("탈퇴한 사용자입니다");
    await expect($(".main-screen")).not.toBeExisting();
    await expect($(".nickname-input:not(.password-input)")).toHaveValue(GONE);
  });

  it("첫 로그인이면 비밀번호 변경을 강제하고, 바꾸면 입장한다", async () => {
    await submitLogin(FRESH, initialPassword(FRESH));

    await expect($(".modal-card h3")).toHaveText("비밀번호 변경 필요");
    // 강제 모드에서는 현재 비밀번호 칸이 없다
    await expect($(".modal-card .current-password")).not.toBeExisting();

    const next = changedPassword(FRESH);
    await $(".modal-card .new-password").setValue(next);
    await $(".modal-card .confirm-password").setValue(next);
    await $(".modal-card").$("button=변경").click();
    setPassword(FRESH, next);

    await $(".main-screen").waitForDisplayed({ timeout: 10_000 });
    await expect($(".main-header .me strong")).toHaveText(FRESH);

    // 다음 로그인은 바꾼 비밀번호로 바로 입장한다
    await loginAs(FRESH, next);
    await expect($(".modal-card")).not.toBeExisting();
  });

  it("비밀번호 변경 강제 화면에서 '나가기'를 누르면 로그인 화면으로 돌아간다", async () => {
    await submitLogin(FRESH_LEAVE, initialPassword(FRESH_LEAVE));
    await expect($(".modal-card h3")).toHaveText("비밀번호 변경 필요");

    await $(".modal-card").$("button=나가기").click();

    await $(".nickname-screen").waitForDisplayed({ timeout: 10_000 });
    await expect($(".modal-card")).not.toBeExisting();
  });

  it("자동로그인을 켜면 새로고침해도 바로 입장하고, 로그아웃하면 자동로그인만 꺼진다", async () => {
    const pw = changedPassword(ACTIVE);
    const idInput = $(".nickname-input:not(.password-input)");
    await idInput.waitForDisplayed({ timeout: 10_000 });
    await idInput.setValue(ACTIVE);
    await $(".password-input").setValue(pw);
    // 자동로그인을 켜면 비밀번호 저장도 함께 켜진다
    await $(".auto-login").click();
    await expect($(".save-password")).toBeSelected();
    await $(".start-button").click();
    await $(".main-screen").waitForDisplayed({ timeout: 10_000 });

    await browser.refresh();
    await $(".main-screen").waitForDisplayed({ timeout: 10_000 });
    await expect($(".main-header .me strong")).toHaveText(ACTIVE);

    await logout();
    // 저장된 아이디/비밀번호는 남고 자동로그인만 꺼진다
    await expect($(".nickname-input:not(.password-input)")).toHaveValue(ACTIVE);
    await expect($(".password-input")).toHaveValue(pw);
    await expect($(".save-password")).toBeSelected();
    await expect($(".auto-login")).not.toBeSelected();

    await browser.refresh();
    await $(".nickname-screen").waitForDisplayed({ timeout: 10_000 });
    await expect($(".main-screen")).not.toBeExisting();
  });
});
