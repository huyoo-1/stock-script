<script setup>
defineProps({
  tabs: { type: Array, required: true },
  current: { type: String, required: true },
  collapsed: { type: Boolean, default: false },
});
const emit = defineEmits(['switch', 'toggle-collapse']);
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar-collapsed': collapsed }">
    <div class="sidebar-brand">
      <el-icon class="brand-icon"><TrendCharts /></el-icon>
      <span class="brand-text">A股大盘监控</span>
    </div>
    <el-menu :default-active="current" :collapse="collapsed" class="sidebar-nav" @select="(id) => emit('switch', id)">
      <el-menu-item v-for="t in tabs" :key="t.id" :index="t.id">
        <el-icon><component :is="t.icon" /></el-icon>
        <template #title>{{ t.name }}</template>
      </el-menu-item>
    </el-menu>
  </aside>
</template>
