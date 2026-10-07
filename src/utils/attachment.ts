import type { ChatAttachment } from "../types/chat";

/** 채팅 서버 HTTP 주소 (WebSocket 과 같은 포트에서 첨부파일 업로드/다운로드를 받는다) */
export const FILE_SERVER_URL = "http://localhost:8080";

/** 업로드 최대 크기 (서버 MAX_UPLOAD_BYTES 와 동일) */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** 한 번에 첨부할 수 있는 파일 수 */
export const MAX_ATTACHMENTS_PER_SEND = 10;

/** 첨부파일 URL. download=true 면 서버가 attachment 로 내려준다 */
export function attachmentUrl(file: ChatAttachment, download = false): string {
  const base = `${FILE_SERVER_URL}/files/${encodeURIComponent(file.id)}`;
  return download ? `${base}?download=1` : base;
}

/**
 * 붙여넣기한 이미지는 이름이 'image.png' 로 고정되어 오므로
 * 받는 쪽에서 구분되도록 시각을 붙인 이름으로 바꾼다.
 */
export function nameForUpload(file: File): string {
  const name = file.name?.trim();
  if (name && name !== "image.png") return name;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
  return `image_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

/** 업로드 전 검사: 문제가 있으면 사용자에게 보여줄 문구, 없으면 null */
export function validateAttachment(file: File): string | null {
  if (file.size === 0) return `빈 파일은 보낼 수 없습니다: ${file.name}`;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `20MB 이하 파일만 보낼 수 있습니다: ${file.name}`;
  }
  return null;
}

/** 파일을 서버에 올리고 첨부 정보를 돌려준다 (실패 시 사용자에게 보여줄 문구로 throw) */
export async function uploadAttachment(file: File): Promise<ChatAttachment> {
  const invalid = validateAttachment(file);
  if (invalid) throw new Error(invalid);
  const name = nameForUpload(file);
  let res: Response;
  try {
    res = await fetch(`${FILE_SERVER_URL}/upload?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new Error(`파일을 올리지 못했습니다. 서버 연결을 확인해주세요: ${name}`);
  }
  const body = (await res.json().catch(() => null)) as
    | { fileId?: string; name?: string; size?: number; mime?: string; error?: string }
    | null;
  if (!res.ok || !body?.fileId) {
    if (body?.error === "too_large") throw new Error(`20MB 이하 파일만 보낼 수 있습니다: ${name}`);
    throw new Error(`파일을 올리지 못했습니다: ${name}`);
  }
  return {
    id: body.fileId,
    name: body.name ?? name,
    size: body.size ?? file.size,
    mime: body.mime ?? (file.type || "application/octet-stream"),
  };
}

/**
 * 첨부파일을 원래 이름으로 저장한다.
 * 서버가 다른 origin 이라 <a download> 의 파일명이 무시되므로 blob 으로 받아 저장시킨다.
 */
export async function downloadAttachment(file: ChatAttachment): Promise<void> {
  const res = await fetch(attachmentUrl(file, true));
  if (!res.ok) throw new Error("파일을 받지 못했습니다.");
  const blobUrl = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = file.name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  }
}
