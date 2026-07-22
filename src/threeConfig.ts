import * as THREE from 'three'

export const BACKGROUND_COLOR = 0xd3d3d7

// Fog Config
export const FOG_COLOR = BACKGROUND_COLOR
export const FOG_NEAR = 5
export const FOG_FAR = 40

// Grid Helper Config
export const GRID_SIZE = 100
export const GRID_DIVISIONS = 100
export const GRID_COLOR_CENTER = 0xaaaaaf
export const GRID_COLOR_GRID = 0xc5c5cb

// Ambient Light Config
export const AMBIENT_LIGHT_COLOR = 0xffffff
export const AMBIENT_LIGHT_INTENSITY = 0.6

// Directional Light Config
export const MAIN_LIGHT_COLOR = 0xffffff
export const MAIN_LIGHT_INTENSITY = 0.8
export const MAIN_LIGHT_OFFSET = new THREE.Vector3(15, 30, 15)

// Shadow Settings
export const SHADOW_MAP_WIDTH = 2048
export const SHADOW_MAP_HEIGHT = 2048
export const SHADOW_BIAS = -0.0001
export const SHADOW_NORMAL_BIAS = 0.015
export const SHADOW_FRUSTUM_SIZE = 15 // Covers 30x30m around the target

// Fill Light Config
export const FILL_LIGHT_COLOR = 0x3d4974
export const FILL_LIGHT_INTENSITY = 0.3
export const FILL_LIGHT_POSITION = new THREE.Vector3(-5, 3, -5)
