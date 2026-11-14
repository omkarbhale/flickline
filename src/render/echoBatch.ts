import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, type ShaderMaterial } from 'three';
import type { EchoMeshData } from './echoModel';
import { STATE_FLOATS, writeInstanceMatrix } from './echoInstance';

/** Vertex attributes of an Echo-family mesh (see `echoMaterial.ts`). */
function createGeometry(data: EchoMeshData, capacity: number): { geometry: BufferGeometry; state: InstancedBufferAttribute } {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(data.position, 3));
  g.setAttribute('aPosC', new Float32BufferAttribute(data.positionC, 3));
  g.setAttribute('normal', new Float32BufferAttribute(data.normal, 3));
  g.setAttribute('aSmooth', new Float32BufferAttribute(data.smooth, 3));
  g.setAttribute('aCent', new Float32BufferAttribute(data.centroid, 3));
  g.setAttribute('aCentC', new Float32BufferAttribute(data.centroidC, 3));
  g.setAttribute('aMeta', new Float32BufferAttribute(data.meta, 2));
  const state = new InstancedBufferAttribute(new Float32Array(capacity * STATE_FLOATS), STATE_FLOATS);
  state.setUsage(DynamicDrawUsage);
  g.setAttribute('aState', state);
  return { geometry: g, state };
}

/**
 * All instances of one enemy type: ONE draw call for the bodies, plus one for the outline hull
 * when it is on. Filled compactly each frame (`begin`, `add` per visible enemy, `end`), so the
 * instance count is exactly what is on screen and an idle batch draws nothing. Nothing here
 * allocates after construction.
 */
export class EnemyBatch {
  readonly mesh: InstancedMesh;
  readonly hull: InstancedMesh;
  readonly capacity: number;
  /** Instances written this frame. */
  count = 0;
  private prevCount = 0;
  private hullOn = false;
  private readonly matrices: Float32Array;
  private readonly state: InstancedBufferAttribute;
  private readonly stateArr: Float32Array;

  constructor(data: EchoMeshData, material: ShaderMaterial, hullMaterial: ShaderMaterial, capacity: number) {
    this.capacity = capacity;
    const { geometry, state } = createGeometry(data, capacity);
    this.state = state;
    this.stateArr = state.array as Float32Array;
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.hull = new InstancedMesh(geometry, hullMaterial, capacity);
    // The hull draws the same instances: share the matrix buffer (and the geometry's state buffer).
    this.hull.instanceMatrix = this.mesh.instanceMatrix;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
    for (const m of [this.mesh, this.hull]) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.count = 0;
    }
  }

  /** Outline on/off. Off = zero instances (the object stays in the scene so its shader is compiled). */
  setOutline(on: boolean): void {
    this.hullOn = on;
    this.hull.count = on ? this.count : 0;
  }

  begin(): void {
    this.count = 0;
  }

  /** Add one instance; ignored when full. `x,y,z` = feet centre (humanoid) or centre (orb). */
  add(x: number, y: number, z: number, yaw: number, flash: number, dissolve: number, crouch: number, lean: number): void {
    const i = this.count;
    if (i >= this.capacity) return;
    writeInstanceMatrix(this.matrices, i, x, y, z, yaw);
    const o = i * STATE_FLOATS;
    this.stateArr[o] = flash;
    this.stateArr[o + 1] = dissolve;
    this.stateArr[o + 2] = crouch;
    this.stateArr[o + 3] = lean;
    this.count = i + 1;
  }

  end(): void {
    this.mesh.count = this.count;
    this.hull.count = this.hullOn ? this.count : 0;
    if (this.count > 0 || this.prevCount > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.state.needsUpdate = true;
    }
    this.prevCount = this.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    (this.hull.material as ShaderMaterial).dispose();
    this.mesh.dispose();
    this.hull.dispose();
  }
}
