// 내 계정: 상태 / 닉네임 변경 / 프로필 이미지 / 내정보 / 비밀번호 변경 / 비밀번호 초기화.
// 앱은 일반 사용자 acme로 로그인하고, 다른 사용자 acobs가 Node WebSocket 클라이언트로 변경 전파를 확인한다.
// 테스트는 위에서부터 같은 계정 상태를 이어서 쓴다 (닉네임·비밀번호가 차례로 바뀐다).
import { fixture, headerMenu, loginAs, logout, setFileInput, submitLogin } from "../helpers/app.js";
import {
  changedPassword,
  connectClient,
  createActiveUser,
  latestStatus,
  setPassword,
} from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디를 쓴다 (닉네임 = 아이디)
const ME = "acme";
const OBS = "acobs";
// 비밀번호 초기화 값 = 아이디 + 전화번호 뒤 4자리 (테스트 사용자 전화번호는 010-0000-1234)
const RESET_PASSWORD = `${ME}1234`;

const modal = () => $(".modal-card");

describe("내 계정", () => {
  let meNo = 0;
  let obs = null;
  let password = changedPassword(ME);

  before(async () => {
    const admin = await connectClient("admin");
    meNo = await createActiveUser(admin, ME);
    await createActiveUser(admin, OBS);
    admin.close();
    obs = await connectClient(OBS);
    await loginAs(ME, password);
  });

  afterEach(async () => {
    // 실패로 모달이 남아 있으면 닫는다
    if (await $(".modal-backdrop").isExisting()) await browser.keys("Escape");
  });

  after(() => {
    obs?.close();
  });

  it("내 상태를 바꾸면 다른 사용자에게 전파된다", async () => {
    await obs.waitFor(() => latestStatus(obs, meNo) === "online");

    await $(".main-header .status-select").selectByAttribute("value", "busy");

    await expect($(".main-header .status-select")).toHaveElementClass("busy");
    await obs.waitFor(() => latestStatus(obs, meNo) === "busy");
  });

  it("닉네임을 바꾸면 헤더와 다른 사용자의 목록에 반영된다", async () => {
    await headerMenu("내 닉네임 변경");
    await expect(modal().$("h3")).toHaveText("내 닉네임 변경");
    await expect(modal().$("input.text-input")).toHaveValue(ME);

    await modal().$("input.text-input").setValue("acmenew");
    await modal().$("button=저장").click();

    await expect($(".main-header .me-name")).toHaveText("acmenew");
    await obs.waitFor(
      (m) => m.type === "userlist" && m.users.some((u) => u.user_no === meNo && u.nickname === "acmenew"),
    );
  });

  it("이미 쓰는 닉네임으로 바꾸면 오류를 보여주고 그대로 둔다", async () => {
    await headerMenu("내 닉네임 변경");
    await modal().$("input.text-input").setValue(OBS);
    await modal().$("button=저장").click();

    await expect($(".rename-result")).toHaveText(expect.stringContaining("이미 사용 중인 닉네임입니다."));
    await expect($(".main-header .me-name")).toHaveText("acmenew");
  });

  it("프로필 이미지를 올리면 헤더에 보이고, 초기화하면 기본 이미지로 돌아간다", async () => {
    await expect($(".main-header .avatar-btn svg.silhouette")).toBeDisplayed();

    await headerMenu("프로필이미지 설정");
    await expect(modal().$("h3")).toHaveText("프로필이미지 설정");
    await expect(modal().$("button=저장")).toBeDisabled();
    await setFileInput(modal().$("input.hidden-input"), fixture("red16.png"));
    await expect(modal().$(".caption")).toHaveText("새 이미지 미리보기 (저장을 눌러야 적용됩니다)");
    await modal().$("button=저장").click();
    await modal().waitForExist({ reverse: true, timeout: 10_000 });

    await expect($(".main-header .avatar-btn img")).toBeDisplayed();
    await expect($(".main-header .avatar-btn")).toHaveElementClass("clickable");
    await obs.waitFor(
      (m) => m.type === "userlist" && m.users.some((u) => u.user_no === meNo && u.profileImage),
    );

    await headerMenu("프로필이미지 설정");
    await expect(modal().$(".caption")).toHaveText("현재 이미지");
    await modal().$("button=초기화").click();
    await modal().waitForExist({ reverse: true, timeout: 10_000 });
    await expect($(".main-header .avatar-btn svg.silhouette")).toBeDisplayed();
  });

  it("내정보에서 내 닉네임을 볼 수 있다", async () => {
    await headerMenu("내정보");
    await expect(modal().$("h3")).toHaveText("내정보");
    const rows = await modal().$$(".detail-list dd");
    await expect(rows[0]).toHaveText("acmenew");
    await modal().$("button=닫기").click();
    await expect(modal()).not.toBeExisting();
  });

  it("비밀번호 변경은 입력을 검사하고, 현재 비밀번호가 틀리면 서버 오류를 보여준다", async () => {
    await headerMenu("비번변경");
    await expect(modal().$("h3")).toHaveText("비번변경");
    const error = modal().$(".error");

    await modal().$("button=변경").click();
    await expect(error).toHaveText("현재 비밀번호를 입력하세요.");

    await modal().$(".current-password").setValue(password);
    await modal().$(".new-password").setValue("short1");
    await modal().$(".confirm-password").setValue("short1");
    await modal().$("button=변경").click();
    await expect(error).toHaveText("새 비밀번호는 영문과 숫자를 포함해 8~50자로 입력하세요.");

    await modal().$(".new-password").setValue("acmeNext77");
    await modal().$(".confirm-password").setValue("acmeNext78");
    await modal().$("button=변경").click();
    await expect(error).toHaveText("새 비밀번호와 확인이 일치하지 않습니다.");

    await modal().$(".new-password").setValue(password);
    await modal().$(".confirm-password").setValue(password);
    await modal().$("button=변경").click();
    await expect(error).toHaveText("현재 비밀번호와 다른 비밀번호를 입력하세요.");

    await modal().$(".current-password").setValue("wrongPass11");
    await modal().$(".new-password").setValue("acmeNext77");
    await modal().$(".confirm-password").setValue("acmeNext77");
    await modal().$("button=변경").click();
    await expect(error).toHaveText("현재 비밀번호가 올바르지 않습니다.");

    await modal().$("button=취소").click();
  });

  it("비밀번호를 바꾸면 새 비밀번호로만 로그인된다", async () => {
    const next = "acmeNext77";
    await headerMenu("비번변경");
    await modal().$(".current-password").setValue(password);
    await modal().$(".new-password").setValue(next);
    await modal().$(".confirm-password").setValue(next);
    await modal().$("button=변경").click();
    await expect(modal().$(".message")).toHaveText("비밀번호가 변경되었습니다.");
    await modal().$("button=확인").click();
    const old = password;
    password = next;
    setPassword(ME, next);

    await logout();
    await submitLogin(ME, old);
    await expect($(".nickname-screen")).toBeDisplayed();
    await expect($(".main-screen")).not.toBeExisting();

    await loginAs(ME, next);
    await expect($(".main-header .me-name")).toHaveText("acmenew");
  });

  it("비밀번호를 초기화하면 초기 비밀번호로 로그인해 새 비밀번호를 정해야 한다", async () => {
    await headerMenu("비번초기화");
    await expect(modal().$("h3")).toHaveText("비번초기화");
    await expect(modal().$(".message")).toHaveText(expect.stringContaining("아이디 + 전화번호 뒤 4자리"));
    await modal().$("button=초기화").click();
    await expect(modal().$(".message")).toHaveText("비밀번호가 초기화되었습니다.");
    await modal().$("button=확인").click();

    await logout();
    await submitLogin(ME, RESET_PASSWORD);
    await expect(modal().$("h3")).toHaveText("비밀번호 변경 필요");

    const next = "acmeFinal55";
    await modal().$(".new-password").setValue(next);
    await modal().$(".confirm-password").setValue(next);
    await modal().$("button=변경").click();
    setPassword(ME, next);
    await $(".main-screen").waitForDisplayed({ timeout: 10_000 });
  });
});
