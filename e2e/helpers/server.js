// 서버에 직접 붙는 테스트용 WebSocket 클라이언트 (Node 22+ 내장 WebSocket).
// 테스트 데이터 준비나 "상대방" 역할(메시지 보내기, 초대 등)에 쓴다.
//
// 서버(임시 DB)는 E2E 실행 전체에서 하나를 공유하고 spec 파일은 각자 다른 워커에서 돈다.
// 그래서 spec마다 겹치지 않는 아이디(예: "chatbob")를 써야 한다. 아이디는 영문+숫자만, 최대 20자.

export const WS_URL = "ws://localhost:8080";

// 테스트 사용자 전화번호 고정 → 초기 비밀번호 = 아이디 + '1234' (admin은 'admin').
// 신규 계정은 첫 로그인에 비밀번호 변경이 강제되므로 '<아이디>Pass99'로 바꾸고 이후엔 그 값을 쓴다.
export const TEST_PHONE = "010-0000-1234";
const passwords = new Map([["admin", "admin"]]);
export const initialPassword = (loginId) => `${loginId}1234`;
export const changedPassword = (loginId) => `${loginId}Pass99`;
export const currentPassword = (loginId) => passwords.get(loginId) ?? initialPassword(loginId);
/** 앱 화면에서 비밀번호를 바꾼 경우처럼, 이 모듈 밖에서 바뀐 비밀번호를 알려준다 */
export const setPassword = (loginId, password) => passwords.set(loginId, password);

/**
 * 로그인한 클라이언트를 돌려준다. 첫 로그인이면 비밀번호를 changedPassword()로 바꾼다.
 * @returns {Promise<{inbox: object[], waitFor: Function, send: Function, request: Function, close: Function}>}
 */
export const connectClient = (loginId) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const inbox = [];
    const waitFor = (pred, timeout = 10_000) =>
      new Promise((res, rej) => {
        const start = Date.now();
        const iv = setInterval(() => {
          const hit = inbox.find(pred);
          if (hit) {
            clearInterval(iv);
            res(hit);
          } else if (Date.now() - start > timeout) {
            clearInterval(iv);
            rej(new Error(`${loginId}: 서버 응답 타임아웃`));
          }
        }, 20);
      });
    const send = (o) => ws.send(JSON.stringify(o));
    // 보내기 전에 받은 같은 응답과 헷갈리지 않도록, 보낸 뒤에 들어온 메시지 중에서만 찾는다
    const request = (o, pred, timeout) => {
      const from = inbox.length;
      send(o);
      return waitFor((m) => inbox.indexOf(m) >= from && pred(m), timeout);
    };
    ws.addEventListener("message", (e) => {
      try {
        const m = JSON.parse(String(e.data));
        inbox.push(m);
        if (m.type === "password_change_required") {
          const next = changedPassword(loginId);
          send({ type: "password_change", currentPassword: currentPassword(loginId), newPassword: next });
          passwords.set(loginId, next);
        }
      } catch {
        // 무시
      }
    });
    ws.addEventListener("error", () => reject(new Error(`${loginId}: 서버 연결 실패`)));
    ws.addEventListener("open", async () => {
      send({ type: "join", loginId, password: currentPassword(loginId) });
      try {
        await waitFor((m) => m.type === "join_ok" || m.type === "join_failed");
        if (inbox.some((m) => m.type === "join_failed")) throw new Error(`${loginId}: 로그인 실패`);
        resolve({ inbox, waitFor, send, request, close: () => ws.close() });
      } catch (err) {
        ws.close();
        reject(err);
      }
    });
  });

/** admin 클라이언트로 사용자를 등록하고 user_no를 돌려준다 (비밀번호는 initialPassword) */
export const registerUser = async (admin, loginId, extra = {}) => {
  const res = await admin.request(
    { type: "user_upsert", loginId, nickname: loginId, phone: TEST_PHONE, isDeleted: false, ...extra },
    (m) => m.type === "user_upsert_result",
  );
  if (!res.ok) throw new Error(`${loginId} 등록 실패: ${JSON.stringify(res)}`);
  return res.user_no;
};

/** 사용자 등록 + 첫 로그인(비밀번호 변경)까지 끝내서, 앱에서 changedPassword()로 바로 로그인할 수 있게 한다 */
export const createActiveUser = async (admin, loginId, extra = {}) => {
  const userNo = await registerUser(admin, loginId, extra);
  const c = await connectClient(loginId);
  c.close();
  return userNo;
};

/** 방을 만들고 roomId를 돌려준다 (요청한 사용자 + memberNos) */
export const createRoom = async (client, memberNos) => {
  const res = await client.request({ type: "room_create", memberNos }, (m) => m.type === "room_created");
  return res.roomId;
};

/** admin 클라이언트로 부서를 만들고 deptNo를 돌려준다 */
export const createDept = async (admin, deptCode, deptName, sortOrder = 1) => {
  const res = await admin.request(
    { type: "dept_upsert", deptNo: null, deptCode, deptName, sortOrder, isDeleted: false },
    (m) => m.type === "dept_upsert_result",
  );
  if (!res.ok) throw new Error(`${deptCode} 부서 생성 실패: ${JSON.stringify(res)}`);
  return res.deptNo;
};

/** 가장 최근에 받은 userlist에서 user_no의 상태 (없으면 undefined) */
export const latestStatus = (client, userNo) =>
  [...client.inbox].reverse().find((m) => m.type === "userlist")?.userStatuses?.[userNo];

/**
 * 로그인만 시도하고 서버의 첫 응답(join_ok / join_failed / password_change_required)을 돌려준다.
 * connectClient와 달리 비밀번호를 자동으로 바꾸지 않는다.
 */
export const tryJoin = (loginId, password) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`${loginId}: 로그인 응답 타임아웃`));
    }, 10_000);
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data));
      if (["join_ok", "join_failed", "password_change_required"].includes(m.type)) {
        clearTimeout(timer);
        ws.close();
        resolve(m);
      }
    });
    ws.addEventListener("error", () => reject(new Error(`${loginId}: 서버 연결 실패`)));
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "join", loginId, password })));
  });

/**
 * 채팅 서버 끄기/켜기 (연결 끊김 테스트용). 서버는 wdio 런처가 띄우므로 런처의 제어 포트에 요청한다.
 * 다시 켜면 같은 임시 DB를 쓰므로 계정·방은 그대로다.
 */
export const serverControl = {
  stop: () => fetch("http://127.0.0.1:8099/server/stop", { method: "POST" }).then((r) => r.text()),
  start: () => fetch("http://127.0.0.1:8099/server/start", { method: "POST" }).then((r) => r.text()),
};
