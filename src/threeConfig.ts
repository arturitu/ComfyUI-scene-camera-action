import * as THREE from 'three'

export const BACKGROUND_COLOR = 0x88888f

// Camera Config
export const CAMERA_FOV = 45
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 200
export const CAMERA_MIN_DISTANCE = 1.5
export const CAMERA_MAX_DISTANCE = 65.0
export const MAX_PAN = 25.0

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
export const MAIN_LIGHT_OFFSET = new THREE.Vector3(35, 60, 35)

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
export const FILL_LIGHT_POSITION = new THREE.Vector3(-15, 20, -15)

// Edge Outline Config
export const EDGE_COLOR = 0x66666f
export const EDGE_OPACITY = 0.50

// Ground and Floor Height Config
export const GROUND_Y = 0.0
export const GRID_Y = 0.0
export const FLOOR_Y = -0.002
export const DEFAULT_ACTOR_ROTATION_Y = Math.PI / 2 // 90 degrees in radians (facing Right)

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
