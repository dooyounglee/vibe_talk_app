// 실제 Tauri 앱에서 채팅방 "이전 대화 더보기"(위로 무한스크롤)를 검증한다.
// 서버는 wdio.conf.js가 임시 DB로 띄운다. 테스트 데이터는 Node의 WebSocket 클라이언트로 서버에 직접 넣는다.
//   - admin이 scrollbob을 등록하고 둘이 있는 방을 만든 뒤 메시지 100건(seed-0 ~ seed-99)을 보낸다.
//   - 앱은 admin으로 로그인해 같은 창(#/room/:id)에서 그 방을 연다.
// E2E_SHOT_DIR 환경변수를 주면 단계별 스크린샷을 그 폴더에 남긴다.
import { loginAs, openRoomHere, shot } from "../helpers/app.js";
import { connectClient, createRoom, registerUser } from "../helpers/server.js";

const SEED_COUNT = 100;
const PAGE_SIZE = 30;
// 다른 spec과 같은 서버(DB)를 공유하므로 이 spec 전용 아이디를 쓴다
const BOB = "scrollbob";

/** 채팅창 스크롤 상태 + 화면에 그려진 seed 번호들 */
const readChat = () =>
  browser.execute(() => {
    const body = document.querySelector(".chat-body");
    const rows = [...document.querySelectorAll(".chat-body .message-row")].map((r) =>
      (r.textContent ?? "").trim(),
    );
    return {
      top: body.scrollTop,
      height: body.scrollHeight,
      client: body.clientHeight,
      rows,
      edge: document.querySelector(".chat-body .history-edge")?.textContent?.trim() ?? "",
    };
  });

const seedNumbers = (rows) =>
  rows.map((t) => /seed-(\d+)/.exec(t)).filter(Boolean).map((m) => Number(m[1]));

/** 맨 위로 스크롤하고, 같은 순간(이전 대화가 붙기 전)의 기준 메시지 화면 위치를 잰다 */
const scrollToTopAndMeasure = (anchorText) =>
  browser.execute((text) => {
    const body = document.querySelector(".chat-body");
    body.scrollTop = 0;
    const row = [...body.querySelectorAll(".message-row")].find((r) => r.textContent.includes(text));
    return row ? row.getBoundingClientRect().top - body.getBoundingClientRect().top : null;
  }, anchorText);

const anchorOffset = (anchorText) =>
  browser.execute((text) => {
    const body = document.querySelector(".chat-body");
    const row = [...body.querySelectorAll(".message-row")].find((r) => r.textContent.includes(text));
    return row ? row.getBoundingClientRect().top - body.getBoundingClientRect().top : null;
  }, anchorText);

describe("채팅방 이전 대화 더보기 (위로 무한스크롤)", () => {
  let roomId = 0;
  let bob = null;

  before(async () => {
    // ─── 테스트 데이터: bob 등록 → admin+bob 방 → 메시지 100건 ───
    const admin = await connectClient("admin");
    const bobNo = await registerUser(admin, BOB);
    roomId = await createRoom(admin, [bobNo]);
    for (let i = 0; i < SEED_COUNT; i++) {
      admin.send({ type: "room_message", roomId, text: `seed-${i}` });
    }
    // 서버는 한 소켓의 메시지를 순서대로 처리하므로, 이 조회 응답이 오면 100건이 모두 저장된 뒤다
    // (방을 만들 때도 history_room 이 오므로, 마지막 메시지가 seed-99 인 응답을 기다린다)
    await admin.request(
      { type: "room_history", roomId },
      (m) => m.type === "history_room" && m.roomId === roomId && m.messages.at(-1)?.text === `seed-${SEED_COUNT - 1}`,
    );
    admin.close();

    bob = await connectClient(BOB);

    // ─── 앱: 깨끗한 로그인 화면에서 admin으로 입장 → 같은 창에서 방 열기 ───
    await loginAs("admin", "admin");
    await openRoomHere(roomId);
  });

  after(() => {
    bob?.close();
  });

  it("방을 열면 최신 30건이 보이고 맨 아래에 있다", async () => {
    await browser.waitUntil(async () => (await readChat()).rows.length === PAGE_SIZE, {
      timeout: 10_000,
      timeoutMsg: "최신 페이지 30건이 그려지지 않음",
    });
    const s = await readChat();
    expect(seedNumbers(s.rows)).toEqual(Array.from({ length: PAGE_SIZE }, (_, i) => 70 + i));
    expect(s.height - s.top - s.client).toBeLessThanOrEqual(2);
    await shot("1-opened");
  });

  it("맨 위로 스크롤하면 이전 30건이 앞에 붙고, 보던 메시지 위치가 그대로다", async () => {
    const before = await scrollToTopAndMeasure("seed-70");
    expect(before).not.toBeNull();
    await browser.waitUntil(async () => (await readChat()).rows.length === PAGE_SIZE * 2, {
      timeout: 10_000,
      timeoutMsg: "이전 대화가 불러와지지 않음",
    });
    // 위치 복원은 다음 렌더 직후에 적용되므로 잠깐 기다렸다 잰다
    await browser.pause(200);
    const after = await anchorOffset("seed-70");
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
    const s = await readChat();
    expect(seedNumbers(s.rows)).toEqual(Array.from({ length: PAGE_SIZE * 2 }, (_, i) => 40 + i));
    expect(s.top).toBeGreaterThan(60); // 복원 후에는 다시 "맨 위 근처"가 아니어야 연속 요청이 없다
    await shot("2-loaded-older");
  });

  it("끝까지 올리면 100건이 빠짐/중복 없이 모이고 '대화의 시작입니다'가 뜬다", async () => {
    for (let i = 0; i < 5; i++) {
      const s = await readChat();
      if (s.edge === "대화의 시작입니다") break;
      const count = s.rows.length;
      await scrollToTopAndMeasure("seed-");
      await browser.waitUntil(
        async () => {
          const now = await readChat();
          return now.rows.length > count || now.edge === "대화의 시작입니다";
        },
        { timeout: 10_000, timeoutMsg: "더 불러오지 못함" },
      );
      await browser.pause(200);
    }
    const s = await readChat();
    expect(s.edge).toBe("대화의 시작입니다");
    expect(seedNumbers(s.rows)).toEqual(Array.from({ length: SEED_COUNT }, (_, i) => i));
    await shot("3-start-of-chat");
  });

  it("위쪽을 읽는 중에 상대 메시지가 와도 끌려 내려가지 않는다", async () => {
    await browser.execute(() => {
      document.querySelector(".chat-body").scrollTop = 600;
    });
    await browser.pause(300);
    const before = await readChat();
    bob.send({ type: "room_message", roomId, text: "from-bob" });
    await browser.waitUntil(async () => (await readChat()).rows.some((t) => t.includes("from-bob")), {
      timeout: 10_000,
      timeoutMsg: "bob 메시지가 도착하지 않음",
    });
    await browser.pause(300);
    const after = await readChat();
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2);
    expect(after.height - after.top - after.client).toBeGreaterThan(200);
    await shot("4-bob-message-while-reading");
  });

  it("내가 보내면 맨 아래로 내려간다", async () => {
    await $(".chat-footer input:not(.file-input)").setValue("from-me");
    await browser.keys("Enter");
    await browser.waitUntil(
      async () => {
        const s = await readChat();
        return s.rows.at(-1)?.includes("from-me") && s.height - s.top - s.client <= 2;
      },
      { timeout: 10_000, timeoutMsg: "내 메시지 후 맨 아래로 내려가지 않음" },
    );
    await shot("5-sent-mine");
  });
});
