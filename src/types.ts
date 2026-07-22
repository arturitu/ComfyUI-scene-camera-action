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

export interface SceneState {
  type: string
  num_assets: number
  asset_transforms?: CubeTransform[]
}

export interface ActingState {
  character_speed: number
  scene_data: SceneState
}

export interface ThreeSceneOptions {
  container: HTMLElement
  initialState?: Partial<SceneState>
  onStateChange?: (state: SceneState) => void
}

export interface ThreeActingOptions {
  container: HTMLElement
  initialState?: Partial<ActingState>
  onStateChange?: (state: ActingState) => void
}

export interface SceneAppExposed {
  setState: (state: Partial<SceneState>) => void
  cleanup: () => void
}

export interface ActingAppExposed {
  setState: (state: Partial<ActingState>) => void
  cleanup: () => void
}

export interface CustomNodeInstance {
  container: HTMLElement
  vueApp: VueApp
  exposed: SceneAppExposed | ActingAppExposed
  currentNode: ComfyNode
  widget: DOMWidgetInstance | null
  cleanupTimer: number | null
}
