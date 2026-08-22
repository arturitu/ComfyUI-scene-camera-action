<template>
  <div class="three-container">
    <div v-if="!state.scene_data" class="disabled-overlay">
      <div class="disabled-title">Acting Canvas Disabled</div>
      <div class="disabled-subtitle">Connect a Stage or Acting 3D Node to activate.</div>
    </div>
    <div v-else class="canvas-wrapper">
      <div class="canvas-aspect-container">
        <StagingCanvas :init-scene="initScene" />
      </div>

      <!-- Top-left Countdown Badge -->
      <div v-if="countdownVal !== null" class="countdown-badge">
        <span class="countdown-dot"></span>
        REC IN {{ countdownVal }}s
      </div>

      <!-- Recording progress bar / state overlay -->
      <div v-if="isRecording" class="recording-overlay">
        <div class="rec-header">
          <span class="rec-dot"></span>
          <span class="rec-text">RECORDING</span>
          <span class="rec-timer">{{ recordingElapsed.toFixed(1) }}s / {{ state.duration }}s</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: (recordingElapsed / state.duration * 100) + '%' }"></div>
        </div>
      </div>

      <!-- Spawn Point Toolbar (Left Side: 3 Buttons) -->
      <div v-if="!isRecording && !isPlaying && !isCounting && !state.motion_data" class="canvas-edit-toolbar left">
        <button
          class="edit-btn"
          title="Reset Actor to Spawn Point"
          @click.stop="resetActorToSpawn"
        >
          <LocateFixed :size="16" />
        </button>
        <button
          class="edit-btn"
          :class="{ 'active': activeSpawnMode === 'translate' }"
          title="Move Spawn Point (XYZ axes)"
          @click.stop="toggleSpawnMode('translate')"
        >
          <Move :size="16" />
        </button>
        <button
          class="edit-btn"
          :class="{ 'active': activeSpawnMode === 'rotate' }"
          title="Rotate Spawn Heading (Y axis)"
          @click.stop="toggleSpawnMode('rotate')"
        >
          <RotateCw :size="16" />
        </button>
      </div>

      <!-- Controls Overlay (Top Right / Bottom Center) -->
      <div class="acting-toolbar">
        <button
          v-if="!isRecording && !isCounting && !state.motion_data"
          class="acting-btn rec-trigger"
          title="Start Recording"
          @click="startCountdown"
        >
          <CircleDot :size="13" class="btn-icon" />
          <span>Record</span>
        </button>
        <button
          v-if="isRecording"
          class="acting-btn rec-stop"
          title="Stop Recording"
          @click="stopRecording"
        >
          <Square :size="12" class="btn-icon fill-icon" />
          <span>Stop</span>
        </button>

        <template v-if="state.motion_data && !isRecording && !isCounting">
          <button
            class="acting-btn play-btn"
            :class="{ 'playing': isPlaying }"
            :title="isPlaying ? 'Pause Playback' : 'Play Playback'"
            @click="togglePlay"
          >
            <component :is="isPlaying ? Pause : Play" :size="12" class="btn-icon" />
            <span>{{ isPlaying ? 'Pause' : 'Play' }}</span>
          </button>
          <button
            class="acting-btn stop-btn"
            title="Stop and Reset Position"
            @click="stopPlayback"
          >
            <Square :size="12" class="btn-icon fill-icon" />
            <span>Stop</span>
          </button>
          <button
            class="acting-btn reset-btn"
            title="Clear Recording and Reset to Keyboard"
            @click="resetToInteractive"
          >
            <RotateCcw :size="12" class="btn-icon" />
            <span>Reset</span>
          </button>
        </template>
      </div>
    </div>

    <div class="info-overlay">
      <template v-if="state.scene_data">
        <div v-if="isPlaying" class="state-indicator playing">
          <Play :size="10" class="status-icon fill-icon" /> REPLAYING
        </div>
        <div v-else-if="isRecording" class="state-indicator recording">
          <span class="rec-dot"></span> RECORDING
        </div>
        <div v-else-if="isCounting" class="state-indicator counting">
          STARTING IN {{ countdownVal }}...
        </div>
        <div v-else-if="!state.motion_data" class="state-indicator practice">
          <span class="practice-dot"></span> PRACTICE
        </div>
        <div v-else class="state-indicator recorded">
          <Check :size="11" class="status-icon" /> RECORDED
        </div>
        
        <button class="info-help-btn" title="View Keyboard Controls" @click="showHelpModal = true">
          <CircleHelp :size="13" class="info-icon" />
          <span class="info-label">Controls</span>
        </button>
      </template>
      <template v-else>
        <div class="hint">Waiting for stage link...</div>
      </template>
    </div>

    <!-- Time Counter Overlay (Bottom Right) -->
    <div v-if="state.scene_data" class="time-counter-overlay" :class="{ practice: !state.motion_data, recording: isRecording, playing: isPlaying }">
      <Repeat v-if="!state.motion_data" :size="12" class="loop-icon" title="Practice Loop" />
      {{ formattedTime }}
    </div>

    <!-- Help / Keyboard Controls Modal (Scoped to Acting Widget container) -->
    <div v-if="showHelpModal" class="controls-modal-backdrop" @click.self="showHelpModal = false">
      <div class="controls-modal-card">
        <div class="modal-header">
          <div class="modal-title-group">
            <h3 class="modal-title">Keyboard Controls</h3>
            <span class="actor-type-badge" :class="state.actor_type">
              {{ state.actor_type === 'car' ? 'CAR ACTOR' : 'HUMAN ACTOR' }}
            </span>
          </div>
          <button class="modal-close-btn" @click="showHelpModal = false" title="Close">
            <X :size="16" />
          </button>
        </div>

        <div class="modal-body">
          <div v-if="state.actor_type === 'car'" class="controls-list">
            <div class="control-row">
              <div class="key-group"><kbd>W</kbd> <span class="or">or</span> <kbd>▲</kbd></div>
              <span class="action-desc">Accelerate</span>
            </div>
            <div class="control-row">
              <div class="key-group"><kbd>S</kbd> <span class="or">or</span> <kbd>▼</kbd></div>
              <span class="action-desc">Brake / Reverse</span>
            </div>
            <div class="control-row">
              <div class="key-group"><kbd>A</kbd> <kbd>D</kbd> <span class="or">or</span> <kbd>◀</kbd> <kbd>▶</kbd></div>
              <span class="action-desc">Steer Left / Right</span>
            </div>
            <div class="control-row">
              <div class="key-group"><kbd>Space</kbd></div>
              <span class="action-desc">Handbrake</span>
            </div>
          </div>

          <div v-else class="controls-list">
            <div class="control-row">
              <div class="key-group"><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <span class="or">or</span> <kbd>Arrows</kbd></div>
              <span class="action-desc">Move</span>
            </div>
            <div class="control-row">
              <div class="key-group"><kbd>Shift</kbd> + Move</div>
              <span class="action-desc">Sprint (Fast Run)</span>
            </div>
            <div class="control-row">
              <div class="key-group"><kbd>C</kbd></div>
              <span class="action-desc">Crouch / Crouch Walk</span>
            </div>
            <div class="control-row">
              <div class="key-group"><kbd>Space</kbd> <span class="or">or</span> <kbd>J</kbd></div>
              <span class="action-desc">Jump</span>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="modal-ok-btn" @click="showHelpModal = false">Got it</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  LocateFixed,
  Move,
  RotateCw,
  CircleDot,
  Square,
  Play,
  Pause,
  RotateCcw,
  Check,
  CircleHelp,
  Repeat,
  X
} from 'lucide-vue-next'
import StagingCanvas from './StagingCanvas.vue'
import { ThreeActing } from '../ThreeActing'
import type { ActingState } from '../types'

const props = defineProps<{
  initialState?: Partial<ActingState>
  onStateChange?: (state: ActingState) => void
  currentNode?: any
}>()

const initialActorType = props.initialState?.actor_type ?? 'human'
const initialActorSpeed = props.initialState?.actor_speed ?? (initialActorType === 'car' ? 20.0 : 10.0)
const defaultActorColor = computed(() => initialActorType === 'car' ? '#0284C7' : '#F1DFBF')
const initialActorColor = props.initialState?.actor_color ?? defaultActorColor.value

const state = reactive<ActingState>({
  actor_type: initialActorType,
  actor_color: initialActorColor,
  actor_speed: initialActorSpeed,
  duration: props.initialState?.duration ?? 7.0,
  spawn_point: props.initialState?.spawn_point,
  motion_data: props.initialState?.motion_data ?? '',
  scene_data: props.initialState?.scene_data ?? null as any,
  actors: props.initialState?.actors ?? []
})

const actorColorVal = computed(() => state.actor_color || (state.actor_type === 'car' ? '#0284C7' : '#F1DFBF'))

const onColorChange = (e: Event) => {
  const hex = (e.target as HTMLInputElement).value
  state.actor_color = hex
  if (props.onStateChange) {
    props.onStateChange(state)
  }
  if (threeActing) {
    threeActing.setActorColor(hex)
  }
}

const isCounting = ref(false)
const countdownVal = ref<number | null>(null)
const isRecording = ref(false)
const recordingElapsed = ref(0)
const isPlaying = ref(false)
const showHelpModal = ref(false)
const activeSpawnMode = ref<'translate' | 'rotate' | null>(null)

const toggleSpawnMode = (mode: 'translate' | 'rotate') => {
  if (activeSpawnMode.value === mode) {
    activeSpawnMode.value = null
  } else {
    activeSpawnMode.value = mode
  }
  if (threeActing) {
    threeActing.setSpawnTransformMode(activeSpawnMode.value)
  }
}

const resetActorToSpawn = () => {
  if (threeActing) {
    threeActing.resetActorPosition()
  }
}

const handleEscapeKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && showHelpModal.value) {
    showHelpModal.value = false
  }
}

let threeActing: ThreeActing | null = null
let currentThreeScene: any = null
let checkInterval: any = null
let recordProgressFrameId: number | null = null

const initScene = (container: HTMLElement) => {
  threeActing = new ThreeActing({
    container,
    initialState: state,
    onStateChange: (updatedState) => {
      Object.assign(state, updatedState)
      if (props.onStateChange) {
        props.onStateChange(updatedState)
      }
    },
    onRecordingFinished: onRecordingFinished,
    connectedThreeScene: currentThreeScene
  })

  // Auto-play initially if there is saved motion data
  if (state.motion_data) {
    isPlaying.value = true
    threeActing.startPlayback(state.motion_data)
  }
}

const updateRecordProgress = () => {
  if (threeActing && isRecording.value) {
    recordingElapsed.value = (threeActing as any).recordingTime
    recordProgressFrameId = requestAnimationFrame(updateRecordProgress)
  }
}

const startCountdown = () => {
  if (isCounting.value || isRecording.value) return
  activeSpawnMode.value = null
  if (threeActing) {
    threeActing.setSpawnTransformMode(null)
    threeActing.setCountingState(true)
  }

  if (isPlaying.value) {
    isPlaying.value = false
    if (threeActing) {
      threeActing.stopPlayback()
    }
  }

  isCounting.value = true
  countdownVal.value = 3

  const interval = setInterval(() => {
    if (countdownVal.value !== null && countdownVal.value > 1) {
      countdownVal.value -= 1
    } else {
      clearInterval(interval)
      countdownVal.value = null
      isCounting.value = false

      // Start recording
      isRecording.value = true
      recordingElapsed.value = 0
      if (threeActing) {
        threeActing.startRecording()
      }
    }
  }, 1000)
}

const stopRecording = () => {
  if (threeActing && isRecording.value) {
    const json = threeActing.stopRecording()
    onRecordingFinished(json)
  }
}

const onRecordingFinished = (json: string) => {
  isRecording.value = false

  state.motion_data = json
  if (props.onStateChange) {
    props.onStateChange(state)
  }

  // Auto-play the recording in a loop
  isPlaying.value = true
  if (threeActing) {
    threeActing.startPlayback(json)
  }
}

const togglePlay = () => {
  if (isPlaying.value) {
    isPlaying.value = false
    if (threeActing) {
      threeActing.pause()
    }
  } else {
    if (state.motion_data) {
      isPlaying.value = true
      if (threeActing) {
        threeActing.play()
      }
    }
  }
}

const stopPlayback = () => {
  isPlaying.value = false
  if (threeActing) {
    threeActing.stop()
  }
}

const resetToInteractive = () => {
  isPlaying.value = false
  isRecording.value = false
  isCounting.value = false
  state.motion_data = ''
  if (threeActing) {
    threeActing.setCountingState(false)
    threeActing.resetRecording()
  }
  if (props.onStateChange) {
    props.onStateChange(state)
  }
}

const setState = (newState: Partial<ActingState>) => {
  if (newState.hasOwnProperty('actors')) {
    state.actors = newState.actors
  }
  if (newState.hasOwnProperty('scene_data')) {
    state.scene_data = newState.scene_data as any
  }
  if (newState.hasOwnProperty('actor_type')) {
    state.actor_type = newState.actor_type as any
  }
  if (newState.hasOwnProperty('actor_color')) {
    state.actor_color = newState.actor_color as string
  }
  if (newState.hasOwnProperty('actor_speed')) {
    state.actor_speed = newState.actor_speed as number
  }
  if (newState.hasOwnProperty('duration')) {
    state.duration = newState.duration as number
  }
  if (newState.hasOwnProperty('motion_data')) {
    state.motion_data = newState.motion_data as string
    if (!newState.motion_data) {
      isPlaying.value = false
    }
  }

  if (threeActing) {
    threeActing.setState(newState)
  } else {
    Object.assign(state, newState)
  }
}

const setConnectedThreeStage = (threeStage: any) => {
  currentThreeScene = threeStage
  if (threeActing) {
    threeActing.setConnectedThreeStage(threeStage)
  }
}
const setConnectedThreeScene = setConnectedThreeStage

const cleanup = () => {
  if (recordProgressFrameId !== null) {
    cancelAnimationFrame(recordProgressFrameId)
    recordProgressFrameId = null
  }
  if (threeActing) {
    threeActing.dispose()
    threeActing = null
  }
}

watch(() => state.stage_data || state.scene_data, (newVal) => {
  if (threeActing) {
    threeActing.setState({ stage_data: newVal ?? undefined, scene_data: newVal ?? undefined })
  }
})

watch(() => state.actor_color, (newColor) => {
  if (threeActing && newColor) {
    threeActing.setActorColor(newColor)
  }
})

const currentTime = ref(0)
const practiceElapsed = ref(0)
const totalDuration = ref(props.initialState?.duration ?? 7.0)
let timeFrameId: number | null = null

const updateTimeCounter = () => {
  if (threeActing) {
    if (isRecording.value) {
      recordingElapsed.value = (threeActing as any).recordingTime
      currentTime.value = (threeActing as any).recordingTime
    } else if (isPlaying.value || (threeActing as any).isPlaybackMode) {
      currentTime.value = threeActing.getCurrentTime()
    } else {
      practiceElapsed.value = typeof (threeActing as any).getPracticeTime === 'function' ? (threeActing as any).getPracticeTime() : 0
      currentTime.value = practiceElapsed.value
    }
    totalDuration.value = threeActing.getDuration()
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
  window.addEventListener('keydown', handleEscapeKey)
})

onUnmounted(() => {
  if (timeFrameId !== null) {
    cancelAnimationFrame(timeFrameId)
    timeFrameId = null
  }
  window.removeEventListener('keydown', handleEscapeKey)
  cleanup()
})

const getThreeActing = () => threeActing

defineExpose({ setState, cleanup, setConnectedThreeStage, setConnectedThreeScene, getThreeActing })
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

/* Countdown Badge styling */
.countdown-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(12, 12, 18, 0.85);
  border: 1.5px solid #ff007f;
  color: #ff007f;
  font-size: 11px;
  font-weight: bold;
  border-radius: 4px;
  padding: 6px 12px;
  z-index: 30;
  text-shadow: 0 0 10px rgba(255, 0, 127, 0.6);
  pointer-events: none;
  font-family: monospace;
  animation: pulse 1s infinite alternate;
  display: flex;
  align-items: center;
  gap: 6px;
}

.countdown-dot {
  width: 6px;
  height: 6px;
  background: #ff007f;
  border-radius: 50%;
  animation: blink 0.5s infinite steps(2, start);
}

/* Recording Overlay styling */
.recording-overlay {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 320px;
  background: rgba(12, 12, 18, 0.95);
  border: 1px solid rgba(255, 51, 102, 0.4);
  border-radius: 6px;
  padding: 8px 12px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  gap: 6px;
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

.rec-text {
  flex-grow: 1;
  letter-spacing: 1px;
}

.rec-timer {
  color: #a08090;
}

.progress-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #ff3366;
  width: 0%;
  transition: width 0.1s linear;
}

/* Spawn Point Toolbar (Left Side 3 Buttons) Styling */
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

/* Acting Toolbar styling */
.acting-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  z-index: 20;
}

.acting-btn {
  background: rgba(12, 12, 18, 0.85);
  color: #8c8c9e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.btn-icon {
  flex-shrink: 0;
}

.fill-icon {
  fill: currentColor;
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

.play-btn {
  color: #00ffff;
}

.play-btn:hover {
  background: rgba(0, 255, 255, 0.15);
  border-color: #00ffff;
}

.play-btn.playing {
  background: #008888;
  color: #ffffff;
  border-color: #00ffff;
}

.reset-btn {
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
  pointer-events: auto;
}

.info-help-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  background: rgba(0, 255, 255, 0.1);
  border: 1px solid rgba(0, 255, 255, 0.4);
  color: #00ffff;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 10px;
  font-family: system-ui, -apple-system, sans-serif;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.info-help-btn:hover {
  background: rgba(0, 255, 255, 0.25);
  border-color: #00ffff;
  box-shadow: 0 0 8px rgba(0, 255, 255, 0.3);
}

.info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
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
  display: inline-flex;
  align-items: center;
  gap: 5px;
  letter-spacing: 0.5px;
}

.state-indicator.playing {
  color: #00ffff;
}

.state-indicator.recording {
  color: #ff3366;
}

.rec-dot {
  width: 6px;
  height: 6px;
  background: #ff3366;
  border-radius: 50%;
  box-shadow: 0 0 6px #ff3366;
  animation: blink 0.8s infinite;
}

.state-indicator.counting {
  color: #ff007f;
}

.state-indicator.practice {
  color: #00ffaa;
}

.practice-dot {
  width: 6px;
  height: 6px;
  background: #00ffaa;
  border-radius: 50%;
  box-shadow: 0 0 6px #00ffaa;
  animation: pulse 1s infinite alternate;
}

.state-indicator.recorded {
  color: #00e5ff;
}

.status-icon {
  font-size: 9px;
}

.hint {
  margin-top: 2px;
  font-size: 10px;
  color: #00ffff;
  font-style: italic;
}

@keyframes blink {
  from { opacity: 1; }
  to { opacity: 0.2; }
}

@keyframes pulse {
  from { transform: scale(0.95); opacity: 0.8; }
  to { transform: scale(1.05); opacity: 1; }
}

.time-counter-overlay {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(20, 16, 25, 0.85);
  border: 1px solid rgba(255, 0, 127, 0.4);
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
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.time-counter-overlay.practice {
  border-color: rgba(0, 255, 170, 0.4);
  color: #e6fff7;
}

.time-counter-overlay.recording {
  border-color: rgba(255, 51, 102, 0.6);
  color: #ff99b3;
}

.time-counter-overlay.playing {
  border-color: rgba(0, 255, 255, 0.4);
  color: #e0ffff;
}

.loop-icon {
  font-size: 10px;
  opacity: 0.85;
}

/* Modal Styles (Scoped to Acting Widget container) */
.controls-modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(10, 8, 16, 0.75);
  backdrop-filter: blur(8px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.controls-modal-card {
  background: #181524;
  border: 1px solid rgba(0, 255, 255, 0.3);
  border-radius: 12px;
  width: 100%;
  max-width: 380px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7), 0 0 20px rgba(0, 255, 255, 0.15);
  overflow: hidden;
  font-family: system-ui, -apple-system, sans-serif;
  animation: modalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalPop {
  from { opacity: 0; transform: scale(0.92) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.modal-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-icon {
  font-size: 16px;
}

.modal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}

.actor-type-badge {
  font-size: 9px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.actor-type-badge.human {
  background: rgba(255, 0, 127, 0.2);
  color: #ff007f;
  border: 1px solid rgba(255, 0, 127, 0.4);
}

.actor-type-badge.car {
  background: rgba(0, 255, 255, 0.2);
  color: #00ffff;
  border: 1px solid rgba(0, 255, 255, 0.4);
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: #8a8a9e;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.modal-body {
  padding: 16px;
}

.controls-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.03);
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.key-group {
  display: flex;
  align-items: center;
  gap: 5px;
}

kbd {
  background: #282438;
  border: 1px solid #48425e;
  border-bottom-width: 2px;
  border-radius: 4px;
  color: #ffffff;
  display: inline-block;
  font-family: monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 6px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.3);
}

.or {
  font-size: 10px;
  color: #707085;
}

.action-desc {
  font-size: 12px;
  font-weight: 500;
  color: #d0d0e0;
}

.modal-footer {
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: flex-end;
}

.modal-ok-btn {
  background: #00ffff;
  color: #0b0a14;
  border: none;
  font-weight: 700;
  font-size: 11px;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-ok-btn:hover {
  background: #80ffff;
  transform: translateY(-1px);
}
</style>
