<template>
  <div class="three-container">
    <!-- Preset Top Control Bar -->
    <div class="preset-control-bar">
      <div class="preset-selector-group">
        <span class="preset-label">SCENE:</span>
        <select class="preset-select" :value="selectedPreset" @change="onPresetSelectChange">
          <option value="__NEW__">+ New Scene...</option>
          <option v-if="selectedPreset && selectedPreset !== '__NEW__' && !presetFiles.includes(selectedPreset)" :value="selectedPreset">
            {{ selectedPreset }}
          </option>
          <option v-for="file in presetFiles" :key="file" :value="file">
            {{ file }}
          </option>
        </select>
        <span v-if="isDirty" class="dirty-badge" title="Unsaved modifications">Modified</span>
      </div>
      <div class="preset-actions">
        <button class="preset-btn save-btn" title="Save scene to JSON preset" @click.stop="saveCurrentPreset">
          Save
        </button>
        <button class="preset-btn reset-btn" title="Reset to last saved state" :disabled="!isDirty" @click.stop="resetCurrentPreset">
          Reset
        </button>
      </div>
    </div>

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

    <!-- Unsaved Changes Warning Modal -->
    <div v-if="showConfirmModal" class="confirm-modal-backdrop" @click.self="cancelSwitch">
      <div class="confirm-modal">
        <h3>Unsaved Changes</h3>
        <p>You have unsaved modifications in the current scene. What would you like to do before switching?</p>
        <div class="modal-buttons">
          <button class="modal-btn save" @click="confirmSaveAndSwitch">Save & Switch</button>
          <button class="modal-btn discard" @click="confirmDiscardAndSwitch">Discard Changes</button>
          <button class="modal-btn cancel" @click="cancelSwitch">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import SceneCanvas from './SceneCanvas.vue'
import { ThreeScene } from '../ThreeScene'
import type { SceneState } from '../types'

const props = defineProps<{
  initialState?: Partial<SceneState>
  initialPreset?: string
  onStateChange?: (state: SceneState) => void
  onPresetSaved?: (filename: string) => void
  onPresetChanged?: (filename: string) => void
}>()

const state = reactive<SceneState>({
  type: 'cube_scene',
  num_assets: props.initialState?.num_assets ?? 0,
  nodes: props.initialState?.nodes ?? [],
  selectedPreset: props.initialState?.selectedPreset || props.initialPreset || '__NEW__',
})

const activeMode = ref<'translate' | 'rotate' | 'scale' | null>('translate')
const hasSelection = ref(false)
const canGroup = ref(false)
const canUngroup = ref(false)
const isDirty = ref(false)
const presetFiles = ref<string[]>([])
const selectedPreset = ref<string>(state.selectedPreset || '__NEW__')
const pendingPresetTarget = ref<string | null>(null)
const showConfirmModal = ref(false)
let threeScene: ThreeScene | null = null
let originalPresetState: Partial<SceneState> | null = null

const normalizeStateString = (s: any): string => {
  if (!s || typeof s !== 'object') return ''
  return JSON.stringify({
    type: s.type || 'cube_scene',
    num_assets: s.num_assets ?? (s.nodes?.length || 0),
    nodes: s.nodes || []
  })
}

const isStateDifferent = (current: any, original: any): boolean => {
  if (!original) return false
  return normalizeStateString(current) !== normalizeStateString(original)
}

const fetchPresetList = async () => {
  try {
    const res = await fetch('/scene_camera_action/list_presets')
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.files)) {
        presetFiles.value = data.files.filter((f: string) => f !== 'None')
        const targetPreset = state.selectedPreset && state.selectedPreset !== '__NEW__' ? state.selectedPreset : null
        if (targetPreset && presetFiles.value.includes(targetPreset)) {
          selectedPreset.value = targetPreset
          try {
            const pRes = await fetch(`/scene_camera_action/get_preset?filename=${encodeURIComponent(targetPreset)}`)
            if (pRes.ok) {
              const origData = await pRes.json()
              originalPresetState = origData
              if (props.initialState && props.initialState.nodes?.length) {
                isDirty.value = isStateDifferent(props.initialState, originalPresetState)
              } else {
                setState(origData)
                isDirty.value = false
              }
            }
          } catch (e) {
            console.error('Error fetching initial preset data:', e)
          }
        }
      }
    }
  } catch (e) {
    console.error('Error fetching preset list:', e)
  }
}

onMounted(() => {
  fetchPresetList()
})

const loadPresetFile = async (filename: string) => {
  if (filename === '__NEW__') {
    const emptyState: SceneState = { type: 'cube_scene', num_assets: 0, nodes: [], selectedPreset: '__NEW__' }
    originalPresetState = emptyState
    setState(emptyState)
    selectedPreset.value = '__NEW__'
    state.selectedPreset = '__NEW__'
    isDirty.value = false
    props.onPresetChanged?.('__NEW__')
    if (props.onStateChange) props.onStateChange(state)
    return
  }

  try {
    const res = await fetch(`/scene_camera_action/get_preset?filename=${encodeURIComponent(filename)}`)
    if (res.ok) {
      const data = await res.json()
      originalPresetState = data
      data.selectedPreset = filename
      setState(data)
      selectedPreset.value = filename
      state.selectedPreset = filename
      isDirty.value = false
      props.onPresetChanged?.(filename)
      if (props.onStateChange) props.onStateChange(state)
    }
  } catch (e) {
    console.error('Error loading preset:', e)
  }
}

const onPresetSelectChange = (e: Event) => {
  const targetEl = e.target as HTMLSelectElement
  const newTarget = targetEl.value

  if (isDirty.value) {
    targetEl.value = selectedPreset.value
    pendingPresetTarget.value = newTarget
    showConfirmModal.value = true
  } else {
    selectedPreset.value = newTarget
    state.selectedPreset = newTarget
    loadPresetFile(newTarget)
  }
}

const confirmSaveAndSwitch = async () => {
  showConfirmModal.value = false
  await saveCurrentPreset()
  if (pendingPresetTarget.value) {
    const target = pendingPresetTarget.value
    pendingPresetTarget.value = null
    await loadPresetFile(target)
  }
}

const confirmDiscardAndSwitch = async () => {
  showConfirmModal.value = false
  isDirty.value = false
  if (pendingPresetTarget.value) {
    const target = pendingPresetTarget.value
    pendingPresetTarget.value = null
    await loadPresetFile(target)
  }
}

const cancelSwitch = () => {
  showConfirmModal.value = false
  pendingPresetTarget.value = null
}

const saveCurrentPreset = async () => {
  let targetFile = selectedPreset.value
  if (!targetFile || targetFile === 'None' || targetFile === '__NEW__') {
    const name = prompt('Name for the scene JSON preset file:', 'new_scene.json')
    if (!name) return
    targetFile = name.endsWith('.json') ? name : `${name}.json`
  }

  try {
    const res = await fetch('/scene_camera_action/save_preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: targetFile,
        scene_data: state,
      })
    })
    if (res.ok) {
      originalPresetState = JSON.parse(JSON.stringify(state))
      isDirty.value = false
      selectedPreset.value = targetFile
      state.selectedPreset = targetFile
      await fetchPresetList()
      if (props.onPresetSaved) {
        props.onPresetSaved(targetFile)
      }
      if (props.onStateChange) {
        props.onStateChange(state)
      }
    }
  } catch (e) {
    console.error('Error saving preset:', e)
  }
}

const resetCurrentPreset = () => {
  if (selectedPreset.value) {
    loadPresetFile(selectedPreset.value)
  }
}

const initScene = (container: HTMLElement) => {
  threeScene = new ThreeScene({
    container,
    initialState: state,
    onStateChange: (updatedState) => {
      Object.assign(state, updatedState, { selectedPreset: selectedPreset.value })
      isDirty.value = isStateDifferent(updatedState, originalPresetState)
      if (props.onStateChange) {
        props.onStateChange(state)
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
  if (newState.selectedPreset) {
    selectedPreset.value = newState.selectedPreset
    state.selectedPreset = newState.selectedPreset
  }
  if (threeScene) {
    threeScene.setState(newState)
  } else {
    Object.assign(state, newState)
  }
  isDirty.value = isStateDifferent(state, originalPresetState)
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

defineExpose({ setState, cleanup, getThreeScene, saveCurrentPreset, fetchPresetList })
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
  display: flex;
  flex-direction: column;
}

.preset-control-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: rgba(12, 16, 24, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 30;
  gap: 10px;
}

.preset-selector-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preset-label {
  font-size: 11px;
  font-weight: 600;
  color: #8c8c9e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.preset-select {
  background: #181d28;
  color: #e0e0e0;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.preset-select:hover {
  border-color: #4a90e2;
}

.dirty-badge {
  font-size: 11px;
  color: #ff9900;
  font-weight: bold;
  animation: blink 1.5s infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.preset-actions {
  display: flex;
  gap: 6px;
}

.preset-btn {
  background: #252b3b;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:hover:not(:disabled) {
  background: #3d4974;
  border-color: #4a90e2;
}

.preset-btn.save-btn {
  background: #1a4d36;
  border-color: #00ff66;
  color: #00ff66;
}

.preset-btn.save-btn:hover {
  background: #236849;
}

.preset-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.canvas-wrapper {
  width: 100%;
  flex: 1;
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

.confirm-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: flex;
  justify-content: center;
  align-items: center;
}

.confirm-modal {
  background: #181d28;
  border: 1px solid #4a90e2;
  border-radius: 8px;
  padding: 16px 20px;
  max-width: 320px;
  color: #ffffff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.confirm-modal h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #ff9900;
}

.confirm-modal p {
  margin: 0 0 16px 0;
  font-size: 12px;
  color: #cccccc;
  line-height: 1.4;
}

.modal-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-btn {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}

.modal-btn.save {
  background: #1a4d36;
  color: #00ff66;
  border-color: #00ff66;
}

.modal-btn.discard {
  background: #4a1f28;
  color: #ff3366;
  border-color: #ff3366;
}

.modal-btn.cancel {
  background: #252b3b;
  color: #aaaaaa;
  border-color: rgba(255, 255, 255, 0.2);
}
</style>
