<template>
  <div class="three-container">
    <div v-if="!hasActingData" class="disabled-overlay">
      <div class="disabled-title">Directing Canvas Disabled</div>
      <div class="disabled-subtitle">{{ disabledSubtitle }}</div>
    </div>
    <div v-else class="canvas-wrapper" @mousedown="onCanvasMouseDown">
      <div class="canvas-aspect-container">
        <StagingCanvas :init-scene="initScene" />
      </div>

      <!-- Recording Overlay when Auto-Capturing -->
      <div v-if="isRecordingVideo" class="recording-overlay" @mousedown.stop.prevent>
        <div class="recording-spinner"></div>
        <div class="recording-text">{{ videoStatusText || 'Capturing 3D Video...' }}</div>
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
          <SkipBack :size="14" />
        </button>

        <!-- Play / Pause Toggle -->
        <button
          class="tl-btn play-btn"
          :disabled="isRecordingVideo"
          :title="isPlaying ? 'Pause' : 'Play'"
          @click="togglePlay"
        >
          <component :is="isPlaying ? Pause : Play" :size="14" />
        </button>

        <!-- Add Keyframe Button with Tooltip -->
        <div class="add-kf-wrapper">
          <button
            class="tl-btn add-kf-btn"
            :disabled="isRecordingVideo"
            title="Add cut at current position"
            @click="addKeyframe"
          >
            <Diamond :size="14" class="diamond-icon" />
            <Plus :size="9" class="plus-icon" />
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
                  <Trash2 :size="12" />
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
                  {{ mode?.label || mode?.id || '' }}
                </button>
              </div>

              <!-- Target Actor Selector for Multi-Actor scenes -->
              <div v-if="getAvailableActorsForMode(kf.mode).length > 0" class="popover-target-row">
                <span class="target-label">Track:</span>
                <select
                  :value="getEffectiveTarget(kf)"
                  class="target-select"
                  @change.stop="changeKeyframeTarget(kf, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="act in getAvailableActorsForMode(kf.mode)" :key="act?.id || act" :value="act?.id || act">
                    {{ act?.label || act?.id || act || '' }}
                  </option>
                </select>
              </div>

              <!-- Distance Slider Row (for Wide, Third Person, Side) -->
              <div v-if="kf.mode !== 'First Person'" class="popover-dist-row">
                <div class="dist-label-row">
                  <span class="dist-label">Dist:</span>
                  <span class="dist-value">{{ getKeyframeDistance(kf) }}m</span>
                  <button
                    class="dist-reset-btn"
                    title="Reset to default Distance"
                    @click.stop="resetKeyframeDistance(kf)"
                  >
                    <RotateCcw :size="10" />
                  </button>
                </div>
                <div class="dist-slider-container">
                  <span class="dist-bound-label">{{ getDistanceConfig(kf.mode, kf).min }}m</span>
                  <input
                    type="range"
                    :min="getDistanceConfig(kf.mode, kf).min"
                    :max="getDistanceConfig(kf.mode, kf).max"
                    :step="getDistanceConfig(kf.mode, kf).step"
                    :value="getKeyframeDistance(kf)"
                    class="dist-slider"
                    @input.stop="changeKeyframeDistance(kf, Number(($event.target as HTMLInputElement).value))"
                    @mousedown.stop
                  />
                  <span class="dist-bound-label">{{ getDistanceConfig(kf.mode, kf).max }}m</span>
                </div>
              </div>

              <!-- FOV Slider Row -->
              <div class="popover-fov-row">
                <div class="fov-label-row">
                  <span class="fov-label">FOV:</span>
                  <span class="fov-value">{{ getKeyframeFov(kf) }}°</span>
                  <button
                    class="fov-reset-btn"
                    title="Reset to default FOV"
                    @click.stop="resetKeyframeFov(kf)"
                  >
                    <RotateCcw :size="10" />
                  </button>
                </div>
                <div class="fov-slider-container">
                  <span class="fov-bound-label">{{ getFovConfig(kf.mode).min }}°</span>
                  <input
                    type="range"
                    :min="getFovConfig(kf.mode).min"
                    :max="getFovConfig(kf.mode).max"
                    step="1"
                    :value="getKeyframeFov(kf)"
                    class="fov-slider"
                    @input.stop="changeKeyframeFov(kf, Number(($event.target as HTMLInputElement).value))"
                    @mousedown.stop
                  />
                  <span class="fov-bound-label">{{ getFovConfig(kf.mode).max }}°</span>
                </div>
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
import {
  SkipBack,
  Play,
  Pause,
  Diamond,
  Plus,
  Trash2,
  RotateCcw
} from 'lucide-vue-next'
import StagingCanvas from './StagingCanvas.vue'
import { ThreeDirecting } from '../ThreeDirecting'
import {
  getCameraFovConfig,
  getDefaultCameraFov,
  getCameraDistanceConfig,
  getDefaultCameraDistance
} from '../threeConfig'
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
  actor_target?: string
  fov?: number
  distance?: number
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
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(7.0)
const trackRef = ref<HTMLElement | null>(null)

const isRecordingVideo = ref(false)
const videoStatusText = ref('')

let threeDirecting: ThreeDirecting | null = null
let timeFrameId: number | null = null
let isDraggingPlayhead = false
let draggingKeyframe: Keyframe | null = null

const availableActorsList = ref<Array<{ id: string; label: string }>>([
  { id: 'actor_1', label: 'Actor 1 (human)' }
])

const availableActors = computed(() => {
  if (threeDirecting && typeof (threeDirecting as any).getAvailableActors === 'function') {
    const list = (threeDirecting as any).getAvailableActors()
    if (Array.isArray(list) && list.length > 0) return list
  }
  return availableActorsList.value
})

function parseKeyframes(raw: string): Keyframe[] {
  if (!raw || !raw.trim()) {
    return [{
      id: 'kf-init',
      t: 0,
      mode: 'Third Person',
      actor_target: 'actor_1',
      fov: getDefaultCameraFov('Third Person'),
      distance: getDefaultCameraDistance('Third Person')
    }]
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item: any, idx: number) => ({
        id: item.id || `kf-${idx}-${Date.now()}`,
        t: Math.max(0, typeof item.t === 'number' ? item.t : 0),
        mode: item.mode || 'Third Person',
        actor_target: item.actor_target || item.actorTarget || 'actor_1',
        fov: typeof item.fov === 'number' ? item.fov : undefined,
        distance: typeof item.distance === 'number' ? item.distance : undefined,
      })).sort((a, b) => a.t - b.t)
    }
  } catch {}
  return [{
    id: 'kf-init',
    t: 0,
    mode: 'Third Person',
    actor_target: 'actor_1',
    fov: getDefaultCameraFov('Third Person'),
    distance: getDefaultCameraDistance('Third Person')
  }]
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
      if (Array.isArray(parsed.actors) && parsed.actors.length > 0) return true
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
    }
  })
  threeDirecting.setKeyframes(keyframes.value)
  availableActorsList.value = threeDirecting.getAvailableActors()
}

const updateTimeLoop = () => {
  if (threeDirecting && !isDraggingPlayhead) {
    currentTime.value = threeDirecting.getCurrentTime()
    duration.value = threeDirecting.getDuration()
    const actors = threeDirecting.getAvailableActors()
    if (actors && actors.length > 0 && JSON.stringify(actors) !== JSON.stringify(availableActorsList.value)) {
      availableActorsList.value = actors
    }
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
  const existing = keyframes.value.find(k => Math.abs(k.t - curT) < 0.1)
  if (existing) {
    selectKeyframe(existing)
    return
  }

  const prevKf = [...keyframes.value].reverse().find(k => k.t <= curT)
  const activeMode = prevKf ? prevKf.mode : (threeDirecting ? threeDirecting.getActiveKeyframeMode(curT) : 'Third Person')
  const activeTarget = prevKf?.actor_target || 'actor_1'

  const newKf: Keyframe = {
    id: `kf-${Date.now()}`,
    t: curT,
    mode: activeMode,
    actor_target: activeTarget,
    fov: prevKf?.fov ?? getDefaultCameraFov(activeMode),
    distance: prevKf?.distance ?? getDefaultCameraDistance(activeMode),
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

const getFovConfig = (mode: string) => {
  return getCameraFovConfig(mode)
}

const getKeyframeFov = (kf: Keyframe): number => {
  if (typeof kf.fov === 'number') return kf.fov
  return getDefaultCameraFov(kf.mode)
}

const changeKeyframeFov = (kf: Keyframe, fov: number) => {
  const cfg = getCameraFovConfig(kf.mode)
  const clamped = Math.max(cfg.min, Math.min(cfg.max, Math.round(fov)))
  kf.fov = clamped
  syncKeyframes()
  if (threeDirecting) {
    threeDirecting.seekToTime(kf.t)
  }
}

const resetKeyframeFov = (kf: Keyframe) => {
  kf.fov = getDefaultCameraFov(kf.mode)
  syncKeyframes()
  if (threeDirecting) {
    threeDirecting.seekToTime(kf.t)
  }
}

const getTargetActorInfo = (kf: Keyframe): { isCar: boolean; scale: number } => {
  const target = kf.actor_target || 'actor_1'
  const found: any = availableActors.value.find(a => a?.id === target)
  const isCar = found?.actor_type === 'car'
  const scale = typeof found?.scale === 'number' ? found.scale : (found?.actor_type === 'quadruped' ? 0.5 : 1.0)
  return { isCar, scale }
}

const getDistanceConfig = (mode: string, kf?: Keyframe) => {
  const { isCar, scale } = kf ? getTargetActorInfo(kf) : { isCar: false, scale: 1.0 }
  return getCameraDistanceConfig(mode, isCar, scale)
}

const getKeyframeDistance = (kf: Keyframe): number => {
  const { isCar, scale } = getTargetActorInfo(kf)
  if (typeof kf.distance === 'number') {
    const cfg = getCameraDistanceConfig(kf.mode, isCar, scale)
    return Math.max(cfg.min, Math.min(cfg.max, kf.distance))
  }
  return getDefaultCameraDistance(kf.mode, isCar, scale)
}

const changeKeyframeDistance = (kf: Keyframe, dist: number) => {
  const { isCar, scale } = getTargetActorInfo(kf)
  const cfg = getCameraDistanceConfig(kf.mode, isCar, scale)
  const clamped = Math.max(cfg.min, Math.min(cfg.max, Math.round(dist * 10) / 10))
  kf.distance = clamped
  syncKeyframes()
  if (threeDirecting) {
    threeDirecting.seekToTime(kf.t)
  }
}

const resetKeyframeDistance = (kf: Keyframe) => {
  const { isCar, scale } = getTargetActorInfo(kf)
  kf.distance = getDefaultCameraDistance(kf.mode, isCar, scale)
  syncKeyframes()
  if (threeDirecting) {
    threeDirecting.seekToTime(kf.t)
  }
}

const getAvailableActorsForMode = (_mode: string) => {
  const all = availableActors.value.filter(a => a.id !== 'stage')
  if (all.length === 0) {
    return [{ id: 'actor_1', label: 'Actor 1 (human)' }]
  }
  return all
}

const getEffectiveTarget = (kf: Keyframe) => {
  const options = getAvailableActorsForMode(kf.mode)
  if (kf.actor_target && options.some(o => o.id === kf.actor_target)) {
    return kf.actor_target
  }
  return options[0]?.id || 'actor_1'
}

const changeKeyframeMode = (kf: Keyframe, mode: string) => {
  const oldMode = kf.mode
  const oldDefaultFov = getDefaultCameraFov(oldMode)
  const isUsingDefaultFov = kf.fov === undefined || kf.fov === oldDefaultFov

  const oldDefaultDist = getDefaultCameraDistance(oldMode)
  const isUsingDefaultDist = kf.distance === undefined || kf.distance === oldDefaultDist

  kf.mode = mode

  if (isUsingDefaultFov) {
    kf.fov = getDefaultCameraFov(mode)
  } else if (typeof kf.fov === 'number') {
    const newCfg = getCameraFovConfig(mode)
    kf.fov = Math.max(newCfg.min, Math.min(newCfg.max, kf.fov))
  }

  if (isUsingDefaultDist) {
    kf.distance = getDefaultCameraDistance(mode)
  } else if (typeof kf.distance === 'number') {
    const newDistCfg = getCameraDistanceConfig(mode)
    kf.distance = Math.max(newDistCfg.min, Math.min(newDistCfg.max, kf.distance))
  }

  // Ensure target is valid actor
  const validActors = getAvailableActorsForMode(mode)
  if (!validActors.some(a => a.id === kf.actor_target)) {
    kf.actor_target = validActors[0]?.id || 'actor_1'
  }

  syncKeyframes()
  if (threeDirecting) {
    threeDirecting.seekToTime(kf.t)
  }
}

const changeKeyframeTarget = (kf: Keyframe, targetId: string) => {
  kf.actor_target = targetId
  syncKeyframes()
  if (threeDirecting) {
    threeDirecting.seekToTime(kf.t)
  }
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
  if (isRecordingVideo.value) return
  const nodeId = String(props.currentNode?.id ?? '')

  if (!hasActingData.value || !threeDirecting) {
    try {
      await fetch('/scene_camera_action/capture_done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_id: nodeId,
          error: 'Directing canvas is disabled. Connect an Acting node and record motion first.'
        }),
      })
    } catch (e) {}
    return
  }


  // Hide any open cut popover
  selectedKeyframe.value = null
  isRecordingVideo.value = true
  videoStatusText.value = 'Capturing 3D Video...'

  const dur = threeDirecting.getDuration()

  // Seek to start (t = 0) and enable single-pass recording mode
  threeDirecting.seekToTime(0)
  threeDirecting.setIsRecordingMode(true)
  currentTime.value = 0

  // Capture exact first frame snapshot directly from canvas at t=0
  let stageBlob: Blob | null = null
  try {
    stageBlob = await threeDirecting.captureCurrentCanvasSnapshot()
  } catch (e) {}

  threeDirecting.isPlaying = true
  isPlaying.value = true

  // Start recording canvas video stream at 30 fps
  threeDirecting.startRecording(30)

  const recordStartTime = performance.now()

  const captureCheckInterval = window.setInterval(async () => {
    if (threeDirecting) {
      const elapsed = (performance.now() - recordStartTime) / 1000
      const displayT = Math.min(dur, elapsed)
      videoStatusText.value = `Capturing 3D Video... ${displayT.toFixed(1)}s / ${dur.toFixed(1)}s`

      // Stop cleanly as soon as wall-clock duration is reached OR playback stops
      if (elapsed >= dur || !threeDirecting.isPlaying) {
        clearInterval(captureCheckInterval)
        threeDirecting.isPlaying = false
        isPlaying.value = false
        videoStatusText.value = 'Saving Video...'

        try {
          const videoBlob = await threeDirecting.stopRecording()
          threeDirecting.setIsRecordingMode(false)

          // 1. Upload Video
          const videoFormData = new FormData()
          videoFormData.append('video', videoBlob, `3d_directing_record_${nodeId}.webm`)
          videoFormData.append('filename', `3d_directing_record_${nodeId}.webm`)

          await fetch('/scene_camera_action/upload_video', {
            method: 'POST',
            body: videoFormData
          })

          // 2. Upload Captured Stage Overview Image
          if (stageBlob) {
            const imageFormData = new FormData()
            imageFormData.append('image', stageBlob, `3d_directing_stage_${nodeId}.png`)
            imageFormData.append('filename', `3d_directing_stage_${nodeId}.png`)

            await fetch('/scene_camera_action/upload_image', {
              method: 'POST',
              body: imageFormData
            })
          }

          videoStatusText.value = 'Saved!'
        } catch (err) {
          console.error('Failed to capture and upload video:', err)
          threeDirecting.setIsRecordingMode(false)
        } finally {
          // Notify python backend execution that capture and upload are complete
          try {
            await fetch('/scene_camera_action/capture_done', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ node_id: nodeId }),
            })
          } catch (e) {}

          window.setTimeout(() => {
            videoStatusText.value = ''
            isRecordingVideo.value = false
          }, 300)
        }
      }
    }
  }, 50)
}

const handleWsCaptureEvent = async (event: Event) => {
  const detail = (event as CustomEvent).detail
  const targetNodeId = String(detail?.node_id ?? '')
  const myNodeId = String(props.currentNode?.id ?? '')

  if (targetNodeId && myNodeId && targetNodeId === myNodeId) {
    await handleRecordVideo()
  }
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
  const comfyApi = (window as any).comfyAPI?.api?.api || (window as any).comfyAPI?.app?.app?.api
  if (comfyApi && typeof comfyApi.addEventListener === 'function') {
    comfyApi.addEventListener('scene_camera_action_directing_capture', handleWsCaptureEvent)
    comfyApi.addEventListener('ub_3d_studio_directing_capture', handleWsCaptureEvent)
  }
})

onUnmounted(() => {
  const comfyApi = (window as any).comfyAPI?.api?.api || (window as any).comfyAPI?.app?.app?.api
  if (comfyApi && typeof comfyApi.removeEventListener === 'function') {
    comfyApi.removeEventListener('scene_camera_action_directing_capture', handleWsCaptureEvent)
    comfyApi.removeEventListener('ub_3d_studio_directing_capture', handleWsCaptureEvent)
  }
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
    availableActorsList.value = threeDirecting.getAvailableActors()
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
    availableActorsList.value = threeDirecting.getAvailableActors()
  }
}

const renderOnce = () => {
  threeDirecting?.renderOnce()
}

defineExpose({ setState, renderOnce, cleanup, setConnectedThreeActing })
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

/* Recording Overlay */
.recording-overlay {
  position: absolute;
  top: -4px;
  left: -4px;
  right: -4px;
  bottom: -4px;
  background: rgba(10, 13, 20, 0.85);
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  pointer-events: all;
  user-select: none;
  backdrop-filter: blur(4px);
}

.recording-text {
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.recording-spinner {
  width: 26px;
  height: 26px;
  border: 3px solid rgba(255, 51, 102, 0.2);
  border-top-color: #ff3366;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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
  width: 184px;
  box-sizing: border-box;
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

.popover-target-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.target-label {
  font-size: 9px;
  font-weight: bold;
  color: #a0a8b8;
  font-family: monospace;
}

.target-select {
  flex: 1;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(0, 255, 204, 0.3);
  color: #ffffff;
  font-size: 9px;
  border-radius: 4px;
  padding: 2px 4px;
  outline: none;
  cursor: pointer;
}

.target-select:focus {
  border-color: #00ffcc;
}

/* Distance Slider Row in Popover */
.popover-dist-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
  width: 100%;
}

.dist-label-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: monospace;
}

.dist-label {
  font-size: 9px;
  font-weight: bold;
  color: #a0a8b8;
}

.dist-value {
  font-size: 10px;
  font-weight: bold;
  color: #38bdf8;
  min-width: 32px;
}

.dist-reset-btn {
  margin-left: auto;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #c0c5d0;
  font-size: 10px;
  border-radius: 3px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: all 0.2s ease;
}

.dist-reset-btn:hover {
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
  border-color: #38bdf8;
}

.dist-slider-container {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
}

.dist-bound-label {
  font-size: 9px;
  font-family: monospace;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 22px;
  text-align: center;
}

.dist-slider {
  flex: 1 1 auto;
  min-width: 0;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  margin: 0;
  padding: 0;
}

.dist-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #38bdf8;
  cursor: pointer;
  box-shadow: 0 0 4px rgba(56, 189, 248, 0.6);
  transition: transform 0.1s ease;
}

.dist-slider::-webkit-slider-thumb:hover {
  transform: scale(1.3);
}

.dist-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #38bdf8;
  cursor: pointer;
  border: none;
  box-shadow: 0 0 4px rgba(56, 189, 248, 0.6);
}

/* FOV Slider Row in Popover */
.popover-fov-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
  width: 100%;
}

.fov-label-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: monospace;
}

.fov-label {
  font-size: 9px;
  font-weight: bold;
  color: #a0a8b8;
}

.fov-value {
  font-size: 10px;
  font-weight: bold;
  color: #00ffcc;
  min-width: 28px;
}

.fov-reset-btn {
  margin-left: auto;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #c0c5d0;
  font-size: 10px;
  border-radius: 3px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: all 0.2s ease;
}

.fov-reset-btn:hover {
  background: rgba(0, 255, 204, 0.2);
  color: #00ffcc;
  border-color: #00ffcc;
}

.fov-slider-container {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
}

.fov-bound-label {
  font-size: 9px;
  font-family: monospace;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 18px;
  text-align: center;
}

.fov-slider {
  flex: 1 1 auto;
  min-width: 0;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  margin: 0;
  padding: 0;
}

.fov-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #00ffcc;
  cursor: pointer;
  box-shadow: 0 0 4px rgba(0, 255, 204, 0.6);
  transition: transform 0.1s ease;
}

.fov-slider::-webkit-slider-thumb:hover {
  transform: scale(1.3);
}

.fov-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #00ffcc;
  cursor: pointer;
  border: none;
  box-shadow: 0 0 4px rgba(0, 255, 204, 0.6);
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

.directing-top-toolbar {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 20;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.activity-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  user-select: none;
  transition: all 0.2s ease;
  background: rgba(16, 20, 30, 0.6);
  backdrop-filter: blur(4px);
}

.activity-pill.live {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.35);
}

.activity-pill.live .activity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
}

.activity-pill.standby {
  background: rgba(107, 114, 128, 0.15);
  color: #9ca3af;
  border: 1px solid rgba(107, 114, 128, 0.25);
}

.activity-pill.standby .activity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6b7280;
}
</style>
