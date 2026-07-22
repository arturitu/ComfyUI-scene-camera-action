<template>
  <div class="three-container">
    <div class="canvas-wrapper">
      <div class="canvas-aspect-container">
        <SceneCanvas :init-scene="initScene" />
      </div>
      <!-- Edit Mode Toolbar -->
      <div class="canvas-edit-toolbar">
        <button class="edit-btn" :class="{ 'active': activeMode === 'translate' }" title="Move object" @click="setMode('translate')">
          ✛
        </button>
        <button class="edit-btn" :class="{ 'active': activeMode === 'rotate' }" title="Rotate object" @click="setMode('rotate')">
          ↺
        </button>
        <button class="edit-btn" :class="{ 'active': activeMode === 'scale' }" title="Scale object" @click="setMode('scale')">
          ⤢
        </button>
      </div>
    </div>
    <div class="info-overlay">
      <div class="title">Scene 3D Node</div>
      <div>Assets: {{ state.num_assets }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import SceneCanvas from './SceneCanvas.vue'
import { ThreeScene } from '../ThreeScene'
import type { SceneState } from '../types'

const props = defineProps<{
  initialState?: Partial<SceneState>
  onStateChange?: (state: SceneState) => void
}>()

const state = reactive<SceneState>({
  type: 'cube_scene',
  num_assets: props.initialState?.num_assets ?? 1,
  asset_transforms: props.initialState?.asset_transforms ?? [],
})

const activeMode = ref<'translate' | 'rotate' | 'scale' | null>(null)
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
    },
    onTransformModeChange: (mode) => {
      activeMode.value = mode
    }
  })
  threeScene.setTransformMode(activeMode.value)
}

const setMode = (mode: 'translate' | 'rotate' | 'scale') => {
  if (activeMode.value === mode) {
    activeMode.value = null
  } else {
    activeMode.value = mode
  }
  if (threeScene) {
    threeScene.setTransformMode(activeMode.value)
  }
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
  position: relative;
}

.canvas-aspect-container {
  width: 100%;
  aspect-ratio: 16 / 9;
  max-width: 100%;
  max-height: 100%;
  position: relative;
  overflow: hidden;
}

.canvas-edit-toolbar {
  position: absolute;
  left: 12px;
  top: 12px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  z-index: 20;
}

.edit-btn {
  background: rgba(12, 12, 18, 0.85);
  color: #8c8c9e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  width: 32px;
  height: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
}

.edit-btn:hover {
  background: #2b2b3b;
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.2);
}

.edit-btn.active {
  background: #3d4974;
  color: #ffffff;
  border-color: #5d6d9e;
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
