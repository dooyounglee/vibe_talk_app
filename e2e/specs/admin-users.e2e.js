// admin 사용자 관리 (사용자 탭): 추가 / 입력 검사 / 중복 / 수정(부서) / 탈퇴 / 비밀번호 초기화,
// 그리고 일반 사용자에게는 admin 기능과 admin·탈퇴 사용자가 보이지 않는지.
import { loginAs, logout, openTab } from "../helpers/app.js";
import {
  changedPassword,
  connectClient,
  createActiveUser,
  createDept,
  initialPassword,
  tryJoin,
} from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디·부서를 쓴다 (닉네임 = 아이디)
const NEW = "aunew";
const EDIT = "auedit";
const GONE = "augone";
const RESET = "aureset";
const NORMAL = "aunormal";
const TAKEN = "autaken"; // 중복 아이디 추가 시도의 대상 (다른 테스트와 분리)
const DEPT = "관리검증팀";

const userItem = (nickname) => $(".user-list").$(`.user-item*=${nickname}`);
const modal = () => $(".modal-card");
const field = (placeholder) => modal().$(`input[placeholder="${placeholder}"]`);
const listError = () => $(".userlist-screen").$("p.error");

const openEdit = async (nickname) => {
  await userItem(nickname).$(".edit-btn").click();
  await expect(modal().$("h3")).toHaveText("사용자 수정");
};

describe("admin 사용자 관리", () => {
  before(async () => {
    const admin = await connectClient("admin");
    await createDept(admin, "AUD1", DEPT);
    for (const id of [EDIT, GONE, RESET, NORMAL, TAKEN]) await createActiveUser(admin, id);
    admin.close();

    await loginAs("admin", "admin");
    await openTab("사용자");
    await userItem(EDIT).waitForDisplayed({ timeout: 10_000 });
  });

  afterEach(async () => {
    if (await $(".modal-backdrop").isExisting()) await browser.keys("Escape");
  });

  it("사용자를 추가하면 목록에 보이고, 첫 로그인에 비밀번호 변경을 요구받는다", async () => {
    await $(".userlist-screen .add-btn").click();
    await expect(modal().$("h3")).toHaveText("사용자 추가");
    await field("아이디 입력").setValue(NEW);
    await field("닉네임 입력").setValue(NEW);
    await field("010-1234-5678").setValue("01000001234");
    await field("이름 입력").setValue("새사용자");
    await modal().$("button=추가").click();

    await expect(userItem(NEW)).toBeDisplayed();
    const reply = await tryJoin(NEW, initialPassword(NEW));
    expect(reply.type).toBe("password_change_required");
  });

  it("추가할 때 입력을 검사한다", async () => {
    await $(".userlist-screen .add-btn").click();
    const error = modal().$("p.error");

    await modal().$("button=추가").click();
    await expect(error).toHaveText("아이디는 영문+숫자, 최대 20자입니다.");

    await field("아이디 입력").setValue("auvalid");
    await modal().$("button=추가").click();
    await expect(error).toHaveText("닉네임을 입력하세요.");

    await field("닉네임 입력").setValue("auvalid");
    await modal().$("button=추가").click();
    await expect(error).toHaveText("전화번호를 입력하세요.");

    await field("010-1234-5678").setValue("12");
    await modal().$("button=추가").click();
    await expect(error).toHaveText("전화번호 형식이 올바르지 않습니다. (예: 010-1234-5678)");

    await modal().$("button=취소").click();
    await expect(userItem("auvalid")).not.toBeExisting();
  });

  // 회귀 방지: 예전에는 서버가 아이디 존재 여부로만 추가/수정을 구분해서 '추가'에 기존 아이디를 넣으면
  // 오류 없이 그 사용자를 덮어썼다. 지금은 클라이언트가 mode: "create"를 보내고 서버가 login_id_taken으로 거부한다.
  it("이미 있는 아이디로 추가하면 목록에 오류를 보여주고 기존 사용자는 그대로다", async () => {
    await $(".userlist-screen .add-btn").click();
    await field("아이디 입력").setValue(TAKEN);
    await field("닉네임 입력").setValue("audup");
    await field("010-1234-5678").setValue("010-0000-1234");
    await modal().$("button=추가").click();

    await expect(listError()).toHaveText("이미 사용 중인 아이디입니다. (탈퇴 포함)");
    await expect(userItem("audup")).not.toBeExisting();
    await expect(userItem(TAKEN)).toBeDisplayed();
  });

  it("수정에서 아이디는 바꿀 수 없고, 닉네임·부서를 바꾸면 목록에 반영된다", async () => {
    await openEdit(EDIT);
    await expect(field("아이디 입력")).toBeDisabled();
    await expect(field("아이디 입력")).toHaveValue(EDIT);

    await field("닉네임 입력").setValue("aueditok");
    await modal().$("select.text-input").selectByVisibleText(DEPT);
    await modal().$("button=저장").click();

    await expect(userItem("aueditok")).toBeDisplayed();
    await expect(userItem("aueditok").$(".dept-tag")).toHaveText(DEPT);
  });

  it("탈퇴 처리하면 목록에 탈퇴로 표시되고 로그인할 수 없다", async () => {
    await openEdit(GONE);
    await modal().$(".check-row input[type=checkbox]").click();
    await modal().$("button=저장").click();

    await expect(userItem(GONE)).toHaveElementClass("withdrawn");
    await expect(userItem(GONE).$(".withdrawn-tag")).toHaveText("탈퇴");
    const reply = await tryJoin(GONE, changedPassword(GONE));
    expect(reply.type).toBe("join_failed");
    expect(reply.text).toBe("탈퇴한 사용자입니다");
  });

  it("다른 사용자의 비밀번호를 초기화하면 초기 비밀번호로 로그인해 변경을 요구받는다", async () => {
    await openEdit(RESET);
    await modal().$(".reset-password-btn").click();
    // 수정 모달 위에 초기화 모달이 뜬다
    const reset = $$(".modal-card").at(-1);
    await expect(reset.$("h3")).toHaveText("비번초기화");
    await expect(reset.$(".message")).toHaveText(expect.stringContaining(`'${RESET}'`));
    await reset.$("button=초기화").click();
    await expect(reset.$(".message")).toHaveText("비밀번호가 초기화되었습니다.");
    await reset.$("button=확인").click();
    await $(".modal-card").$("button=취소").click();

    expect((await tryJoin(RESET, changedPassword(RESET))).type).toBe("join_failed");
    expect((await tryJoin(RESET, initialPassword(RESET))).type).toBe("password_change_required");
  });

  it("일반 사용자에게는 관리 기능과 admin·탈퇴 사용자가 보이지 않는다", async () => {
    await logout();
    await loginAs(NORMAL, changedPassword(NORMAL));

    await expect($(".tab-row").$("button*=설정")).not.toBeExisting();
    await openTab("사용자");
    await userItem("aueditok").waitForDisplayed({ timeout: 10_000 });
    await expect($(".userlist-screen .add-btn")).not.toBeExisting();
    await expect($(".userlist-screen .edit-btn")).not.toBeExisting();
    const names = await $$(".user-list .user-item .name").map((el) => el.getText());
    expect(names).not.toContain("admin");
    expect(names).not.toContain(GONE);
    // 부서는 admin에게만 보인다
    await expect(userItem("aueditok").$(".dept-tag")).not.toBeExisting();
  });
});
