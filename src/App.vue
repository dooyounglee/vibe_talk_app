<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

// WebSocket 연결 상태 추적
const isConnected = ref(false);
const nickname = ref("");
const messages = ref<Array<{ type: string; nickname: string; text: string }>>([]);
const inputMessage = ref("");

// WebSocket 인스턴스
let ws: WebSocket | null = null;

// 메시지 전송 함수
const send = () => {
  if (inputMessage.value.trim() === "") return;
  
  const message = {
    type: "message",
    nickname: nickname.value,
    text: inputMessage.value
  };
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    inputMessage.value = "";
  }
};

// WebSocket 이벤트 핸들러
const setupWebSocket = () => {
  // 기존 연결 종료
  if (ws) {
    ws.close();
  }

  // 새 연결 생성
  ws = new WebSocket("ws://localhost:8080");

  // 연결 성공 시 처리
  ws.onopen = () => {
    if (nickname.value) {
      ws.send(JSON.stringify({ type: "join", nickname: nickname.value }));
    }
    isConnected.value = true;
  };

  // 메시지 수신 처리
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "message") {
        messages.value.push(data);
      }
    } catch (e) {
      console.error("Invalid message format:", e);
    }
  };

  // 연결 종료 처리
  ws.onclose = () => {
    isConnected.value = false;
    console.log("Connection closed");
  };

  // 오류 처리
  ws.onerror = (error) => {
    console.error("WebSocket Error:", error);
  };
};

// 컴포넌트 언마운트 시 WebSocket 종료
onUnmounted(() => {
  if (ws) {
    ws.close();
  }
});
</script>

<template>
  <div class="chat-container">
    <!-- 상단: 닉네임 입력 -->
    <div class="input-section" v-if="!isConnected">
      <input
        v-model="nickname"
        placeholder="닉네임을 입력하세요"
        @keyup.enter="setupWebSocket"
      />
      <button @click="setupWebSocket">접속</button>
    </div>

    <!-- 연결 상태 표시 -->
    <div class="status" v-if="isConnected">
      <span style="color: green">연결됨</span>
    </div>

    <!-- 중단: 메시지 리스트 -->
    <div class="messages">
      <div
        v-for="(msg, index) in messages"
        :key="index"
        :class="{ 'message-self': msg.nickname === nickname.value, 'message-other': msg.nickname !== nickname.value }"
      >
        <div class="message-content">
          <span class="nickname">[{{ msg.nickname }}]</span>
          {{ msg.text }}
        </div>
      </div>
    </div>

    <!-- 하단: 메시지 입력 -->
    <div class="input-area" v-if="isConnected">
      <input
        v-model="inputMessage"
        @keyup.enter="send"
        placeholder="메시지를 입력하세요"
      />
      <button @click="send" :disabled="!inputMessage">전송</button>
    </div>
  </div>
</template>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20px;
  font-family: sans-serif;
}

.input-section {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.input-section input {
  flex: 1;
  padding: 10px;
  font-size: 16px;
}

.input-section button {
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
}

.status {
  margin-bottom: 20px;
  font-weight: bold;
}

.messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.message-self {
  align-self: flex-end;
  background-color: #d1e7dd;
  padding: 10px 15px;
  border-radius: 15px;
  max-width: 70%;
  color: #000;
}

.message-other {
  align-self: flex-start;
  background-color: #f8d7da;
  padding: 10px 15px;
  border-radius: 15px;
  max-width: 70%;
  color: #000;
}

.message-content {
  word-break: break-word;
}

.nickname {
  font-weight: bold;
  margin-right: 5px;
}

.input-area {
  display: flex;
  gap: 10px;
}

.input-area input {
  flex: 1;
  padding: 10px;
  font-size: 16px;
}

.input-area button {
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
}

.input-area button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>