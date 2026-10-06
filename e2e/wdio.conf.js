import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

let server = null;
let driver = null;
let tmpDir = null;

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

// Windows에서는 kill() 직후에도 서버가 DB 파일을 잡고 있으므로, 종료를 기다린 뒤 임시 폴더를 지운다.
const stopServer = async () => {
  const proc = server;
  server = null;
  if (proc && proc.exitCode === null) {
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    proc.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  tmpDir = null;
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
    if (!fs.existsSync(edgeDriver)) {
      throw new Error("msedgedriver가 없습니다. 먼저 `npm --prefix e2e run driver`를 실행하세요.");
    }
    if (await isPortOpen(SERVER_PORT)) {
      throw new Error(
        `${SERVER_PORT} 포트가 이미 사용 중입니다. 평소 쓰는 채팅 서버를 끄고 다시 실행하세요.`,
      );
    }

    // Windows에서 npm은 npm.cmd라 shell이 필요하다. 인자는 고정 문자열이라 한 줄로 넘긴다.
    const build = spawnSync("npm run tauri build -- --debug --no-bundle", {
      cwd: appDir,
      stdio: "inherit",
      shell: true,
    });
    if (build.status !== 0) throw new Error("tauri debug 빌드 실패");

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-e2e-"));
    server = spawn(process.execPath, ["server.js"], {
      cwd: serverDir,
      env: { ...process.env, PORT: String(SERVER_PORT), VIBE_TEST_DB: path.join(tmpDir, "e2e.db") },
      stdio: ["ignore", "ignore", "inherit"],
    });
    await waitForPort(SERVER_PORT, 10_000);
  },

  // 세션마다: tauri-driver를 띄운다 (tauri-driver가 msedgedriver와 앱을 실행한다)
  beforeSession: async () => {
    driver = spawn(tauriDriver, ["--native-driver", edgeDriver], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    await waitForPort(4444, 10_000);
  },

  afterSession: () => {
    if (driver && !driver.killed) driver.kill();
    driver = null;
  },

  onComplete: async () => {
    await stopServer();
  },
};

// 중간에 Ctrl+C로 끊어도 서버/드라이버가 남지 않게 한다 (임시 DB는 OS 임시 폴더에 남을 수 있다)
for (const signal of ["SIGINT", "SIGTERM", "exit"]) {
  process.on(signal, () => {
    if (driver && !driver.killed) driver.kill();
    if (server && server.exitCode === null) server.kill();
  });
}
