<script setup>
const props = defineProps({
  title: { type: String, default: '' },
  collapsed: { type: Boolean, default: false },
  statusText: { type: String, default: '' },
  statusType: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  lastDate: { type: String, default: '' },
});
const emit = defineEmits(['toggle-collapse']);

// statusType → el-tag type：error→danger，其余按 loading/info
function tagType() {
  if (props.statusType === 'error') return 'danger';
  if (props.loading) return 'primary';
  return 'success';
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <el-button class="hamburger" text :icon="collapsed ? 'Expand' : 'Fold'" @click="emit('toggle-collapse')" />
      <span class="topbar-title">{{ title }}</span>
    </div>
    <div class="topbar-right">
      <el-tag :type="tagType()" effect="light" size="small" class="topbar-status">
        {{ statusText }}
      </el-tag>
      <span class="topbar-date" v-if="lastDate">数据截至 {{ lastDate }}</span>
    </div>
  </header>
</template>
