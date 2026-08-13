import * as THREE from 'three'
import type { SceneState, SceneNode, CubeTransform } from '../types'
import * as config from '../threeConfig'
import { StageEnvironment } from './StageEnvironment'

function r2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

export class StagingHierarchyManager {
  private meshes: THREE.Mesh[] = []

  public getMeshes(): THREE.Mesh[] {
    return this.meshes
  }

  public createBlockMesh(transform: CubeTransform): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const mesh = new THREE.Mesh(geometry, config.createBlockMaterial())

    mesh.position.set(transform.px, transform.py, transform.pz)
    mesh.rotation.set(transform.rx, transform.ry, transform.rz)
    mesh.scale.set(transform.sx, transform.sy, transform.sz)
    mesh.castShadow = true
    mesh.receiveShadow = true

    // Add subtle edge outlines for crisp shape definitions
    const edgesGeo = new THREE.EdgesGeometry(geometry)
    const edgeMat = new THREE.LineBasicMaterial({
      color: config.EDGE_COLOR,
      transparent: true,
      opacity: config.EDGE_OPACITY,
    })
    const lineEdges = new THREE.LineSegments(edgesGeo, edgeMat)
    lineEdges.name = '__edge_outline__'
    mesh.add(lineEdges)

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
      if (!StageEnvironment.isStageObject(child, transformControlsHelper)) {
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
    }

    this.syncState(scene, state, transformControlsHelper, null)
  }

  public serializeObjectToNode(
    obj: THREE.Object3D,
    transformControlsHelper: THREE.Object3D,
    multiSelectionPivot: THREE.Group | null
  ): SceneNode | null {
    if (obj.name === '__spawn_point_indicator__' || obj.name === '__spawn_point_mesh__') {
      return null
    }
    if (obj.type === 'Mesh' && obj.name !== 'floor') {
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
