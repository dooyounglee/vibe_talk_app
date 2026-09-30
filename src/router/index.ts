import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import HomeView from "../views/HomeView.vue";
import ChatRoomView from "../views/ChatRoomView.vue";

// hash 히스토리 사용: Tauri 빌드(file://)와 vite dev 서버 모두에서 동작
const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: HomeView,
  },
  {
    // 1:1 채팅 전용 페이지. window.open()으로 새 창에 띄우는 대상
    path: "/chat/:peer",
    name: "chat",
    component: ChatRoomView,
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
