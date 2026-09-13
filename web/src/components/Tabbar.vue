<script setup>
defineProps({
  tabs: { type: Array, required: true },
  current: { type: String, required: true },
});
const emit = defineEmits(['switch']);
</script>

<template>
  <nav class="tabbar">
    <button v-for="t in tabs" :key="t.id" class="tabbar-item"
            :class="{ active: current === t.id }" @click="emit('switch', t.id)">
      <el-icon class="tabbar-icon"><component :is="t.icon" /></el-icon>
      <span class="tabbar-label">{{ t.name }}</span>
    </button>
  </nav>
</template>
