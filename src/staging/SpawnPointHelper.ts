import * as THREE from 'three'
import type { SpawnPoint } from '../types'

export class SpawnPointHelper {
  public group: THREE.Group
  private mainMaterial: THREE.MeshBasicMaterial
  private fillMaterial: THREE.MeshBasicMaterial

  constructor() {
    this.group = new THREE.Group()
    this.group.name = '__spawn_point_indicator__'
    this.group.rotation.order = 'YXZ'

    const mainColor = 0x5a5a66
    const fillColor = 0x888896

    this.mainMaterial = new THREE.MeshBasicMaterial({
      color: mainColor,
      wireframe: false,
      transparent: true,
      opacity: 0.80,
      depthTest: true,
      side: THREE.DoubleSide
    })

    this.fillMaterial = new THREE.MeshBasicMaterial({
      color: fillColor,
      transparent: true,
      opacity: 0.20,
      depthTest: true,
      side: THREE.DoubleSide
    })

    this.buildGraphics()
  }

  private buildGraphics(): void {
    // 1. Outer Floor Ring (Radius 0.75)
    const ringGeom = new THREE.RingGeometry(0.6, 0.75, 32)
    ringGeom.rotateX(-Math.PI / 2)
    const ringMesh = new THREE.Mesh(ringGeom, this.mainMaterial)
    ringMesh.position.y = 0.02
    ringMesh.name = '__spawn_point_mesh__'
    this.group.add(ringMesh)

    // 2. Inner Filled Circle
    const circleGeom = new THREE.CircleGeometry(0.6, 32)
    circleGeom.rotateX(-Math.PI / 2)
    const circleMesh = new THREE.Mesh(circleGeom, this.fillMaterial)
    circleMesh.position.y = 0.01
    circleMesh.name = '__spawn_point_mesh__'
    this.group.add(circleMesh)

    // 3. Direction Arrow pointing along +Z
    const arrowGroup = new THREE.Group()
    arrowGroup.name = '__spawn_point_mesh__'

    // Arrow Shaft
    const shaftGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 16)
    shaftGeom.rotateX(Math.PI / 2)
    shaftGeom.translate(0, 0, 0.4)
    const shaftMesh = new THREE.Mesh(shaftGeom, this.mainMaterial)
    shaftMesh.position.y = 0.03
    shaftMesh.name = '__spawn_point_mesh__'
    arrowGroup.add(shaftMesh)

    // Arrow Head
    const coneGeom = new THREE.ConeGeometry(0.18, 0.35, 16)
    coneGeom.rotateX(Math.PI / 2)
    coneGeom.translate(0, 0, 0.85)
    const coneMesh = new THREE.Mesh(coneGeom, this.mainMaterial)
    coneMesh.position.y = 0.03
    coneMesh.name = '__spawn_point_mesh__'
    arrowGroup.add(coneMesh)

    this.group.add(arrowGroup)

    // 4. Vertical Marker Pole & Avatar Head (Taller: 2.3m height so head sticks out above actors)
    const poleGeom = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 16)
    poleGeom.translate(0, 1.1, 0)
    const poleMesh = new THREE.Mesh(poleGeom, this.mainMaterial)
    poleMesh.name = '__spawn_point_mesh__'
    this.group.add(poleMesh)

    const headGeom = new THREE.SphereGeometry(0.22, 16, 16)
    headGeom.translate(0, 2.3, 0)
    const headMesh = new THREE.Mesh(headGeom, this.mainMaterial)
    headMesh.name = '__spawn_point_mesh__'
    this.group.add(headMesh)
  }

  public setScale(scale: number): void {
    const s = Math.max(0.1, scale)
    this.group.scale.set(s, s, s)
  }

  public setSpawnPoint(sp?: SpawnPoint): void {
    const px = sp?.px ?? 0.0
    const py = sp?.py ?? 0.0
    const pz = sp?.pz ?? 2.0
    const ry = sp?.ry ?? 0.0

    this.group.position.set(px, py, pz)
    this.group.rotation.set(0, ry, 0, 'YXZ')
    this.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry)
  }

  public getSpawnPoint(): SpawnPoint {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion)
    const ry = Math.atan2(forward.x, forward.z)
    return {
      px: Math.round(this.group.position.x * 1000) / 1000,
      py: Math.round(this.group.position.y * 1000) / 1000,
      pz: Math.round(this.group.position.z * 1000) / 1000,
      ry: Math.round(ry * 1000) / 1000,
    }
  }

  public isSpawnPointObject(obj: THREE.Object3D | null): boolean {
    if (!obj) return false
    let curr: THREE.Object3D | null = obj
    while (curr) {
      if (curr === this.group || curr.name === '__spawn_point_indicator__') {
        return true
      }
      curr = curr.parent
    }
    return false
  }

  public dispose(): void {
    this.mainMaterial.dispose()
    this.fillMaterial.dispose()
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
      }
    })
  }
}
