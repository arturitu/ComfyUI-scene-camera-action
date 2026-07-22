<template>
  <div class="three-container">
    <div v-if="!state.scene_data" class="disabled-overlay">
      <div class="disabled-title">Acting Canvas Disabled</div>
      <div class="disabled-subtitle">Connect a Scene 3D Node to activate.</div>
    </div>
    <div v-else class="canvas-wrapper">
      <div class="canvas-aspect-container">
        <SceneCanvas :init-scene="initScene" />
      </div>
    </div>
    <div class="info-overlay">
      <div class="title">Acting 3D Node</div>
      <template v-if="state.scene_data">
        <div>Speed: {{ state.character_speed }}</div>
        <div class="hint">Use Arrow keys to move character</div>
      </template>
      <template v-else>
        <div class="hint">Waiting for scene link...</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch, onMounted, onUnmounted } from 'vue'
import SceneCanvas from './SceneCanvas.vue'
import { ThreeActing } from '../ThreeActing'
import type { ActingState } from '../types'

const props = defineProps<{
  initialState?: Partial<ActingState>
  onStateChange?: (state: ActingState) => void
  currentNode?: any
}>()

const state = reactive<ActingState>({
  character_speed: props.initialState?.character_speed ?? 10.0,
  scene_data: props.initialState?.scene_data ?? null as any,
})

let threeActing: ThreeActing | null = null
let checkInterval: any = null

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
  if (newState.hasOwnProperty('scene_data')) {
    state.scene_data = newState.scene_data as any
  }
  if (newState.hasOwnProperty('character_speed')) {
    state.character_speed = newState.character_speed as number
  }
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

// Watch scene_data to trigger cleanup when disconnected
watch(() => state.scene_data, (newVal) => {
  if (!newVal) {
    cleanup()
  }
})

onMounted(() => {
  checkInterval = setInterval(() => {
    const node = props.currentNode
    if (!node) return

    const sceneInput = node.inputs?.find((i: any) => i.name === 'scene')
    const hasLink = sceneInput && sceneInput.link != null

    if (!hasLink) {
      if (state.scene_data) {
        state.scene_data = null as any
      }
    } else {
      // Access app's graph
      const comfyApp = (window as any).comfyAPI?.app?.app
      const graph = node.graph || comfyApp?.graph
      let linkFound = false
      if (graph && graph.links) {
        const link = graph.links[sceneInput.link]
        if (link) {
          const originNode = graph.getNodeById?.(link.origin_id)
          if (originNode) {
            linkFound = true
            // Read serialized state directly from originNode's widget
            const sceneDataWidget = originNode.widgets?.find((w: any) => w.name === 'scene_data')
            let connectedState: any = null
            if (sceneDataWidget && sceneDataWidget.value) {
              if (typeof sceneDataWidget.value === 'object') {
                connectedState = sceneDataWidget.value
              } else if (typeof sceneDataWidget.value === 'string' && sceneDataWidget.value.trim()) {
                try {
                  connectedState = JSON.parse(sceneDataWidget.value)
                } catch (e) {}
              }
            }

            // Fallback to node properties
            if (!connectedState && originNode.properties?.['sceneNodeState']) {
              connectedState = originNode.properties['sceneNodeState']
            }

            if (connectedState) {
              // Ensure asset_transforms is at least present
              if (!connectedState.asset_transforms) {
                connectedState.asset_transforms = []
              }

              // Only trigger state change if the data is actually different
              if (JSON.stringify(state.scene_data) !== JSON.stringify(connectedState)) {
                state.scene_data = connectedState
                if (threeActing) {
                  threeActing.setState({ scene_data: connectedState })
                }
              }
            }
          }
        }
      }
      if (!linkFound) {
        if (state.scene_data) {
          state.scene_data = null as any
        }
      }
    }
  }, 200)
})

onUnmounted(() => {
  if (checkInterval) {
    clearInterval(checkInterval)
  }
  cleanup()
})

const setConnectedThreeScene = (threeScene: any) => {
  if (threeActing) {
    threeActing.setConnectedThreeScene(threeScene)
  }
}

defineExpose({ setState, cleanup, setConnectedThreeScene })
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

.canvas-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #0d0a10;
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

.disabled-overlay {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: rgba(20, 16, 25, 0.95);
  color: #ff007f;
  text-align: center;
  padding: 20px;
  box-sizing: border-box;
}

.disabled-title {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 6px;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.disabled-subtitle {
  font-size: 11px;
  color: #a08090;
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
