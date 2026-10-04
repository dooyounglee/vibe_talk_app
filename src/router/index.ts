import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";
import HomeView from "../views/HomeView.vue";
import RoomView from "../views/RoomView.vue";

// hash 히스토리 사용: Tauri 빌드(file://)와 vite dev 서버 모두에서 동작
// NOTE: 1:1 대화도 방 하나이므로 '#/room/:roomId' 경로만 쓴다.
const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: HomeView,
  },
  {
    // 번호방(1:1 포함) 채팅 페이지. window.open()으로 새 창에 띄우는 대상
    path: "/room/:roomId",
    name: "room",
    component: RoomView,
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
