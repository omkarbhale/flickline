import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { Subscribable } from '../core/eventBus';
import { Pool } from '../core/pool';
import type { SimEvents } from '../sim/types';

interface Fx {
  mesh: Mesh;
  age: number;
  life: number;
  size: number;
}

/**
 * Transient shot visuals (tracers and impact flashes) driven by sim events.
 * Everything is preallocated in pools; nothing is created per shot. If a pool is exhausted the
 * effect is simply skipped.
 */
export class ShotEffects {
  private readonly group = new Group();
  private readonly tracers: Pool<Fx>;
  private readonly impacts: Pool<Fx>;
  private readonly active: Fx[] = [];
  private readonly activeOwner: Pool<Fx>[] = [];
  private readonly offs: (() => void)[] = [];
  private readonly tracerMat = new MeshBasicMaterial({ color: 0xffe9a8, fog: false });
  private readonly hitMat = new MeshBasicMaterial({ color: 0xff7a5a, fog: false });
  private readonly missMat = new MeshBasicMaterial({ color: 0xfff3d0, fog: false });
  private readonly tracerGeo = new BoxGeometry(1, 1, 1);
  private readonly impactGeo = new SphereGeometry(1, 8, 6);
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  /** Recoil kick 0..1 for the viewmodel. */
  kick = 0;

  constructor(scene: Scene, bus: Subscribable<SimEvents>) {
    this.tracers = new Pool(24, () => this.makeFx(this.tracerGeo, this.tracerMat));
    this.impacts = new Pool(32, () => this.makeFx(this.impactGeo, this.missMat));
    scene.add(this.group);

    this.offs.push(
      bus.on('shotFired', (e) => {
        this.kick = 1;
        // Remember the muzzle for the matching impact event (emitted right after).
        const dx = e.dir.x, dz = e.dir.z;
        const hl = Math.sqrt(dx * dx + dz * dz) || 1;
        // muzzle = eye + right*0.2 - up*0.16 + forward*0.5
        this.muzzle.set(
          e.origin.x + (-dz / hl) * 0.2 + e.dir.x * 0.5,
          e.origin.y - 0.16 + e.dir.y * 0.5,
          e.origin.z + (dx / hl) * 0.2 + e.dir.z * 0.5,
        );
      }),
      bus.on('shotImpact', (e) => {
        this.spawnTracer(e.point.x, e.point.y, e.point.z);
        this.spawnImpact(e.point.x + e.normal.x * 0.02, e.point.y + e.normal.y * 0.02, e.point.z + e.normal.z * 0.02, e.onTarget);
      }),
    );
  }

  private readonly muzzle = new Vector3();

  private makeFx(geo: BoxGeometry | SphereGeometry, mat: MeshBasicMaterial): Fx {
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, age: 0, life: 0, size: 1 };
  }

  private spawnTracer(x: number, y: number, z: number): void {
    const fx = this.tracers.acquire();
    if (!fx) return;
    const a = this.muzzle;
    const b = this.tmpB.set(x, y, z);
    const mid = this.tmpA.copy(a).add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    fx.mesh.position.copy(mid);
    fx.mesh.lookAt(b);
    fx.size = 0.012;
    fx.mesh.scale.set(fx.size, fx.size, len);
    fx.mesh.visible = true;
    fx.age = 0;
    fx.life = 0.07;
    this.active.push(fx);
    this.activeOwner.push(this.tracers);
  }

  private spawnImpact(x: number, y: number, z: number, onTarget: boolean): void {
    const fx = this.impacts.acquire();
    if (!fx) return;
    fx.mesh.material = onTarget ? this.hitMat : this.missMat;
    fx.mesh.position.set(x, y, z);
    fx.size = onTarget ? 0.11 : 0.07;
    fx.mesh.scale.setScalar(fx.size);
    fx.mesh.visible = true;
    fx.age = 0;
    fx.life = 0.16;
    this.active.push(fx);
    this.activeOwner.push(this.impacts);
  }

  /** Advance animations by real frame time. */
  update(dt: number): void {
    this.kick = Math.max(0, this.kick - dt * 9);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i]!;
      fx.age += dt;
      const t = fx.age / fx.life;
      if (t >= 1) {
        fx.mesh.visible = false;
        this.activeOwner[i]!.release(fx);
        // swap-remove to avoid shifting
        const last = this.active.length - 1;
        this.active[i] = this.active[last]!;
        this.activeOwner[i] = this.activeOwner[last]!;
        this.active.length = last;
        this.activeOwner.length = last;
        continue;
      }
      const k = 1 - t;
      if (this.activeOwner[i] === this.tracers) {
        fx.mesh.scale.x = fx.mesh.scale.y = fx.size * k;
      } else {
        fx.mesh.scale.setScalar(fx.size * (1 + t * 0.8) * k);
      }
    }
  }

  dispose(): void {
    this.offs.forEach((f) => f());
    this.tracerGeo.dispose();
    this.impactGeo.dispose();
    this.tracerMat.dispose();
    this.hitMat.dispose();
    this.missMat.dispose();
  }
}
