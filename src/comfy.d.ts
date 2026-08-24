interface ComfyWidget {
  name: string
  label?: string
  value: unknown
  type?: string
  callback?: (value: unknown) => void
  options?: any
}

interface ComfyInput {
  name: string
  label?: string
  type: string
  link: number | null
}

interface ComfyNode {
  id: number
  type?: string
  size: [number, number]
  widgets?: ComfyWidget[]
  inputs?: ComfyInput[]
  outputs?: Array<{ name: string; label?: string; links?: number[] }>
  properties?: Record<string, unknown>
  graph?: {
    links?: Record<number, { origin_id: number; origin_slot: number; target_id: number; target_slot: number }>
    getNodeById?(id: number): ComfyNode | undefined
  }
  constructor: Function & { comfyClass?: string }
  setSize(size: [number, number]): void
  addDOMWidget(
    name: string,
    type: string,
    element: HTMLElement,
    options?: {
      getMinHeight?: () => number
      hideOnZoom?: boolean
      serialize?: boolean
    }
  ): DOMWidgetInstance
  onConnectionsChange?: (
    slotType: number,
    slotIndex: number,
    isConnected: boolean,
    link: unknown,
    ioSlot: unknown
  ) => void
  onExecuted?: (output: unknown) => void
  onPropertyChanged?: (key: string, value: unknown) => void
  onConfigure?: (info: any) => void
  onRemoved?: () => void
}

interface DOMWidgetInstance {
  name: string
  label?: string
  type: string
  element: HTMLElement
  options: Record<string, unknown>
  onRemove?: () => void
  serializeValue?: () => Promise<string> | string
}

interface ComfyGraph {
  links?: Record<number, { origin_id: number; origin_slot: number; target_id: number; target_slot: number }>
  getNodeById?(id: number): ComfyNode | undefined
  setDirtyCanvas(fg: boolean, bg: boolean): void
}

interface ComfyUISettings {
  getSettingValue?(key: string): unknown
}

interface ComfyUI {
  settings?: ComfyUISettings
}

interface ComfyAppInstance {
  graph?: ComfyGraph
  ui?: ComfyUI
  canvas?: any
  registerExtension(extension: {
    name: string
    setup?(): void
    nodeCreated?(node: ComfyNode): void
  }): void
}

interface ComfyApiInstance {
  addEventListener(event: string, callback: (event: CustomEvent) => void): void
  apiURL(route: string): string
}

interface Window {
  comfyAPI: {
    app: { app: ComfyAppInstance }
    api: { api: ComfyApiInstance }
  }
}
