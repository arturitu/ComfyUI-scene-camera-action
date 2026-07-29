import type { App as VueApp } from 'vue'

export interface CubeTransform {
  px: number
  py: number
  pz: number
  rx: number
  ry: number
  rz: number
  sx: number
  sy: number
  sz: number
}

export interface MotionFrame {
  t: number
  px: number
  py: number
  pz: number
  rx: number
  ry: number
  rz: number
}

export interface SceneState {
  type: string
  num_assets: number
  asset_transforms?: CubeTransform[]
}

export interface ActingState {
  actor_type?: 'human' | 'car'
  actor_speed: number
  duration: number
  motion_data?: string
  scene_data: SceneState
}

export interface ThreeSceneOptions {
  container: HTMLElement
  initialState?: Partial<SceneState>
  onStateChange?: (state: SceneState) => void
  onTransformModeChange?: (mode: 'translate' | 'rotate' | 'scale' | null) => void
  onSelectionChange?: (hasSelection: boolean) => void
}

export interface ThreeActingOptions {
  container: HTMLElement
  initialState?: Partial<ActingState>
  onStateChange?: (state: ActingState) => void
  onRecordingFinished?: (trajectoryJson: string) => void
  connectedThreeScene?: any
}

export interface SceneAppExposed {
  setState: (state: Partial<SceneState>) => void
  cleanup: () => void
  getThreeScene: () => any
}

export interface ActingAppExposed {
  setState: (state: Partial<ActingState>) => void
  cleanup: () => void
  setConnectedThreeScene: (threeScene: any) => void
}

export interface DirectingState {
  camera_mode: string
  acting_data?: string
  directing_data?: string
}

export interface ThreeDirectingOptions {
  container: HTMLElement
  initialState?: Partial<DirectingState>
  onStateChange?: (state: DirectingState) => void
}

export interface DirectingAppExposed {
  setState: (state: Partial<DirectingState>) => void
  cleanup: () => void
}

export interface CustomNodeInstance {
  container: HTMLElement
  vueApp: VueApp
  exposed: SceneAppExposed | ActingAppExposed | DirectingAppExposed
  currentNode: ComfyNode
  widget: DOMWidgetInstance | null
  cleanupTimer: number | null
}
