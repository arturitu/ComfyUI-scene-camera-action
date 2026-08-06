import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'

export interface SelectionCallbacks {
  onSelectionChange?: (hasSelection: boolean) => void
  onSelectionInfoChange?: (info: { selectedCount: number; hasGroupSelected: boolean; canGroup: boolean; canUngroup: boolean }) => void
}

export class SceneSelectionManager {
  private selectedObjects: THREE.Object3D[] = []
  private boxHelpers: THREE.BoxHelper[] = []
  private multiSelectionPivot: THREE.Group | null = null

  private startPivotTransform: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null = null
  private startObjectTransforms: Map<THREE.Object3D, { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }> = new Map()

  public getSelectedObjects(): THREE.Object3D[] {
    return this.selectedObjects
  }

  public setSelectedObjects(objs: THREE.Object3D[]): void {
    this.selectedObjects = objs
  }

  public getMultiSelectionPivot(): THREE.Group | null {
    return this.multiSelectionPivot
  }

  public clearSelectionUI(scene: THREE.Scene, transformControls?: TransformControls): void {
    this.boxHelpers.forEach(h => {
      scene.remove(h)
      h.dispose()
    })
    this.boxHelpers = []

    if (this.multiSelectionPivot) {
      scene.remove(this.multiSelectionPivot)
      this.multiSelectionPivot = null
    }

    if (transformControls) {
      transformControls.detach()
    }
    this.startPivotTransform = null
    this.startObjectTransforms.clear()
  }

  public updateSelectionUI(
    scene: THREE.Scene,
    transformControls: TransformControls,
    transformMode: 'translate' | 'rotate' | 'scale' | null,
    lastTransformMode: 'translate' | 'rotate' | 'scale',
    callbacks: SelectionCallbacks
  ): void {
    this.clearSelectionUI(scene, transformControls)

    const count = this.selectedObjects.length
    const hasGroup = this.selectedObjects.some(o => o.type === 'Group')
    const canGroup = count >= 2
    const canUngroup = hasGroup

    if (count === 0) {
      if (callbacks.onSelectionChange) callbacks.onSelectionChange(false)
      if (callbacks.onSelectionInfoChange) {
        callbacks.onSelectionInfoChange({ selectedCount: 0, hasGroupSelected: false, canGroup: false, canUngroup: false })
      }
      return
    }

    const modeToUse = transformMode ?? lastTransformMode

    if (count === 1) {
      const target = this.selectedObjects[0]
      const isSpawnPoint = target.name === '__spawn_point_indicator__'
      if (transformControls) {
        transformControls.setMode(modeToUse)
        if (isSpawnPoint && modeToUse === 'rotate') {
          transformControls.showX = false
          transformControls.showY = true
          transformControls.showZ = false
        } else {
          transformControls.showX = true
          transformControls.showY = true
          transformControls.showZ = true
        }
        transformControls.attach(target)
      }
      if (callbacks.onSelectionChange) callbacks.onSelectionChange(true)
      if (callbacks.onSelectionInfoChange) {
        callbacks.onSelectionInfoChange({ selectedCount: 1, hasGroupSelected: target.type === 'Group', canGroup: false, canUngroup: target.type === 'Group' })
      }
    } else {
      // Multi-selection (2+ items): show BoxHelpers and attach TransformControls to multiSelectionPivot
      this.selectedObjects.forEach(obj => {
        const helper = new THREE.BoxHelper(obj, 0x4a90e2)
        helper.name = '__box_helper__'
        scene.add(helper)
        this.boxHelpers.push(helper)
      })

      const bbox = new THREE.Box3()
      this.selectedObjects.forEach(obj => bbox.expandByObject(obj))
      const centerVec = new THREE.Vector3()
      bbox.getCenter(centerVec)

      this.multiSelectionPivot = new THREE.Group()
      this.multiSelectionPivot.position.copy(centerVec)
      scene.add(this.multiSelectionPivot)

      if (transformControls) {
        transformControls.setMode(modeToUse)
        transformControls.attach(this.multiSelectionPivot)
      }

      if (callbacks.onSelectionChange) callbacks.onSelectionChange(true)
      if (callbacks.onSelectionInfoChange) {
        callbacks.onSelectionInfoChange({ selectedCount: count, hasGroupSelected: hasGroup, canGroup: true, canUngroup: canUngroup })
      }
    }
  }

  public getTopSelectableObject(obj: THREE.Object3D, scene: THREE.Scene, transformControlsHelper: THREE.Object3D): THREE.Object3D | null {
    let curr: THREE.Object3D | null = obj
    while (curr && curr.parent && curr.parent !== scene) {
      if (curr.parent.type === 'Scene') break
      if (curr.parent.name === 'floor' || curr.parent === transformControlsHelper) break
      curr = curr.parent
    }
    if (curr && (curr.type === 'Mesh' || curr.type === 'Group') && curr.name !== 'floor') {
      return curr
    }
    return null
  }

  public onDraggingChanged(eventValue: boolean): void {
    if (eventValue) {
      // Dragging started
      if (this.selectedObjects.length >= 2 && this.multiSelectionPivot) {
        this.startPivotTransform = {
          pos: this.multiSelectionPivot.position.clone(),
          quat: this.multiSelectionPivot.quaternion.clone(),
          scale: this.multiSelectionPivot.scale.clone(),
        }
        this.startObjectTransforms.clear()
        this.selectedObjects.forEach(obj => {
          this.startObjectTransforms.set(obj, {
            pos: obj.position.clone(),
            quat: obj.quaternion.clone(),
            scale: obj.scale.clone(),
          })
        })
      }
    } else {
      // Dragging ended
      if (this.selectedObjects.length >= 2 && this.multiSelectionPivot) {
        const bbox = new THREE.Box3()
        this.selectedObjects.forEach(obj => bbox.expandByObject(obj))
        const newCenter = new THREE.Vector3()
        bbox.getCenter(newCenter)

        this.multiSelectionPivot.position.copy(newCenter)
        this.multiSelectionPivot.quaternion.identity()
        this.multiSelectionPivot.scale.set(1, 1, 1)
        this.multiSelectionPivot.updateMatrixWorld()
      }
      this.startPivotTransform = null
      this.startObjectTransforms.clear()
    }
  }

  public onObjectChange(): void {
    if (this.selectedObjects.length >= 2 && this.multiSelectionPivot && this.startPivotTransform) {
      const p = this.multiSelectionPivot.position
      const q = this.multiSelectionPivot.quaternion
      const s = this.multiSelectionPivot.scale

      const p0 = this.startPivotTransform.pos
      const q0 = this.startPivotTransform.quat
      const s0 = this.startPivotTransform.scale

      const qDelta = q.clone().multiply(q0.clone().invert())
      const sDelta = new THREE.Vector3(s.x / s0.x, s.y / s0.y, s.z / s0.z)
      const pDelta = p.clone().sub(p0)

      this.selectedObjects.forEach(obj => {
        const init = this.startObjectTransforms.get(obj)
        if (!init) return

        const vecRel = init.pos.clone().sub(p0)
        vecRel.multiply(sDelta)
        vecRel.applyQuaternion(qDelta)

        obj.position.copy(p0).add(pDelta).add(vecRel)
        obj.quaternion.copy(qDelta).multiply(init.quat)
        obj.scale.copy(init.scale).multiply(sDelta)
        obj.updateMatrixWorld(true)
      })
    }

    this.updateBoxHelpers()
  }

  public updateBoxHelpers(): void {
    if (this.boxHelpers.length > 0) {
      this.boxHelpers.forEach(h => h.update())
    }
  }
}
