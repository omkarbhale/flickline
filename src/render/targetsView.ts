import {
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three';
import { lerp } from '../core/math';
import { TICK_RATE } from '../core/time';
import { feedback } from '../config/feedback';
import type { Tunables } from '../config/tunables';
import type { World } from '../sim/world';

const BODY_COLOR = 0x6fa8c7;
const HEAD_COLOR = 0xd8f3ff;
const BEACON_COLOR = 0xff8a4d;
const FLASH_COLOR = 0xffffff;
/** White hit flash length (design §7.1: 60 ms). */
const FLASH_TICKS = Math.max(1, Math.round(feedback.targetFlashSec * TICK_RATE));

/**
 * PLACEHOLDER visuals for the roster (final Echo look is #18): one instanced capsule for a
 * humanoid's torso and legs, one instanced unlit sphere for its head node and for Beacon orbs.
 * Reads sim state only; hit detection never looks at these meshes (it uses `sim/hitZones.ts`).
 * `update` allocates nothing.
 */
export class TargetsView {
  readonly root = new Group();
  private readonly body: InstancedMesh;
  private readonly head: InstancedMesh;
  private readonly m4 = new Matrix4();
  private readonly color = new Color();
  private readonly lastId: Int32Array;
  private readonly flash: Uint8Array;
  private readonly shown: Uint8Array;

  constructor(
    private readonly tunables: Tunables,
    capacity: number,
  ) {
    const h = tunables.targets.hit;
    const torsoTop = h.torsoTopStand;
    // Torso + legs as one capsule, 0.25 m radius, floor to the torso top (arms count as body).
    const bodyGeo = new CapsuleGeometry(h.torsoWidth / 2, torsoTop - h.torsoWidth, 6, 14);
    this.body = new InstancedMesh(bodyGeo, new MeshLambertMaterial({ color: 0xffffff }), capacity);
    this.head = new InstancedMesh(new SphereGeometry(1, 18, 12), new MeshBasicMaterial({ color: 0xffffff }), capacity);
    for (const m of [this.body, this.head]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(35048); // DynamicDrawUsage
      m.count = capacity;
      this.root.add(m);
    }
    this.lastId = new Int32Array(capacity).fill(-2);
    this.flash = new Uint8Array(capacity);
    this.shown = new Uint8Array(capacity);
    // Start hidden (zero scale).
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.body.setMatrixAt(i, this.m4);
      this.head.setMatrixAt(i, this.m4);
      // Create the instance-colour attribute now so the shaders compile with it (no hitch later).
      this.body.setColorAt(i, this.color.setHex(BODY_COLOR));
      this.head.setColorAt(i, this.color.setHex(HEAD_COLOR));
    }
  }

  update(world: World, alpha: number): void {
    const h = this.tunables.targets.hit;
    const kinds = this.tunables.targets.kinds;
    const slots = world.targets;
    let colorDirty = false;
    let matrixDirty = false;
    for (let i = 0; i < slots.length; i++) {
      const t = slots[i]!;
      if (!t.alive) {
        if (this.shown[i]) {
          this.m4.makeScale(0, 0, 0);
          this.body.setMatrixAt(i, this.m4);
          this.head.setMatrixAt(i, this.m4);
          this.shown[i] = 0;
          this.lastId[i] = -2;
          matrixDirty = true;
        }
        continue;
      }
      const def = kinds[t.kind];
      const sway = lerp(t.prevSway, t.sway, alpha);
      if (def.shape === 'orb') {
        const r = def.orbRadius * t.scale;
        this.m4.makeScale(r, r, r).setPosition(t.pos.x, t.pos.y, t.pos.z);
        this.head.setMatrixAt(i, this.m4);
        this.m4.makeScale(0, 0, 0);
        this.body.setMatrixAt(i, this.m4);
      } else {
        const crouch = t.crouched;
        const top = crouch ? h.torsoTopCrouch : h.torsoTopStand;
        const sy = top / h.torsoTopStand;
        this.m4.makeScale(1, sy, 1).setPosition(t.pos.x + sway * 0.5, t.pos.y + top / 2, t.pos.z);
        this.body.setMatrixAt(i, this.m4);
        const r = h.headRadius;
        this.m4
          .makeScale(r, r, r)
          .setPosition(t.pos.x + sway, t.pos.y + (crouch ? h.headCentreCrouch : h.headCentreStand), t.pos.z);
        this.head.setMatrixAt(i, this.m4);
      }
      this.shown[i] = 1;
      matrixDirty = true;

      const age = world.tick - t.lastHitTick;
      const flashing = t.lastHitTick >= 0 && age < FLASH_TICKS ? 1 : 0;
      if (t.id !== this.lastId[i] || flashing !== this.flash[i]) {
        this.lastId[i] = t.id;
        this.flash[i] = flashing;
        this.body.setColorAt(i, this.color.setHex(flashing ? FLASH_COLOR : BODY_COLOR));
        this.head.setColorAt(i, this.color.setHex(flashing ? FLASH_COLOR : def.shape === 'orb' ? BEACON_COLOR : HEAD_COLOR));
        colorDirty = true;
      }
    }
    if (matrixDirty) {
      this.body.instanceMatrix.needsUpdate = true;
      this.head.instanceMatrix.needsUpdate = true;
    }
    if (colorDirty) {
      if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
      if (this.head.instanceColor) this.head.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of [this.body, this.head]) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
      m.dispose();
    }
  }
}
