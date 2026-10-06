<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { Department } from "../types/chat";

// ─── 설정 > 부서관리 (admin 전용) ───
// 목록 + 검색/상태 조회조건, 추가/수정은 모달. 삭제 대신 '미사용' 체크.
const props = defineProps<{
  depts: Department[];
  upsertResult: { seq: number; ok: boolean; text: string } | null;
  isConnected: boolean;
}>();

const emit = defineEmits<{
  (e: "upsert-dept", payload: { deptNo?: number | null; deptCode: string; deptName: string; sortOrder: number; isDeleted: boolean }): void;
}>();

// ─── 조회조건 ───
const keyword = ref("");
const useFilter = ref<"all" | "active" | "inactive">("all");
const filteredDepts = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return props.depts.filter((d) => {
    if (useFilter.value === "active" && d.isDeleted) return false;
    if (useFilter.value === "inactive" && !d.isDeleted) return false;
    if (!kw) return true;
    return d.deptName.toLowerCase().includes(kw) || d.deptCode.toLowerCase().includes(kw);
  });
});

// ─── 추가/수정 모달 ───
const showModal = ref(false);
const editMode = ref<"add" | "edit">("add");
const editDeptNo = ref<number | null>(null);
const editCode = ref("");
const editName = ref("");
const editSort = ref("0");
const editIsDeleted = ref(false);
const modalError = ref("");
// 서버 응답 대기 중: 성공하면 닫고, 실패하면 모달에 사유를 표시한다
const saving = ref(false);
const DEPT_CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;

const editingDept = computed(() => props.depts.find((d) => d.deptNo === editDeptNo.value) ?? null);
// 소속 인원이 있는데 미사용 체크 → 즉시 경고 (최종 판정은 서버)
const memberWarning = computed(() => {
  const d = editingDept.value;
  if (!editIsDeleted.value || !d || d.isDeleted || d.memberCount === 0) return "";
  return `소속 사용자 ${d.memberCount}명이 있어 미사용 처리할 수 없습니다.`;
});

const openAddModal = () => {
  editMode.value = "add";
  editDeptNo.value = null;
  editCode.value = "";
  editName.value = "";
  // 기본 정렬순서: 현재 최대 + 1
  editSort.value = String(props.depts.reduce((m, d) => Math.max(m, d.sortOrder), 0) + 1);
  editIsDeleted.value = false;
  modalError.value = "";
  saving.value = false;
  showModal.value = true;
};

const openEditModal = (d: Department) => {
  editMode.value = "edit";
  editDeptNo.value = d.deptNo;
  editCode.value = d.deptCode;
  editName.value = d.deptName;
  editSort.value = String(d.sortOrder);
  editIsDeleted.value = d.isDeleted;
  modalError.value = "";
  saving.value = false;
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
  saving.value = false;
  modalError.value = "";
};

const confirmModal = () => {
  if (saving.value) return;
  const code = editCode.value.trim();
  const name = editName.value.trim().slice(0, 30);
  const sort = Number(editSort.value);
  if (editMode.value === "add" && !DEPT_CODE_RE.test(code)) {
    modalError.value = "부서코드는 영문/숫자/_/-, 최대 20자입니다.";
    return;
  }
  if (!name) {
    modalError.value = "부서명을 입력하세요.";
    return;
  }
  if (String(editSort.value).trim() === "" || !Number.isInteger(sort)) {
    modalError.value = "정렬순서는 정수로 입력하세요.";
    return;
  }
  if (memberWarning.value) {
    modalError.value = memberWarning.value;
    return;
  }
  if (!props.isConnected) {
    modalError.value = "서버에 연결되어 있지 않습니다.";
    return;
  }
  modalError.value = "";
  saving.value = true;
  emit("upsert-dept", {
    deptNo: editDeptNo.value,
    deptCode: code,
    deptName: name,
    sortOrder: sort,
    isDeleted: editIsDeleted.value,
  });
};

watch(
  () => props.upsertResult?.seq,
  () => {
    if (!saving.value || !props.upsertResult) return;
    saving.value = false;
    if (props.upsertResult.ok) closeModal();
    else modalError.value = props.upsertResult.text;
  },
);
</script>

<template>
  <div class="dept-screen">
    <h2 class="list-title">부서관리 ({{ filteredDepts.length }}개)
      <button class="small-btn primary" @click="openAddModal">+ 추가</button>
    </h2>
    <div class="filter-row">
      <input
        v-model="keyword"
        class="text-input search-input"
        placeholder="부서명/코드 검색"
      />
      <select v-model="useFilter" class="use-filter" title="사용여부 조회조건">
        <option value="all">전체</option>
        <option value="active">사용</option>
        <option value="inactive">미사용</option>
      </select>
    </div>

    <p v-if="depts.length === 0" class="empty">등록된 부서가 없습니다.</p>
    <p v-else-if="filteredDepts.length === 0" class="empty">조건에 해당하는 부서가 없습니다.</p>
    <div v-else class="dept-table" role="table">
      <div class="dept-row head" role="row">
        <span class="c-sort">정렬</span>
        <span class="c-code">코드</span>
        <span class="c-name">부서명</span>
        <span class="c-count">인원</span>
        <span class="c-use">상태</span>
        <span class="c-act"></span>
      </div>
      <div
        v-for="d in filteredDepts"
        :key="d.deptNo"
        class="dept-row"
        :class="{ inactive: d.isDeleted }"
        role="row"
        @dblclick="openEditModal(d)"
      >
        <span class="c-sort">{{ d.sortOrder }}</span>
        <span class="c-code">{{ d.deptCode }}</span>
        <span class="c-name">{{ d.deptName }}</span>
        <span class="c-count">{{ d.memberCount }}</span>
        <span class="c-use">
          <span class="use-tag" :class="d.isDeleted ? 'off' : 'on'">{{ d.isDeleted ? '미사용' : '사용' }}</span>
        </span>
        <span class="c-act">
          <button class="edit-btn" @click.stop="openEditModal(d)">수정</button>
        </span>
      </div>
    </div>

    <!-- 부서 추가/수정 모달 -->
    <div v-if="showModal" class="modal-backdrop" @click="closeModal">
      <div class="modal-card" @click.stop>
        <h3>{{ editMode === 'add' ? '부서 추가' : '부서 수정' }}</h3>
        <label class="field-label">부서코드 (영문/숫자, 불변)</label>
        <input
          v-model="editCode"
          class="text-input"
          placeholder="예) D001"
          maxlength="20"
          :disabled="editMode === 'edit'"
          @keyup.enter="confirmModal"
        />
        <label class="field-label">부서명</label>
        <input
          v-model="editName"
          class="text-input"
          placeholder="부서명 입력"
          maxlength="30"
          @keyup.enter="confirmModal"
        />
        <label class="field-label">정렬순서</label>
        <input
          v-model="editSort"
          class="text-input"
          type="number"
          step="1"
          @keyup.enter="confirmModal"
        />
        <label v-if="editMode === 'edit'" class="check-row">
          <input type="checkbox" v-model="editIsDeleted" />
          미사용 (체크 = 미사용)
          <span v-if="editingDept" class="member-hint">· 소속 {{ editingDept.memberCount }}명</span>
        </label>
        <p v-if="memberWarning" class="error">{{ memberWarning }}</p>
        <p v-else-if="modalError" class="error">{{ modalError }}</p>
        <div class="modal-actions">
          <button class="small-btn" @click="closeModal">취소</button>
          <button class="small-btn primary" :disabled="saving || !!memberWarning" @click="confirmModal">
            {{ saving ? '저장 중…' : editMode === 'add' ? '추가' : '저장' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dept-screen {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.list-title {
  font-size: 16px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.small-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.small-btn.primary {
  background: #007bff;
  color: #fff;
  border-color: #007bff;
}
.small-btn:disabled { opacity: 0.6; cursor: default; }
.filter-row { display: flex; gap: 8px; }
.search-input { flex: 1; min-width: 0; }
.use-filter {
  flex-shrink: 0;
  padding: 7px 6px;
  font-size: 13px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  color: #333;
  cursor: pointer;
}
.use-filter:focus { outline: none; border-color: #007bff; }
.error { color: #d33; font-size: 13px; margin: 8px 0 0; }
.empty { color: #888; font-size: 14px; }
.dept-table {
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
}
.dept-row {
  display: grid;
  grid-template-columns: 44px 70px 1fr 44px 64px 56px;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 14px;
  border-top: 1px solid #f0f0f0;
}
.dept-row:not(.head):hover { background: #e9f2ff; }
.dept-row.head {
  border-top: none;
  background: #f8f9fa;
  font-size: 12px;
  color: #666;
}
.dept-row.inactive { opacity: 0.6; }
.c-sort, .c-count { text-align: center; }
.c-code { color: #555; font-family: monospace; overflow: hidden; text-overflow: ellipsis; }
.c-name { word-break: break-all; }
.c-act { text-align: right; }
.use-tag {
  font-size: 11px;
  border-radius: 4px;
  padding: 2px 6px;
}
.use-tag.on { color: #1a7f37; background: #e6f4ea; }
.use-tag.off { color: #fff; background: #6c757d; }
.edit-btn {
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  color: #333;
}
.edit-btn:hover { background: #f0f0f0; }
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
}
.modal-card h3 { margin: 0 0 12px; font-size: 16px; }
.field-label { display: block; font-size: 13px; color: #555; margin: 8px 0 4px; }
.text-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-sizing: border-box;
}
.text-input:disabled { background: #f1f3f5; color: #555; }
.check-row { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-top: 12px; }
.member-hint { color: #888; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
