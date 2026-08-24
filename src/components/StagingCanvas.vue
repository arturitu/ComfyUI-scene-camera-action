<template>
  <div ref="containerRef" class="canvas-container" @pointerdown.stop @mousedown.stop></div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const props = defineProps<{
  initScene: (container: HTMLElement) => void
}>()

const containerRef = ref<HTMLElement | null>(null)

onMounted(() => {
  if (containerRef.value) {
    props.initScene(containerRef.value)
  }
})
</script>

<style scoped>
.canvas-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}
</style>
