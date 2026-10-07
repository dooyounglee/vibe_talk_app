// E2E_COVERAGE=1 을 켜고 wdio를 실행한다 (Windows npm 스크립트에서 환경변수를 넘기기 위한 래퍼).
// 추가 인자는 그대로 wdio에 넘긴다. 예: npm run test:e2e:coverage -- --spec specs/login.e2e.js
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wdio = path.join(e2eDir, "node_modules/@wdio/cli/bin/wdio.js");

const result = spawnSync(process.execPath, [wdio, "run", "wdio.conf.js", ...process.argv.slice(2)], {
  cwd: e2eDir,
  stdio: "inherit",
  env: { ...process.env, E2E_COVERAGE: "1" },
});
process.exit(result.status ?? 1);
