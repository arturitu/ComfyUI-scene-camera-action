import * as THREE from 'three'

export const BACKGROUND_COLOR = 0x88888f

// Camera Config
export const CAMERA_FOV = 45
export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 200
export const CAMERA_MIN_DISTANCE = 1.5
export const CAMERA_MAX_DISTANCE = 65.0
export const MAX_PAN = 42.0

export interface CameraFovRange {
  min: number
  max: number
  default: number
}

export const CAMERA_FOV_CONFIG: Record<string, CameraFovRange> = {
  'Wide': { min: 20, max: 70, default: 45 },
  'Third Person': { min: 25, max: 85, default: 50 },
  'Side': { min: 20, max: 80, default: 45 },
  'First Person': { min: 40, max: 100, default: 50 },
}

export function getCameraFovConfig(mode: string): CameraFovRange {
  return CAMERA_FOV_CONFIG[mode] || { min: 20, max: 90, default: 50 }
}

export function getDefaultCameraFov(mode: string): number {
  return getCameraFovConfig(mode).default
}

export interface CameraDistanceRange {
  min: number
  max: number
  default: number
  step: number
}

export const CAMERA_DISTANCE_CONFIG: Record<string, CameraDistanceRange> = {
  'Wide': { min: 4, max: 80, default: 16, step: 1 },
  'Third Person': { min: 1.5, max: 15, default: 3.5, step: 0.1 },
  'Side': { min: 1.5, max: 20, default: 4.5, step: 0.1 },
  'First Person': { min: 0, max: 0, default: 0, step: 0 },
}

export function getCameraDistanceConfig(mode: string, isCar: boolean = false): CameraDistanceRange {
  const base = CAMERA_DISTANCE_CONFIG[mode] || { min: 1, max: 60, default: 10, step: 0.5 }
  if (isCar && (mode === 'Side' || mode === 'Third Person')) {
    return {
      min: 3.5,
      max: base.max,
      default: mode === 'Third Person' ? 6.5 : 6.5,
      step: base.step
    }
  }
  return base
}

export function getDefaultCameraDistance(mode: string, isCar: boolean = false): number {
  if (mode === 'Third Person') return isCar ? 6.5 : 3.5
  if (mode === 'Side') return isCar ? 6.5 : 4.5
  if (mode === 'Wide') return isCar ? 18.0 : 16.0
  return getCameraDistanceConfig(mode, isCar).default
}

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
 * Calculates overall spatial extent (bounding size & offset) of stage content objects.
 */
export function calculateStageExtent(
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
    return 15.0 // Default baseline stage extent
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
export const calculateSceneExtent = calculateStageExtent

/**
 * Dynamically updates scene fog and camera far clipping plane based on camera position, target center, and stage extent.
 */
export function updateStageFog(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  stageExtent: number,
  targetCenter?: THREE.Vector3
): { fogNear: number; fogFar: number; cameraFar: number } {
  const center = targetCenter || new THREE.Vector3(0, 0, 0)
  const cameraDistance = Math.max(1.0, camera.position.distanceTo(center))

  // Near fog starts in front of target center relative to camera distance (25% of camera distance)
  const fogNear = Math.max(1.0, cameraDistance * 0.25)

  // Far fog reaches 100% density past stage extent & camera distance, smoothly fading far floor grid into background gray
  const fogFar = Math.max(fogNear + 15.0, cameraDistance + Math.max(stageExtent * 1.0, 15.0))

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
export const updateSceneFog = updateStageFog

// ==========================================
// SpringArm Camera Collision & Anti-Occlusion
// ==========================================
export const SPRING_ARM_COLLISION_RADIUS = 0.22 // Multi-probe sweep radius around camera
export const SPRING_ARM_SAFETY_MARGIN = 0.25    // Safety clearance in front of hit obstacles
export const SPRING_ARM_MIN_DISTANCE = 0.55     // Absolute minimum distance from actor center
export const SPRING_ARM_OTS_THRESHOLD = 1.25    // Distance threshold to blend into Over-The-Shoulder
export const SPRING_ARM_ZOOM_IN_SPEED = 26.0    // Fast snap response when obstacle enters
export const SPRING_ARM_ZOOM_OUT_SPEED = 4.5    // Smooth damped recovery when obstacle clears

// Stage Fade Config (Rounded Box / Cuadrado con bordes redondeados)
export const STAGE_FADE_ENABLED = true
export const STAGE_FADE_INNER_RADIUS = 40.0
export const STAGE_FADE_OUTER_RADIUS = 50.0
export const STAGE_FADE_CORNER_RADIUS = 10.0

export const stageFadeUniforms = {
  uStageFadeEnabled: { value: STAGE_FADE_ENABLED ? 1.0 : 0.0 },
  uStageFadeInnerRadius: { value: STAGE_FADE_INNER_RADIUS },
  uStageFadeOuterRadius: { value: STAGE_FADE_OUTER_RADIUS },
  uStageFadeCornerRadius: { value: STAGE_FADE_CORNER_RADIUS },
  uStageFadeBgColor: { value: new THREE.Color(BACKGROUND_COLOR) },
}

/**
 * Injects a 4x4 screen-space Bayer dither pattern discard logic and rounded-box stage boundary fade into a THREE.Material.
 * This guarantees zero alpha-sorting or depth-buffer artifacts while smoothly fading occluding geometry
 * and seamlessly blending outer stage edges into the background color.
 */
export function injectDitherShader(
  material: THREE.Material,
  uniformHolder?: { uDitherOpacity: { value: number } }
): { uDitherOpacity: { value: number } } {
  const ditherUniform = uniformHolder || { uDitherOpacity: { value: 1.0 } }

  const originalOnBeforeCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    if (originalOnBeforeCompile) {
      originalOnBeforeCompile(shader, renderer)
    }

    shader.uniforms.uDitherOpacity = ditherUniform.uDitherOpacity
    shader.uniforms.uStageFadeEnabled = stageFadeUniforms.uStageFadeEnabled
    shader.uniforms.uStageFadeInnerRadius = stageFadeUniforms.uStageFadeInnerRadius
    shader.uniforms.uStageFadeOuterRadius = stageFadeUniforms.uStageFadeOuterRadius
    shader.uniforms.uStageFadeCornerRadius = stageFadeUniforms.uStageFadeCornerRadius
    shader.uniforms.uStageFadeBgColor = stageFadeUniforms.uStageFadeBgColor

    const ditherVertexPars = `
      attribute float instanceDither;
      varying float vInstanceDither;
      varying vec3 vStageWorldPos;
    `
    shader.vertexShader = ditherVertexPars + '\n' + shader.vertexShader

    if (shader.vertexShader.includes('#include <begin_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vInstanceDither = (instanceDither > 0.0) ? instanceDither : 1.0;`
      )
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `void main() {
        vInstanceDither = (instanceDither > 0.0) ? instanceDither : 1.0;`
      )
    }

    if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vStageWorldPos = (modelMatrix * (instanceMatrix * vec4(transformed, 1.0))).xyz;
        #else
          vStageWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`
      )
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `void main() {
        #ifdef USE_INSTANCING
          vStageWorldPos = (modelMatrix * (instanceMatrix * vec4(position, 1.0))).xyz;
        #else
          vStageWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif`
      )
    }

    const ditherFunction = `
      uniform float uDitherOpacity;
      uniform float uStageFadeEnabled;
      uniform float uStageFadeInnerRadius;
      uniform float uStageFadeOuterRadius;
      uniform float uStageFadeCornerRadius;
      uniform vec3 uStageFadeBgColor;
      varying float vInstanceDither;
      varying vec3 vStageWorldPos;

      float getStageRoundedBoxDist(vec2 p) {
        float cr = clamp(uStageFadeCornerRadius, 0.0, uStageFadeOuterRadius);
        float s = max(0.0, uStageFadeOuterRadius - cr);
        vec2 q = max(abs(p) - vec2(s), vec2(0.0));
        if (q.x > 0.0 && q.y > 0.0) {
          return s + length(q);
        }
        return max(abs(p.x), abs(p.y));
      }

      float getDitherThreshold(vec2 pos) {
        int x = int(mod(pos.x, 4.0));
        int y = int(mod(pos.y, 4.0));
        if (x == 0) {
          if (y == 0) return 0.0625;
          if (y == 1) return 0.8125;
          if (y == 2) return 0.25;
          return 1.0;
        } else if (x == 1) {
          if (y == 0) return 0.5625;
          if (y == 1) return 0.3125;
          if (y == 2) return 0.75;
          return 0.5;
        } else if (x == 2) {
          if (y == 0) return 0.1875;
          if (y == 1) return 0.9375;
          if (y == 2) return 0.125;
          return 0.875;
        } else {
          if (y == 0) return 0.6875;
          if (y == 1) return 0.4375;
          if (y == 2) return 0.625;
          return 0.375;
        }
      }
    `

    shader.fragmentShader = ditherFunction + '\n' + shader.fragmentShader

    const ditherDiscardSnippet = `
      if (uStageFadeEnabled > 0.5) {
        float distBox = getStageRoundedBoxDist(vStageWorldPos.xz);
        if (distBox >= uStageFadeOuterRadius) {
          discard;
        }
      }
      float effDither = uDitherOpacity * (vInstanceDither > 0.0 ? vInstanceDither : 1.0);
      if (effDither < 0.999 && effDither < getDitherThreshold(gl_FragCoord.xy)) {
        discard;
      }
    `

    if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        ${ditherDiscardSnippet}`
      )
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `void main() {
        ${ditherDiscardSnippet}`
      )
    }

    const stageFadeColorBlendSnippet = `
      if (uStageFadeEnabled > 0.5) {
        float distBox = getStageRoundedBoxDist(vStageWorldPos.xz);
        float fadeFactor = smoothstep(uStageFadeInnerRadius, uStageFadeOuterRadius, distBox);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uStageFadeBgColor, fadeFactor);
      }
    `

    if (shader.fragmentShader.includes('#include <colorspace_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <colorspace_fragment>',
        `${stageFadeColorBlendSnippet}
        #include <colorspace_fragment>`
      )
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor =',
        `${stageFadeColorBlendSnippet}
        gl_FragColor =`
      )
    }
  }

  material.needsUpdate = true
  return ditherUniform
}
export const injectStageShader = injectDitherShader

/**
 * Injects rounded-box distance fade into Line materials (such as GridHelper).
 */
export function injectGridFadeShader(material: THREE.Material): void {
  const originalOnBeforeCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    if (originalOnBeforeCompile) {
      originalOnBeforeCompile(shader, renderer)
    }

    shader.uniforms.uStageFadeEnabled = stageFadeUniforms.uStageFadeEnabled
    shader.uniforms.uStageFadeInnerRadius = stageFadeUniforms.uStageFadeInnerRadius
    shader.uniforms.uStageFadeOuterRadius = stageFadeUniforms.uStageFadeOuterRadius
    shader.uniforms.uStageFadeCornerRadius = stageFadeUniforms.uStageFadeCornerRadius

    const vertexPars = `
      varying vec3 vGridWorldPos;
    `
    shader.vertexShader = vertexPars + '\n' + shader.vertexShader

    if (shader.vertexShader.includes('#include <begin_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGridWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      )
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `void main() {
        vGridWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
      )
    }

    const fragmentPars = `
      uniform float uStageFadeEnabled;
      uniform float uStageFadeInnerRadius;
      uniform float uStageFadeOuterRadius;
      uniform float uStageFadeCornerRadius;
      varying vec3 vGridWorldPos;

      float getGridRoundedBoxDist(vec2 p) {
        float cr = clamp(uStageFadeCornerRadius, 0.0, uStageFadeOuterRadius);
        float s = max(0.0, uStageFadeOuterRadius - cr);
        vec2 q = max(abs(p) - vec2(s), vec2(0.0));
        if (q.x > 0.0 && q.y > 0.0) {
          return s + length(q);
        }
        return max(abs(p.x), abs(p.y));
      }
    `
    shader.fragmentShader = fragmentPars + '\n' + shader.fragmentShader

    const gridFadeSnippet = `
      if (uStageFadeEnabled > 0.5) {
        float distBox = getGridRoundedBoxDist(vGridWorldPos.xz);
        if (distBox >= uStageFadeOuterRadius) {
          discard;
        }
        float lineFade = 1.0 - smoothstep(uStageFadeInnerRadius, uStageFadeOuterRadius, distBox);
        diffuseColor.a *= lineFade;
        if (diffuseColor.a < 0.005) {
          discard;
        }
      }
    `

    if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        ${gridFadeSnippet}`
      )
    } else if (shader.fragmentShader.includes('#include <colorspace_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <colorspace_fragment>',
        `${gridFadeSnippet}
        #include <colorspace_fragment>`
      )
    }
  }

  material.transparent = true
  material.needsUpdate = true
}
