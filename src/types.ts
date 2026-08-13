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
  anim?: string
}

export interface StageBlockNode {
  id: string
  type: 'block'
  name?: string
  transform: CubeTransform
}

export interface StageGroupNode {
  id: string
  type: 'group'
  name?: string
  transform: CubeTransform
  children: StageNode[]
}

export type StageNode = StageBlockNode | StageGroupNode
export type SceneBlockNode = StageBlockNode
export type SceneGroupNode = StageGroupNode
export type SceneNode = StageNode

export interface SpawnPoint {
  px: number
  py: number
  pz: number
  ry: number
}

export interface ActorRecord {
  id: string
  actor_type: 'human' | 'car'
  actor_color?: string
  actor_speed: number
  spawn_point?: SpawnPoint
  trajectory: MotionFrame[]
}

export interface StageState {
  type: string
  num_assets: number
  nodes?: StageNode[]
  selectedPreset?: string
}
export type SceneState = StageState

export interface ActingState {
  actor_type?: 'human' | 'car'
  actor_color?: string
  actor_speed: number
  duration: number
  spawn_point?: SpawnPoint
  motion_data?: string
  stage_data: StageState
  scene_data?: StageState
  actors?: ActorRecord[]
}

export interface ThreeStageOptions {
  container: HTMLElement
  initialState?: Partial<StageState>
  onStateChange?: (state: StageState) => void
  onTransformModeChange?: (mode: 'translate' | 'rotate' | 'scale' | null) => void
  onSelectionChange?: (hasSelection: boolean) => void
  onSelectionInfoChange?: (info: { selectedCount: number; hasGroupSelected: boolean; canGroup: boolean; canUngroup: boolean; cycleInfo?: { index: number; total: number } }) => void
}

export type ThreeSceneOptions = ThreeStageOptions
export type ThreeStagingOptions = ThreeStageOptions

export interface ThreeActingOptions {
  container: HTMLElement
  initialState?: Partial<ActingState>
  onStateChange?: (state: ActingState) => void
  onRecordingFinished?: (trajectoryJson: string) => void
  connectedThreeStage?: any
  connectedThreeScene?: any
}

export interface StageAppExposed {
  setState: (state: Partial<StageState>) => void
  cleanup: () => void
  getThreeScene: () => any
  getThreeStaging?: () => any
}

export type SceneAppExposed = StageAppExposed
export type StagingAppExposed = StageAppExposed

export interface ActingAppExposed {
  setState: (state: Partial<ActingState>) => void
  cleanup: () => void
  setConnectedThreeStage: (threeStage: any) => void
  setConnectedThreeScene?: (threeScene: any) => void
  getThreeActing?: () => any
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
  setConnectedThreeActing?: (threeActing: any) => void
}

export interface CustomNodeInstance {
  container: HTMLElement
  vueApp: VueApp
  exposed: StageAppExposed | ActingAppExposed | DirectingAppExposed
  currentNode: ComfyNode
  widget: DOMWidgetInstance | null
  cleanupTimer: number | null
}
