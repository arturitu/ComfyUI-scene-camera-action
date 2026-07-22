<template>
  <div class="three-container">
    <SceneCanvas :init-scene="initScene" />
    <div class="info-overlay">
      <div class="title">Acting 3D Node</div>
      <div>Scene Cube: {{ state.scene_data?.cube_size ?? 1.0 }}</div>
      <div>Scene Color: {{ state.scene_data?.color ?? '#4a90e2' }}</div>
      <div>Speed: {{ state.character_speed }}</div>
      <div class="hint">Use WASD / Arrow keys to move character</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import SceneCanvas from './SceneCanvas.vue'
import { ThreeActing } from '../ThreeActing'
import type { ActingState } from '../types'

const props = defineProps<{
  initialState?: Partial<ActingState>
  onStateChange?: (state: ActingState) => void
}>()

const state = reactive<ActingState>({
  character_speed: props.initialState?.character_speed ?? 1.0,
  scene_data: props.initialState?.scene_data ?? {
    type: 'cube_scene',
    cube_size: 1.0,
    color: '#4a90e2',
    grid_visible: true,
  },
})

let threeActing: ThreeActing | null = null

const initScene = (container: HTMLElement) => {
  threeActing = new ThreeActing({
    container,
    initialState: state,
    onStateChange: (updatedState) => {
      Object.assign(state, updatedState)
      if (props.onStateChange) {
        props.onStateChange(updatedState)
      }
    }
  })
}

const setState = (newState: Partial<ActingState>) => {
  if (threeActing) {
    threeActing.setState(newState)
  } else {
    Object.assign(state, newState)
  }
}

const cleanup = () => {
  if (threeActing) {
    threeActing.dispose()
    threeActing = null
  }
}

defineExpose({ setState, cleanup })
</script>

<style scoped>
.three-container {
  width: 100%;
  height: 100%;
  position: relative;
  background: #141019;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 0, 127, 0.3);
}

.info-overlay {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(20, 16, 25, 0.85);
  border: 1px solid rgba(255, 0, 127, 0.4);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: #ff007f;
  backdrop-filter: blur(4px);
  font-family: monospace;
  pointer-events: none;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  font-weight: bold;
  color: #ffffff;
  margin-bottom: 2px;
}

.hint {
  margin-top: 2px;
  font-size: 10px;
  color: #00ffff;
  font-style: italic;
}
</style>
