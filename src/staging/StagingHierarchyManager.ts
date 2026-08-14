import * as THREE from 'three'
import type { SceneState, SceneNode, CubeTransform } from '../types'
import type { InstancedStageMesh } from './InstancedStageMesh'

function r2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

export class StagingHierarchyManager {
  private sharedUnitBoxGeo: THREE.BoxGeometry
  private sharedInvisibleMat: THREE.MeshBasicMaterial

  constructor() {
    this.sharedUnitBoxGeo = new THREE.BoxGeometry(1, 1, 1)
    this.sharedInvisibleMat = new THREE.MeshBasicMaterial({ visible: false })
  }

  public createBlockMesh(transform: CubeTransform): THREE.Mesh {
    const mesh = new THREE.Mesh(this.sharedUnitBoxGeo, this.sharedInvisibleMat)
    mesh.userData.isBlock = true
    mesh.name = 'Block'

    mesh.position.set(transform.px, transform.py, transform.pz)
    mesh.rotation.set(transform.rx, transform.ry, transform.rz)
    mesh.scale.set(transform.sx, transform.sy, transform.sz)

    return mesh
  }

  public buildNodeFromData(nodeData: SceneNode): THREE.Object3D {
    if (nodeData.type === 'block') {
      const mesh = this.createBlockMesh(nodeData.transform)
      mesh.uuid = nodeData.id || mesh.uuid
      if (nodeData.name) mesh.name = nodeData.name
      return mesh
    } else {
      const group = new THREE.Group()
      group.userData.isGroup = true
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

  public getVirtualRootObjects(scene: THREE.Scene): THREE.Object3D[] {
    return scene.children.filter(child => child.userData.isBlock === true || child.userData.isGroup === true)
  }

  public getAllVirtualBlocks(sceneOrObjects: THREE.Scene | THREE.Object3D[]): THREE.Mesh[] {
    const blocks: THREE.Mesh[] = []
    const roots = Array.isArray(sceneOrObjects) ? sceneOrObjects : sceneOrObjects.children

    roots.forEach(root => {
      if (root.userData.isBlock === true) {
        blocks.push(root as THREE.Mesh)
      } else if (root.userData.isGroup === true) {
        root.traverse(child => {
          if (child.userData.isBlock === true) {
            blocks.push(child as THREE.Mesh)
          }
        })
      }
    })

    return blocks
  }

  public updateMesh(
    scene: THREE.Scene,
    state: SceneState,
    clearSelectionFn: () => void,
    transformControlsHelper: THREE.Object3D,
    instancedMesh?: InstancedStageMesh
  ): void {
    clearSelectionFn()

    const objectsToRemove: THREE.Object3D[] = []
    scene.children.forEach(child => {
      if (child.userData.isBlock === true || child.userData.isGroup === true) {
        objectsToRemove.push(child)
      }
    })
    objectsToRemove.forEach(obj => scene.remove(obj))

    if (state.nodes && state.nodes.length > 0) {
      state.nodes.forEach(nodeData => {
        const obj = this.buildNodeFromData(nodeData)
        scene.add(obj)
      })
    }

    if (instancedMesh) {
      const virtualBlocks = this.getAllVirtualBlocks(scene)
      instancedMesh.syncFromVirtualBlocks(virtualBlocks)
    }

    this.syncState(scene, state, transformControlsHelper, null)
  }

  public serializeObjectToNode(
    obj: THREE.Object3D,
    transformControlsHelper: THREE.Object3D,
    multiSelectionPivot: THREE.Group | null
  ): SceneNode | null {
    if (obj.userData.isBlock === true) {
      const mesh = obj as THREE.Mesh
      return {
        id: mesh.uuid,
        type: 'block',
        name: mesh.name || 'Block',
        transform: {
          px: r2(mesh.position.x), py: r2(mesh.position.y), pz: r2(mesh.position.z),
          rx: r2(mesh.rotation.x), ry: r2(mesh.rotation.y), rz: r2(mesh.rotation.z),
          sx: r2(mesh.scale.x), sy: r2(mesh.scale.y), sz: r2(mesh.scale.z)
        }
      }
    } else if (
      obj.userData.isGroup === true &&
      obj !== transformControlsHelper &&
      obj !== multiSelectionPivot
    ) {
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
          px: r2(group.position.x), py: r2(group.position.y), pz: r2(group.position.z),
          rx: r2(group.rotation.x), ry: r2(group.rotation.y), rz: r2(group.rotation.z),
          sx: r2(group.scale.x), sy: r2(group.scale.y), sz: r2(group.scale.z)
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

    scene.children.forEach(child => {
      const node = this.serializeObjectToNode(child, transformControlsHelper, multiSelectionPivot)
      if (node) {
        nodes.push(node)
      }
    })

    const totalBlocks = nodes.reduce((sum, n) => sum + this.countBlocks(n), 0)

    state.nodes = nodes
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
    group.userData.isGroup = true
    group.name = 'Group_' + Math.random().toString(36).substring(2, 7)
    group.position.copy(centerVec)
    scene.add(group)

    selectedObjects.forEach(obj => group.attach(obj))

    return group
  }

  public ungroupSelected(scene: THREE.Scene, selectedObjects: THREE.Object3D[]): THREE.Object3D[] {
    const groups = selectedObjects.filter(o => o.userData.isGroup === true || o.type === 'Group')
    if (groups.length === 0) return selectedObjects

    const newSelected: THREE.Object3D[] = []

    selectedObjects.forEach(obj => {
      if (obj.userData.isGroup === true || obj.type === 'Group') {
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

  public dispose(): void {
    this.sharedUnitBoxGeo.dispose()
    this.sharedInvisibleMat.dispose()
  }
}
