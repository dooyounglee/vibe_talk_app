import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MY_STATUS,
  ROOM_TITLE_MAX_LENGTH,
  formatRoomTime,
  myStatusLabel,
  myStatusText,
  normalizeMyStatus,
  roomDisplayName,
  roomLastMessagePreview,
  roomRawName,
  truncateRoomTitle,
  type RoomInfo,
} from "../chat";

const room = (over: Partial<RoomInfo> = {}): RoomInfo => ({
  roomId: 1,
  name: "기본방",
  owner_no: 1,
  owner: "admin",
  memberCount: 2,
  ...over,
});

describe("내 상태", () => {
  it("유효한 값은 그대로 둔다", () => {
    expect(normalizeMyStatus("busy")).toBe("busy");
    expect(normalizeMyStatus("away")).toBe("away");
  });

  it("목록에 없거나 손상된 값은 기본값으로 되돌린다", () => {
    expect(normalizeMyStatus("sleeping")).toBe(DEFAULT_MY_STATUS);
    expect(normalizeMyStatus(null)).toBe(DEFAULT_MY_STATUS);
    expect(normalizeMyStatus(undefined)).toBe(DEFAULT_MY_STATUS);
    expect(normalizeMyStatus(42)).toBe(DEFAULT_MY_STATUS);
  });

  it("라벨과 표시 문구를 만든다", () => {
    expect(myStatusLabel("meeting")).toBe("회의중");
    expect(myStatusLabel("??")).toBe("접속");
    expect(myStatusText("online")).toBe("접속(🙂)");
    expect(myStatusText("offline")).toBe("오프라인(👻)");
  });
});

describe("truncateRoomTitle", () => {
  it("최대 길이 이하면 그대로, 앞뒤 공백은 제거한다", () => {
    expect(truncateRoomTitle("  개발팀  ")).toBe("개발팀");
    const exact = "가".repeat(ROOM_TITLE_MAX_LENGTH);
    expect(truncateRoomTitle(exact)).toBe(exact);
  });

  it("초과하면 잘라서 ...을 붙인다", () => {
    const long = "가".repeat(ROOM_TITLE_MAX_LENGTH + 1);
    expect(truncateRoomTitle(long)).toBe(`${"가".repeat(ROOM_TITLE_MAX_LENGTH)}...`);
    expect(truncateRoomTitle("abcdef", 3)).toBe("abc...");
  });

  it("null/undefined는 빈 문자열", () => {
    expect(truncateRoomTitle(null)).toBe("");
    expect(truncateRoomTitle(undefined)).toBe("");
  });
});

describe("roomDisplayName / roomRawName", () => {
  it("displayName이 있으면 우선한다", () => {
    expect(roomDisplayName(room({ displayName: "철수" }))).toBe("철수");
    expect(roomRawName(room({ displayName: " 철수 " }))).toBe("철수");
  });

  it("displayName이 비어 있으면 name으로 폴백한다", () => {
    expect(roomDisplayName(room({ displayName: "   " }))).toBe("기본방");
    expect(roomRawName(room({ displayName: undefined }))).toBe("기본방");
  });

  it("표시용은 축약하고 원본은 축약하지 않는다", () => {
    const long = "a".repeat(30);
    expect(roomDisplayName(room({ displayName: long }))).toBe(`${"a".repeat(20)}...`);
    expect(roomRawName(room({ displayName: long }))).toBe(long);
  });
});

describe("formatRoomTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (y: number, m: number, d: number, h: number, min: number) =>
    new Date(y, m - 1, d, h, min).getTime();

  it("값이 없거나 잘못되면 빈 문자열", () => {
    expect(formatRoomTime()).toBe("");
    expect(formatRoomTime(null)).toBe("");
    expect(formatRoomTime(Number.NaN)).toBe("");
    expect(formatRoomTime(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("오늘/어제/올해/그 이전을 구분해 표시한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 7, 15, 0));
    expect(formatRoomTime(at(2026, 10, 7, 9, 5))).toBe("09:05");
    expect(formatRoomTime(at(2026, 10, 6, 23, 59))).toBe("어제 23:59");
    expect(formatRoomTime(at(2026, 3, 14, 14, 5))).toBe("3.14 14:05");
    expect(formatRoomTime(at(2024, 3, 14, 14, 5))).toBe("2024.3.14 14:05");
  });

  it("1월 1일의 어제는 작년 12월 31일이다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0));
    expect(formatRoomTime(at(2025, 12, 31, 22, 0))).toBe("어제 22:00");
  });
});

describe("roomLastMessagePreview", () => {
  it("메시지가 없으면 빈 문자열", () => {
    expect(roomLastMessagePreview(room())).toBe("");
    expect(roomLastMessagePreview(room({ lastMessage: "   " }))).toBe("");
  });

  it("다른 사람이 보낸 메시지는 '닉네임: 내용'", () => {
    expect(
      roomLastMessagePreview(room({ lastMessage: "안녕", lastMessageSender: "영희" }), "철수"),
    ).toBe("영희: 안녕");
  });

  it("내가 보냈거나 발신자를 모르면 내용만", () => {
    expect(
      roomLastMessagePreview(room({ lastMessage: "안녕", lastMessageSender: "철수" }), "철수"),
    ).toBe("안녕");
    expect(roomLastMessagePreview(room({ lastMessage: "안녕", lastMessageSender: null }))).toBe(
      "안녕",
    );
  });
});

describe("첨부파일 헬퍼", () => {
  it("formatFileSize", async () => {
    const { formatFileSize } = await import("../chat");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("toChatAttachment / attachmentPreviewText", async () => {
    const { toChatAttachment, attachmentPreviewText, isImageAttachment } = await import("../chat");
    expect(toChatAttachment(null)).toBeUndefined();
    expect(toChatAttachment({ name: "x" })).toBeUndefined();
    const img = toChatAttachment({ id: "k", name: "a.png", size: 3, mime: "image/png" })!;
    expect(isImageAttachment(img)).toBe(true);
    expect(attachmentPreviewText(img)).toBe("사진");
    const doc = toChatAttachment({ id: "k2", name: "a.zip" })!;
    expect(doc.mime).toBe("application/octet-stream");
    expect(attachmentPreviewText(doc)).toBe("파일: a.zip");
  });
});
