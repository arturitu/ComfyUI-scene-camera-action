<template>
  <div class="three-container">
    <div v-if="!hasActingData" class="disabled-overlay">
      <div class="disabled-title">Directing Canvas Disabled</div>
      <div class="disabled-subtitle">Connect an Acting 3D Node to direct.</div>
    </div>
    <div v-else class="canvas-wrapper">
      <div class="canvas-aspect-container">
        <SceneCanvas :init-scene="initScene" />
      </div>

      <!-- Recording progress bar -->
      <div v-if="isRecording" class="recording-overlay">
        <div class="rec-header">
          <span class="rec-dot"></span>
          <span class="rec-text">DIRECTING</span>
          <span class="rec-timer">{{ recordingElapsed.toFixed(1) }}s</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill-recording"></div>
        </div>
      </div>

      <!-- Toolbar (Top Right) -->
      <div class="directing-toolbar">
        <button
          v-if="!isRecording"
          class="acting-btn rec-trigger"
          title="Start recording camera cuts"
          @click="startRecording"
        >● Record</button>
        <button
          v-else
          class="acting-btn rec-stop"
          title="Stop recording"
          @click="stopRecording"
        >■ Stop</button>

        <button
          v-for="mode in cameraModes"
          :key="mode.id"
          class="acting-btn cam-btn"
          :class="{ active: activeCameraMode === mode.id, recording: isRecording && activeCameraMode === mode.id }"
          @click="setCameraMode(mode.id)"
          :title="mode.id"
        >
          {{ mode.label }}
        </button>
      </div>
    </div>

    <!-- Status info overlay (Bottom Left) -->
    <div class="info-overlay">
      <template v-if="hasActingData">
        <div class="title">Directing 3D Node</div>
        <div v-if="isRecording" class="state-indicator recording">Recording Camera Cuts</div>
        <div v-else-if="cameraTimeline.length > 0" class="state-indicator playing">
          {{ cameraTimeline.length }} cut{{ cameraTimeline.length !== 1 ? 's' : '' }} recorded
        </div>
        <div v-else class="state-indicator interactive">Playback Loop</div>
        <div class="hint">Active View: {{ activeCameraMode }}</div>
      </template>
      <template v-else>
        <div class="hint">Waiting for acting link...</div>
      </template>
    </div>

    <!-- Time Counter Overlay (Bottom Right) -->
    <div v-if="hasActingData" class="time-counter-overlay">
      {{ formattedTime }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted, onUnmounted } from 'vue'
import SceneCanvas from './SceneCanvas.vue'
import { ThreeDirecting } from '../ThreeDirecting'
import type { DirectingState } from '../types'

const props = defineProps<{
  initialState?: Partial<DirectingState>
  onStateChange?: (state: DirectingState) => void
  onDirectingDataChange?: (directingDataJson: string) => void
  currentNode?: any
}>()

interface CameraMode {
  id: string
  label: string
}

const cameraModes: CameraMode[] = [
  { id: 'Third Person', label: 'TPV' },
  { id: 'First Person', label: 'FPV' },
  { id: 'Wide', label: 'Wide' },
  { id: 'Cinematic Drone', label: 'Drone' },
]

const state = reactive<DirectingState>({
  camera_mode: props.initialState?.camera_mode ?? 'Third Person',
  acting_data: props.initialState?.acting_data ?? '',
  directing_data: props.initialState?.directing_data ?? '',
})

const activeCameraMode = ref(state.camera_mode)
const isRecording = ref(false)
const recordingElapsed = ref(0)
const cameraTimeline = ref<Array<{ t: number; mode: string }>>(
  tryParseTimeline(state.directing_data)
)

let threeDirecting: ThreeDirecting | null = null
let checkInterval: any = null
let recordingInterval: any = null
let recordingStartTime = 0

function tryParseTimeline(raw: string): Array<{ t: number; mode: string }> {
  if (!raw || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  return []
}

const hasActingData = computed(() => !!state.acting_data && state.acting_data.trim().length > 0)

const initScene = (el: HTMLElement) => {
  threeDirecting = new ThreeDirecting({
    container: el,
    initialState: state,
    onStateChange: (newState) => {
      if (props.onStateChange) {
        props.onStateChange({ ...state, ...newState })
      }
    },
  })
}

const setCameraMode = (mode: string) => {
  activeCameraMode.value = mode
  state.camera_mode = mode
  if (threeDirecting) {
    threeDirecting.setState({ camera_mode: mode })
  }

  // While recording, log each cut with timestamp
  if (isRecording.value) {
    const t = (performance.now() - recordingStartTime) / 1000
    cameraTimeline.value.push({ t, mode })
  }
}

const startRecording = () => {
  cameraTimeline.value = []
  recordingStartTime = performance.now()
  recordingElapsed.value = 0
  isRecording.value = true

  // Push first entry as time=0 with current mode
  cameraTimeline.value.push({ t: 0, mode: activeCameraMode.value })

  recordingInterval = setInterval(() => {
    recordingElapsed.value = (performance.now() - recordingStartTime) / 1000
  }, 100)
}

const stopRecording = () => {
  isRecording.value = false
  if (recordingInterval) {
    clearInterval(recordingInterval)
    recordingInterval = null
  }

  const timelineJson = JSON.stringify(cameraTimeline.value)
  state.directing_data = timelineJson

  if (props.onDirectingDataChange) {
    props.onDirectingDataChange(timelineJson)
  }
}

const setState = (newState: Partial<DirectingState>) => {
  if (newState.hasOwnProperty('acting_data')) {
    state.acting_data = newState.acting_data as string
  }
  if (newState.hasOwnProperty('camera_mode')) {
    activeCameraMode.value = newState.camera_mode as string
    state.camera_mode = newState.camera_mode as string
  }
  if (newState.hasOwnProperty('directing_data')) {
    state.directing_data = newState.directing_data as string
    cameraTimeline.value = tryParseTimeline(state.directing_data)
  }

  if (threeDirecting) {
    threeDirecting.setState(newState)
  } else {
    Object.assign(state, newState)
  }
}

const cleanup = () => {
  if (threeDirecting) {
    threeDirecting.dispose()
    threeDirecting = null
  }
  if (recordingInterval) {
    clearInterval(recordingInterval)
    recordingInterval = null
  }
}

const currentTime = ref(0)
const totalDuration = ref(7.0)
let timeFrameId: number | null = null

const updateTimeCounter = () => {
  if (threeDirecting) {
    currentTime.value = threeDirecting.getCurrentTime()
    totalDuration.value = threeDirecting.getDuration()
  }
  timeFrameId = requestAnimationFrame(updateTimeCounter)
}

const formattedTime = computed(() => {
  const cur = Math.max(0, currentTime.value).toFixed(1)
  const dur = Math.max(0, totalDuration.value).toFixed(1)
  return `${cur}s / ${dur}s`
})

onMounted(() => {
  timeFrameId = requestAnimationFrame(updateTimeCounter)
})

onUnmounted(() => {
  if (timeFrameId !== null) {
    cancelAnimationFrame(timeFrameId)
    timeFrameId = null
  }
  cleanup()
})

const setConnectedThreeActing = (threeActing: any) => {
  if (threeDirecting) {
    threeDirecting.setConnectedThreeActing(threeActing)
  }
}

defineExpose({ setState, cleanup, setConnectedThreeActing })
</script>

<style scoped>
.three-container {
  width: 100%;
  height: 100%;
  position: relative;
  background: #10121d;
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

.disabled-overlay {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: rgba(16, 18, 29, 0.95);
  color: #4a90e2;
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
  color: #8c8c9e;
}

/* Recording overlay */
.recording-overlay {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 320px;
  background: rgba(12, 12, 18, 0.9);
  border: 1px solid rgba(255, 51, 102, 0.4);
  border-radius: 6px;
  padding: 8px 12px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 6px;
  backdrop-filter: blur(8px);
}

.rec-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: bold;
  color: #ff3366;
}

.rec-dot {
  width: 8px;
  height: 8px;
  background: #ff3366;
  border-radius: 50%;
  animation: blink 1s infinite steps(2, start);
}

@keyframes blink {
  from { opacity: 1; }
  to { opacity: 0.2; }
}

.rec-text {
  flex-grow: 1;
  letter-spacing: 1px;
}

.rec-timer {
  color: #8c8c9e;
}

.progress-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill-recording {
  height: 100%;
  background: #ff3366;
  width: 100%;
  animation: progress-pulse 1.5s infinite alternate;
}

@keyframes progress-pulse {
  from { opacity: 0.6; }
  to { opacity: 1; }
}

/* Toolbar styling matching ActingWidget */
.directing-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 6px;
  z-index: 20;
}

.acting-btn {
  background: rgba(12, 12, 18, 0.85);
  color: #8c8c9e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
}

.acting-btn:hover {
  background: #2b2b3b;
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.2);
}

.rec-trigger {
  color: #ff3366;
  border-color: rgba(255, 51, 102, 0.2);
}

.rec-trigger:hover {
  background: rgba(255, 51, 102, 0.15);
  border-color: #ff3366;
}

.rec-stop {
  color: #ffffff;
  background: #ff3366;
  border-color: #ff3366;
}

.rec-stop:hover {
  background: #ff0044;
}

.cam-btn.active {
  background: #3d4974;
  color: #ffffff;
  border-color: #5d6d9e;
}

.cam-btn.recording.active {
  background: #ff3366;
  color: #ffffff;
  border-color: #ff3366;
}

/* Info overlay styling matching Scene/Acting Widget */
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
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
}

.title {
  font-weight: bold;
  color: #ffffff;
  margin-bottom: 2px;
}

.state-indicator {
  font-size: 10px;
  font-weight: bold;
  margin: 2px 0;
  text-transform: uppercase;
}

.state-indicator.playing {
  color: #00ff66;
}

.state-indicator.recording {
  color: #ff3366;
}

.state-indicator.interactive {
  color: #4a90e2;
}

.hint {
  margin-top: 2px;
  font-size: 10px;
  color: #4a90e2;
  font-style: italic;
}

.time-counter-overlay {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(15, 20, 29, 0.85);
  border: 1px solid rgba(74, 144, 226, 0.4);
  border-radius: 6px;
  padding: 5px 9px;
  font-size: 11px;
  font-weight: bold;
  color: #ffffff;
  backdrop-filter: blur(4px);
  font-family: monospace;
  pointer-events: none;
  z-index: 10;
  letter-spacing: 0.5px;
}
</style>
