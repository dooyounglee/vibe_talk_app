/** 검색어 하이라이트용 조각. hit=true 인 조각이 검색어와 일치하는 부분이다. */
export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * text 를 keyword 일치 부분과 나머지로 나눈다 (대소문자 무시).
 * v-html 없이 <mark> 로 감싸 렌더하기 위한 용도라 원문은 그대로 보존된다.
 * keyword 가 비어 있으면 원문 한 조각만 돌려준다.
 */
export function splitHighlight(text: string, keyword: string): HighlightSegment[] {
  const kw = keyword.trim();
  if (!kw || !text) return [{ text, hit: false }];
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const segments: HighlightSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(escaped, "gi"))) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), hit: false });
    segments.push({ text: match[0], hit: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false });
  return segments.length > 0 ? segments : [{ text, hit: false }];
}
