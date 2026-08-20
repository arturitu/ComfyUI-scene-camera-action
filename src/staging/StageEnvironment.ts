import * as THREE from 'three'
import * as config from '../threeConfig'
import { StagingHierarchyManager } from './StagingHierarchyManager'
import { InstancedStageMesh } from './InstancedStageMesh'
import type { SceneState } from '../types'

export interface StageSetupResult {
  ambientLight: THREE.AmbientLight
  hemiLight: THREE.HemisphereLight
  mainLight: THREE.DirectionalLight
  fillLight: THREE.DirectionalLight
  gridHelper: THREE.GridHelper
  floorMesh: THREE.Mesh
}

export class StageEnvironment {
  private hierarchyManager: StagingHierarchyManager

  constructor() {
    this.hierarchyManager = new StagingHierarchyManager()
  }

  /**
   * Initializes standard stage environment (Lights, Grid, and Floor plane) into targetScene.
   */
  public initStage(targetScene: THREE.Scene): StageSetupResult {
    // 1. Lights Setup
    const ambientLight = new THREE.AmbientLight(config.AMBIENT_LIGHT_COLOR, config.AMBIENT_LIGHT_INTENSITY)
    targetScene.add(ambientLight)

    const hemiLight = new THREE.HemisphereLight(
      config.HEMI_SKY_COLOR,
      config.HEMI_GROUND_COLOR,
      config.HEMI_LIGHT_INTENSITY
    )
    hemiLight.position.set(0, 50, 0)
    targetScene.add(hemiLight)

    const mainLight = new THREE.DirectionalLight(config.MAIN_LIGHT_COLOR, config.MAIN_LIGHT_INTENSITY)
    mainLight.position.copy(config.MAIN_LIGHT_OFFSET)
    mainLight.castShadow = true
    mainLight.shadow.mapSize.width = config.SHADOW_MAP_WIDTH
    mainLight.shadow.mapSize.height = config.SHADOW_MAP_HEIGHT
    mainLight.shadow.bias = config.SHADOW_BIAS
    mainLight.shadow.normalBias = config.SHADOW_NORMAL_BIAS

    const d = config.SHADOW_FRUSTUM_SIZE
    mainLight.shadow.camera.left = -d
    mainLight.shadow.camera.right = d
    mainLight.shadow.camera.top = d
    mainLight.shadow.camera.bottom = -d
    mainLight.shadow.camera.near = 0.5
    mainLight.shadow.camera.far = 200

    targetScene.add(mainLight)
    targetScene.add(mainLight.target)

    const fillLight = new THREE.DirectionalLight(config.FILL_LIGHT_COLOR, config.FILL_LIGHT_INTENSITY)
    fillLight.position.copy(config.FILL_LIGHT_POSITION)
    targetScene.add(fillLight)

    // 2. Base Setup (Grid & Floor)
    const gridHelper = new THREE.GridHelper(
      config.GRID_SIZE,
      config.GRID_DIVISIONS,
      config.GRID_COLOR_CENTER,
      config.GRID_COLOR_GRID
    )
    gridHelper.position.y = config.GRID_Y
    targetScene.add(gridHelper)

    const floorGeo = new THREE.PlaneGeometry(100, 100)
    const floorMat = new THREE.MeshStandardMaterial({
      color: config.FLOOR_COLOR,
      roughness: config.FLOOR_ROUGHNESS,
      metalness: config.FLOOR_METALNESS,
    })
    const floorMesh = new THREE.Mesh(floorGeo, floorMat)
    floorMesh.name = 'floor'
    floorMesh.rotation.x = -Math.PI / 2
    floorMesh.position.y = config.FLOOR_Y
    floorMesh.receiveShadow = true
    targetScene.add(floorMesh)

    return {
      ambientLight,
      hemiLight,
      mainLight,
      fillLight,
      gridHelper,
      floorMesh,
    }
  }

  /**
   * Builds an optimized InstancedStageMesh from sceneData into parentGroup.
   */
  public buildInstancedStage(
    sceneData: Partial<SceneState> | undefined,
    parentGroup: THREE.Group
  ): InstancedStageMesh {
    const instancedStageMesh = new InstancedStageMesh()

    if (sceneData && sceneData.nodes && sceneData.nodes.length > 0) {
      const virtualRoots: THREE.Object3D[] = []
      sceneData.nodes.forEach(nodeData => {
        const obj = this.hierarchyManager.buildNodeFromData(nodeData)
        virtualRoots.push(obj)
      })

      const virtualBlocks = this.hierarchyManager.getAllVirtualBlocks(virtualRoots)
      instancedStageMesh.syncFromVirtualBlocks(virtualBlocks)
    }

    parentGroup.add(instancedStageMesh.getGroup())
    return instancedStageMesh
  }

  /**
   * Backward-compatible helper to build stage objects into parentGroup.
   */
  public buildObjectsFromData(sceneData: Partial<SceneState> | undefined, parentGroup: THREE.Group): THREE.Mesh[] {
    const instancedStageMesh = this.buildInstancedStage(sceneData, parentGroup)
    return [instancedStageMesh.getSurfaceMesh()]
  }

  /**
   * Helper utility to identify standard stage elements (Lights, Floor, Grid, BoxHelpers, TransformControls).
   */
  public static isStageObject(object: THREE.Object3D, _transformControlsHelper?: THREE.Object3D): boolean {
    if (object.userData.isBlock === true || object.userData.isGroup === true) {
      return false
    }
    return true
  }
}
