// 실제 Tauri 앱(mykatalk.exe)을 띄워 로그인 흐름을 검증한다.
// 서버는 wdio.conf.js가 임시 DB로 띄우며, admin 계정은 서버가 자동으로 만든다.

describe("로그인", () => {
  before(async () => {
    // WebView2 프로필은 실행이 끝나도 남아서, 저장된 로그인 ID가 있으면 앱이 자동으로 입장한다.
    // 깨끗한 로그인 화면에서 시작하도록 저장값을 지우고 새로고침한다.
    await browser.execute(() => localStorage.clear());
    await browser.refresh();
  });

  it("admin으로 입장하면 메인 화면이 뜬다", async () => {
    await expect($(".nickname-screen")).toBeDisplayed();

    await $(".nickname-input").setValue("admin");
    await $(".start-button").click();

    await $(".main-screen").waitForDisplayed({ timeout: 10_000 });
    await expect($(".main-header .me strong")).toHaveText("admin");
    await expect($(".main-header .status")).toHaveText("연결됨");
    // admin(user_no=1)에게만 보이는 탭
    await expect($(".tab-row").$("button=설정")).toBeDisplayed();
  });
});
