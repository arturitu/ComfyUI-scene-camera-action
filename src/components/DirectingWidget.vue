<template>
  <div class="three-container">
    <div v-if="!hasActingData" class="disabled-overlay">
      <div class="disabled-title">Directing Canvas Disabled</div>
      <div class="disabled-subtitle">{{ disabledSubtitle }}</div>
    </div>
    <div v-else class="canvas-wrapper" @mousedown="onCanvasMouseDown">
      <div class="canvas-aspect-container">
        <SceneCanvas :init-scene="initScene" />
      </div>

      <!-- Top Right Floating Capture Button -->
      <div class="directing-top-bar" @mousedown.stop>
        <button
          class="capture-btn"
          :class="{ 'recording': isRecordingVideo }"
          :disabled="isRecordingVideo"
          title="Capture video from start of acting"
          @click="handleRecordVideo"
        >
          <span class="rec-dot" v-if="isRecordingVideo"></span>
          {{ isRecordingVideo ? (videoStatusText || 'Capturing...') : '● Capture' }}
        </button>
      </div>

      <!-- Floating Bottom Timeline Bar -->
      <div
        class="timeline-bar"
        :class="{ 'disabled-timeline': isRecordingVideo }"
        @mousedown.stop
      >
        <!-- Rewind to Start -->
        <button
          class="tl-btn"
          :disabled="isRecordingVideo"
          title="Rewind to start"
          @click="rewind"
        >
          ⏮
        </button>

        <!-- Play / Pause Toggle -->
        <button
          class="tl-btn play-btn"
          :disabled="isRecordingVideo"
          :title="isPlaying ? 'Pause' : 'Play'"
          @click="togglePlay"
        >
          {{ isPlaying ? '⏸' : '▶' }}
        </button>

        <!-- Add Keyframe Button with Tooltip -->
        <div class="add-kf-wrapper">
          <button
            class="tl-btn add-kf-btn"
            :disabled="isRecordingVideo"
            title="Add cut at current position"
            @click="addKeyframe"
          >
            <span class="diamond-icon">◇</span>
            <span class="plus-icon">+</span>
          </button>
          <div class="add-kf-tooltip">Add cut</div>
        </div>

        <!-- Timeline Track & Scrubber -->
        <div
          ref="trackRef"
          class="timeline-track"
          @mousedown.stop="onTrackMouseDown"
        >
          <!-- Base Track Line -->
          <div class="track-line"></div>

          <!-- Progress Fill Line -->
          <div
            class="track-fill"
            :style="{ width: progressPercent + '%' }"
          ></div>

          <!-- Playhead Cursor Line & Handle -->
          <div
            class="playhead"
            :style="{ left: progressPercent + '%' }"
          >
            <div class="playhead-line"></div>
          </div>

          <!-- Keyframe Markers (Diamonds) -->
          <div
            v-for="kf in keyframes"
            :key="kf.id"
            class="keyframe-marker"
            :class="{ active: selectedKeyframe?.id === kf.id }"
            :style="{ left: (kf.t / duration * 100) + '%' }"
            :title="`${kf.t.toFixed(1)}s: ${kf.mode}`"
            @mousedown.stop="onKeyframeMouseDown(kf, $event)"
          >
            <div class="diamond-marker"></div>

            <!-- Selected Keyframe Popover Context Menu directly attached to marker -->
            <div
              v-if="selectedKeyframe?.id === kf.id && !isPlaying && !isRecordingVideo"
              class="keyframe-popover"
              :class="{
                'align-left': (kf.t / duration) < 0.2,
                'align-right': (kf.t / duration) > 0.8
              }"
              @mousedown.stop
            >
              <div class="popover-header">
                <span class="popover-title">Cut at {{ kf.t.toFixed(1) }}s</span>
                <button
                  v-if="kf.t > 0"
                  class="popover-delete"
                  title="Delete cut"
                  @click.stop="deleteKeyframe(kf)"
                >
                  ✕
                </button>
              </div>
              <div class="popover-modes">
                <button
                  v-for="mode in cameraModes"
                  :key="mode.id"
                  class="mode-pill"
                  :class="{ active: kf.mode === mode.id }"
                  @click.stop="changeKeyframeMode(kf, mode.id)"
                >
                  {{ mode.label }}
                </button>
              </div>
              <div class="popover-arrow"></div>
            </div>
          </div>
        </div>

        <!-- Formatted Time Display -->
        <div class="time-display">
          {{ formattedTime }}
        </div>
      </div>
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

interface Keyframe {
  id: string
  t: number
  mode: string
}

const cameraModes: CameraMode[] = [
  { id: 'Third Person', label: 'TPV' },
  { id: 'First Person', label: 'FPV' },
  { id: 'Wide', label: 'Wide' },
  { id: 'Side', label: 'Side' },
]

const state = reactive<DirectingState>({
  camera_mode: props.initialState?.camera_mode ?? 'Third Person',
  acting_data: props.initialState?.acting_data ?? '',
  directing_data: props.initialState?.directing_data ?? '',
})

const keyframes = ref<Keyframe[]>(parseKeyframes(state.directing_data))
const selectedKeyframe = ref<Keyframe | null>(null)
const isPlaying = ref(true)
const currentTime = ref(0)
const duration = ref(7.0)
const trackRef = ref<HTMLElement | null>(null)

const isRecordingVideo = ref(false)
const videoStatusText = ref('')

let threeDirecting: ThreeDirecting | null = null
let timeFrameId: number | null = null
let isDraggingPlayhead = false
let draggingKeyframe: Keyframe | null = null

function parseKeyframes(raw: string): Keyframe[] {
  if (!raw || !raw.trim()) {
    return [{ id: 'kf-init', t: 0, mode: 'Third Person' }]
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item: any, idx: number) => ({
        id: item.id || `kf-${idx}-${Date.now()}`,
        t: Math.max(0, typeof item.t === 'number' ? item.t : 0),
        mode: item.mode || 'Third Person',
      })).sort((a, b) => a.t - b.t)
    }
  } catch {}
  return [{ id: 'kf-init', t: 0, mode: 'Third Person' }]
}

const isActingNodeConnected = computed(() => {
  if (threeDirecting && (threeDirecting as any).connectedThreeActing) return true
  if (!state.acting_data || !state.acting_data.trim()) return false
  try {
    const parsed = JSON.parse(state.acting_data)
    if (parsed && typeof parsed === 'object') return true
  } catch {}
  return false
})

const hasActingData = computed(() => {
  if (!state.acting_data || !state.acting_data.trim()) return false
  try {
    const parsed = JSON.parse(state.acting_data)
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.trajectory) && parsed.trajectory.length > 0) return true
      if (Array.isArray(parsed.motion_data) && parsed.motion_data.length > 0) return true
      if (typeof parsed.motion_data === 'string' && parsed.motion_data.trim().length > 0) {
        try {
          const inner = JSON.parse(parsed.motion_data)
          if (Array.isArray(inner) && inner.length > 0) return true
        } catch {}
      }
    }
    if (Array.isArray(parsed) && parsed.length > 0) return true
  } catch {}
  return false
})

const disabledSubtitle = computed(() => {
  if (isActingNodeConnected.value) {
    return 'Waiting for recorded motion from Acting 3D Node.'
  }
  return 'Connect an Acting 3D Node to direct.'
})

const progressPercent = computed(() => {
  if (duration.value <= 0) return 0
  return Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100))
})

const formattedTime = computed(() => {
  const pad = (n: number) => n.toFixed(1).padStart(4, '0')
  return `${pad(currentTime.value)}s / ${pad(duration.value)}s`
})

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
  threeDirecting.setKeyframes(keyframes.value)
}

const updateTimeLoop = () => {
  if (threeDirecting && !isDraggingPlayhead) {
    currentTime.value = threeDirecting.getCurrentTime()
    duration.value = threeDirecting.getDuration()
  }
  timeFrameId = requestAnimationFrame(updateTimeLoop)
}

const togglePlay = () => {
  if (isRecordingVideo.value) return
  isPlaying.value = !isPlaying.value
  if (isPlaying.value) {
    selectedKeyframe.value = null
  }
  if (threeDirecting) {
    if (isPlaying.value) {
      threeDirecting.play()
    } else {
      threeDirecting.pause()
    }
  }
}

const rewind = () => {
  if (isRecordingVideo.value) return
  if (threeDirecting) {
    threeDirecting.seekToTime(0)
  }
  currentTime.value = 0
}

const addKeyframe = () => {
  if (isRecordingVideo.value) return
  const curT = Math.round(currentTime.value * 10) / 10
  const activeMode = threeDirecting ? threeDirecting.getActiveKeyframeMode(curT) : 'Third Person'

  // If a keyframe already exists very close, select it & seek
  const existing = keyframes.value.find(k => Math.abs(k.t - curT) < 0.1)
  if (existing) {
    selectKeyframe(existing)
    return
  }

  const newKf: Keyframe = {
    id: `kf-${Date.now()}`,
    t: curT,
    mode: activeMode,
  }

  keyframes.value.push(newKf)
  keyframes.value.sort((a, b) => a.t - b.t)
  selectKeyframe(newKf)
  syncKeyframes()
}

const selectKeyframe = (kf: Keyframe) => {
  if (isRecordingVideo.value) return
  selectedKeyframe.value = kf
  isPlaying.value = false
  if (threeDirecting) {
    threeDirecting.isPlaying = false
    threeDirecting.seekToTime(kf.t)
  }
  currentTime.value = kf.t
}

const changeKeyframeMode = (kf: Keyframe, mode: string) => {
  kf.mode = mode
  syncKeyframes()
}

const deleteKeyframe = (kf: Keyframe) => {
  if (kf.t === 0 && keyframes.value.length === 1) return // Keep initial
  keyframes.value = keyframes.value.filter(k => k.id !== kf.id)
  if (selectedKeyframe.value?.id === kf.id) {
    selectedKeyframe.value = null
  }
  syncKeyframes()
}

const syncKeyframes = () => {
  if (threeDirecting) {
    threeDirecting.setKeyframes(keyframes.value)
  }
  const json = JSON.stringify(keyframes.value)
  state.directing_data = json
  if (props.onDirectingDataChange) {
    props.onDirectingDataChange(json)
  }
}

const handleRecordVideo = async () => {
  if (!threeDirecting || isRecordingVideo.value) return

  // Validate that BOTH Captured Video AND Captured First Frame output slots are connected
  const videoOutput = props.currentNode?.outputs?.find((o: any) =>
    o.name === 'captured_video' || o.name === 'Captured Video'
  )
  const stageOutput = props.currentNode?.outputs?.find((o: any) =>
    o.name === 'captured_stage' || o.name === 'Captured Stage' || o.name === 'Captured First Frame' || o.name === 'captured_first_frame'
  )

  const isVideoConnected = videoOutput?.links && videoOutput.links.length > 0
  const isStageConnected = stageOutput?.links && stageOutput.links.length > 0

  if (!isVideoConnected || !isStageConnected) {
    if (props.currentNode) {
      props.currentNode.has_errors = true
      if (videoOutput && !isVideoConnected) videoOutput.has_errors = true
      if (stageOutput && !isStageConnected) stageOutput.has_errors = true

      const comfyApp = (window as any).comfyAPI?.app?.app
      if (comfyApp && comfyApp.canvas) {
        comfyApp.canvas.draw(true, true)
      }

      const missingNames: string[] = []
      if (!isVideoConnected) missingNames.push("'Captured Video'")
      if (!isStageConnected) missingNames.push("'Captured First Frame'")

      const validationErrorMsg = {
        "prompt_id": "validation_error",
        "node_id": String(props.currentNode.id),
        "node_type": props.currentNode.type,
        "executed": [],
        "exception_message": `Required output connection(s) missing: ${missingNames.join(' and ')}. Connect outputs to proceed.`,
        "exception_type": "ValueError",
        "traceback": [],
        "current_inputs": [],
        "current_outputs": []
      }

      if (comfyApp && comfyApp.api && typeof comfyApp.api.dispatchEvent === "function") {
        comfyApp.api.dispatchEvent(new CustomEvent("execution_error", { detail: validationErrorMsg }))
      }

      window.setTimeout(() => {
        if (props.currentNode) {
          delete props.currentNode.has_errors
          if (videoOutput) delete videoOutput.has_errors
          if (stageOutput) delete stageOutput.has_errors
          if (comfyApp && comfyApp.canvas) {
            comfyApp.canvas.draw(true, true)
          }
        }
      }, 4000)
    }
    return
  }

  // Hide any open cut popover
  selectedKeyframe.value = null
  isRecordingVideo.value = true
  videoStatusText.value = 'Capturing...'

  const dur = threeDirecting.getDuration()

  // Seek to start (t = 0) and enable single-pass recording mode
  threeDirecting.seekToTime(0)
  threeDirecting.setIsRecordingMode(true)
  currentTime.value = 0

  // Capture exact first frame image directly from canvas at t=0
  const stageBlob = await threeDirecting.captureCurrentCanvasSnapshot()

  threeDirecting.isPlaying = true
  isPlaying.value = true

  // Start recording canvas video stream at 30 fps
  threeDirecting.startRecording(30)

  const recordStartTime = performance.now()

  const captureCheckInterval = window.setInterval(async () => {
    if (threeDirecting) {
      const elapsed = (performance.now() - recordStartTime) / 1000
      const displayT = Math.min(dur, elapsed)
      videoStatusText.value = `Capturing ${displayT.toFixed(1)}s / ${dur.toFixed(1)}s...`

      // Stop cleanly as soon as wall-clock duration is reached OR playback stops
      if (elapsed >= dur || !threeDirecting.isPlaying) {
        clearInterval(captureCheckInterval)
        threeDirecting.isPlaying = false
        isPlaying.value = false
        videoStatusText.value = 'Saving Video...'

        try {
          const videoBlob = await threeDirecting.stopRecording()
          threeDirecting.setIsRecordingMode(false)

          const nodeId = props.currentNode?.id ?? 'default'

          // 1. Upload Video
          const videoFormData = new FormData()
          videoFormData.append('video', videoBlob, `3d_directing_record_${nodeId}.webm`)
          videoFormData.append('filename', `3d_directing_record_${nodeId}.webm`)

          await fetch('/scene_camera_action/upload_video', {
            method: 'POST',
            body: videoFormData
          })

          // 2. Upload Captured Stage Overview Image
          const imageFormData = new FormData()
          imageFormData.append('image', stageBlob, `3d_directing_stage_${nodeId}.png`)
          imageFormData.append('filename', `3d_directing_stage_${nodeId}.png`)

          await fetch('/scene_camera_action/upload_image', {
            method: 'POST',
            body: imageFormData
          })

          videoStatusText.value = 'Saved!'

          const comfyApp = (window as any).comfyAPI?.app?.app
          if (comfyApp && typeof comfyApp.queuePrompt === 'function') {
            comfyApp.queuePrompt(0)
          }
        } catch (err) {
          console.error('Failed to capture and upload video/image:', err)
          threeDirecting.setIsRecordingMode(false)
        } finally {
          window.setTimeout(() => {
            videoStatusText.value = ''
            isRecordingVideo.value = false
          }, 1000)
        }
      }
    }
  }, 50)
}

const onCanvasMouseDown = () => {
  if (!isRecordingVideo.value) {
    selectedKeyframe.value = null
  }
}

// Mouse Scrubbing & Dragging Handlers
const onTrackMouseDown = (e: MouseEvent) => {
  if (isRecordingVideo.value) return
  isDraggingPlayhead = true
  selectedKeyframe.value = null
  updateScrubPosition(e)

  const onMouseMove = (me: MouseEvent) => {
    if (isDraggingPlayhead) {
      updateScrubPosition(me)
    }
  }

  const onMouseUp = () => {
    isDraggingPlayhead = false
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const updateScrubPosition = (e: MouseEvent) => {
  if (!trackRef.value || isRecordingVideo.value) return
  const rect = trackRef.value.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const targetTime = pct * duration.value
  currentTime.value = targetTime
  if (threeDirecting) {
    threeDirecting.seekToTime(targetTime)
  }
}

const onKeyframeMouseDown = (kf: Keyframe, e: MouseEvent) => {
  if (isRecordingVideo.value) return
  selectKeyframe(kf)

  if (kf.t === 0) return

  draggingKeyframe = kf

  const onMouseMove = (me: MouseEvent) => {
    if (!draggingKeyframe || !trackRef.value) return
    const rect = trackRef.value.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
    let newT = Math.round(pct * duration.value * 10) / 10
    if (newT < 0.1) newT = 0.1
    draggingKeyframe.t = newT
    currentTime.value = newT
    if (threeDirecting) {
      threeDirecting.seekToTime(newT)
    }
    keyframes.value.sort((a, b) => a.t - b.t)
  }

  const onMouseUp = () => {
    if (draggingKeyframe) {
      draggingKeyframe = null
      syncKeyframes()
    }
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

onMounted(() => {
  timeFrameId = requestAnimationFrame(updateTimeLoop)
})

onUnmounted(() => {
  if (timeFrameId !== null) {
    cancelAnimationFrame(timeFrameId)
    timeFrameId = null
  }
  if (threeDirecting) {
    threeDirecting.dispose()
    threeDirecting = null
  }
})

const setState = (newState: Partial<DirectingState>) => {
  if (newState.hasOwnProperty('acting_data')) {
    state.acting_data = newState.acting_data as string
  }
  if (newState.hasOwnProperty('directing_data')) {
    state.directing_data = newState.directing_data as string
    keyframes.value = parseKeyframes(state.directing_data)
    if (threeDirecting) {
      threeDirecting.setKeyframes(keyframes.value)
    }
  }
  if (threeDirecting) {
    threeDirecting.setState(newState)
  }
}

const cleanup = () => {
  if (threeDirecting) {
    threeDirecting.dispose()
    threeDirecting = null
  }
}

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

/* Top Right Capture Toolbar */
.directing-top-bar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 25;
}

.capture-btn {
  background: rgba(12, 12, 18, 0.85);
  color: #ff3366;
  border: 1px solid rgba(255, 51, 102, 0.3);
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  gap: 6px;
}

.capture-btn:hover:not(:disabled) {
  background: rgba(255, 51, 102, 0.2);
  border-color: #ff3366;
  color: #ffffff;
}

.capture-btn.recording {
  background: #ff3366;
  color: #ffffff;
  border-color: #ff3366;
}

.rec-dot {
  width: 7px;
  height: 7px;
  background: #ffffff;
  border-radius: 50%;
  animation: blink 0.8s infinite steps(2, start);
}

@keyframes blink {
  from { opacity: 1; }
  to { opacity: 0.2; }
}

/* Floating Timeline Bar (Bottom Center) */
.timeline-bar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: 92%;
  max-width: 650px;
  height: 38px;
  background: rgba(18, 20, 28, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 0 12px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 30;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  user-select: none;
  transition: opacity 0.2s ease;
}

.timeline-bar.disabled-timeline {
  opacity: 0.4;
  pointer-events: none;
}

/* Control Buttons */
.tl-btn {
  background: transparent;
  border: none;
  color: #c0c5d0;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.tl-btn:hover:not(:disabled) {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.1);
}

.play-btn {
  font-size: 13px;
}

/* Add Keyframe Button & Tooltip */
.add-kf-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.add-kf-btn {
  position: relative;
  font-size: 13px;
  color: #ffffff;
}

.diamond-icon {
  font-size: 15px;
  font-weight: bold;
}

.plus-icon {
  position: absolute;
  top: 1px;
  right: 1px;
  font-size: 9px;
  font-weight: bold;
  color: #00ffcc;
}

.add-kf-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
  font-family: monospace;
}

.add-kf-wrapper:hover .add-kf-tooltip {
  opacity: 1;
}

/* Timeline Track Area */
.timeline-track {
  flex: 1;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
  margin: 0 4px;
}

.track-line {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.track-fill {
  position: absolute;
  left: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 2px;
  pointer-events: none;
}

/* Playhead Scrubber Cursor */
.playhead {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
  z-index: 10;
}

.playhead-line {
  width: 2px;
  height: 22px;
  background: #ffffff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.8);
  border-radius: 1px;
}

/* Keyframe Marker Diamonds */
.keyframe-marker {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 16px;
  height: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: grab;
  z-index: 20;
}

.diamond-marker {
  width: 9px;
  height: 9px;
  background: #4a90e2;
  border: 1px solid #ffffff;
  transform: rotate(45deg);
  transition: all 0.2s ease;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
}

.keyframe-marker:hover .diamond-marker {
  scale: 1.25;
  background: #00ffcc;
  border-color: #ffffff;
}

.keyframe-marker.active .diamond-marker {
  background: #00ffcc;
  border-color: #ffffff;
  scale: 1.3;
  box-shadow: 0 0 8px #00ffcc;
}

/* Selected Keyframe Popover attached directly to marker */
.keyframe-popover {
  position: absolute;
  bottom: 26px;
  left: 50%;
  transform: translateX(-50%);
  width: 160px;
  background: rgba(18, 20, 28, 0.95);
  border: 1px solid rgba(0, 255, 204, 0.5);
  border-radius: 6px;
  padding: 8px;
  z-index: 50;
  backdrop-filter: blur(10px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: default;
}

.keyframe-popover.align-left {
  left: 0;
  transform: translateX(-10px);
}
.keyframe-popover.align-left .popover-arrow {
  left: 16px;
  transform: translateX(0) rotate(45deg);
}

.keyframe-popover.align-right {
  left: auto;
  right: 0;
  transform: translateX(10px);
}
.keyframe-popover.align-right .popover-arrow {
  left: auto;
  right: 16px;
  transform: translateX(0) rotate(45deg);
}

.popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  font-weight: bold;
  color: #00ffcc;
  font-family: monospace;
}

.popover-delete {
  background: transparent;
  border: none;
  color: #ff3366;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 4px;
}

.popover-delete:hover {
  color: #ff0044;
}

.popover-modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.mode-pill {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #c0c5d0;
  font-size: 9px;
  font-weight: bold;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-pill:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.mode-pill.active {
  background: #3d4974;
  color: #ffffff;
  border-color: #00ffcc;
}

.popover-arrow {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 10px;
  height: 10px;
  background: rgba(18, 20, 28, 0.95);
  border-right: 1px solid rgba(0, 255, 204, 0.5);
  border-bottom: 1px solid rgba(0, 255, 204, 0.5);
}

/* Time Display */
.time-display {
  font-family: monospace;
  font-size: 11px;
  font-weight: bold;
  color: #a0a8b8;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
</style>
