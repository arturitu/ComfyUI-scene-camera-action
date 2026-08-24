import GUI from 'lil-gui'
import type { ThreeActing } from '../ThreeActing'
import * as config from '../threeConfig'

const STORAGE_KEY = 'acting_debug_options'
const STAGE_FADE_STORAGE_KEY = 'stage_fade_options'

export class DebugPanel {
  private gui: GUI
  private container: HTMLElement

  constructor(parentContainer: HTMLElement, title = '3D Debug Controls') {
    this.container = parentContainer

    this.gui = new GUI({
      container: parentContainer,
      title: title,
      autoPlace: false,
    })

    const domElement = this.gui.domElement
    domElement.style.position = 'absolute'
    domElement.style.top = '10px'
    domElement.style.right = '10px'
    domElement.style.zIndex = '100'
    domElement.style.borderRadius = '6px'
    domElement.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)'

    // Closed by default so it doesn't clutter canvas
    this.gui.close()

    this.setupStageFadeControls()
  }

  private loadSavedFadeConfig() {
    try {
      const saved = localStorage.getItem(STAGE_FADE_STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch (e) {
      // Ignore storage errors
    }
    return null
  }

  private saveFadeConfig(params: { enabled: boolean; innerRadius: number; outerRadius: number; cornerRadius: number }) {
    try {
      localStorage.setItem(STAGE_FADE_STORAGE_KEY, JSON.stringify(params))
    } catch (e) {
      // Ignore storage errors
    }
  }

  private setupStageFadeControls(): void {
    const saved = this.loadSavedFadeConfig()
    if (saved) {
      if (typeof saved.enabled === 'boolean') {
        config.stageFadeUniforms.uStageFadeEnabled.value = saved.enabled ? 1.0 : 0.0
      }
      if (typeof saved.innerRadius === 'number') {
        config.stageFadeUniforms.uStageFadeInnerRadius.value = saved.innerRadius
      }
      if (typeof saved.outerRadius === 'number') {
        config.stageFadeUniforms.uStageFadeOuterRadius.value = saved.outerRadius
      }
      if (typeof saved.cornerRadius === 'number') {
        config.stageFadeUniforms.uStageFadeCornerRadius.value = saved.cornerRadius
      }
    }

    const fadeFolder = this.gui.addFolder('Stage Edge Fade')
    const fadeParams = {
      enabled: config.stageFadeUniforms.uStageFadeEnabled.value > 0.5,
      innerRadius: config.stageFadeUniforms.uStageFadeInnerRadius.value,
      outerRadius: config.stageFadeUniforms.uStageFadeOuterRadius.value,
      cornerRadius: config.stageFadeUniforms.uStageFadeCornerRadius.value,
    }

    fadeFolder
      .add(fadeParams, 'enabled')
      .name('Fade Enabled')
      .onChange((val: boolean) => {
        config.stageFadeUniforms.uStageFadeEnabled.value = val ? 1.0 : 0.0
        this.saveFadeConfig(fadeParams)
      })

    fadeFolder
      .add(fadeParams, 'innerRadius', 0, 100, 1)
      .name('Inner Extent (m)')
      .onChange((val: number) => {
        config.stageFadeUniforms.uStageFadeInnerRadius.value = val
        this.saveFadeConfig(fadeParams)
      })

    fadeFolder
      .add(fadeParams, 'outerRadius', 5, 120, 1)
      .name('Outer Extent (m)')
      .onChange((val: number) => {
        config.stageFadeUniforms.uStageFadeOuterRadius.value = val
        this.saveFadeConfig(fadeParams)
      })

    fadeFolder
      .add(fadeParams, 'cornerRadius', 0, 50, 1)
      .name('Corner Radius (m)')
      .onChange((val: number) => {
        config.stageFadeUniforms.uStageFadeCornerRadius.value = val
        this.saveFadeConfig(fadeParams)
      })

    fadeFolder.close()
  }

  private loadSavedConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch (e) {
      // Ignore storage errors
    }
    return null
  }

  private saveConfig(params: Record<string, boolean>) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params))
    } catch (e) {
      // Ignore storage errors
    }
  }

  /**
   * Attach controls for ThreeActing scene instance
   */
  public attachThreeActing(threeActing: ThreeActing): void {
    const saved = this.loadSavedConfig()

    const bvhParams = {
      displayBVH: saved?.displayBVH ?? threeActing.getDisplayBVH(),
      displayCollider: saved?.displayCollider ?? threeActing.getDisplayCollider(),
      displayActorCollider: saved?.displayActorCollider ?? threeActing.getDisplayActorCollider(),
    }

    // Apply saved options to ThreeActing instance immediately
    if (saved) {
      threeActing.setDisplayBVH(bvhParams.displayBVH)
      threeActing.setDisplayCollider(bvhParams.displayCollider)
      threeActing.setDisplayActorCollider(bvhParams.displayActorCollider)
    }

    // 1. BVH & Physics Colliders Folder
    const bvhFolder = this.gui.addFolder('BVH & Colliders')

    bvhFolder
      .add(bvhParams, 'displayBVH')
      .name('Show BVH Bounding Boxes')
      .onChange((val: boolean) => {
        threeActing.setDisplayBVH(val)
        this.saveConfig(bvhParams)
      })

    bvhFolder
      .add(bvhParams, 'displayCollider')
      .name('Show Wireframe Mesh')
      .onChange((val: boolean) => {
        threeActing.setDisplayCollider(val)
        this.saveConfig(bvhParams)
      })

    bvhFolder
      .add(bvhParams, 'displayActorCollider')
      .name('Show Actor Collider')
      .onChange((val: boolean) => {
        threeActing.setDisplayActorCollider(val)
        this.saveConfig(bvhParams)
      })

    bvhFolder.close()

    // 2. Actor Physics Folder
    const actorFolder = this.gui.addFolder('Actor Physics')
    const actorParams = {
      resetPos: () => {
        threeActing.resetActorPosition()
      },
    }
    actorFolder.add(actorParams, 'resetPos').name('Reset Actor to Origin')
    actorFolder.close()

    // 3. Actor Real-Time Status Monitor
    const monitorFolder = this.gui.addFolder('Actor Real-Time Status')
    const monitorState = {
      animation: 'None',
      activeKeys: 'None',
      isGrounded: true,
    }

    monitorFolder.add(monitorState, 'animation').name('Anim Playing').listen().disable()
    monitorFolder.add(monitorState, 'activeKeys').name('Active Keys').listen().disable()
    monitorFolder.add(monitorState, 'isGrounded').name('Is Grounded').listen().disable()

    let monitorAnimationFrameId: number | null = null

    const updateMonitor = () => {
      const actor = threeActing.getActorController()
      if (actor) {
        if ('getCurrentAnimationName' in actor && typeof (actor as any).getCurrentAnimationName === 'function') {
          monitorState.animation = (actor as any).getCurrentAnimationName()
        } else {
          monitorState.animation = 'Base'
        }
        monitorState.isGrounded = actor.isOnGround
      }
      const keys = (threeActing as any).keysPressed || {}
      const activeList = Object.keys(keys).filter((k) => keys[k])
      monitorState.activeKeys = activeList.length > 0 ? activeList.join(', ') : 'None'

      monitorAnimationFrameId = requestAnimationFrame(updateMonitor)
    }
    monitorAnimationFrameId = requestAnimationFrame(updateMonitor)
  }

  public toggle(): void {
    if (this.gui.domElement.style.display === 'none') {
      this.gui.domElement.style.display = 'block'
    } else {
      this.gui.domElement.style.display = 'none'
    }
  }

  public getGUI(): GUI {
    return this.gui
  }

  public dispose(): void {
    this.gui.destroy()
  }
}
