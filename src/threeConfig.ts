import * as THREE from 'three'

export const BACKGROUND_COLOR = 0x88888f

// Camera Config
export const CAMERA_FOV = 45
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 200
export const CAMERA_MIN_DISTANCE = 1.5
export const CAMERA_MAX_DISTANCE = 65.0
export const MAX_PAN = 42.0

// Fog Config
export const FOG_NEAR = 1
export const FOG_FAR = 160

// Grid Helper Config
export const GRID_SIZE = 100
export const GRID_DIVISIONS = 50
export const GRID_COLOR_CENTER = 0x77777f
export const GRID_COLOR_GRID = 0x88888e

// Ambient Light Config
export const AMBIENT_LIGHT_COLOR = 0xffffff
export const AMBIENT_LIGHT_INTENSITY = 0.5

// Directional Light Config
export const MAIN_LIGHT_COLOR = 0xffffff
export const MAIN_LIGHT_INTENSITY = 0.65
export const MAIN_LIGHT_OFFSET = new THREE.Vector3(-35, 55, 35)

// Shadow Settings (Smart Target-Tracking for 100x100m stage coverage)
export const SHADOW_MAP_WIDTH = 2048
export const SHADOW_MAP_HEIGHT = 2048
export const SHADOW_BIAS = -0.0001
export const SHADOW_NORMAL_BIAS = 0.02
export const SHADOW_FRUSTUM_SIZE = 50 // Covers 120x120m full stage bounds

// Hemisphere Light Config
export const HEMI_SKY_COLOR = 0xddeeff
export const HEMI_GROUND_COLOR = 0x666677
export const HEMI_LIGHT_INTENSITY = 0.5

// Fill Light Config
export const FILL_LIGHT_COLOR = 0x8fa2c4
export const FILL_LIGHT_INTENSITY = 0.45
export const FILL_LIGHT_POSITION = new THREE.Vector3(25, 25, -25)

// Edge Outline Config
export const EDGE_COLOR = 0x55555e
export const EDGE_OPACITY = 0.4

// Ground and Floor Height Config
export const GROUND_Y = 0.0
export const GRID_Y = 0.0
export const FLOOR_Y = -0.002
export const DEFAULT_ACTOR_ROTATION_Y = 0 // 0 degrees in radians (facing +Z)

// Floor Material Config
export const FLOOR_COLOR = 0xc9c9cf
export const FLOOR_ROUGHNESS = 1.0
export const FLOOR_METALNESS = 0.0

// Block Material Config
export const BLOCK_COLOR = 0xc9c9cf
export const BLOCK_ROUGHNESS = 1.0
export const BLOCK_METALNESS = 0.0

export function createBlockMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: BLOCK_COLOR,
    roughness: BLOCK_ROUGHNESS,
    metalness: BLOCK_METALNESS,
  })
}

/**
 * Calculates overall spatial extent (bounding size & offset) of scene content objects.
 */
export function calculateSceneExtent(
  target: THREE.Object3D | THREE.Object3D[] | null | undefined
): number {
  if (!target) return 15.0

  const bbox = new THREE.Box3()
  let hasObjects = false

  if (Array.isArray(target)) {
    target.forEach((obj) => {
      if (obj && obj.visible) {
        bbox.expandByObject(obj)
        hasObjects = true
      }
    })
  } else if (target) {
    if (target.children && target.children.length > 0) {
      target.children.forEach((child) => {
        if (child && child.visible) {
          bbox.expandByObject(child)
          hasObjects = true
        }
      })
    } else {
      bbox.setFromObject(target)
      hasObjects = true
    }
  }

  if (!hasObjects || bbox.isEmpty()) {
    return 15.0 // Default baseline scene extent
  }

  const size = new THREE.Vector3()
  bbox.getSize(size)
  const center = new THREE.Vector3()
  bbox.getCenter(center)

  const maxSpan = Math.max(size.x, size.z, size.y, 10.0)
  const centerDist = Math.sqrt(center.x * center.x + center.z * center.z)

  // Extent covers full span plus center offset from origin
  return Math.max(maxSpan, centerDist + maxSpan / 2, 15.0)
}

/**
 * Dynamically updates scene fog and camera far clipping plane based on camera position, target center, and scene extent.
 */
export function updateSceneFog(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sceneExtent: number,
  targetCenter?: THREE.Vector3
): { fogNear: number; fogFar: number; cameraFar: number } {
  const center = targetCenter || new THREE.Vector3(0, 0, 0)
  const cameraDistance = Math.max(1.0, camera.position.distanceTo(center))

  // Near fog starts in front of target center relative to camera distance (25% of camera distance)
  const fogNear = Math.max(1.0, cameraDistance * 0.25)

  // Far fog reaches 100% density past scene extent & camera distance, smoothly fading far floor grid into background gray
  const fogFar = Math.max(fogNear + 15.0, cameraDistance + Math.max(sceneExtent * 1.0, 15.0))

  // Camera far plane extends beyond fog.far so geometry is not clipped before full fog fade
  const cameraFar = Math.max(CAMERA_FAR, fogFar * 1.3)

  if (scene.fog && scene.fog instanceof THREE.Fog) {
    scene.fog.near = fogNear
    scene.fog.far = fogFar
  } else {
    const bgColor = new THREE.Color(BACKGROUND_COLOR)
    scene.fog = new THREE.Fog(bgColor, fogNear, fogFar)
  }

  if (camera.far !== cameraFar) {
    camera.far = cameraFar
    camera.updateProjectionMatrix()
  }

  return { fogNear, fogFar, cameraFar }
}


