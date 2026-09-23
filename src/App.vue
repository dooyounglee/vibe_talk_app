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

// 재연결 관련 상태
const connectionStatus = ref("연결되지 않음");
const reconnectTimer = ref<NodeJS.Timeout | null>(null);
const isManuallyDisconnected = ref(false);

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

// 재연결 시도 함수
const attemptReconnect = () => {
  if (isManuallyDisconnected.value) return;
  
  connectionStatus.value = "연결 중...";
  
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
    connectionStatus.value = "연결됨";
    
    // 재연결 성공 후 타이머 정리
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value);
      reconnectTimer.value = null;
    }
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
    
    // 수동으로 연결 해제한 경우 재연결하지 않음
    if (isManuallyDisconnected.value) {
      connectionStatus.value = "연결 끊김";
      return;
    }
    
    // 자동 재연결 로직
    connectionStatus.value = "연결 끊김 - 3초 후 재연결 시도";
    reconnectTimer.value = setTimeout(attemptReconnect, 3000);
  };
  
  // 오류 처리
  ws.onerror = (error) => {
    console.error("WebSocket Error:", error);
    // 오류 발생 시에도 재연결 시도
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value);
    }
    connectionStatus.value = "연결 끊김 - 3초 후 재연결 시도";
    reconnectTimer.value = setTimeout(attemptReconnect, 3000);
  };
};

// 수동 재연결 함수
const manualReconnect = () => {
  if (reconnectTimer.value) {
    clearTimeout(reconnectTimer.value);
    reconnectTimer.value = null;
  }
  isManuallyDisconnected.value = false;
  attemptReconnect();
};

// 연결 해제 함수
const disconnect = () => {
  if (ws) {
    ws.close();
  }
  isManuallyDisconnected.value = true;
  connectionStatus.value = "연결 끊김";
};

// 컴포넌트 언마운트 시 WebSocket 종료
onUnmounted(() => {
  if (ws) {
    ws.close();
  }
  if (reconnectTimer.value) {
    clearTimeout(reconnectTimer.value);
  }
});

// 컴포넌트 마운트 시 WebSocket 연결 설정
onMounted(() => {
  // 초기에는 닉네임이 없기 때문에 연결 시도하지 않음
  // 닉네임이 입력되고 연결 버튼이 눌러질 때만 연결 시도
});

// 채팅방으로 전환
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
    <!-- 연결 상태 표시 -->
    <div class="status">{{ connectionStatus }}</div>
    
    <!-- 재연결 버튼 -->
    <div v-if="connectionStatus.includes('끊김')" style="margin-bottom: 10px;">
      <button @click="manualReconnect" class="reconnect-button">재연결</button>
    </div>
    
    <!-- 상단: 닉네임 입력 -->
    <div class="input-section" v-if="!isConnected">
      <input
        v-model="nickname"
        placeholder="닉네임을 입력하세요"
        @keyup.enter="attemptReconnect"
      />
      <button @click="attemptReconnect" :disabled="isConnected || !nickname">연결</button>
      <button @click="disconnect" :disabled="!isConnected">연결 해제</button>
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

.reconnect-button {
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
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