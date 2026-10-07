// admin 부서관리 (설정 탭): 추가 / 입력 검사 / 중복 코드 / 수정 / 소속 인원 경고 / 미사용 처리·필터 / 검색.
import { loginAs, openTab } from "../helpers/app.js";
import { connectClient, createDept, registerUser } from "../helpers/server.js";

// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 부서코드(ADx)·부서명을 쓴다
const NEW_CODE = "ADN1";
const NEW_NAME = "신규검증팀";
const MEMBER_CODE = "ADM1"; // 소속 사용자가 있는 부서
const MEMBER_NAME = "소속있는팀";

const deptRow = (text) => $(".dept-screen").$(`.dept-row*=${text}`);
const modal = () => $(".modal-card");
const field = (placeholder) => modal().$(`input[placeholder="${placeholder}"]`);
const rowCodes = () => $$(".dept-screen .dept-row:not(.head) .c-code").map((el) => el.getText());

const openEdit = async (code) => {
  await deptRow(code).$(".edit-btn").click();
  await expect(modal().$("h3")).toHaveText("부서 수정");
};

describe("admin 부서관리", () => {
  before(async () => {
    const admin = await connectClient("admin");
    const deptNo = await createDept(admin, MEMBER_CODE, MEMBER_NAME, 50);
    await registerUser(admin, "admem", { deptNo });
    admin.close();

    await loginAs("admin", "admin");
    await openTab("설정");
    await deptRow(MEMBER_CODE).waitForDisplayed({ timeout: 10_000 });
  });

  afterEach(async () => {
    if (await $(".modal-backdrop").isExisting()) await browser.keys("Escape");
    if (await modal().isExisting()) await modal().$("button=취소").click();
  });

  it("부서를 추가하면 사용 중 상태로 목록에 보인다", async () => {
    await $(".dept-screen").$("button=+ 추가").click();
    await expect(modal().$("h3")).toHaveText("부서 추가");
    await field("예) D001").setValue(NEW_CODE);
    await field("부서명 입력").setValue(NEW_NAME);
    await modal().$("button=추가").click();
    await modal().waitForExist({ reverse: true, timeout: 10_000 });

    const row = deptRow(NEW_CODE);
    await expect(row.$(".c-name")).toHaveText(NEW_NAME);
    await expect(row.$(".c-count")).toHaveText(expect.stringContaining("0"));
    await expect(row.$(".use-tag")).toHaveText("사용");
  });

  it("추가할 때 입력을 검사한다", async () => {
    await $(".dept-screen").$("button=+ 추가").click();
    const error = modal().$("p.error");

    await modal().$("button=추가").click();
    await expect(error).toHaveText("부서코드는 영문/숫자/_/-, 최대 20자입니다.");

    await field("예) D001").setValue("ADV1");
    await modal().$("button=추가").click();
    await expect(error).toHaveText("부서명을 입력하세요.");

    await modal().$("button=취소").click();
    await expect(deptRow("ADV1")).not.toBeExisting();
  });

  it("이미 있는 부서코드로 추가하면 서버 오류를 모달에 보여준다", async () => {
    await $(".dept-screen").$("button=+ 추가").click();
    await field("예) D001").setValue(NEW_CODE);
    await field("부서명 입력").setValue("다른이름팀");
    await modal().$("button=추가").click();

    await expect(modal().$("p.error")).toHaveText("이미 사용 중인 부서코드입니다. (미사용 포함)");
    await modal().$("button=취소").click();
    await expect(deptRow("다른이름팀")).not.toBeExisting();
  });

  it("수정에서 코드는 바꿀 수 없고, 부서명을 바꾸면 목록에 반영된다", async () => {
    await openEdit(NEW_CODE);
    await expect(field("예) D001")).toBeDisabled();
    await field("부서명 입력").setValue("이름바뀐팀");
    await modal().$("button=저장").click();
    await modal().waitForExist({ reverse: true, timeout: 10_000 });

    await expect(deptRow(NEW_CODE).$(".c-name")).toHaveText("이름바뀐팀");
  });

  it("소속 사용자가 있는 부서는 미사용으로 바꿀 수 없다", async () => {
    await openEdit(MEMBER_CODE);
    await expect(modal().$(".member-hint")).toHaveText("· 소속 1명");
    await modal().$(".check-row input[type=checkbox]").click();

    await expect(modal().$("p.error")).toHaveText("소속 사용자 1명이 있어 미사용 처리할 수 없습니다.");
    await expect(modal().$("button=저장")).toBeDisabled();
  });

  it("소속 없는 부서는 미사용으로 바꿀 수 있고, 사용 여부로 거를 수 있다", async () => {
    await openEdit(NEW_CODE);
    await modal().$(".check-row input[type=checkbox]").click();
    await modal().$("button=저장").click();
    await modal().waitForExist({ reverse: true, timeout: 10_000 });

    await expect(deptRow(NEW_CODE)).toHaveElementClass("inactive");
    await expect(deptRow(NEW_CODE).$(".use-tag")).toHaveText("미사용");

    const filter = $(".dept-screen select.use-filter");
    await filter.selectByAttribute("value", "inactive");
    expect(await rowCodes()).toContain(NEW_CODE);
    expect(await rowCodes()).not.toContain(MEMBER_CODE);

    await filter.selectByAttribute("value", "active");
    expect(await rowCodes()).not.toContain(NEW_CODE);
    expect(await rowCodes()).toContain(MEMBER_CODE);

    await filter.selectByAttribute("value", "all");
  });

  it("부서명이나 코드로 검색할 수 있다", async () => {
    const search = $(".dept-screen .search-input");
    await search.setValue(MEMBER_CODE);
    expect(await rowCodes()).toEqual([MEMBER_CODE]);

    await search.setValue("이름바뀐");
    expect(await rowCodes()).toEqual([NEW_CODE]);

    await search.setValue("없는부서명");
    await expect($(".dept-screen .empty")).toHaveText("조건에 해당하는 부서가 없습니다.");
  });
});
