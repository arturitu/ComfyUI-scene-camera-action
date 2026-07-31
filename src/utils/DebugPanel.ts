import GUI from 'lil-gui'
import type { ThreeActing } from '../ThreeActing'

const STORAGE_KEY = 'acting_debug_options'

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

    // 2. Actor Controls Folder
    const actorFolder = this.gui.addFolder('Actor Physics')
    const actorParams = {
      resetPos: () => {
        threeActing.resetActorPosition()
      },
    }
    actorFolder.add(actorParams, 'resetPos').name('Reset Actor to Origin')
    actorFolder.close()
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
