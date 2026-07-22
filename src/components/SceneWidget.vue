<template>
  <div class="three-container">
    <div class="canvas-wrapper">
      <div class="canvas-aspect-container">
        <SceneCanvas :init-scene="initScene" />
      </div>
    </div>
    <div class="info-overlay">
      <div class="title">Scene 3D Node</div>
      <div>Cube Size: {{ state.cube_size }}</div>
      <div>Color: {{ state.color }}</div>
      <div>Grid: {{ state.grid_visible ? 'On' : 'Off' }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import SceneCanvas from './SceneCanvas.vue'
import { ThreeScene } from '../ThreeScene'
import type { SceneState } from '../types'

const props = defineProps<{
  initialState?: Partial<SceneState>
  onStateChange?: (state: SceneState) => void
}>()

const state = reactive<SceneState>({
  type: 'cube_scene',
  cube_size: props.initialState?.cube_size ?? 1.0,
  color: props.initialState?.color ?? '#4a90e2',
  grid_visible: props.initialState?.grid_visible ?? true,
})

let threeScene: ThreeScene | null = null

const initScene = (container: HTMLElement) => {
  threeScene = new ThreeScene({
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

const setState = (newState: Partial<SceneState>) => {
  if (threeScene) {
    threeScene.setState(newState)
  } else {
    Object.assign(state, newState)
  }
}

const cleanup = () => {
  if (threeScene) {
    threeScene.dispose()
    threeScene = null
  }
}

defineExpose({ setState, cleanup })
</script>

<style scoped>
.three-container {
  width: 100%;
  height: 100%;
  position: relative;
  background: #0f141d;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(74, 144, 226, 0.3);
}

.canvas-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #0a0d14;
  overflow: hidden;
}

.canvas-aspect-container {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-width: 100%;
  max-height: 100%;
  position: relative;
  overflow: hidden;
}

.info-overlay {
  position: absolute;
  bottom: 8px;
  left: 8px;
  background: rgba(15, 20, 29, 0.85);
  border: 1px solid rgba(74, 144, 226, 0.4);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: #4a90e2;
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
</style>
