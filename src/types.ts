import type { App as VueApp } from 'vue'

export interface SceneState {
  type: string
  cube_size: number
  color: string
  grid_visible: boolean
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
