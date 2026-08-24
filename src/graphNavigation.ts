let isGraphNavigating = false
let graphNavTimeout: number | null = null

type Listener = (navigating: boolean) => void
const listeners = new Set<Listener>()

export function isComfyGraphNavigating(): boolean {
  return isGraphNavigating
}

export function onGraphNavigationChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setGraphNavigating(active: boolean, debounceMs = 120): void {
  if (active) {
    if (!isGraphNavigating) {
      isGraphNavigating = true
      listeners.forEach(fn => fn(true))
    }
    if (graphNavTimeout !== null) {
      clearTimeout(graphNavTimeout)
      graphNavTimeout = null
    }
    graphNavTimeout = window.setTimeout(() => {
      isGraphNavigating = false
      graphNavTimeout = null
      listeners.forEach(fn => fn(false))
    }, debounceMs)
  } else {
    if (graphNavTimeout !== null) {
      clearTimeout(graphNavTimeout)
      graphNavTimeout = null
    }
    if (isGraphNavigating) {
      isGraphNavigating = false
      listeners.forEach(fn => fn(false))
    }
  }
}

export function initGraphNavigationTracker(app: any): void {
  const canvasEl = app?.canvas?.canvas
  if (!canvasEl) return

  // 1. Wheel on graph canvas (zooming)
  canvasEl.addEventListener('wheel', () => {
    if (!document.querySelector('.canvas-container:hover')) {
      setGraphNavigating(true, 150)
    }
  }, { passive: true })

  // 2. Pointer move while dragging canvas, dragging node, or pointer down
  canvasEl.addEventListener('pointermove', () => {
    const c = app.canvas as any
    if (c && (c.dragging_canvas || c.node_dragged || c.selected_nodes_dragging || c.pointer_is_down || c.connecting_node)) {
      setGraphNavigating(true, 120)
    }
  }, { passive: true })

  // 3. Pointer down on graph canvas
  canvasEl.addEventListener('pointerdown', () => {
    if (!document.querySelector('.three-container:hover')) {
      setGraphNavigating(true, 150)
    }
  }, { passive: true })

  // 4. Pointer up to quickly settle
  window.addEventListener('pointerup', () => {
    if (isComfyGraphNavigating()) {
      setGraphNavigating(true, 50)
    }
  }, { passive: true })

  // 5. Hook node movement
  if (app.canvas) {
    const origOnNodeMoved = (app.canvas as any).onNodeMoved
    ;(app.canvas as any).onNodeMoved = function () {
      origOnNodeMoved?.apply(this, arguments as any)
      setGraphNavigating(true, 120)
    }

    // 6. Hook DragAndScale changes
    if ((app.canvas as any).ds) {
      const origChangeDelta = (app.canvas as any).ds.changeDelta
      if (typeof origChangeDelta === 'function') {
        ;(app.canvas as any).ds.changeDelta = function () {
          origChangeDelta.apply(this, arguments as any)
          setGraphNavigating(true, 120)
        }
      }
    }
  }
}
