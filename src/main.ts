import { createApp, type App as VueApp } from 'vue'
import StagingWidget from './components/StagingWidget.vue'
import ActingWidget from './components/ActingWidget.vue'
import DirectingWidget from './components/DirectingWidget.vue'
import type { SceneState, StageState, ActingState, DirectingState, SceneAppExposed, StageAppExposed, ActingAppExposed, DirectingAppExposed } from './types'

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
const STAGE_PROP_KEY = 'stageNodeState'
const SCENE_PROP_KEY = STAGE_PROP_KEY
const ACTING_PROP_KEY = 'actingNodeState'
const DIRECTING_PROP_KEY = 'directingNodeState'

/**
 * Sanitizes motion_data string by stripping nested stage_data, scene_data, and duplicate actors array.
 */
function sanitizeMotionDataPayload(raw: unknown): string {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return raw

    let traj = parsed.trajectory || parsed.motion_data
    if (typeof traj === 'string' && traj.trim()) {
      try { traj = JSON.parse(traj) } catch (e) {}
    }

    if (Array.isArray(traj)) {
      const cleanPayload = {
        type: 'acting_motion',
        actor_type: parsed.actor_type || 'human',
        actor_color: parsed.actor_color || '#F1DFBF',
        actor_speed: parsed.actor_speed ?? 10.0,
        duration: parsed.duration ?? 7.0,
        spawn_point: parsed.spawn_point,
        trajectory: traj
      }
      return JSON.stringify(cleanPayload)
    }
  } catch (e) {}
  return raw
}

/**
 * Install automatic localStorage interceptor to recover from storage quota exhaustion.
 */
function installStorageInterceptor(): void {
  const origSetItem = localStorage.setItem.bind(localStorage)

  localStorage.setItem = function (key: string, value: string) {
    try {
      origSetItem(key, value)
    } catch (err: any) {
      const isQuota = err instanceof DOMException && (
        err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22 ||
        err.code === 1014
      )

      if (isQuota) {
        try {
          const draftKeys: string[] = []
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k && (k.startsWith('Comfy.Workflow.DraftPayload:') || k.startsWith('Comfy.Workflow.Drafts:') || k === 'litegrapheditor_clipboard')) {
              draftKeys.push(k)
            }
          }

          for (const k of draftKeys) {
            if (k !== key) {
              localStorage.removeItem(k)
            }
          }

          origSetItem(key, value)
          return
        } catch (retryErr) {}
      }
      throw err
    }
  }
}

interface StageNodeInstance {
  container: HTMLElement
  vueApp: VueApp
  exposed: StageAppExposed
  currentNode: ComfyNode
  widget: DOMWidgetInstance | null
  cleanupTimer: number | null
}
type SceneNodeInstance = StageNodeInstance

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

const stageInstances = new WeakMap<ComfyNode, StageNodeInstance>()
const sceneInstances = stageInstances
const actingInstances = new WeakMap<ComfyNode, ActingNodeInstance>()
const directingInstances = new WeakMap<ComfyNode, DirectingNodeInstance>()

function hideNodeWidget(node: ComfyNode, name: string): void {
  const w = node.widgets?.find((w: any) => w.name === name)
  if (w) {
    w.type = 'hidden' as any
    ;(w as any).computeSize = () => [0, -4]
    ;(w as any).draw = () => {}
  }
}

function removeNodeInput(node: ComfyNode, name: string): void {
  const idx = node.inputs?.findIndex((i: any) => i.name === name)
  if (idx !== -1 && idx !== undefined && typeof (node as any).removeInput === 'function') {
    (node as any).removeInput(idx)
  }
}

export function isStagingNode(node: ComfyNode | null | undefined): boolean {
  if (!node) return false
  const cls = node.constructor?.comfyClass || node.type
  return cls === 'StagingNode' || cls === 'UBStagingNode' || cls === 'StageNode' || cls === 'SceneNode'
}

export function isActingNode(node: ComfyNode | null | undefined): boolean {
  if (!node) return false
  const cls = node.constructor?.comfyClass || node.type
  return cls === 'ActingNode' || cls === 'UBActingNode'
}

export function isDirectingNode(node: ComfyNode | null | undefined): boolean {
  if (!node) return false
  const cls = node.constructor?.comfyClass || node.type
  return cls === 'DirectingNode' || cls === 'UBDirectingNode'
}

// --- Helpers for StageNode ---
async function updateStageNodeFromPreset(node: ComfyNode, filename: string): Promise<void> {
  if (!filename || filename === 'None') return

  try {
    const res = await fetch(`/scene_camera_action/get_preset?filename=${encodeURIComponent(filename)}`)
    if (res.ok) {
      const data = await res.json()
      const instance = stageInstances.get(node)
      if (instance) {
        instance.exposed.setState(data)
      } else {
        writeStoredStageProps(node, data)
      }
      notifyConnectedActingNodes(node)
      notifyConnectedDirectingNodes(node)
    }
  } catch (e) {
    console.error('[StageNode] Failed to load preset:', e)
  }
}
const updateSceneNodeFromPreset = updateStageNodeFromPreset

function getLinkedInputValue(node: ComfyNode, inputName: string): string | null {
  if (!node.inputs || node.inputs.length === 0) return null
  const input = node.inputs.find((i: any) => i.name === inputName)
  if (!input || input.link == null) return null

  const graph = app.graph as any
  if (!graph || !graph.links) return null

  const link = graph.links[input.link]
  if (!link) return null

  const originNode = graph.getNodeById?.(link.origin_id)
  if (!originNode) return null

  if (isStagingNode(originNode)) {
    const state = readStageStateFromNode(originNode)
    if (state) return JSON.stringify(state)
  }

  if (originNode.widgets && originNode.widgets.length > 0) {
    for (const w of originNode.widgets) {
      if (typeof w.value === 'string' && w.value.trim().startsWith('{')) {
        return w.value.trim()
      }
    }
    const firstVal = originNode.widgets[0]?.value
    if (typeof firstVal === 'string' && firstVal.trim()) {
      return firstVal.trim()
    }
  }

  return null
}

function getWidgetValue<T>(node: ComfyNode, name: string, defaultValue: T): T {
  const widget = node.widgets?.find(w => w.name === name)
  return widget ? (widget.value as T) : defaultValue
}

function setWidgetValue(node: ComfyNode, name: string, value: any): void {
  const widget = node.widgets?.find(w => w.name === name)
  if (widget) {
    widget.value = value
  }
}

function readStoredStageProps(node: ComfyNode): Partial<StageState> | null {
  const raw = node.properties?.[STAGE_PROP_KEY] ?? node.properties?.[SCENE_PROP_KEY]
  if (!raw || typeof raw !== 'object') return null
  return raw as Partial<StageState>
}
const readStoredSceneProps = readStoredStageProps

function writeStoredStageProps(node: ComfyNode, patch: Partial<StageState>): void {
  if (node.properties) {
    delete node.properties[STAGE_PROP_KEY]
    delete node.properties[SCENE_PROP_KEY]
  }

  const stageDataWidget = node.widgets?.find(w => w.name === 'stage_data' || w.name === 'scene_data')
  if (stageDataWidget) {
    stageDataWidget.value = JSON.stringify(patch)
  }
}
const writeStoredSceneProps = writeStoredStageProps

function readStageStateFromNode(node: ComfyNode): Partial<StageState> {
  const linkedStage = getLinkedInputValue(node, 'stage') || getLinkedInputValue(node, 'stage_data') || getLinkedInputValue(node, 'scene') || getLinkedInputValue(node, 'scene_data')
  if (linkedStage) {
    try {
      const parsed = JSON.parse(linkedStage)
      if (parsed && typeof parsed === 'object' && parsed.nodes) {
        return parsed
      }
    } catch (e) { }
  }

  const stageDataWidget = node.widgets?.find(w => w.name === 'stage_data' || w.name === 'scene_data')
  if (stageDataWidget && stageDataWidget.value && typeof stageDataWidget.value === 'string' && stageDataWidget.value.trim()) {
    try {
      return JSON.parse(stageDataWidget.value)
    } catch (e) { }
  }

  const stored = readStoredStageProps(node)
  return {
    type: 'cube_stage',
    num_assets: stored?.num_assets ?? 0,
    nodes: stored?.nodes ?? [],
  }
}
const readSceneStateFromNode = readStageStateFromNode

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

  const storedPreset = node.properties?.['selectedPreset'] as string | undefined

  const vueApp = createApp(StagingWidget, {
    initialState: readSceneStateFromNode(node),
    initialPreset: storedPreset,
    onStateChange: (state: SceneState) => {
      const live = instance.currentNode
      writeStoredSceneProps(live, state)
      app.graph?.setDirtyCanvas(true, true)
      notifyConnectedActingNodes(live)
      notifyConnectedDirectingNodes(live)
    },
    onPresetSaved: (filename: string) => {
      const live = instance.currentNode
      if (!live.properties) live.properties = {}
      live.properties['selectedPreset'] = filename
    },
    onPresetChanged: (filename: string) => {
      const live = instance.currentNode
      if (!live.properties) live.properties = {}
      live.properties['selectedPreset'] = filename
    }
  })

  const mounted = vueApp.mount(container)
  instance.vueApp = vueApp
  instance.exposed = mounted as unknown as SceneAppExposed

  sceneInstances.set(node, instance)
  return instance
}

function updateSceneNodeFromLinks(node: ComfyNode): void {
  const instance = sceneInstances.get(node)
  if (!instance) return
  const state = readSceneStateFromNode(node)
  instance.exposed.setState(state)
  notifyConnectedActingNodes(node)
  notifyConnectedDirectingNodes(node)
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

  const origOnConnectionsChange = node.onConnectionsChange
  node.onConnectionsChange = function (slotType, slotIndex, isConnected, link, ioSlot) {
    origOnConnectionsChange?.call(this, slotType, slotIndex, isConnected, link, ioSlot)
    if (slotType === 1) { // INPUT
      setTimeout(() => updateSceneNodeFromLinks(this), 50)
    }
  }

  setTimeout(() => updateSceneNodeFromLinks(node), 100)

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
  const existing = ((node.properties[ACTING_PROP_KEY] as any) || {})
  delete existing.stage_data
  delete existing.scene_data
  delete existing.actors
  delete existing.motion_data

  if (patch.spawn_point) {
    existing.spawn_point = patch.spawn_point
  }
  node.properties[ACTING_PROP_KEY] = existing
}

function findConnectedStageOrActingOrigin(actingNode: ComfyNode): { originNode: ComfyNode; isActing: boolean } | null {
  if (!actingNode.inputs || actingNode.inputs.length === 0) return null
  const inputSlot = actingNode.inputs.find(i => i.name === 'stage' || i.name === 'scene' || i.name === 'acting' || i.name === 'Stage / Acting')
  if (!inputSlot || inputSlot.link == null) return null

  const graph = app.graph
  if (!graph || !graph.links) return null

  const link = graph.links[inputSlot.link]
  if (!link) return null

  const originNode = graph.getNodeById?.(link.origin_id)
  if (!originNode) return null

  if (isStagingNode(originNode)) {
    return { originNode, isActing: false }
  }
  if (isActingNode(originNode)) {
    return { originNode, isActing: true }
  }
  return null
}

function findRootStagingNode(node: ComfyNode): ComfyNode | null {
  let curr: ComfyNode | null = node
  let depth = 0
  while (curr && depth < 10) {
    const originInfo = findConnectedStageOrActingOrigin(curr)
    if (!originInfo) return null
    if (!originInfo.isActing) return originInfo.originNode
    curr = originInfo.originNode
    depth++
  }
  return null
}

function findConnectedStageNode(actingNode: ComfyNode): ComfyNode | null {
  return findRootStagingNode(actingNode)
}
const findConnectedSceneNode = findConnectedStageNode

function findConnectedActingNode(directingNode: ComfyNode): ComfyNode | null {
  if (!directingNode.inputs || directingNode.inputs.length === 0) return null
  const actingInput = directingNode.inputs.find(i => i.name === 'acting' || i.name === 'Acting')
  if (!actingInput || actingInput.link == null) return null

  const graph = app.graph
  if (!graph || !graph.links) return null

  const link = graph.links[actingInput.link]
  if (!link) return null

  const originNode = graph.getNodeById?.(link.origin_id)
  if (isActingNode(originNode)) {
    return originNode || null
  }
  return null
}

function findRootActingNode(actingNode: ComfyNode): ComfyNode {
  let currNode: ComfyNode = actingNode
  const visited = new Set<ComfyNode>()

  while (currNode && !visited.has(currNode)) {
    visited.add(currNode)
    const originInfo = findConnectedStageOrActingOrigin(currNode)
    if (originInfo && originInfo.isActing) {
      currNode = originInfo.originNode
    } else {
      break
    }
  }
  return currNode
}

function updateActingNodeFromConnectedScene(actingNode: ComfyNode, visitedSet: Set<ComfyNode> = new Set()): void {
  if (visitedSet.has(actingNode)) return
  visitedSet.add(actingNode)

  const actingInst = actingInstances.get(actingNode)
  if (!actingInst) return

  const originInfo = findConnectedStageOrActingOrigin(actingNode)
  const currentActingState = readActingStateFromNode(actingNode)
  const charType = currentActingState.actor_type ?? 'human'

  if (originInfo) {
    let stageState: SceneState | null = null
    let previousActors: any[] = []

    const rootActingNode = findRootActingNode(actingNode)
    const rootActingState = readActingStateFromNode(rootActingNode)
    const masterDuration = rootActingState.duration ?? 7.0
    const isNestedActing = originInfo.isActing

    const durWidget = actingNode.widgets?.find(w => w.name === 'duration')
    if (isNestedActing) {
      setWidgetValue(actingNode, 'duration', masterDuration)
      if (durWidget) {
        if (!durWidget.options) durWidget.options = {}
        durWidget.options.read_only = true
        ;(durWidget as any).disabled = true
      }
    } else {
      if (durWidget) {
        if (!durWidget.options) durWidget.options = {}
        durWidget.options.read_only = false
        ;(durWidget as any).disabled = false
      }
    }

    const effectiveDuration = isNestedActing ? masterDuration : (currentActingState.duration ?? 7.0)

    if (!originInfo.isActing) {
      stageState = readSceneStateFromNode(originInfo.originNode) as SceneState
    } else {
      const upstreamActingNode = originInfo.originNode
      const upstreamInst = actingInstances.get(upstreamActingNode)
      const upstreamThreeActing = upstreamInst?.exposed?.getThreeActing ? upstreamInst.exposed.getThreeActing() : null

      if (upstreamThreeActing) {
        stageState = upstreamThreeActing.getStageData()
        previousActors = typeof (upstreamThreeActing as any).getAccumulatedActors === 'function'
          ? (upstreamThreeActing as any).getAccumulatedActors()
          : (upstreamThreeActing.getState().actors ?? [])
      } else {
        const upstreamActingState = readActingStateFromNode(upstreamActingNode)
        stageState = upstreamActingState.stage_data ?? upstreamActingState.scene_data ?? null
        previousActors = upstreamActingState.actors ?? []
      }
    }

    if (stageState) {
      actingInst.exposed.setState({
        scene_data: stageState,
        stage_data: stageState,
        actor_type: charType,
        actor_color: currentActingState.actor_color,
        duration: effectiveDuration,
        actors: previousActors
      })
      writeStoredActingProps(actingNode, {})

      const rootStagingNode = findRootStagingNode(actingNode)
      if (rootStagingNode) {
        const sceneInst = sceneInstances.get(rootStagingNode)
        const threeScene = sceneInst && sceneInst.exposed.getThreeScene ? sceneInst.exposed.getThreeScene() : null
        if (threeScene && actingInst.exposed.setConnectedThreeStage) {
          actingInst.exposed.setConnectedThreeStage(threeScene)
        }
      }
      notifyConnectedActingNodes(actingNode, visitedSet)
      notifyConnectedDirectingNodes(actingNode)
      app.graph?.setDirtyCanvas(true, true)
      return
    }
  }

  actingInst.exposed.setState({ scene_data: undefined, stage_data: undefined, actor_type: charType, actor_color: currentActingState.actor_color, actors: [] })
  writeStoredActingProps(actingNode, {})
  if (actingInst.exposed.setConnectedThreeStage) {
    actingInst.exposed.setConnectedThreeStage(null)
  }
  notifyConnectedDirectingNodes(actingNode)
}

function isActingNodeMotionValid(actingNode: ComfyNode): boolean {
  const actingInst = actingInstances.get(actingNode)
  const threeActing = actingInst?.exposed?.getThreeActing ? actingInst.exposed.getThreeActing() : null
  if (threeActing) {
    if (typeof threeActing.getTrajectory === 'function') {
      const traj = threeActing.getTrajectory()
      if (Array.isArray(traj) && traj.length > 0) return true
    }
  }
  const actingState = readActingStateFromNode(actingNode)
  const rawBlob = actingState.motion_data
  if (rawBlob && (typeof rawBlob === 'object' || (typeof rawBlob === 'string' && rawBlob.trim()))) {
    try {
      const parsed = typeof rawBlob === 'string' ? JSON.parse(rawBlob) : rawBlob
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.trajectory) && parsed.trajectory.length > 0) return true
        if (Array.isArray(parsed.motion_data) && parsed.motion_data.length > 0) return true
      }
      if (Array.isArray(parsed) && parsed.length > 0) return true
    } catch {}
  }
  return false
}

function isUpstreamActingChainComplete(startActingNode: ComfyNode): boolean {
  let currNode: ComfyNode | null = startActingNode
  const visited = new Set<ComfyNode>()

  while (currNode && !visited.has(currNode)) {
    visited.add(currNode)
    if (isActingNode(currNode)) {
      if (!isActingNodeMotionValid(currNode)) {
        return false
      }
      const originInfo = findConnectedStageOrActingOrigin(currNode)
      if (originInfo && originInfo.isActing) {
        currNode = originInfo.originNode
      } else {
        break
      }
    } else {
      break
    }
  }
  return true
}

function notifyConnectedDirectingNodes(originNode: ComfyNode): void {
  const graph = app.graph
  if (!graph || !graph.links) return

  for (const linkId in graph.links) {
    const link = graph.links[linkId]
    if (link && link.origin_id === originNode.id) {
      const targetNode = graph.getNodeById?.(link.target_id)
      if (isDirectingNode(targetNode)) {
        const directingInst = directingInstances.get(targetNode!)
        if (directingInst) {
          if (isActingNode(originNode)) {
            const chainComplete = isUpstreamActingChainComplete(originNode)
            if (!chainComplete) {
              directingInst.exposed.setState({ acting_data: '' })
              if ((directingInst.exposed as any).setConnectedThreeActing) {
                (directingInst.exposed as any).setConnectedThreeActing(null)
              }
              continue
            }

            const actingState = readActingStateFromNode(originNode)
            const actingInst = actingInstances.get(originNode)
            const threeActing = actingInst?.exposed?.getThreeActing ? actingInst.exposed.getThreeActing() : null

            if (threeActing && (directingInst.exposed as any).setConnectedThreeActing) {
              (directingInst.exposed as any).setConnectedThreeActing(threeActing)
            }

            const rawBlob = actingState.motion_data ?? ''
            let actingBlob: any = ''
            const currentSceneData = threeActing?.getStageData ? threeActing.getStageData() : (threeActing?.getSceneData() ?? actingState.scene_data)
            const currentActorType = threeActing?.getActorType() ?? actingState.actor_type ?? 'human'
            const currentActors = typeof (threeActing as any)?.getAccumulatedActors === 'function'
              ? (threeActing as any).getAccumulatedActors()
              : (threeActing?.getState ? threeActing.getState().actors : actingState.actors)

            if (rawBlob && (typeof rawBlob === 'object' || (typeof rawBlob === 'string' && rawBlob.trim()))) {
              try {
                const parsed = typeof rawBlob === 'string' ? JSON.parse(rawBlob) : rawBlob
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                  parsed.actor_type = currentActorType
                  if (currentSceneData) {
                    parsed.stage_data = currentSceneData
                    parsed.scene_data = currentSceneData
                  }
                  if (currentActors) {
                    parsed.actors = currentActors
                  }
                  if (!parsed.motion_data && parsed.trajectory) parsed.motion_data = parsed.trajectory
                  actingBlob = JSON.stringify(parsed)
                } else {
                  actingBlob = JSON.stringify({
                    type: 'acting_motion',
                    actor_type: currentActorType,
                    stage_data: currentSceneData,
                    scene_data: currentSceneData,
                    trajectory: parsed,
                    motion_data: parsed,
                    actors: currentActors
                  })
                }
              } catch (e) {
                actingBlob = rawBlob
              }
            } else {
              actingBlob = ''
            }

            directingInst.exposed.setState({ acting_data: actingBlob })
          }
        }
      }
    }
  }
}

function notifyConnectedActingNodes(originNode: ComfyNode, visitedSet: Set<ComfyNode> = new Set()): void {
  const graph = app.graph
  if (!graph || !graph.links) return
  visitedSet.add(originNode)

  for (const linkId in graph.links) {
    const link = graph.links[linkId]
    if (link && link.origin_id === originNode.id) {
      const targetNode = graph.getNodeById?.(link.target_id)
      if (isActingNode(targetNode)) {
        if (!visitedSet.has(targetNode!)) {
          updateActingNodeFromConnectedScene(targetNode!, visitedSet)
        }
      }
    }
  }
}

function parseCleanHexColor(val: any, defaultColor: string): string {
  if (!val) return defaultColor

  let rawStr = typeof val === 'string' ? val.trim() : null
  let obj = typeof val === 'object' && val !== null ? val : null

  if (rawStr && (rawStr.startsWith('{') || rawStr.startsWith('['))) {
    try {
      const parsed = JSON.parse(rawStr)
      if (parsed && typeof parsed === 'object') {
        obj = parsed
      }
    } catch (e) {}
  }

  if (obj) {
    const hex = obj.hex || obj.color || obj.value
    if (typeof hex === 'string' && hex.trim()) {
      rawStr = hex.trim()
    }
  }

  if (rawStr) {
    // If it's legacy acting motion data JSON, ignore it!
    if (rawStr.includes('"type"') || rawStr.includes('acting_motion')) {
      return defaultColor
    }
    let s = rawStr
    if (!s.startsWith('#') && /^[0-9a-fA-F]{3,8}$/.test(s)) {
      s = `#${s}`
    }
    if (s.startsWith('#')) {
      if (s.length === 9) return s.substring(0, 7)
      if (s.length === 7 || s.length === 4) return s
    }
  }

  return defaultColor
}

function getWidgetValueByNameOrIndex(node: ComfyNode, name: string, defaultIdx: number, defaultValue: any): any {
  const w = node.widgets?.find((w: any) => w.name === name)
  if (w && w.value !== undefined && w.value !== null) {
    return w.value
  }
  if (Array.isArray((node as any).widgets_values)) {
    const wIdx = node.widgets?.findIndex((w: any) => w.name === name)
    const targetIdx = (wIdx !== undefined && wIdx >= 0) ? wIdx : defaultIdx
    const val = (node as any).widgets_values[targetIdx]
    if (val !== undefined && val !== null) {
      return val
    }
  }
  return defaultValue
}

function readActingStateFromNode(node: ComfyNode): Partial<ActingState> {
  const typeVal = getWidgetValueByNameOrIndex(node, 'actor_type', 0, 'human')
  const defaultColor = (typeVal as string) === 'car' ? '#0284C7' : '#F1DFBF'
  const storedProps = readStoredActingProps(node)

  const rawColor = storedProps?.actor_color ?? getWidgetValueByNameOrIndex(node, 'actor_color', 2, defaultColor)
  const cleanColor = parseCleanHexColor(rawColor, defaultColor)
  const speedVal = getWidgetValueByNameOrIndex(node, 'actor_speed', 1, 10.0)
  const durationVal = getWidgetValueByNameOrIndex(node, 'duration', 3, 7.0)
  const rawMotionData = getWidgetValueByNameOrIndex(node, 'motion_data', 4, '')
  const motionDataVal = typeof rawMotionData === 'string' ? sanitizeMotionDataPayload(rawMotionData) : ''
  if (typeof rawMotionData === 'string' && rawMotionData !== motionDataVal) {
    const motionWidget = node.widgets?.find(w => w.name === 'motion_data')
    if (motionWidget) {
      motionWidget.value = motionDataVal
    }
  }

  let extractedActors: any[] | undefined = storedProps?.actors
  if ((!extractedActors || extractedActors.length === 0) && typeof rawMotionData === 'string' && rawMotionData.trim()) {
    try {
      const parsed = JSON.parse(rawMotionData)
      if (parsed && Array.isArray(parsed.actors)) {
        extractedActors = parsed.actors
      }
    } catch (e) { }
  }

  return {
    actor_type: (typeVal as string) === 'car' ? 'car' : 'human',
    actor_color: cleanColor,
    actor_speed: typeof speedVal === 'number' ? Math.max(1.0, Math.min(30.0, speedVal)) : ((typeVal as string) === 'car' ? 20.0 : 10.0),
    duration: typeof durationVal === 'number' ? Math.max(4.0, Math.min(15.0, durationVal)) : 7.0,
    motion_data: motionDataVal,
    spawn_point: storedProps?.spawn_point,
    scene_data: storedProps?.scene_data ?? (undefined as any),
    stage_data: storedProps?.stage_data ?? storedProps?.scene_data ?? (undefined as any),
    actors: extractedActors ?? []
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
      actor_color: stored.actor_color,
      actor_speed: stored.actor_speed ?? 10.0,
      duration: stored.duration ?? 7.0,
      spawn_point: stored.spawn_point,
      motion_data: stored.motion_data ?? '',
      scene_data: initialSceneState,
      stage_data: initialSceneState,
      actors: stored.actors ?? [],
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
      const colorWidget = live.widgets?.find(w => w.name === 'actor_color')
      if (colorWidget && colorWidget.value !== state.actor_color && state.actor_color) {
        colorWidget.value = state.actor_color
      }
      const motionWidget = live.widgets?.find(w => w.name === 'motion_data')
      if (motionWidget && motionWidget.value !== state.motion_data) {
        motionWidget.value = state.motion_data ?? ''
      }

      app.graph?.setDirtyCanvas(true, true)
      notifyConnectedActingNodes(live)
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
    const speedWidget = node.widgets?.find(w => w.name === 'actor_speed')
    const targetSpeed = charType === 'car' ? 20.0 : 10.0
    if (speedWidget) {
      speedWidget.value = targetSpeed
      setWidgetValue(node, 'actor_speed', targetSpeed)
    }
    const colorWidget = node.widgets?.find(w => w.name === 'actor_color')
    const targetColor = charType === 'car' ? '#0284C7' : '#F1DFBF'
    if (colorWidget) {
      colorWidget.value = targetColor
      setWidgetValue(node, 'actor_color', targetColor)
    }
    exposed.setState({ actor_type: charType, actor_color: targetColor, actor_speed: targetSpeed })
    writeStoredActingProps(node, { actor_type: charType, actor_color: targetColor, actor_speed: targetSpeed })
    notifyConnectedDirectingNodes(node)
  })

  wire('actor_color', v => {
    const rawType = getWidgetValue(node, 'actor_type', 'human')
    const charType = String(rawType) === 'car' ? 'car' : 'human'
    const defaultColor = charType === 'car' ? '#0284C7' : '#F1DFBF'
    const cleanColor = parseCleanHexColor(v, defaultColor)
    exposed.setState({ actor_color: cleanColor })
    writeStoredActingProps(node, { actor_color: cleanColor })
    notifyConnectedActingNodes(node)
    notifyConnectedDirectingNodes(node)
  })

  // Sync initial widget state immediately after binding and on tick
  const syncStateNow = () => {
    const st = readActingStateFromNode(node)
    if (st.actor_color) {
      exposed.setState({ actor_color: st.actor_color })
    }
  }
  syncStateNow()
  setTimeout(syncStateNow, 50)
  setTimeout(syncStateNow, 300)

  wire('actor_speed', v => {
    exposed.setState({ actor_speed: Number(v) })
    writeStoredActingProps(node, { actor_speed: Number(v) })
  })

  wire('duration', v => {
    exposed.setState({ duration: Number(v) })
    writeStoredActingProps(node, { duration: Number(v) })
    notifyConnectedActingNodes(node)
    notifyConnectedDirectingNodes(node)
    app.graph?.setDirtyCanvas(true, true)
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

  // Hook onConfigure for workflow graph reloads
  const origOnConfigure = node.onConfigure
  node.onConfigure = function (info: any) {
    origOnConfigure?.call(this, info)
    setTimeout(() => {
      const actingInst = actingInstances.get(this)
      if (actingInst) {
        const st = readActingStateFromNode(this)
        actingInst.exposed.setState(st)
      }
    }, 10)
  }

  // Sync connection change
  const origOnConnectionsChange = node.onConnectionsChange
  node.onConnectionsChange = function (slotType, slotIndex, isConnected, link, ioSlot) {
    origOnConnectionsChange?.call(this, slotType, slotIndex, isConnected, link, ioSlot)

    if (slotType === 1) { // 1 = INPUT
      const input = this.inputs?.[slotIndex]
      if (input && (input.name === 'stage' || input.name === 'scene' || input.name === 'acting' || input.name === 'Stage / Acting') && !isConnected) {
        const actingInst = actingInstances.get(this)
        if (actingInst) {
          actingInst.exposed.setState({ scene_data: undefined, stage_data: undefined, actors: [] })
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
  const existing = (node.properties[DIRECTING_PROP_KEY] as any) || {}
  delete existing.acting_data
  if (patch.camera_mode) {
    existing.camera_mode = patch.camera_mode
  }
  node.properties[DIRECTING_PROP_KEY] = existing
}

function readDirectingStateFromNode(node: ComfyNode): Partial<DirectingState> {
  const directingDataVal = getWidgetValue(node, 'directing_data', '')
  const stored = readStoredDirectingProps(node) ?? {}
  return {
    camera_mode: stored.camera_mode ?? 'Third Person',
    directing_data: typeof directingDataVal === 'string' ? directingDataVal : '',
    acting_data: '',
  }
}

function updateDirectingNodeFromLinks(directingNode: ComfyNode): void {
  const directingInst = directingInstances.get(directingNode)
  if (!directingInst) return

  const connectedActingNode = findConnectedActingNode(directingNode)
  if (connectedActingNode) {
    const actingState = readActingStateFromNode(connectedActingNode)
    const actingBlob = actingState.motion_data ?? ''
    directingInst.exposed.setState({ acting_data: actingBlob })

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
    installStorageInterceptor()

    try {
      // Clean up legacy V1 draft blobs from localStorage to free browser storage quota
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && (key.startsWith('Comfy.Workflow.Drafts:') || key === 'Comfy.Workflow.Drafts' || key === 'Comfy.PreviousWorkflow')) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(k => {
        try { localStorage.removeItem(k) } catch (e) {}
      })
    } catch (e) {}

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
    if (isStagingNode(node)) {
      hideNodeWidget(node, 'stage_data')
      hideNodeWidget(node, 'scene_data')
      hideNodeWidget(node, 'num_assets')

      // Purge legacy bloated properties
      if (node.properties) {
        delete node.properties[STAGE_PROP_KEY]
        delete node.properties[SCENE_PROP_KEY]
        delete node.properties['stageNodeState']
        delete node.properties['sceneNodeState']
      }

      const origOnSerialize = (node as any).onSerialize
      ;(node as any).onSerialize = function (info: any) {
        origOnSerialize?.call(this, info)
        if (info && info.properties) {
          delete info.properties[STAGE_PROP_KEY]
          delete info.properties[SCENE_PROP_KEY]
          delete info.properties['stageNodeState']
          delete info.properties['sceneNodeState']
        }
      }

      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 420), Math.max(oldHeight, 420)])
      createSceneNodeWidget(node)

      const sceneFileWidget = node.widgets?.find(w => w.name === 'stage_file' || w.name === 'scene_file')
      if (sceneFileWidget) {
        const origCb = sceneFileWidget.callback
        sceneFileWidget.callback = function (value: any) {
          origCb?.call(this, value)
          updateStageNodeFromPreset(node, String(value))
        }
      }

      const origOnExecuted = node.onExecuted
      node.onExecuted = function (message: any) {
        origOnExecuted?.call(this, message)
        const stageState = message?.stage_state ?? message?.scene_state
        if (stageState && Array.isArray(stageState.nodes) && stageState.nodes.length > 0) {
          const instance = stageInstances.get(this)
          if (instance) {
            instance.exposed.setState(stageState)
          }
        }
      }

      const origOnConfigure = node.onConfigure
      node.onConfigure = function (info) {
        origOnConfigure?.call(this, info)

        // Purge legacy bloated properties on load/paste
        if (this.properties) {
          delete this.properties[STAGE_PROP_KEY]
          delete this.properties[SCENE_PROP_KEY]
          delete this.properties['stageNodeState']
          delete this.properties['sceneNodeState']
        }

        hideNodeWidget(this, 'stage_data')
        hideNodeWidget(this, 'scene_data')
        hideNodeWidget(this, 'num_assets')

        const instance = stageInstances.get(this)
        if (instance) {
          const state = readStageStateFromNode(this)
          instance.exposed.setState(state)
        }
      }

      const origOnRemoved = node.onRemoved
      node.onRemoved = function (this: ComfyNode) {
        origOnRemoved?.call(this)
        const instance = sceneInstances.get(this)
        if (instance) {
          if (instance.cleanupTimer !== null) {
            clearTimeout(instance.cleanupTimer)
            instance.cleanupTimer = null
          }
          try { instance.exposed?.cleanup?.() } catch (e) {}
          try { instance.vueApp?.unmount() } catch (e) {}
          sceneInstances.delete(this)
        }
      }
    } else if (isActingNode(node)) {
      hideNodeWidget(node, 'motion_data')
      removeNodeInput(node, 'motion_data')

      // Purge legacy bloated properties
      if (node.properties?.[ACTING_PROP_KEY]) {
        const p = node.properties[ACTING_PROP_KEY] as any
        delete p.stage_data
        delete p.scene_data
        delete p.actors
        delete p.motion_data
      }

      const origOnSerialize = (node as any).onSerialize
      ;(node as any).onSerialize = function (info: any) {
        origOnSerialize?.call(this, info)
        if (info && info.properties && info.properties[ACTING_PROP_KEY]) {
          const p = info.properties[ACTING_PROP_KEY]
          delete p.stage_data
          delete p.scene_data
          delete p.actors
          delete p.motion_data
        }
        if (info && Array.isArray(info.widgets_values)) {
          info.widgets_values = info.widgets_values.map((v: any) => typeof v === 'string' ? sanitizeMotionDataPayload(v) : v)
        }
      }

      // Revert speed widget to render as number with step 1.0
      const speedWidget = node.widgets?.find(w => w.name === 'actor_speed')
      if (speedWidget) {
        speedWidget.type = 'number'
        if (!speedWidget.options) speedWidget.options = {}
        speedWidget.options.min = 1.0
        speedWidget.options.max = 30.0
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

      const origActingOnExecuted = node.onExecuted
      node.onExecuted = function (message: any) {
        origActingOnExecuted?.call(this, message)
        if (message?.acting_state) {
          const instance = actingInstances.get(this)
          if (instance) {
            instance.exposed.setState(message.acting_state)
          }
        }
      }

      const origOnConfigure = node.onConfigure
      node.onConfigure = function (info) {
        origOnConfigure?.call(this, info)

        // Purge legacy bloated properties on load/paste
        if (this.properties?.[ACTING_PROP_KEY]) {
          const p = this.properties[ACTING_PROP_KEY] as any
          delete p.stage_data
          delete p.scene_data
          delete p.actors
          delete p.motion_data
        }

        hideNodeWidget(this, 'motion_data')
        removeNodeInput(this, 'motion_data')

        // Sanitize motion_data widget value if legacy bloated format
        const motionWidget = this.widgets?.find(w => w.name === 'motion_data')
        if (motionWidget && typeof motionWidget.value === 'string' && motionWidget.value.trim()) {
          motionWidget.value = sanitizeMotionDataPayload(motionWidget.value)
        }

        // Reinforce speed limits and number type on configure load
        const speedWidgetConf = this.widgets?.find(w => w.name === 'actor_speed')
        if (speedWidgetConf) {
          speedWidgetConf.type = 'number'
          if (!speedWidgetConf.options) speedWidgetConf.options = {}
          speedWidgetConf.options.min = 1.0
          speedWidgetConf.options.max = 30.0
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

      const origActingOnRemoved = node.onRemoved
      node.onRemoved = function (this: ComfyNode) {
        origActingOnRemoved?.call(this)
        const instance = actingInstances.get(this)
        if (instance) {
          if (instance.cleanupTimer !== null) {
            clearTimeout(instance.cleanupTimer)
            instance.cleanupTimer = null
          }
          try { instance.exposed?.cleanup?.() } catch (e) {}
          try { instance.vueApp?.unmount() } catch (e) {}
          actingInstances.delete(this)
        }
      }
    } else if (isDirectingNode(node)) {
      hideNodeWidget(node, 'directing_data')
      removeNodeInput(node, 'directing_data')

      // Purge legacy bloated properties
      if (node.properties?.[DIRECTING_PROP_KEY]) {
        const p = node.properties[DIRECTING_PROP_KEY] as any
        delete p.acting_data
      }

      const origOnSerialize = (node as any).onSerialize
      ;(node as any).onSerialize = function (info: any) {
        origOnSerialize?.call(this, info)
        if (info && info.properties && info.properties[DIRECTING_PROP_KEY]) {
          delete info.properties[DIRECTING_PROP_KEY].acting_data
        }
      }

      const [oldWidth, oldHeight] = node.size
      node.setSize([Math.max(oldWidth, 400), Math.max(oldHeight, 380)])
      createDirectingNodeWidget(node)

      const origOnConfigure = node.onConfigure
      node.onConfigure = function (info) {
        origOnConfigure?.call(this, info)

        // Purge legacy bloated properties on load/paste
        if (this.properties?.[DIRECTING_PROP_KEY]) {
          const p = this.properties[DIRECTING_PROP_KEY] as any
          delete p.acting_data
        }

        hideNodeWidget(this, 'directing_data')
        removeNodeInput(this, 'directing_data')

        const instance = directingInstances.get(this)
        if (instance) {
          const state = readDirectingStateFromNode(this)
          instance.exposed.setState(state)
        }
      }


      const origDirectingOnRemoved = node.onRemoved
      node.onRemoved = function (this: ComfyNode) {
        origDirectingOnRemoved?.call(this)
        const instance = directingInstances.get(this)
        if (instance) {
          if (instance.cleanupTimer !== null) {
            clearTimeout(instance.cleanupTimer)
            instance.cleanupTimer = null
          }
          try { instance.exposed?.cleanup?.() } catch (e) {}
          try { instance.vueApp?.unmount() } catch (e) {}
          directingInstances.delete(this)
        }
      }
    }
  }
})
