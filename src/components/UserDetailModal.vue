<script lang="ts">
// 사용자 상세정보 모달 (읽기 전용, 아이디 제외)
// - 사용자 목록 더보기 메뉴 → '상세정보'
// - 메인 헤더 더보기 메뉴 → '내정보'
export interface UserDetailInfo {
  nickname: string;
  phone: string | null;
  userName: string | null;
  deptNo: number | null;
  isDeleted: boolean;
}
</script>

<script setup lang="ts">
defineProps<{
  user: UserDetailInfo;
  /** 부서명 (부서 목록에서 찾지 못하면 빈 문자열) */
  deptName: string;
  title?: string;
}>();

defineEmits<{
  (e: "close"): void;
}>();
</script>

<template>
  <div class="modal-backdrop" @click="$emit('close')">
    <div class="modal-card" @click.stop>
      <h3>{{ title ?? '상세정보' }}</h3>
      <dl class="detail-list">
        <dt>닉네임</dt>
        <dd>{{ user.nickname }}</dd>
        <dt>전화번호</dt>
        <dd>{{ user.phone || '-' }}</dd>
        <dt>이름</dt>
        <dd>{{ user.userName || '-' }}</dd>
        <dt>부서</dt>
        <dd>{{ deptName || '-' }}</dd>
        <dt>탈퇴여부</dt>
        <dd>{{ user.isDeleted ? '탈퇴' : '정상' }}</dd>
      </dl>
      <div class="modal-actions">
        <button class="small-btn primary" @click="$emit('close')">닫기</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.modal-card {
  width: 300px;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  font-family: sans-serif;
}
.modal-card h3 { margin: 0 0 12px; font-size: 16px; }
.detail-list {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 14px;
}
.detail-list dt { color: #555; font-size: 13px; }
.detail-list dd { margin: 0; color: #222; word-break: break-all; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.small-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.small-btn.primary { background: #007bff; color: #fff; border-color: #007bff; }
</style>
