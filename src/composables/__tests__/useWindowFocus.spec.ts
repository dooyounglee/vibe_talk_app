import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWindowFocus } from "../useWindowFocus";
import { enableTauriRuntime } from "../../test/fakeWebSocket";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

const mountWithFocus = (onChange: (focused: boolean) => void) =>
  mount(
    defineComponent({
      setup() {
        useWindowFocus(onChange);
        return () => h("div");
      },
    }),
  );

describe("useWindowFocus", () => {
  beforeEach(() => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  it("mount 시 현재 상태를 한 번 보고하고, 값이 바뀔 때만 다시 부른다", () => {
    const onChange = vi.fn();
    const wrapper = mountWithFocus(onChange);
    expect(onChange.mock.calls).toEqual([[true]]);

    window.dispatchEvent(new Event("focus"));
    expect(onChange).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("blur"));
    expect(onChange.mock.calls).toEqual([[true], [false]]);

    window.dispatchEvent(new Event("focus"));
    expect(onChange.mock.calls).toEqual([[true], [false], [true]]);
    wrapper.unmount();
  });

  it("창이 숨겨지면(visibilitychange) focus가 아닌 것으로 본다", () => {
    const onChange = vi.fn();
    const wrapper = mountWithFocus(onChange);
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).toHaveBeenLastCalledWith(false);
    spy.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onChange).toHaveBeenLastCalledWith(true);
    wrapper.unmount();
  });

  it("250ms 뒤 한 번 더 확인한다", () => {
    vi.useFakeTimers();
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const onChange = vi.fn();
    const wrapper = mountWithFocus(onChange);
    expect(onChange.mock.calls).toEqual([[false]]);
    vi.mocked(document.hasFocus).mockReturnValue(true);
    vi.advanceTimersByTime(250);
    expect(onChange.mock.calls).toEqual([[false], [true]]);
    wrapper.unmount();
  });

  it("unmount하면 false를 알리고 이후 이벤트는 무시한다", () => {
    const onChange = vi.fn();
    const wrapper = mountWithFocus(onChange);
    wrapper.unmount();
    expect(onChange).toHaveBeenLastCalledWith(false);
    const count = onChange.mock.calls.length;
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    expect(onChange).toHaveBeenCalledTimes(count);
  });

  it("Tauri에서는 OS 창 focus 이벤트도 구독하고 unmount 때 해제한다", async () => {
    enableTauriRuntime();
    const unlisten = vi.fn();
    let emitFocus: ((e: { payload: boolean }) => void) | null = null;
    vi.mocked(getCurrentWindow).mockReturnValue({
      onFocusChanged: vi.fn(async (cb: (e: { payload: boolean }) => void) => {
        emitFocus = cb;
        return unlisten;
      }),
    } as unknown as ReturnType<typeof getCurrentWindow>);

    const onChange = vi.fn();
    const wrapper = mountWithFocus(onChange);
    await vi.waitFor(() => expect(emitFocus).not.toBeNull());
    emitFocus!({ payload: false });
    expect(onChange).toHaveBeenLastCalledWith(false);
    emitFocus!({ payload: true });
    expect(onChange).toHaveBeenLastCalledWith(true);

    wrapper.unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
