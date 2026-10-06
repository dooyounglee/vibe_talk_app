import { beforeEach, describe, expect, it, vi } from "vitest";
import { emit, listen } from "@tauri-apps/api/event";
import {
  CHAT_BUS_NAME,
  createChatBus,
  createChatBusHub,
  createTauriChatBus,
  currentMainIdFromUrl,
  currentRoomIdFromUrl,
  dedupeKeyFor,
  isTauriRuntime,
  type ChatBusMessage,
} from "../chatBus";
import { enableTauriRuntime } from "../test/fakeWebSocket";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(),
}));

const setHash = (hash: string) => window.history.replaceState(null, "", `/${hash}`);

describe("URL 파싱", () => {
  it("#/room/3 에서 방 번호를 꺼낸다", () => {
    setHash("#/room/3");
    expect(currentRoomIdFromUrl()).toBe(3);
    setHash("#/room/12?mainId=abc");
    expect(currentRoomIdFromUrl()).toBe(12);
  });

  it("방 라우트가 아니면 null", () => {
    setHash("");
    expect(currentRoomIdFromUrl()).toBeNull();
    setHash("#/");
    expect(currentRoomIdFromUrl()).toBeNull();
    setHash("#/room/abc");
    expect(currentRoomIdFromUrl()).toBeNull();
  });

  it("mainId 쿼리를 꺼낸다 (소문자 키도 허용)", () => {
    setHash("#/room/3?mainId=main-1");
    expect(currentMainIdFromUrl()).toBe("main-1");
    setHash("#/room/3?mainid=main-2");
    expect(currentMainIdFromUrl()).toBe("main-2");
  });

  it("mainId가 없거나 비어 있으면 null", () => {
    setHash("#/room/3");
    expect(currentMainIdFromUrl()).toBeNull();
    setHash("#/room/3?mainId=%20");
    expect(currentMainIdFromUrl()).toBeNull();
  });
});

describe("isTauriRuntime", () => {
  it("Tauri 전역이 없으면 false, 있으면 true", () => {
    expect(isTauriRuntime()).toBe(false);
    enableTauriRuntime();
    expect(isTauriRuntime()).toBe(true);
  });
});

describe("dedupeKeyFor", () => {
  it("room-send만 id로 키를 만든다", () => {
    expect(dedupeKeyFor({ kind: "room-send", roomId: 1, text: "hi", id: "x1" })).toBe(
      "room-send:x1",
    );
    expect(dedupeKeyFor({ kind: "room-open", roomId: 1 })).toBeNull();
    expect(dedupeKeyFor({ kind: "main-ready" })).toBeNull();
  });
});

describe("createChatBusHub", () => {
  const fakeBus = () => ({ post: vi.fn(), close: vi.fn() });

  it("붙인 모든 버스에 post하고, null은 무시한다", () => {
    const hub = createChatBusHub();
    const a = fakeBus();
    const b = fakeBus();
    hub.add(a);
    hub.add(b);
    hub.add(null);
    const msg: ChatBusMessage = { kind: "main-ready" };
    hub.post(msg);
    expect(a.post).toHaveBeenCalledWith(msg);
    expect(b.post).toHaveBeenCalledWith(msg);
  });

  it("한 버스가 예외를 던져도 나머지는 계속 받는다", () => {
    const hub = createChatBusHub();
    const broken = fakeBus();
    broken.post.mockImplementation(() => {
      throw new Error("boom");
    });
    const ok = fakeBus();
    hub.add(broken);
    hub.add(ok);
    expect(() => hub.post({ kind: "main-ready" })).not.toThrow();
    expect(ok.post).toHaveBeenCalledTimes(1);
  });

  it("close하면 모든 버스를 닫고 비운다", () => {
    const hub = createChatBusHub();
    const a = fakeBus();
    hub.add(a);
    hub.close();
    expect(a.close).toHaveBeenCalledTimes(1);
    hub.post({ kind: "main-ready" });
    expect(a.post).not.toHaveBeenCalled();
  });
});

describe("createChatBus (BroadcastChannel)", () => {
  it("다른 창(채널)에서 보낸 메시지 중 kind가 있는 것만 받는다", async () => {
    const received: ChatBusMessage[] = [];
    const bus = createChatBus((m) => received.push(m));
    const other = new BroadcastChannel(CHAT_BUS_NAME);
    other.postMessage("kind 없는 잡음");
    other.postMessage({ foo: 1 });
    other.postMessage({ kind: "room-open", roomId: 7 });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toEqual({ kind: "room-open", roomId: 7 });
    other.close();
    bus.close();
  });

  it("post한 메시지가 다른 채널에 전달된다", async () => {
    const got: unknown[] = [];
    const other = new BroadcastChannel(CHAT_BUS_NAME);
    other.onmessage = (e) => got.push(e.data);
    const bus = createChatBus(() => undefined);
    bus.post({ kind: "main-closing" });
    await vi.waitFor(() => expect(got).toEqual([{ kind: "main-closing" }]));
    other.close();
    bus.close();
    // 닫힌 뒤 post해도 예외가 나지 않는다
    expect(() => bus.post({ kind: "main-ready" })).not.toThrow();
  });
});

describe("createTauriChatBus", () => {
  const unlisten = vi.fn();
  let deliver: ((event: { payload: unknown }) => void) | null = null;

  beforeEach(() => {
    unlisten.mockReset();
    deliver = null;
    vi.mocked(emit).mockReset();
    vi.mocked(emit).mockResolvedValue(undefined);
    vi.mocked(listen).mockImplementation(async (_name, cb) => {
      deliver = cb as unknown as (event: { payload: unknown }) => void;
      return unlisten;
    });
  });

  it("버스 이름으로 listen하고 유효한 payload만 handler에 넘긴다", async () => {
    const handler = vi.fn();
    await createTauriChatBus(handler);
    expect(listen).toHaveBeenCalledWith(CHAT_BUS_NAME, expect.any(Function));
    deliver?.({ payload: { kind: "main-ready" } });
    deliver?.({ payload: "잡음" });
    deliver?.({ payload: { kind: 1 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ kind: "main-ready" });
  });

  it("post는 emit으로, close 후에는 보내지 않고 unlisten한다", async () => {
    const bus = await createTauriChatBus(vi.fn());
    bus.post({ kind: "room-close", roomId: 2 });
    expect(emit).toHaveBeenCalledWith(CHAT_BUS_NAME, { kind: "room-close", roomId: 2 });
    bus.close();
    expect(unlisten).toHaveBeenCalledTimes(1);
    bus.post({ kind: "main-ready" });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("emit이 실패해도 예외가 밖으로 새지 않는다", async () => {
    vi.mocked(emit).mockRejectedValueOnce(new Error("window closed"));
    const bus = await createTauriChatBus(vi.fn());
    expect(() => bus.post({ kind: "main-ready" })).not.toThrow();
    // 거부된 Promise가 처리되도록 한 틱 기다린다
    await Promise.resolve();
  });
});
