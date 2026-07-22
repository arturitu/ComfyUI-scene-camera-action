import { createApp, type App as VueApp } from 'vue'
import SceneWidget from './components/SceneWidget.vue'
import ActingWidget from './components/ActingWidget.vue'
import type { SceneState, ActingState, SceneAppExposed, ActingAppExposed } from './types'

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
  const updated = { ...existing, ...patch }
  node.properties[SCENE_PROP_KEY] = updated

  const sceneDataWidget = node.widgets?.find(w => w.name === 'scene_data')
  if (sceneDataWidget) {
    sceneDataWidget.value = JSON.stringify(updated)
  }
}

function readSceneStateFromNode(node: ComfyNode): Partial<SceneState> {
  const sceneDataWidget = node.widgets?.find(w => w.name === 'scene_data')
  if (sceneDataWidget && sceneDataWidget.value && typeof sceneDataWidget.value === 'string' && sceneDataWidget.value.trim()) {
    try {
      return JSON.parse(sceneDataWidget.value)
    } catch (e) {}
  }

  const stored = readStoredSceneProps(node)
  return {
    type: 'cube_scene',
    num_assets: stored?.num_assets ?? getWidgetValue(node, 'num_assets', 1),
    asset_transforms: stored?.asset_transforms ?? [],
  }
}

function syncSceneWidgetsFromState(node: ComfyNode, state: Partial<SceneState>): void {
  const num_assets = node.widgets?.find(w => w.name === 'num_assets')
  if (state.num_assets !== undefined && num_assets) num_assets.value = state.num_assets
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

  wire('num_assets', v => {
    exposed.setState({ num_assets: Number(v) })
    writeStoredSceneProps(node, { num_assets: Number(v) })
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
  } else {
    actingInst.exposed.setState({ scene_data: undefined })
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

function readActingStateFromNode(node: ComfyNode): Partial<ActingState> {
  const speedVal = getWidgetValue(node, 'character_speed', 10.0)
  return {
    character_speed: typeof speedVal === 'number' ? Math.max(1.0, Math.min(20.0, speedVal)) : 10.0,
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

  const stored = readActingStateFromNode(node)
  const connectedSceneNode = findConnectedSceneNode(node)
  const initialSceneState = connectedSceneNode ? (readSceneStateFromNode(connectedSceneNode) as SceneState) : undefined

  const vueApp = createApp(ActingWidget, {
    currentNode: node,
    initialState: {
      character_speed: stored.character_speed ?? 1.0,
      scene_data: initialSceneState,
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
    
    if (slotType === 1) { // 1 = INPUT
      const input = this.inputs?.[slotIndex]
      if (input && input.name === 'scene' && !isConnected) {
        const actingInst = actingInstances.get(this)
        if (actingInst) {
          actingInst.exposed.setState({ scene_data: undefined })
        }
        return
      }
    }
    updateActingNodeFromConnectedScene(this)
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
      const sceneDataWidget = node.widgets?.find(w => w.name === 'scene_data')
      if (sceneDataWidget) {
        sceneDataWidget.type = 'hidden'
      }

      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 400), Math.max(oldHeight, 380)])
      createSceneNodeWidget(node)

      const origOnConfigure = node.onConfigure
      node.onConfigure = function(info) {
        origOnConfigure?.call(this, info)
        const instance = sceneInstances.get(this)
        if (instance) {
          const state = readSceneStateFromNode(this)
          instance.exposed.setState(state)
        }
      }
    } else if (comfyClass === 'ActingNode') {
      const motionDataWidget = node.widgets?.find(w => w.name === 'motion_data')
      if (motionDataWidget) {
        motionDataWidget.type = 'hidden'
      }

      // Force speed widget options to match 1 to 20 range even on old cached node instances
      const speedWidget = node.widgets?.find(w => w.name === 'character_speed')
      if (speedWidget) {
        speedWidget.options = { ...speedWidget.options, min: 1.0, max: 20.0, step: 0.1 }
        if (speedWidget.value === 1.0) {
          speedWidget.value = 10.0
        }
      }

      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 400), Math.max(oldHeight, 380)])
      createActingNodeWidget(node)

      const origOnConfigure = node.onConfigure
      node.onConfigure = function(info) {
        origOnConfigure?.call(this, info)
        
        // Reinforce speed limits on configure load
        const speedWidgetConf = this.widgets?.find(w => w.name === 'character_speed')
        if (speedWidgetConf) {
          speedWidgetConf.options = { ...speedWidgetConf.options, min: 1.0, max: 20.0, step: 0.1 }
          if (speedWidgetConf.value === 1.0) {
            speedWidgetConf.value = 10.0
          }
        }

        const instance = actingInstances.get(this)
        if (instance) {
          const state = readActingStateFromNode(this)
          instance.exposed.setState(state)
        }
      }
    }
  }
})
