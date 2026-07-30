<template>
  <div class="three-container">
    <div class="canvas-wrapper">
      <div class="canvas-aspect-container">
        <SceneCanvas :init-scene="initScene" />
      </div>
      <!-- Edit Mode Toolbar (Left Side) -->
      <div class="canvas-edit-toolbar left">
        <button class="edit-btn" :class="{ 'active': activeMode === 'translate' }" title="Move object" @click.stop="setMode('translate')">
          ✛
        </button>
        <button class="edit-btn" :class="{ 'active': activeMode === 'rotate' }" title="Rotate object" @click.stop="setMode('rotate')">
          ↺
        </button>
        <button class="edit-btn" :class="{ 'active': activeMode === 'scale' }" title="Scale object" @click.stop="setMode('scale')">
          ⤢
        </button>
      </div>
      <!-- Asset Add/Duplicate/Group/Ungroup/Delete Toolbar (Right Side) -->
      <div class="canvas-edit-toolbar right">
        <button class="edit-btn add-btn" title="Add asset" @click.stop="addAsset">
          ＋
        </button>
        <button class="edit-btn duplicate-btn" title="Duplicate selected asset" @click.stop="duplicateAsset" :disabled="!hasSelection">
          ❐
        </button>
        <button class="edit-btn group-btn" title="Group selected assets (Cmd+G)" @click.stop="groupSelected" :disabled="!canGroup">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M1.5 2A.5.5 0 0 0 1 2.5v4a.5.5 0 0 0 .5.5h4A.5.5 0 0 0 6 6.5v-4A.5.5 0 0 0 5.5 2h-4zm.5 4V3h3v3h-3zm7.5-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-4zm.5 4V3h3v3h-3zM1.5 9.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-4zm.5 4v-3h3v3h-3zm7.5-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-4zm.5 4v-3h3v3h-3z"/>
          </svg>
        </button>
        <button class="edit-btn ungroup-btn" title="Ungroup selected group (Cmd+Shift+G)" @click.stop="ungroupSelected" :disabled="!canUngroup">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM9 10.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z"/>
            <path stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="2 2" d="M6.5 6.5l3 3"/>
          </svg>
        </button>
        <button class="edit-btn delete-btn" title="Delete selected asset" @click.stop="deleteAsset" :disabled="!hasSelection">
          ✕
        </button>
      </div>
    </div>
    <div class="info-overlay">
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
  nodes: props.initialState?.nodes ?? [],
})

const activeMode = ref<'translate' | 'rotate' | 'scale' | null>('translate')
const hasSelection = ref(false)
const canGroup = ref(false)
const canUngroup = ref(false)
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
    },
    onSelectionChange: (selected) => {
      hasSelection.value = selected
    },
    onSelectionInfoChange: (info) => {
      hasSelection.value = info.selectedCount > 0
      canGroup.value = info.canGroup
      canUngroup.value = info.canUngroup
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

const addAsset = () => {
  if (threeScene) {
    threeScene.addNewAsset()
  }
}

const deleteAsset = () => {
  if (threeScene) {
    threeScene.deleteSelectedAsset()
  }
}

const duplicateAsset = () => {
  if (threeScene) {
    threeScene.duplicateSelectedAsset()
  }
}

const groupSelected = () => {
  if (threeScene) {
    threeScene.groupSelected()
  }
}

const ungroupSelected = () => {
  if (threeScene) {
    threeScene.ungroupSelected()
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

const getThreeScene = () => {
  return threeScene
}

defineExpose({ setState, cleanup, getThreeScene })
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
  top: 12px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  z-index: 20;
}

.canvas-edit-toolbar.left {
  left: 12px;
}

.canvas-edit-toolbar.right {
  right: 12px;
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

.edit-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
  background: rgba(12, 12, 18, 0.5);
  border-color: rgba(255, 255, 255, 0.05);
  color: #5c5c6e;
}

.add-btn {
  color: #00ff66;
}

.add-btn:hover {
  background: rgba(0, 255, 102, 0.15);
  border-color: #00ff66;
}

.delete-btn {
  color: #ff3366;
}

.delete-btn:hover:not(:disabled) {
  background: rgba(255, 51, 102, 0.15);
  border-color: #ff3366;
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
