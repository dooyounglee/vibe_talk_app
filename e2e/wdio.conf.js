import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COVERAGE, NYC_OUTPUT, collectAll } from "./helpers/coverage.js";

// Tauri E2E: WebdriverIO → tauri-driver(4444) → msedgedriver → mykatalk.exe 안의 WebView2
// https://v2.tauri.app/develop/tests/webdriver/

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const serverDir = path.resolve(appDir, "../vibe_talkserver_app");
const application = path.join(appDir, "src-tauri/target/debug/mykatalk.exe");
const edgeDriver = path.join(here, "bin/msedgedriver.exe");
const tauriDriver = path.join(os.homedir(), ".cargo/bin/tauri-driver.exe");

// 앱이 ws://localhost:8080 에 고정으로 붙으므로 E2E 서버도 8080으로 띄운다.
const SERVER_PORT = 8080;
// spec(워커 프로세스)이 서버를 끄고 켤 수 있게 런처가 여는 제어용 포트 (helpers/server.js의 serverControl)
const CONTROL_PORT = 8099;

// E2E_COVERAGE=1 (npm run test:e2e:coverage): 앱은 istanbul 계측 빌드, 서버는 NODE_V8_COVERAGE로 실행한다.
const V8_OUTPUT = path.join(here, ".v8-coverage");
const REPORT_DIR = path.join(appDir, "coverage-e2e");

let server = null;
let driver = null;
let tmpDir = null;
let control = null;

const isPortOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

const waitForPort = async (port, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${port} 포트가 ${timeoutMs}ms 안에 열리지 않았습니다`);
};

// 임시 DB·업로드 폴더(tmpDir)로 채팅 서버를 띄운다. 연결 끊김 테스트에서 같은 DB로 다시 띄울 때도 쓴다.
const startServer = async () => {
  server = spawn(process.execPath, ["server.js"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      VIBE_TEST_DB: path.join(tmpDir, "e2e.db"),
      // 첨부 테스트 파일이 실제 uploads/ 폴더에 쌓이지 않게 임시 폴더를 쓴다
      VIBE_UPLOAD_DIR: path.join(tmpDir, "uploads"),
      ...(COVERAGE ? { NODE_V8_COVERAGE: V8_OUTPUT } : {}),
    },
    // ipc: killServer()가 정상 종료를 요청하는 통로
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  await waitForPort(SERVER_PORT, 10_000);
};

// 서버 프로세스만 끝낸다 (임시 폴더는 그대로)
const killServer = async () => {
  const proc = server;
  server = null;
  if (proc && proc.exitCode === null) {
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    // 먼저 IPC로 정상 종료를 요청한다 (그래야 서버 커버리지가 기록된다). 응답이 없으면 강제 종료.
    try {
      proc.send("shutdown");
    } catch {
      // IPC 채널이 이미 닫혔으면 바로 kill로 넘어간다
    }
    const done = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
    if (!done) {
      proc.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
  }
};

// Windows에서는 kill() 직후에도 서버가 DB 파일을 잡고 있으므로, 종료를 기다린 뒤 임시 폴더를 지운다.
const stopServer = async () => {
  await killServer();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  tmpDir = null;
};

// 일반 Error를 던지면 wdio는 로그만 남기고 테스트를 그대로 돌린다 (→ 이미 떠 있던 다른 서버에 붙는다).
// 이름이 SevereServiceError인 에러여야 실행 전체가 멈춘다.
const abort = (err) => {
  const e = new Error(err instanceof Error ? err.message : String(err));
  e.name = "SevereServiceError";
  return e;
};

export const config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.e2e.js"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": { application },
    },
  ],
  logLevel: "warn",
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60_000 },

  // 테스트 전에 한 번: 최신 프론트엔드가 들어간 debug exe를 빌드하고, 임시 DB로 서버를 띄운다.
  onPrepare: async () => {
    try {
      if (!fs.existsSync(edgeDriver)) {
        throw new Error("msedgedriver가 없습니다. 먼저 `npm --prefix e2e run driver`를 실행하세요.");
      }
      if (await isPortOpen(SERVER_PORT)) {
        throw new Error(
          `${SERVER_PORT} 포트가 이미 사용 중입니다. 평소 쓰는 채팅 서버를 끄고 다시 실행하세요.`,
        );
      }

      if (COVERAGE) {
        for (const dir of [NYC_OUTPUT, V8_OUTPUT, REPORT_DIR]) fs.rmSync(dir, { recursive: true, force: true });
      }

      // E2E_COVERAGE는 환경변수로 그대로 넘어가 vite.config.ts가 계측 여부를 정한다.
      // Windows에서 npm은 npm.cmd라 shell이 필요하다. 인자는 고정 문자열이라 한 줄로 넘긴다.
      const build = spawnSync("npm run tauri build -- --debug --no-bundle", {
        cwd: appDir,
        stdio: "inherit",
        shell: true,
      });
      if (build.status !== 0) throw new Error("tauri debug 빌드 실패");

      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-e2e-"));
      await startServer();

      // POST /server/stop, /server/start : 연결 끊김·재연결 테스트용
      control = http.createServer(async (req, res) => {
        try {
          if (req.method === "POST" && req.url === "/server/stop") await killServer();
          else if (req.method === "POST" && req.url === "/server/start") {
            if (!server) await startServer();
          } else {
            res.writeHead(404).end();
            return;
          }
          res.writeHead(200).end("ok");
        } catch (err) {
          res.writeHead(500).end(String(err));
        }
      });
      await new Promise((resolve) => control.listen(CONTROL_PORT, "127.0.0.1", resolve));
    } catch (err) {
      control?.close();
      await stopServer();
      throw abort(err);
    }
  },

  // 세션마다: tauri-driver를 띄운다 (tauri-driver가 msedgedriver와 앱을 실행한다)
  beforeSession: async () => {
    driver = spawn(tauriDriver, ["--native-driver", edgeDriver], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    await waitForPort(4444, 10_000);
  },

  // 테스트마다 열려 있는 모든 창의 커버리지를 모은다 (세션이 끝나면 창과 함께 사라지므로)
  afterTest: async (test, _context, { passed }) => {
    // E2E_SHOT_DIR을 주면 실패한 테스트의 화면과 DOM을 남긴다
    const dir = process.env.E2E_SHOT_DIR;
    if (!passed && dir) {
      const name = `FAIL-${test.parent}-${test.title}`.replace(/[\/:*?"<>|]/g, "_").slice(0, 120);
      fs.mkdirSync(dir, { recursive: true });
      await browser.saveScreenshot(path.join(dir, `${name}.png`)).catch(() => {});
      const html = await browser.execute(() => document.documentElement.outerHTML).catch(() => "");
      fs.writeFileSync(path.join(dir, `${name}.html`), html);
    }
    await collectAll();
  },

  afterSession: () => {
    if (driver && !driver.killed) driver.kill();
    driver = null;
  },

  onComplete: async () => {
    control?.close();
    control = null;
    await stopServer();
    if (COVERAGE) writeReports();
  },
};

// 커버리지 리포트 생성: 클라이언트(nyc, istanbul 데이터) / 서버(c8, V8 데이터)
const writeReports = () => {
  const run = (args, cwd) => spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (!fs.existsSync(NYC_OUTPUT) || !fs.existsSync(V8_OUTPUT)) {
    console.warn("E2E 커버리지 데이터가 없어 리포트를 만들지 않습니다.");
    return;
  }
  run(
    [
      path.join(here, "node_modules/nyc/bin/nyc.js"),
      "report",
      "--temp-dir", NYC_OUTPUT,
      "--report-dir", path.join(REPORT_DIR, "client"),
      "--reporter=html",
      "--reporter=text-summary",
    ],
    appDir,
  );
  run(
    [
      path.join(here, "node_modules/c8/bin/c8.js"),
      "report",
      "--temp-directory", V8_OUTPUT,
      "--reports-dir", path.join(REPORT_DIR, "server"),
      "--reporter=html",
      "--reporter=text-summary",
      "--include", "server.js",
      "--include", "db.js",
    ],
    serverDir,
  );
  console.log(`
E2E 커버리지 리포트: ${path.join(REPORT_DIR, "client/index.html")}`);
  console.log(`                    ${path.join(REPORT_DIR, "server/index.html")}`);
};

// 중간에 Ctrl+C로 끊어도 서버/드라이버가 남지 않게 한다 (임시 DB는 OS 임시 폴더에 남을 수 있다)
for (const signal of ["SIGINT", "SIGTERM", "exit"]) {
  process.on(signal, () => {
    if (driver && !driver.killed) driver.kill();
    if (server && server.exitCode === null) server.kill();
  });
}
