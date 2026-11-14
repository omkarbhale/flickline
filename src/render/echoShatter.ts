import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, type ShaderMaterial } from 'three';
import { Rng } from '../core/rng';
import type { Subscribable } from '../core/eventBus';
import type { EchoTunables } from '../config/echo';
import type { SimEvents } from '../sim/types';
import { BIAS_FLOATS, KILL_FLOATS, SEED_FLOATS, ShardRing } from './shardRing';

/**
 * Kill shatter (design section 11): `shards` quads burst from the kill's hit point, pushed away
 * from the shooter. One pooled instanced draw; every shard's motion is evaluated in the vertex
 * shader from (origin, birth time, seed), so a kill is a handful of float writes and an upload of
 * a few kilobytes, with no allocation. The mesh draws nothing while idle.
 */
export class EchoShatter {
  readonly mesh: Mesh;
  readonly ring: ShardRing;
  private readonly geometry: InstancedBufferGeometry;
  private readonly killAttr: InstancedBufferAttribute;
  private readonly biasAttr: InstancedBufferAttribute;
  private shards: number;
  private now = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private readonly off: () => void;

  constructor(
    private readonly cfg: EchoTunables['shatter'],
    material: ShaderMaterial,
    bus: Subscribable<SimEvents>,
    shards: number,
  ) {
    this.shards = shards;
    const rng = new Rng(0x5ea7);
    this.ring = new ShardRing(cfg.killCapacity, cfg.shardsPerKill, () => rng.next());
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.killAttr = new InstancedBufferAttribute(this.ring.kill, KILL_FLOATS);
    this.biasAttr = new InstancedBufferAttribute(this.ring.bias, BIAS_FLOATS);
    this.killAttr.setUsage(DynamicDrawUsage);
    this.biasAttr.setUsage(DynamicDrawUsage);
    g.setAttribute('aKill', this.killAttr);
    g.setAttribute('aBias', this.biasAttr);
    g.setAttribute('aSeed', new InstancedBufferAttribute(this.ring.seed, SEED_FLOATS));
    g.instanceCount = 0;
    this.geometry = g;
    this.mesh = new Mesh(g as unknown as BufferGeometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.off = bus.on('targetKilled', (e) => this.onKilled(e.point.x, e.point.y, e.point.z));
  }

  /** Shards per kill, clamped to what the ring reserves (quality preset). */
  setShardCount(n: number): void {
    this.shards = Math.max(0, Math.min(this.cfg.shardsPerKill, Math.floor(n)));
  }

  /** The shooter's position: shards are pushed away from it. */
  setViewer(x: number, y: number, z: number): void {
    this.vx = x; this.vy = y; this.vz = z;
  }

  private onKilled(x: number, y: number, z: number): void {
    let dx = x - this.vx, dy = y - this.vy, dz = z - this.vz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-4) { dx /= len; dy /= len; dz /= len; } else { dx = 0; dy = 0; dz = -1; }
    this.ring.spawn(x, y, z, this.now, dx, dy, dz, this.shards);
    this.killAttr.needsUpdate = true;
    this.biasAttr.needsUpdate = true;
    this.geometry.instanceCount = this.ring.instances;
  }

  /** Advance to time `now` (seconds on the Echo clock); hides the mesh once every shard has landed. */
  update(now: number): void {
    this.now = now;
    this.geometry.instanceCount = this.ring.active(now, this.cfg.lifeSec) ? this.ring.instances : 0;
  }

  dispose(): void {
    this.off();
    this.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
