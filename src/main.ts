import { createApp, type App as VueApp } from 'vue'
import SceneWidget from './components/SceneWidget.vue'
import ActingWidget from './components/ActingWidget.vue'
import DirectingWidget from './components/DirectingWidget.vue'
import type { SceneState, ActingState, DirectingState, SceneAppExposed, ActingAppExposed, DirectingAppExposed } from './types'

const { app } = window.comfyAPI.app

  // Inject CSS from built assets if any (main.css)
  ; (() => {
    const cssUrl = new URL(/* @vite-ignore */ './assets/main.css', import.meta.url).href
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = cssUrl
    document.head.appendChild(link)
  })()

const CLEANUP_DELAY_MS = 200
const SCENE_PROP_KEY = 'sceneNodeState'
const ACTING_PROP_KEY = 'actingNodeState'
const DIRECTING_PROP_KEY = 'directingNodeState'

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

interface DirectingNodeInstance {
  container: HTMLElement
  vueApp: VueApp
  exposed: DirectingAppExposed
  currentNode: ComfyNode
  widget: DOMWidgetInstance | null
  cleanupTimer: number | null
}

const sceneInstances = new WeakMap<ComfyNode, SceneNodeInstance>()
const actingInstances = new WeakMap<ComfyNode, ActingNodeInstance>()
const directingInstances = new WeakMap<ComfyNode, DirectingNodeInstance>()

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
    } catch (e) { }
  }

  const stored = readStoredSceneProps(node)
  return {
    type: 'cube_scene',
    num_assets: stored?.num_assets ?? 1,
    asset_transforms: stored?.asset_transforms ?? [],
  }
}

function syncSceneWidgetsFromState(node: ComfyNode, state: Partial<SceneState>): void {
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
      notifyConnectedDirectingNodes(live)
    }
  })

  const mounted = vueApp.mount(container)
  instance.vueApp = vueApp
  instance.exposed = mounted as unknown as SceneAppExposed

  sceneInstances.set(node, instance)
  return instance
}

function bindSceneWidgetCallbacks(node: ComfyNode, exposed: SceneAppExposed): void {
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

function findConnectedActingNode(directingNode: ComfyNode): ComfyNode | null {
  if (!directingNode.inputs || directingNode.inputs.length === 0) return null
  const actingInput = directingNode.inputs.find(i => i.name === 'acting')
  if (!actingInput || actingInput.link == null) return null

  const graph = app.graph
  if (!graph || !graph.links) return null

  const link = graph.links[actingInput.link]
  if (!link) return null

  const originNode = graph.getNodeById?.(link.origin_id)
  if (originNode && (originNode.constructor?.comfyClass === 'ActingNode' || originNode.type === 'ActingNode')) {
    return originNode
  }
  return null
}

function updateActingNodeFromConnectedScene(actingNode: ComfyNode): void {
  const actingInst = actingInstances.get(actingNode)
  if (!actingInst) return

  const connectedSceneNode = findConnectedSceneNode(actingNode)
  const currentActingState = readActingStateFromNode(actingNode)
  const charType = currentActingState.actor_type ?? 'human'

  if (connectedSceneNode) {
    const sceneState = readSceneStateFromNode(connectedSceneNode) as SceneState
    actingInst.exposed.setState({ scene_data: sceneState, actor_type: charType })
    writeStoredActingProps(actingNode, { scene_data: sceneState, actor_type: charType })

    const sceneInst = sceneInstances.get(connectedSceneNode)
    const threeScene = sceneInst && sceneInst.exposed.getThreeScene ? sceneInst.exposed.getThreeScene() : null
    if (threeScene && actingInst.exposed.setConnectedThreeScene) {
      actingInst.exposed.setConnectedThreeScene(threeScene)
    }
    notifyConnectedDirectingNodes(actingNode)
  } else {
    actingInst.exposed.setState({ scene_data: undefined, actor_type: charType })
    writeStoredActingProps(actingNode, { scene_data: undefined, actor_type: charType })
    if (actingInst.exposed.setConnectedThreeScene) {
      actingInst.exposed.setConnectedThreeScene(null)
    }
    notifyConnectedDirectingNodes(actingNode)
  }
}

function notifyConnectedDirectingNodes(originNode: ComfyNode): void {
  const graph = app.graph
  if (!graph || !graph.links) return

  for (const linkId in graph.links) {
    const link = graph.links[linkId]
    if (link && link.origin_id === originNode.id) {
      const targetNode = graph.getNodeById?.(link.target_id)
      if (targetNode && (targetNode.constructor?.comfyClass === 'DirectingNode' || targetNode.type === 'DirectingNode')) {
        const directingInst = directingInstances.get(targetNode)
        if (directingInst) {
          if (originNode.constructor?.comfyClass === 'ActingNode' || originNode.type === 'ActingNode') {
            const actingState = readActingStateFromNode(originNode)
            const actingBlob = JSON.stringify({
              motion_data: actingState.motion_data ?? '',
              scene_data: actingState.scene_data ?? {},
              actor_type: actingState.actor_type ?? 'human',
            })
            directingInst.exposed.setState({ acting_data: actingBlob })
            writeStoredDirectingProps(targetNode, { acting_data: actingBlob })

            // Pass live ThreeActing scene for cloning (with lights)
            const actingInst = actingInstances.get(originNode)
            if (actingInst?.exposed?.getThreeActing) {
              const threeActing = (actingInst.exposed as any).getThreeActing()
              if (threeActing && (directingInst.exposed as any).setConnectedThreeActing) {
                (directingInst.exposed as any).setConnectedThreeActing(threeActing)
              }
            }
          }
        }
      }
    }
  }
}


function notifyConnectedActingNodes(sceneNode: ComfyNode): void {
  const graph = app.graph
  if (!graph) return

  // Iterate over graph nodes to find connected ActingNodes
  const sceneState = readSceneStateFromNode(sceneNode) as SceneState
  const sceneInst = sceneInstances.get(sceneNode)
  const threeScene = sceneInst && sceneInst.exposed.getThreeScene ? sceneInst.exposed.getThreeScene() : null

  // Update acting instances that are linked to this sceneNode
  if (graph.links) {
    for (const linkId in graph.links) {
      const link = graph.links[linkId]
      if (link && link.origin_id === sceneNode.id) {
        const targetNode = graph.getNodeById?.(link.target_id)
        if (targetNode) {
          const actingInst = actingInstances.get(targetNode)
          if (actingInst) {
            const charType = readActingStateFromNode(targetNode).actor_type ?? 'human'
            actingInst.exposed.setState({ scene_data: sceneState, actor_type: charType })
            writeStoredActingProps(targetNode, { scene_data: sceneState, actor_type: charType })
            if (threeScene && actingInst.exposed.setConnectedThreeScene) {
              actingInst.exposed.setConnectedThreeScene(threeScene)
            }
            notifyConnectedDirectingNodes(targetNode)
          }
        }
      }
    }
  }
}

function readActingStateFromNode(node: ComfyNode): Partial<ActingState> {
  const typeVal = getWidgetValue(node, 'actor_type', 'human')
  const speedVal = getWidgetValue(node, 'actor_speed', 10.0)
  const durationVal = getWidgetValue(node, 'duration', 7.0)
  const motionDataVal = getWidgetValue(node, 'motion_data', '')
  const storedProps = readStoredActingProps(node)
  return {
    actor_type: typeVal === 'car' ? 'car' : 'human',
    actor_speed: typeof speedVal === 'number' ? Math.max(1.0, Math.min(20.0, speedVal)) : 10.0,
    duration: typeof durationVal === 'number' ? Math.max(4.0, Math.min(15.0, durationVal)) : 7.0,
    motion_data: typeof motionDataVal === 'string' ? motionDataVal : '',
    scene_data: storedProps?.scene_data ?? (undefined as any),
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
  const sceneInst = connectedSceneNode ? sceneInstances.get(connectedSceneNode) : null
  const connectedThreeScene = sceneInst && sceneInst.exposed.getThreeScene ? sceneInst.exposed.getThreeScene() : null

  const vueApp = createApp(ActingWidget, {
    currentNode: node,
    initialState: {
      actor_type: stored.actor_type ?? 'human',
      actor_speed: stored.actor_speed ?? 10.0,
      duration: stored.duration ?? 7.0,
      motion_data: stored.motion_data ?? '',
      scene_data: initialSceneState,
    },
    onStateChange: (state: ActingState) => {
      const live = instance.currentNode
      writeStoredActingProps(live, state)
      
      // Update the widget values in ComfyUI node if they differ from state
      const durationWidget = live.widgets?.find(w => w.name === 'duration')
      if (durationWidget && durationWidget.value !== state.duration) {
        durationWidget.value = state.duration
      }
      const speedWidget = live.widgets?.find(w => w.name === 'actor_speed')
      if (speedWidget && speedWidget.value !== state.actor_speed) {
        speedWidget.value = state.actor_speed
      }
      const motionWidget = live.widgets?.find(w => w.name === 'motion_data')
      if (motionWidget && motionWidget.value !== state.motion_data) {
        motionWidget.value = state.motion_data ?? ''
      }

      app.graph?.setDirtyCanvas(true, true)
      notifyConnectedDirectingNodes(live)
    }
  })

  const mounted = vueApp.mount(container) as unknown as ActingAppExposed
  instance.vueApp = vueApp
  instance.exposed = mounted

  if (connectedThreeScene && instance.exposed.setConnectedThreeScene) {
    instance.exposed.setConnectedThreeScene(connectedThreeScene)
  }

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

  wire('actor_type', v => {
    const charType = String(v) === 'car' ? 'car' : 'human'
    exposed.setState({ actor_type: charType })
    writeStoredActingProps(node, { actor_type: charType })
  })

  wire('actor_speed', v => {
    exposed.setState({ actor_speed: Number(v) })
    writeStoredActingProps(node, { actor_speed: Number(v) })
  })

  wire('duration', v => {
    exposed.setState({ duration: Number(v) })
    writeStoredActingProps(node, { duration: Number(v) })
  })

  wire('motion_data', v => {
    exposed.setState({ motion_data: String(v) })
    writeStoredActingProps(node, { motion_data: String(v) })
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
  node.onConnectionsChange = function (slotType, slotIndex, isConnected, link, ioSlot) {
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

// --- Helpers for DirectingNode ---
function readStoredDirectingProps(node: ComfyNode): Partial<DirectingState> | null {
  const raw = node.properties?.[DIRECTING_PROP_KEY]
  if (!raw || typeof raw !== 'object') return null
  return raw as Partial<DirectingState>
}

function writeStoredDirectingProps(node: ComfyNode, patch: Partial<DirectingState>): void {
  if (!node.properties) node.properties = {}
  const existing = (node.properties[DIRECTING_PROP_KEY] as Partial<DirectingState>) ?? {}
  node.properties[DIRECTING_PROP_KEY] = { ...existing, ...patch }
}

function readDirectingStateFromNode(node: ComfyNode): Partial<DirectingState> {
  const directingDataVal = getWidgetValue(node, 'directing_data', '')
  const stored = readStoredDirectingProps(node) ?? {}
  return {
    camera_mode: stored.camera_mode ?? 'Third Person',
    directing_data: typeof directingDataVal === 'string' ? directingDataVal : '',
    acting_data: stored.acting_data ?? '',
  }
}

function updateDirectingNodeFromLinks(directingNode: ComfyNode): void {
  const directingInst = directingInstances.get(directingNode)
  if (!directingInst) return

  const connectedActingNode = findConnectedActingNode(directingNode)
  if (connectedActingNode) {
    const actingState = readActingStateFromNode(connectedActingNode)
    // Build an acting data blob with scene + motion
    const actingBlob = JSON.stringify({
      motion_data: actingState.motion_data ?? '',
      scene_data: actingState.scene_data ?? {},
    })
    directingInst.exposed.setState({ acting_data: actingBlob })
    writeStoredDirectingProps(directingNode, { acting_data: actingBlob })

    // Pass live ThreeActing scene for cloning (with lights)
    const actingInst = actingInstances.get(connectedActingNode)
    if (actingInst?.exposed?.getThreeActing) {
      const threeActing = (actingInst.exposed as any).getThreeActing()
      if (threeActing && (directingInst.exposed as any).setConnectedThreeActing) {
        (directingInst.exposed as any).setConnectedThreeActing(threeActing)
      }
    }
  } else {
    directingInst.exposed.setState({ acting_data: '' })
    writeStoredDirectingProps(directingNode, { acting_data: '' })
  }
}

function createDirectingInstance(node: ComfyNode): DirectingNodeInstance {
  const container = document.createElement('div')
  container.id = `directing-widget-${node.id}`
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.minHeight = '350px'

  const instance = {} as DirectingNodeInstance
  instance.container = container
  instance.currentNode = node
  instance.widget = null
  instance.cleanupTimer = null

  const stored = readDirectingStateFromNode(node)

  const vueApp = createApp(DirectingWidget, {
    currentNode: node,
    initialState: {
      camera_mode: stored.camera_mode ?? 'Third Person',
      acting_data: stored.acting_data ?? '',
      directing_data: stored.directing_data ?? '',
    },
    onStateChange: (state: DirectingState) => {
      const live = instance.currentNode
      writeStoredDirectingProps(live, state)
      app.graph?.setDirtyCanvas(true, true)
    },
    onDirectingDataChange: (directingDataJson: string) => {
      const live = instance.currentNode
      // Write directing_data back to the node widget
      const ddWidget = live.widgets?.find((w: any) => w.name === 'directing_data')
      if (ddWidget) {
        ddWidget.value = directingDataJson
      }
      writeStoredDirectingProps(live, { directing_data: directingDataJson })
      app.graph?.setDirtyCanvas(true, true)
    },
  })

  const mounted = vueApp.mount(container)
  instance.vueApp = vueApp
  instance.exposed = mounted as unknown as DirectingAppExposed

  directingInstances.set(node, instance)
  return instance
}

function createDirectingNodeWidget(node: ComfyNode): DOMWidgetInstance {
  let instance = directingInstances.get(node)

  if (instance) {
    if (instance.cleanupTimer !== null) {
      clearTimeout(instance.cleanupTimer)
      instance.cleanupTimer = null
    }
    instance.currentNode = node
  } else {
    instance = createDirectingInstance(node)
  }

  // Hide the directing_data widget (it's managed internally)
  const ddWidget = node.widgets?.find((w: any) => w.name === 'directing_data')
  if (ddWidget) {
    ddWidget.type = 'hidden' as any
    ;(ddWidget as any).computeSize = () => [0, -4]
  }

  const widget = node.addDOMWidget(
    'directing_3d_preview',
    'directing-widget',
    instance.container,
    {
      getMinHeight: () => 370,
      hideOnZoom: false,
      serialize: false
    }
  )

  instance.widget = widget

  const origOnConnectionsChange = node.onConnectionsChange
  node.onConnectionsChange = function (slotType, slotIndex, isConnected, link, ioSlot) {
    origOnConnectionsChange?.call(this, slotType, slotIndex, isConnected, link, ioSlot)

    if (slotType === 1) { // INPUT
      const input = this.inputs?.[slotIndex]
      if (input && input.name === 'acting' && !isConnected) {
        const directingInst = directingInstances.get(this)
        if (directingInst) {
          directingInst.exposed.setState({ acting_data: '' })
        }
        return
      }
    }
    updateDirectingNodeFromLinks(this)
  }

  const baseOnRemove = widget.onRemove?.bind(widget)
  widget.onRemove = () => {
    baseOnRemove?.()

    const current = directingInstances.get(node)
    if (!current || current.widget !== widget) return

    current.cleanupTimer = window.setTimeout(() => {
      const still = directingInstances.get(node)
      if (!still || still.widget !== widget) return
      still.exposed.cleanup()
      still.vueApp.unmount()
      directingInstances.delete(node)
    }, CLEANUP_DELAY_MS)
  }

  setTimeout(() => updateDirectingNodeFromLinks(node), 100)

  return widget
}


// --- Extension Registration ---
app.registerExtension({
  name: 'ComfyUI.SceneCameraAction',

  setup() {
    window.addEventListener('error', (e: ErrorEvent) => {
      const msg = e.message || e.error?.message || ''
      if (typeof msg === 'string' && (
        msg.includes('ResizeObserver loop completed with undelivered notifications') ||
        msg.includes('ResizeObserver loop limit exceeded')
      )) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }
    }, true)

    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      const msg = e.reason?.message || String(e.reason || '')
      if (typeof msg === 'string' && (
        msg.includes('ResizeObserver loop completed with undelivered notifications') ||
        msg.includes('ResizeObserver loop limit exceeded')
      )) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }
    }, true)

    if (app.canvas && (app.canvas as any).processMouseWheel) {
      const origWheel = (app.canvas as any).processMouseWheel;
      (app.canvas as any).processMouseWheel = function (this: any, e: WheelEvent) {
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

      const numAssetsWidget = node.widgets?.find(w => w.name === 'num_assets')
      if (numAssetsWidget) {
        numAssetsWidget.type = 'hidden'
      }

      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 400), Math.max(oldHeight, 380)])
      createSceneNodeWidget(node)

      const origOnConfigure = node.onConfigure
      node.onConfigure = function (info) {
        origOnConfigure?.call(this, info)

        const numAssetsWidgetConf = this.widgets?.find(w => w.name === 'num_assets')
        if (numAssetsWidgetConf) {
          numAssetsWidgetConf.type = 'hidden'
        }

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

      // Hide the motion_data input slot from the left side of the node
      const motionInputIdx = node.inputs?.findIndex(i => i.name === 'motion_data')
      if (motionInputIdx !== -1 && motionInputIdx !== undefined) {
        node.removeInput(motionInputIdx)
      }

      // Revert speed widget to render as number with step 1.0
      const speedWidget = node.widgets?.find(w => w.name === 'actor_speed')
      if (speedWidget) {
        speedWidget.type = 'number'
        if (!speedWidget.options) speedWidget.options = {}
        speedWidget.options.min = 1.0
        speedWidget.options.max = 20.0
        speedWidget.options.step = 1.0
        if (speedWidget.value === 1.0) {
          speedWidget.value = 10.0
        }
      }

      let durationWidget = node.widgets?.find(w => w.name === 'duration')
      if (!durationWidget) {
        durationWidget = (node as any).addWidget(
          'number',
          'duration',
          7.0,
          (value: unknown) => {
            const instance = actingInstances.get(node)
            if (instance && instance.exposed) {
              instance.exposed.setState({ duration: Number(value) })
            }
            writeStoredActingProps(node, { duration: Number(value) })
          },
          { min: 4.0, max: 15.0, step: 0.5 }
        )
        if (node.widgets) {
          const speedIdx = node.widgets.findIndex(w => w.name === 'actor_speed')
          if (speedIdx !== -1) {
            node.widgets.pop()
            node.widgets.splice(speedIdx + 1, 0, durationWidget!)
          }
        }
      } else {
        durationWidget.type = 'number'
        if (!durationWidget.options) durationWidget.options = {}
        durationWidget.options.min = 4.0
        durationWidget.options.max = 15.0
        durationWidget.options.step = 0.5
      }

      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 400), Math.max(oldHeight, 380)])
      createActingNodeWidget(node)

      const origOnConfigure = node.onConfigure
      node.onConfigure = function (info) {
        origOnConfigure?.call(this, info)

        // Hide the motion_data input slot on configure load
        const motionInputIdxConf = this.inputs?.findIndex(i => i.name === 'motion_data')
        if (motionInputIdxConf !== -1 && motionInputIdxConf !== undefined) {
          this.removeInput(motionInputIdxConf)
        }

        // Reinforce speed limits and number type on configure load
        const speedWidgetConf = this.widgets?.find(w => w.name === 'actor_speed')
        if (speedWidgetConf) {
          speedWidgetConf.type = 'number'
          if (!speedWidgetConf.options) speedWidgetConf.options = {}
          speedWidgetConf.options.min = 1.0
          speedWidgetConf.options.max = 20.0
          speedWidgetConf.options.step = 1.0
          if (speedWidgetConf.value === 1.0) {
            speedWidgetConf.value = 10.0
          }
        }

        let durationWidgetConf = this.widgets?.find(w => w.name === 'duration')
        if (!durationWidgetConf) {
          durationWidgetConf = (this as any).addWidget(
            'number',
            'duration',
            7.0,
            (value: unknown) => {
              const instance = actingInstances.get(this)
              if (instance && instance.exposed) {
                instance.exposed.setState({ duration: Number(value) })
              }
              writeStoredActingProps(this, { duration: Number(value) })
            },
            { min: 4.0, max: 15.0, step: 0.5 }
          )
          if (this.widgets) {
            const speedIdx = this.widgets.findIndex(w => w.name === 'actor_speed')
            if (speedIdx !== -1) {
              this.widgets.pop()
              this.widgets.splice(speedIdx + 1, 0, durationWidgetConf!)
            }
          }
        } else {
          durationWidgetConf.type = 'number'
          if (!durationWidgetConf.options) durationWidgetConf.options = {}
          durationWidgetConf.options.min = 4.0
          durationWidgetConf.options.max = 15.0
          durationWidgetConf.options.step = 0.5
        }

        const instance = actingInstances.get(this)
        if (instance) {
          const state = readActingStateFromNode(this)
          instance.exposed.setState(state)
        }
      }
    } else if (comfyClass === 'DirectingNode') {
      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 400), Math.max(oldHeight, 380)])
      createDirectingNodeWidget(node)

      const origOnConfigure = node.onConfigure
      node.onConfigure = function (info) {
        origOnConfigure?.call(this, info)

        const instance = directingInstances.get(this)
        if (instance) {
          const state = readDirectingStateFromNode(this)
          instance.exposed.setState(state)
        }
      }
    }
  }
})
