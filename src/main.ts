import { createApp, type App as VueApp } from 'vue'
import SceneWidget from './components/SceneWidget.vue'
import ActingWidget from './components/ActingWidget.vue'
import type { SceneState, ActingState, SceneAppExposed, ActingAppExposed, DOMWidgetInstance } from './types'

const { app } = window.comfyAPI.app

// Inject CSS from built assets if any (main.css)
;(() => {
  const cssUrl = new URL(/* @vite-ignore */ './assets/main.css', import.meta.url).href
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = cssUrl
  document.head.appendChild(link)
})()

const CLEANUP_DELAY_MS = 200
const SCENE_PROP_KEY = 'sceneNodeState'
const ACTING_PROP_KEY = 'actingNodeState'

interface SceneNodeInstance {
  container: HTMLElement
  vueApp: VueApp
  exposed: SceneAppExposed
  currentNode: ComfyNode
  widget: DOMWidgetInstance | null
  cleanupTimer: number | null
}

interface ActingNodeInstance {
  container: HTMLElement
  vueApp: VueApp
  exposed: ActingAppExposed
  currentNode: ComfyNode
  widget: DOMWidgetInstance | null
  cleanupTimer: number | null
}

const sceneInstances = new WeakMap<ComfyNode, SceneNodeInstance>()
const actingInstances = new WeakMap<ComfyNode, ActingNodeInstance>()

// --- Helpers for SceneNode ---
function getWidgetValue<T>(node: ComfyNode, name: string, defaultValue: T): T {
  const widget = node.widgets?.find(w => w.name === name)
  return widget ? (widget.value as T) : defaultValue
}

function readStoredSceneProps(node: ComfyNode): Partial<SceneState> | null {
  const raw = node.properties?.[SCENE_PROP_KEY]
  if (!raw || typeof raw !== 'object') return null
  return raw as Partial<SceneState>
}

function writeStoredSceneProps(node: ComfyNode, patch: Partial<SceneState>): void {
  if (!node.properties) node.properties = {}
  const existing = (node.properties[SCENE_PROP_KEY] as Partial<SceneState>) ?? {}
  node.properties[SCENE_PROP_KEY] = { ...existing, ...patch }
}

function readSceneStateFromNode(node: ComfyNode): Partial<SceneState> {
  const stored = readStoredSceneProps(node)
  return {
    type: 'cube_scene',
    cube_size: stored?.cube_size ?? getWidgetValue(node, 'cube_size', 1.0),
    color: stored?.color ?? getWidgetValue(node, 'color', '#4a90e2'),
    grid_visible: stored?.grid_visible ?? getWidgetValue(node, 'grid_visible', true),
  }
}

function syncSceneWidgetsFromState(node: ComfyNode, state: Partial<SceneState>): void {
  const cube_size = node.widgets?.find(w => w.name === 'cube_size')
  const color = node.widgets?.find(w => w.name === 'color')
  const grid_visible = node.widgets?.find(w => w.name === 'grid_visible')

  if (state.cube_size !== undefined && cube_size) cube_size.value = state.cube_size
  if (state.color !== undefined && color) color.value = state.color
  if (state.grid_visible !== undefined && grid_visible) grid_visible.value = state.grid_visible
}

function createSceneInstance(node: ComfyNode): SceneNodeInstance {
  const container = document.createElement('div')
  container.id = `scene-widget-${node.id}`
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.minHeight = '350px'

  const instance = {} as SceneNodeInstance
  instance.container = container
  instance.currentNode = node
  instance.widget = null
  instance.cleanupTimer = null

  const vueApp = createApp(SceneWidget, {
    initialState: readSceneStateFromNode(node),
    onStateChange: (state: SceneState) => {
      const live = instance.currentNode
      syncSceneWidgetsFromState(live, state)
      writeStoredSceneProps(live, state)
      app.graph?.setDirtyCanvas(true, true)
      notifyConnectedActingNodes(live)
    }
  })

  const mounted = vueApp.mount(container)
  instance.vueApp = vueApp
  instance.exposed = mounted as unknown as SceneAppExposed

  sceneInstances.set(node, instance)
  return instance
}

function bindSceneWidgetCallbacks(node: ComfyNode, exposed: SceneAppExposed): void {
  const wire = (name: string, apply: (value: unknown) => void) => {
    const w = node.widgets?.find(widget => widget.name === name)
    if (!w) return
    const origCallback = w.callback
    w.callback = (value: unknown) => {
      origCallback?.call(w, value)
      apply(value)
    }
  }

  wire('cube_size', v => {
    exposed.setState({ cube_size: Number(v) })
    writeStoredSceneProps(node, { cube_size: Number(v) })
    notifyConnectedActingNodes(node)
  })
  wire('color', v => {
    exposed.setState({ color: String(v) })
    writeStoredSceneProps(node, { color: String(v) })
    notifyConnectedActingNodes(node)
  })
  wire('grid_visible', v => {
    exposed.setState({ grid_visible: Boolean(v) })
    writeStoredSceneProps(node, { grid_visible: Boolean(v) })
    notifyConnectedActingNodes(node)
  })
}

function createSceneNodeWidget(node: ComfyNode): DOMWidgetInstance {
  let instance = sceneInstances.get(node)

  if (instance) {
    if (instance.cleanupTimer !== null) {
      clearTimeout(instance.cleanupTimer)
      instance.cleanupTimer = null
    }
    instance.currentNode = node
    instance.exposed.setState(readSceneStateFromNode(node))
  } else {
    instance = createSceneInstance(node)
  }

  const widget = node.addDOMWidget(
    'scene_3d_preview',
    'scene-widget',
    instance.container,
    {
      getMinHeight: () => 370,
      hideOnZoom: false,
      serialize: false
    }
  )

  instance.widget = widget
  bindSceneWidgetCallbacks(node, instance.exposed)

  const baseOnRemove = widget.onRemove?.bind(widget)
  widget.onRemove = () => {
    baseOnRemove?.()

    const current = sceneInstances.get(node)
    if (!current || current.widget !== widget) return

    current.cleanupTimer = window.setTimeout(() => {
      const still = sceneInstances.get(node)
      if (!still || still.widget !== widget) return
      still.exposed.cleanup()
      still.vueApp.unmount()
      sceneInstances.delete(node)
    }, CLEANUP_DELAY_MS)
  }

  return widget
}

// --- Helpers for ActingNode ---
function readStoredActingProps(node: ComfyNode): Partial<ActingState> | null {
  const raw = node.properties?.[ACTING_PROP_KEY]
  if (!raw || typeof raw !== 'object') return null
  return raw as Partial<ActingState>
}

function writeStoredActingProps(node: ComfyNode, patch: Partial<ActingState>): void {
  if (!node.properties) node.properties = {}
  const existing = (node.properties[ACTING_PROP_KEY] as Partial<ActingState>) ?? {}
  node.properties[ACTING_PROP_KEY] = { ...existing, ...patch }
}

function findConnectedSceneNode(actingNode: ComfyNode): ComfyNode | null {
  if (!actingNode.inputs || actingNode.inputs.length === 0) return null
  const sceneInput = actingNode.inputs.find(i => i.name === 'scene')
  if (!sceneInput || sceneInput.link == null) return null

  const graph = app.graph
  if (!graph || !graph.links) return null

  const link = graph.links[sceneInput.link]
  if (!link) return null

  const originNode = graph.getNodeById?.(link.origin_id)
  if (originNode && (originNode.constructor?.comfyClass === 'SceneNode' || originNode.type === 'SceneNode')) {
    return originNode
  }
  return null
}

function updateActingNodeFromConnectedScene(actingNode: ComfyNode): void {
  const actingInst = actingInstances.get(actingNode)
  if (!actingInst) return

  const connectedSceneNode = findConnectedSceneNode(actingNode)
  if (connectedSceneNode) {
    const sceneState = readSceneStateFromNode(connectedSceneNode) as SceneState
    actingInst.exposed.setState({ scene_data: sceneState })
  }
}

function notifyConnectedActingNodes(sceneNode: ComfyNode): void {
  const graph = app.graph
  if (!graph) return

  // Iterate over graph nodes to find connected ActingNodes
  const sceneState = readSceneStateFromNode(sceneNode) as SceneState
  
  // Update acting instances that are linked to this sceneNode
  if (graph.links) {
    for (const linkId in graph.links) {
      const link = graph.links[linkId]
      if (link && link.origin_id === sceneNode.id) {
        const targetNode = graph.getNodeById?.(link.target_id)
        if (targetNode) {
          const actingInst = actingInstances.get(targetNode)
          if (actingInst) {
            actingInst.exposed.setState({ scene_data: sceneState })
          }
        }
      }
    }
  }
}

function createActingInstance(node: ComfyNode): ActingNodeInstance {
  const container = document.createElement('div')
  container.id = `acting-widget-${node.id}`
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.minHeight = '350px'

  const instance = {} as ActingNodeInstance
  instance.container = container
  instance.currentNode = node
  instance.widget = null
  instance.cleanupTimer = null

  const stored = readStoredActingProps(node)
  const connectedSceneNode = findConnectedSceneNode(node)
  const initialSceneState = connectedSceneNode ? (readSceneStateFromNode(connectedSceneNode) as SceneState) : undefined

  const vueApp = createApp(ActingWidget, {
    initialState: {
      character_speed: stored?.character_speed ?? getWidgetValue(node, 'character_speed', 1.0),
      scene_data: stored?.scene_data ?? initialSceneState,
    },
    onStateChange: (state: ActingState) => {
      const live = instance.currentNode
      writeStoredActingProps(live, state)
      app.graph?.setDirtyCanvas(true, true)
    }
  })

  const mounted = vueApp.mount(container)
  instance.vueApp = vueApp
  instance.exposed = mounted as unknown as ActingAppExposed

  actingInstances.set(node, instance)
  return instance
}

function bindActingWidgetCallbacks(node: ComfyNode, exposed: ActingAppExposed): void {
  const wire = (name: string, apply: (value: unknown) => void) => {
    const w = node.widgets?.find(widget => widget.name === name)
    if (!w) return
    const origCallback = w.callback
    w.callback = (value: unknown) => {
      origCallback?.call(w, value)
      apply(value)
    }
  }

  wire('character_speed', v => {
    exposed.setState({ character_speed: Number(v) })
    writeStoredActingProps(node, { character_speed: Number(v) })
  })
}

function createActingNodeWidget(node: ComfyNode): DOMWidgetInstance {
  let instance = actingInstances.get(node)

  if (instance) {
    if (instance.cleanupTimer !== null) {
      clearTimeout(instance.cleanupTimer)
      instance.cleanupTimer = null
    }
    instance.currentNode = node
  } else {
    instance = createActingInstance(node)
  }

  const widget = node.addDOMWidget(
    'acting_3d_preview',
    'acting-widget',
    instance.container,
    {
      getMinHeight: () => 370,
      hideOnZoom: false,
      serialize: false
    }
  )

  instance.widget = widget
  bindActingWidgetCallbacks(node, instance.exposed)

  // Sync connection change
  const origOnConnectionsChange = node.onConnectionsChange
  node.onConnectionsChange = function(slotType, slotIndex, isConnected, link, ioSlot) {
    origOnConnectionsChange?.call(this, slotType, slotIndex, isConnected, link, ioSlot)
    updateActingNodeFromConnectedScene(node)
  }

  const baseOnRemove = widget.onRemove?.bind(widget)
  widget.onRemove = () => {
    baseOnRemove?.()

    const current = actingInstances.get(node)
    if (!current || current.widget !== widget) return

    current.cleanupTimer = window.setTimeout(() => {
      const still = actingInstances.get(node)
      if (!still || still.widget !== widget) return
      still.exposed.cleanup()
      still.vueApp.unmount()
      actingInstances.delete(node)
    }, CLEANUP_DELAY_MS)
  }

  // Initial connection sync check
  setTimeout(() => updateActingNodeFromConnectedScene(node), 100)

  return widget
}

// --- Extension Registration ---
app.registerExtension({
  name: 'ComfyUI.SceneCameraAction',

  setup() {
    if (app.canvas && (app.canvas as any).processMouseWheel) {
      const origWheel = (app.canvas as any).processMouseWheel;
      (app.canvas as any).processMouseWheel = function(this: any, e: WheelEvent) {
        if (document.querySelector('.canvas-container:hover')) {
          return;
        }
        return origWheel.apply(this, arguments as any);
      };
    }
  },

  nodeCreated(node: ComfyNode) {
    const comfyClass = node.constructor?.comfyClass

    if (comfyClass === 'SceneNode') {
      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 360), Math.max(oldHeight, 520)])
      createSceneNodeWidget(node)
    } else if (comfyClass === 'ActingNode') {
      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 360), Math.max(oldHeight, 520)])
      createActingNodeWidget(node)
    }
  }
})
