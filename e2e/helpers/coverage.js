// E2E 커버리지 수집 (E2E_COVERAGE=1 일 때만 동작).
// 앱은 vite-plugin-istanbul로 계측되어 창마다 window.__coverage__ 를 가진다.
// 창이 새로고침되거나 닫히면 그 값이 사라지므로, 그 전에 수집해서 e2e/.nyc_output 에 파일로 남긴다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COVERAGE = process.env.E2E_COVERAGE === "1";
export const NYC_OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.nyc_output");

let seq = 0;

/** 현재 창의 커버리지를 파일로 저장하고, 같은 실행이 두 번 집계되지 않게 창 안의 카운터를 0으로 되돌린다 */
export const collectCurrent = async () => {
  if (!COVERAGE) return;
  let json = null;
  try {
    json = await browser.execute(() => {
      const cov = window.__coverage__;
      if (!cov) return null;
      const out = JSON.stringify(cov);
      for (const file of Object.values(cov)) {
        for (const k of Object.keys(file.s)) file.s[k] = 0;
        for (const k of Object.keys(file.f)) file.f[k] = 0;
        for (const k of Object.keys(file.b)) file.b[k] = file.b[k].map(() => 0);
      }
      return out;
    });
  } catch {
    // 창이 이미 닫혔거나 응답하지 않으면 건너뛴다
    return;
  }
  if (!json) return;
  fs.mkdirSync(NYC_OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(NYC_OUTPUT, `${process.pid}-${Date.now()}-${seq++}.json`), json);
};

/** 열려 있는 모든 창에서 수집한 뒤 원래 창으로 돌아온다 */
export const collectAll = async () => {
  if (!COVERAGE) return;
  let original = null;
  try {
    original = await browser.getWindowHandle();
  } catch {
    // 현재 창이 닫힌 상태일 수 있다
  }
  const handles = await browser.getWindowHandles().catch(() => []);
  for (const h of handles) {
    try {
      await browser.switchToWindow(h);
      await collectCurrent();
    } catch {
      // 닫히는 중인 창은 건너뛴다
    }
  }
  const back = original && handles.includes(original) ? original : handles[0];
  if (back) await browser.switchToWindow(back).catch(() => {});
};
