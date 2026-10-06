<script setup lang="ts">
import { ref } from "vue";
import type { Department } from "../types/chat";
import DeptManageView from "./DeptManageView.vue";

// admin 전용 '설정' 탭: 좌측 메뉴 + 우측 작업영역
// 설정 메뉴 추가 시 SETTINGS_MENUS에 항목을 넣고 우측에 v-else-if 화면을 붙인다.
defineProps<{
  depts: Department[];
  deptUpsertResult: { seq: number; ok: boolean; text: string } | null;
  isConnected: boolean;
}>();

defineEmits<{
  (e: "upsert-dept", payload: { deptNo?: number | null; deptCode: string; deptName: string; sortOrder: number; isDeleted: boolean }): void;
}>();

const SETTINGS_MENUS = [{ key: "dept", label: "부서관리" }] as const;
type MenuKey = (typeof SETTINGS_MENUS)[number]["key"];
const activeMenu = ref<MenuKey>("dept");
</script>

<template>
  <div class="settings-screen">
    <nav class="settings-menu">
      <h3 class="menu-title">설정 메뉴</h3>
      <button
        v-for="m in SETTINGS_MENUS"
        :key="m.key"
        class="menu-item"
        :class="{ active: activeMenu === m.key }"
        @click="activeMenu = m.key"
      >{{ m.label }}</button>
    </nav>
    <section class="settings-body">
      <DeptManageView
        v-if="activeMenu === 'dept'"
        :depts="depts"
        :upsert-result="deptUpsertResult"
        :is-connected="isConnected"
        @upsert-dept="(p) => $emit('upsert-dept', p)"
      />
    </section>
  </div>
</template>

<style scoped>
.settings-screen {
  display: grid;
  grid-template-columns: 1fr 3fr;
  gap: 12px;
  align-items: start;
}
.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #fff;
  border-radius: 10px;
  padding: 10px;
}
.menu-title {
  margin: 0 0 6px;
  font-size: 13px;
  color: #888;
  font-weight: normal;
}
.menu-item {
  text-align: left;
  padding: 8px 10px;
  font-size: 14px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: #333;
}
.menu-item:hover { background: #f2f7ff; }
.menu-item.active { background: #e7f1ff; color: #007bff; font-weight: bold; }
.settings-body { min-width: 0; }
/* 좁은 창에서는 메뉴를 위로 쌓는다 */
@media (max-width: 560px) {
  .settings-screen { grid-template-columns: 1fr; }
  .settings-menu { flex-direction: row; flex-wrap: wrap; }
  .menu-title { display: none; }
}
</style>
