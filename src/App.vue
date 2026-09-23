<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

// WebSocket 연결 상태 추적
const isConnected = ref(false);
const nickname = ref("");
const globalMessages = ref<Array<{ type: string; nickname: string; text: string }>>([]);
const dmMessages = ref<Record<string, Array<{ type: string; nickname: string; text: string }>>>({});
const inputMessage = ref("");
const userlist = ref<Array<string>>([]);
const selectedConversation = ref<string | null>(null);

// WebSocket 인스턴스
let ws: WebSocket | null = null;

// 메시지 전송 함수
const send = () => {
  if (inputMessage.value.trim() === "") return;
  
  const message = selectedConversation.value === null
    ? {
        type: "message",
        nickname: nickname.value,
        text: inputMessage.value
      }
    : {
        type: "dm",
        to: selectedConversation.value,
        nickname: nickname.value,
        text: inputMessage.value
      };
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    inputMessage.value = "";
  }
};

// 메시지 필터링 함수 - 현재 선택된 대화에 해당하는 메시지만 반환
const getFilteredMessages = () => {
  if (selectedConversation.value === null) {
    return globalMessages.value;
  } else {
    return dmMessages.value[selectedConversation.value] || [];
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
        // 전체 채팅 메시지 저장
        globalMessages.value.push(data);
      } else if (data.type === "dm") {
        // DM 메시지 처리
        let conversationPartner = "";
        
        // 메시지의 발신자가 나 자신인 경우 to를 기준으로 저장
        if (data.from === nickname.value) {
          conversationPartner = data.to;
        } else {
          // 메시지의 발신자가 다른 사용자인 경우 from을 기준으로 저장
          conversationPartner = data.from;
        }
        
        // 메시지를 우리가 사용하는 구조로 변환 후 저장
        const formattedMessage = {
          type: "dm",
          nickname: data.from,
          text: data.text
        };
        
        console.log("Formatted message:", formattedMessage);
        console.log("Current nickname:", nickname.value);
        
        // DM 메시지를 해당 사용자에 맞게 저장
        if (!dmMessages.value[conversationPartner]) {
          dmMessages.value[conversationPartner] = [];
        }
        dmMessages.value[conversationPartner].push(formattedMessage);
      } else if (data.type === "userlist") {
        userlist.value = data.users.filter((user: string) => user !== nickname.value);
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

// 전체 채팅방으로 전환
const selectGlobalChat = () => {
  selectedConversation.value = null;
};

// 특정 사용자와의 1:1 대화로 전환
const selectUserChat = (user: string) => {
  selectedConversation.value = user;
};
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
        v-for="(msg, index) in getFilteredMessages()"
        :key="index"
        :class="{
          'message-self': msg.nickname == nickname,
          'message-other': msg.nickname !== nickname
        }"
      >
        <div class="message-content">
          <span class="nickname" v-if="msg.nickname !== nickname">[{{ msg.nickname }}]</span>
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
  
  <!-- 왼쪽 사이드바 -->
  <div class="sidebar">
    <div class="sidebar-header">전체 채팅방</div>
    <div 
      class="user-item" 
      :class="{ 'selected': selectedConversation === null }" 
      @click="selectGlobalChat"
    >
      전체 채팅방
    </div>
    
    <div class="sidebar-header" style="margin-top: 20px;">접속자 목록</div>
    <div class="user-list">
      <div 
        v-for="(user, index) in userlist" 
        :key="index" 
        class="user-item" 
        :class="{ 'selected': selectedConversation === user }" 
        @click="selectUserChat(user)"
      >
        {{ user }}
      </div>
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

.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  width: 200px;
  height: 100vh;
  background-color: #ccc;
  padding: 20px;
  overflow-y: auto;
  box-sizing: border-box;
  z-index: 1000;
}

.sidebar-header {
  font-weight: bold;
  margin-bottom: 15px;
}

.user-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user-item {
  padding: 8px 12px;
  background-color: #f0f0f0;
  border-radius: 6px;
  word-break: break-word;
}

.user-item.selected {
  background-color: #d1e7dd !important;
}

.chat-container {
  margin-left: 200px;
}
</style>