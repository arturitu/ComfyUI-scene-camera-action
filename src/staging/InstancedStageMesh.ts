import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as config from '../threeConfig'

const INITIAL_CAPACITY = 64
const ZERO_MATRIX = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)

export class InstancedStageMesh {
  private group: THREE.Group
  private surfaceMesh!: THREE.InstancedMesh
  private edgeLines!: THREE.LineSegments
  private edgeGeometry!: THREE.EdgesGeometry
  private unitBoxGeometry!: THREE.BoxGeometry
  private surfaceMaterial!: THREE.MeshStandardMaterial
  private edgeMaterial!: THREE.ShaderMaterial
  private interleavedBuffer!: THREE.InstancedInterleavedBuffer

  private capacity: number = INITIAL_CAPACITY
  private _count: number = 0

  private nodeToInstanceMap: Map<string, number> = new Map()
  private instanceToNodeMap: (THREE.Object3D | null)[] = []

  constructor(initialCapacity = INITIAL_CAPACITY) {
    this.capacity = Math.max(INITIAL_CAPACITY, initialCapacity)
    this.group = new THREE.Group()
    this.group.name = '__instanced_stage_group__'

    this.initGeometriesAndMaterials()
    this.allocateBuffers(this.capacity)
  }

  private initGeometriesAndMaterials(): void {
    this.unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1)
    this.edgeGeometry = new THREE.EdgesGeometry(this.unitBoxGeometry)

    this.surfaceMaterial = config.createBlockMaterial()

    this.edgeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        diffuse: { value: new THREE.Color(config.EDGE_COLOR) },
        opacity: { value: config.EDGE_OPACITY },
        ...THREE.UniformsLib.fog,
      },
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec4 instanceMatrix0;
        attribute vec4 instanceMatrix1;
        attribute vec4 instanceMatrix2;
        attribute vec4 instanceMatrix3;
        void main() {
          mat4 instanceMatrix = mat4(instanceMatrix0, instanceMatrix1, instanceMatrix2, instanceMatrix3);
          vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
          vec4 mvPosition = viewMatrix * worldPosition;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform vec3 diffuse;
        uniform float opacity;
        void main() {
          vec4 diffuseColor = vec4(diffuse, opacity);
          gl_FragColor = diffuseColor;
          #include <fog_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
  }

  private allocateBuffers(newCapacity: number): void {
    const oldMatrices = this.surfaceMesh ? new Float32Array(this.surfaceMesh.instanceMatrix.array) : null
    const oldCount = this._count

    if (this.surfaceMesh) {
      this.group.remove(this.surfaceMesh)
      this.surfaceMesh.dispose()
    }
    if (this.edgeLines) {
      this.group.remove(this.edgeLines)
      this.edgeLines.geometry.dispose()
    }

    this.capacity = newCapacity

    // 1. Solid Faces InstancedMesh
    this.surfaceMesh = new THREE.InstancedMesh(this.unitBoxGeometry, this.surfaceMaterial, this.capacity)
    this.surfaceMesh.name = '__stage_instanced_surface__'
    this.surfaceMesh.castShadow = true
    this.surfaceMesh.receiveShadow = true
    this.surfaceMesh.count = oldCount
    this.surfaceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    // 2. Edge Outlines Instanced LineSegments using InstancedInterleavedBuffer
    const instancedEdgeGeo = new THREE.InstancedBufferGeometry()
    instancedEdgeGeo.index = this.edgeGeometry.index
    instancedEdgeGeo.attributes.position = this.edgeGeometry.attributes.position

    this.interleavedBuffer = new THREE.InstancedInterleavedBuffer(
      this.surfaceMesh.instanceMatrix.array as Float32Array,
      16
    )
    this.interleavedBuffer.setUsage(THREE.DynamicDrawUsage)

    instancedEdgeGeo.setAttribute('instanceMatrix0', new THREE.InterleavedBufferAttribute(this.interleavedBuffer, 4, 0))
    instancedEdgeGeo.setAttribute('instanceMatrix1', new THREE.InterleavedBufferAttribute(this.interleavedBuffer, 4, 4))
    instancedEdgeGeo.setAttribute('instanceMatrix2', new THREE.InterleavedBufferAttribute(this.interleavedBuffer, 4, 8))
    instancedEdgeGeo.setAttribute('instanceMatrix3', new THREE.InterleavedBufferAttribute(this.interleavedBuffer, 4, 12))
    instancedEdgeGeo.instanceCount = oldCount

    this.edgeLines = new THREE.LineSegments(instancedEdgeGeo, this.edgeMaterial)
    this.edgeLines.name = '__stage_instanced_edges__'
    this.edgeLines.frustumCulled = false

    // Initialize all matrices to zero matrices so unused slots never render ghost geometry
    for (let i = 0; i < this.capacity; i++) {
      this.surfaceMesh.setMatrixAt(i, ZERO_MATRIX)
    }

    if (oldMatrices && oldCount > 0) {
      const copyCount = Math.min(oldCount, this.capacity)
      for (let i = 0; i < copyCount; i++) {
        const mat = new THREE.Matrix4().fromArray(oldMatrices, i * 16)
        this.surfaceMesh.setMatrixAt(i, mat)
      }
    }

    this.surfaceMesh.instanceMatrix.needsUpdate = true
    this.interleavedBuffer.needsUpdate = true

    const isVis = oldCount > 0
    this.group.visible = isVis
    this.surfaceMesh.visible = isVis
    this.edgeLines.visible = isVis

    this.group.add(this.surfaceMesh)
    this.group.add(this.edgeLines)
  }

  public ensureCapacity(requiredCount: number): void {
    if (requiredCount > this.capacity) {
      let nextCap = this.capacity
      while (nextCap < requiredCount) {
        nextCap *= 2
      }
      this.allocateBuffers(nextCap)
    }
  }

  public getGroup(): THREE.Group {
    return this.group
  }

  public getSurfaceMesh(): THREE.InstancedMesh {
    return this.surfaceMesh
  }

  public get count(): number {
    return this._count
  }

  public setCount(newCount: number): void {
    this.ensureCapacity(newCount)
    this._count = newCount
    this.surfaceMesh.count = newCount
    ;(this.edgeLines.geometry as THREE.InstancedBufferGeometry).instanceCount = newCount

    const isVis = newCount > 0
    this.group.visible = isVis
    this.surfaceMesh.visible = isVis
    this.edgeLines.visible = isVis
  }

  public setInstance(index: number, matrix: THREE.Matrix4, virtualNode?: THREE.Object3D): void {
    if (index >= this.capacity) {
      this.ensureCapacity(index + 1)
    }
    this.surfaceMesh.setMatrixAt(index, matrix)
    if (virtualNode) {
      this.nodeToInstanceMap.set(virtualNode.uuid, index)
      this.instanceToNodeMap[index] = virtualNode
    }
  }

  public getInstanceMatrix(index: number, matrix: THREE.Matrix4): void {
    this.surfaceMesh.getMatrixAt(index, matrix)
  }

  public getNodeByInstanceId(instanceId: number): THREE.Object3D | null {
    if (instanceId < 0 || instanceId >= this._count) return null
    return this.instanceToNodeMap[instanceId] || null
  }

  public getInstanceIdByNodeUuid(uuid: string): number | undefined {
    return this.nodeToInstanceMap.get(uuid)
  }

  public updateMatrices(): void {
    this.surfaceMesh.instanceMatrix.needsUpdate = true
    if (this.interleavedBuffer) {
      this.interleavedBuffer.needsUpdate = true
    }
    if (this._count > 0) {
      this.surfaceMesh.computeBoundingBox()
      this.surfaceMesh.computeBoundingSphere()
    }
  }

  public clear(): void {
    this._count = 0
    this.surfaceMesh.count = 0
    ;(this.edgeLines.geometry as THREE.InstancedBufferGeometry).instanceCount = 0

    for (let i = 0; i < this.capacity; i++) {
      this.surfaceMesh.setMatrixAt(i, ZERO_MATRIX)
    }

    this.group.visible = false
    this.surfaceMesh.visible = false
    this.edgeLines.visible = false

    this.updateMatrices()
    this.nodeToInstanceMap.clear()
    this.instanceToNodeMap = []
  }

  public syncFromVirtualBlocks(blocks: THREE.Object3D[]): void {
    if (!blocks || blocks.length === 0) {
      this.clear()
      return
    }

    this.ensureCapacity(blocks.length)
    this.nodeToInstanceMap.clear()
    this.instanceToNodeMap = new Array(blocks.length)

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      block.updateWorldMatrix(true, false)
      this.surfaceMesh.setMatrixAt(i, block.matrixWorld)
      this.nodeToInstanceMap.set(block.uuid, i)
      this.instanceToNodeMap[i] = block
    }

    // Zero out unused slots
    for (let i = blocks.length; i < this.capacity; i++) {
      this.surfaceMesh.setMatrixAt(i, ZERO_MATRIX)
    }

    this.setCount(blocks.length)
    this.updateMatrices()
  }

  public getMergedColliderGeometry(includeFloor = true): THREE.BufferGeometry | null {
    const geometries: THREE.BufferGeometry[] = []

    if (includeFloor) {
      const floorBox = new THREE.BoxGeometry(100, 0.1, 100)
      floorBox.translate(0, -0.05, 0)
      geometries.push(floorBox)
    }

    const mat = new THREE.Matrix4()
    for (let i = 0; i < this._count; i++) {
      this.surfaceMesh.getMatrixAt(i, mat)
      const geom = this.unitBoxGeometry.clone()
      geom.applyMatrix4(mat)
      geometries.push(geom)
    }

    if (geometries.length === 0) return null
    return BufferGeometryUtils.mergeGeometries(geometries)
  }

  public dispose(): void {
    if (this.surfaceMesh) {
      this.surfaceMesh.dispose()
    }
    if (this.edgeLines) {
      this.edgeLines.geometry.dispose()
    }
    if (this.unitBoxGeometry) {
      this.unitBoxGeometry.dispose()
    }
    if (this.edgeGeometry) {
      this.edgeGeometry.dispose()
    }
    if (this.surfaceMaterial) {
      this.surfaceMaterial.dispose()
    }
    if (this.edgeMaterial) {
      this.edgeMaterial.dispose()
    }
    this.nodeToInstanceMap.clear()
    this.instanceToNodeMap = []
  }
}
