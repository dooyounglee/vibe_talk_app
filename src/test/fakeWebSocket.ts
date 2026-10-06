import { vi } from "vitest";

/**
 * 테스트용 WebSocket. 실제 서버 없이 보낸 메시지를 기록하고,
 * 서버 메시지를 onmessage로 흘려 넣는다.
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** 생성된 순서대로 쌓인다. 마지막 원소가 현재 연결이다. */
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static get last(): FakeWebSocket {
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!ws) throw new Error("WebSocket이 아직 생성되지 않았습니다");
    return ws;
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("not open");
    this.sent.push(data);
  }

  /** 보낸 메시지를 JSON으로 파싱해서 돌려준다 */
  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new Event("close") as CloseEvent);
  }

  // ─── 테스트 조작용 ───

  /** 서버가 연결을 받아들인 것처럼 open 상태로 바꾼다 */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** 서버 메시지를 수신한 것처럼 onmessage를 호출한다 */
  receive(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  /** 서버 쪽에서 연결이 끊긴 것처럼 onclose를 호출한다 */
  drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new Event("close") as CloseEvent);
  }
}

/** 전역 WebSocket을 FakeWebSocket으로 바꾼다 */
export function installFakeWebSocket(): void {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
}

/** isTauriRuntime()이 true를 돌려주도록 Tauri 전역 표시를 넣는다 */
export function enableTauriRuntime(): void {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}
