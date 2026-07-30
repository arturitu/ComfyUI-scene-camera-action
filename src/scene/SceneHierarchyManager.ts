import * as THREE from 'three'
import type { SceneState, SceneNode, CubeTransform } from '../types'
import { createBlockMaterial } from '../threeConfig'

export class SceneHierarchyManager {
  private meshes: THREE.Mesh[] = []

  public getMeshes(): THREE.Mesh[] {
    return this.meshes
  }

  public createBlockMesh(transform: CubeTransform): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const mesh = new THREE.Mesh(geometry, createBlockMaterial())

    mesh.position.set(transform.px, transform.py, transform.pz)
    mesh.rotation.set(transform.rx, transform.ry, transform.rz)
    mesh.scale.set(transform.sx, transform.sy, transform.sz)
    mesh.castShadow = true
    mesh.receiveShadow = true

    return mesh
  }

  public buildNodeFromData(nodeData: SceneNode): THREE.Object3D {
    if (nodeData.type === 'block') {
      const mesh = this.createBlockMesh(nodeData.transform)
      mesh.uuid = nodeData.id || mesh.uuid
      if (nodeData.name) mesh.name = nodeData.name
      this.meshes.push(mesh)
      return mesh
    } else {
      const group = new THREE.Group()
      group.uuid = nodeData.id || group.uuid
      if (nodeData.name) group.name = nodeData.name
      group.position.set(nodeData.transform.px, nodeData.transform.py, nodeData.transform.pz)
      group.rotation.set(nodeData.transform.rx, nodeData.transform.ry, nodeData.transform.rz)
      group.scale.set(nodeData.transform.sx, nodeData.transform.sy, nodeData.transform.sz)

      if (nodeData.children && nodeData.children.length > 0) {
        nodeData.children.forEach(childNode => {
          const childObj = this.buildNodeFromData(childNode)
          group.add(childObj)
        })
      }
      return group
    }
  }

  public updateMesh(
    scene: THREE.Scene,
    state: SceneState,
    clearSelectionFn: () => void,
    transformControlsHelper: THREE.Object3D
  ): void {
    clearSelectionFn()

    const objectsToRemove: THREE.Object3D[] = []
    scene.children.forEach(child => {
      if (child.name !== 'floor' &&
          child.type !== 'AmbientLight' &&
          child.type !== 'DirectionalLight' &&
          child.type !== 'GridHelper' &&
          child !== transformControlsHelper) {
        objectsToRemove.push(child)
      }
    })
    objectsToRemove.forEach(obj => scene.remove(obj))
    this.meshes = []

    if (state.nodes && state.nodes.length > 0) {
      state.nodes.forEach(nodeData => {
        const obj = this.buildNodeFromData(nodeData)
        scene.add(obj)
      })
    } else {
      if (!state.asset_transforms) {
        state.asset_transforms = []
      }
      state.asset_transforms.forEach((t, i) => {
        if (t.sx === 1.0 && t.sy === 1.0 && t.sz === 1.0) {
          if (i === 0) {
            t.sx = 0.8; t.sz = 0.8; t.sy = 2.0
          } else {
            const seed1 = Math.sin(i * 12.9898) * 43758.5453
            const seed2 = Math.sin(i * 78.233) * 43758.5453
            const rand1 = seed1 - Math.floor(seed1)
            const rand2 = seed2 - Math.floor(seed2)
            t.sx = 0.6 + rand1 * 0.4
            t.sz = 0.6 + rand2 * 0.4
            t.sy = 1.0 + rand1 * 1.5
          }
        }
        const mesh = this.createBlockMesh(t)
        scene.add(mesh)
        this.meshes.push(mesh)
      })
    }

    this.syncState(scene, state, transformControlsHelper, null)
  }

  public serializeObjectToNode(
    obj: THREE.Object3D,
    transformControlsHelper: THREE.Object3D,
    multiSelectionPivot: THREE.Group | null
  ): SceneNode | null {
    if (obj.type === 'Mesh' && obj.name !== 'floor') {
      const mesh = obj as THREE.Mesh
      return {
        id: mesh.uuid,
        type: 'block',
        name: mesh.name || 'Block',
        transform: {
          px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z,
          rx: mesh.rotation.x, ry: mesh.rotation.y, rz: mesh.rotation.z,
          sx: mesh.scale.x, sy: mesh.scale.y, sz: mesh.scale.z
        }
      }
    } else if (obj.type === 'Group' && obj !== transformControlsHelper && obj !== multiSelectionPivot) {
      const group = obj as THREE.Group
      const childrenNodes: SceneNode[] = []
      group.children.forEach(child => {
        const node = this.serializeObjectToNode(child, transformControlsHelper, multiSelectionPivot)
        if (node) childrenNodes.push(node)
      })
      return {
        id: group.uuid,
        type: 'group',
        name: group.name || 'Group',
        transform: {
          px: group.position.x, py: group.position.y, pz: group.position.z,
          rx: group.rotation.x, ry: group.rotation.y, rz: group.rotation.z,
          sx: group.scale.x, sy: group.scale.y, sz: group.scale.z
        },
        children: childrenNodes
      }
    }
    return null
  }

  public countBlocks(node: SceneNode): number {
    if (node.type === 'block') return 1
    if (node.type === 'group' && node.children) {
      return node.children.reduce((sum, child) => sum + this.countBlocks(child), 0)
    }
    return 0
  }

  public syncState(
    scene: THREE.Scene,
    state: SceneState,
    transformControlsHelper: THREE.Object3D,
    multiSelectionPivot: THREE.Group | null,
    onStateChange?: (state: SceneState) => void
  ): void {
    const nodes: SceneNode[] = []
    const legacyTransforms: CubeTransform[] = []

    scene.children.forEach(child => {
      const node = this.serializeObjectToNode(child, transformControlsHelper, multiSelectionPivot)
      if (node) {
        nodes.push(node)
      }
    })

    this.meshes.forEach(mesh => {
      const worldPos = new THREE.Vector3()
      const worldQuat = new THREE.Quaternion()
      const worldScale = new THREE.Vector3()
      mesh.getWorldPosition(worldPos)
      mesh.getWorldQuaternion(worldQuat)
      mesh.getWorldScale(worldScale)
      const euler = new THREE.Euler().setFromQuaternion(worldQuat)

      legacyTransforms.push({
        px: worldPos.x, py: worldPos.y, pz: worldPos.z,
        rx: euler.x, ry: euler.y, rz: euler.z,
        sx: worldScale.x, sy: worldScale.y, sz: worldScale.z
      })
    })

    const totalBlocks = nodes.reduce((sum, n) => sum + this.countBlocks(n), 0)

    state.nodes = nodes
    state.asset_transforms = legacyTransforms
    state.num_assets = totalBlocks

    if (onStateChange) {
      onStateChange({ ...state })
    }
  }

  public groupSelected(scene: THREE.Scene, selectedObjects: THREE.Object3D[]): THREE.Group | null {
    if (selectedObjects.length < 2) return null

    const bbox = new THREE.Box3()
    selectedObjects.forEach(obj => bbox.expandByObject(obj))
    const centerVec = new THREE.Vector3()
    bbox.getCenter(centerVec)

    const group = new THREE.Group()
    group.name = 'Group_' + Math.random().toString(36).substring(2, 7)
    group.position.copy(centerVec)
    scene.add(group)

    selectedObjects.forEach(obj => group.attach(obj))

    return group
  }

  public ungroupSelected(scene: THREE.Scene, selectedObjects: THREE.Object3D[]): THREE.Object3D[] {
    const groups = selectedObjects.filter(o => o.type === 'Group')
    if (groups.length === 0) return selectedObjects

    const newSelected: THREE.Object3D[] = []

    selectedObjects.forEach(obj => {
      if (obj.type === 'Group') {
        const children = [...obj.children]
        children.forEach(child => {
          scene.attach(child)
          newSelected.push(child)
        })
        scene.remove(obj)
      } else {
        newSelected.push(obj)
      }
    })

    return newSelected
  }

  public registerMesh(mesh: THREE.Mesh): void {
    this.meshes.push(mesh)
  }

  public unregisterMesh(mesh: THREE.Mesh): void {
    const idx = this.meshes.indexOf(mesh)
    if (idx !== -1) this.meshes.splice(idx, 1)
  }
}
