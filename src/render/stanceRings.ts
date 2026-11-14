import {
  AdditiveBlending, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, type BufferGeometry, type Scene,
} from 'three';
import { palette, stanceRingColours } from '../config/palette';
import type { StanceRingTunables } from '../config/stanceRing';
import type { RenderFrame, RenderLayer } from './gameRenderer';

const SLOTS = 2;

/** One ring: a floor disc, a lower band, and (crouch only) an upper band, each drawn twice (solid, and a dim see-through pass). */
interface Ring {
  readonly group: Group;
  readonly upper: Mesh;
  readonly ghostUpper: Mesh;
  /** Every material of the ring: they all take the ring's colour. */
  readonly materials: MeshBasicMaterial[];
}

/**
 * The stance rings of Stop & Pop as a render layer: up to two (a double), shown, judged and hidden
 * by events (`stanceRingShown/Judged/Hidden`) through `show`, `judge` and `hide`. Nothing moves, so
 * `update` does nothing and nothing is allocated after construction.
 *
 * Stand = one white band, crouch = two blue bands, so the stance reads without colour; a judged
 * ring turns `ok` or `alert`. The Lane's half-wall stops hide a Post's feet from most strafing
 * positions, and the ring is information, not scenery, so each ring is drawn twice: solid where
 * it is in view and as a dim ghost through whatever hides it.
 */
export class StanceRings implements RenderLayer {
  private readonly rings: Ring[] = [];
  private readonly geometries: BufferGeometry[] = [];

  constructor(scene: Scene, cfg: StanceRingTunables) {
    const band = new CylinderGeometry(cfg.radiusM, cfg.radiusM, cfg.bandHeightM, cfg.segments, 1, true);
    const floor = new RingGeometry(cfg.floorInnerM, cfg.radiusM, cfg.segments);
    floor.rotateX(-Math.PI / 2);
    this.geometries.push(band, floor);
    for (let i = 0; i < SLOTS; i++) {
      const group = new Group();
      group.visible = false;
      const materials: MeshBasicMaterial[] = [];
      const meshes: Mesh[] = [];
      const add = (geo: BufferGeometry, opacity: number, ghost: boolean, y: number): Mesh => {
        const material = new MeshBasicMaterial({
          color: stanceRingColours.stand, transparent: true, opacity: ghost ? opacity * cfg.ghostShare : opacity,
          blending: AdditiveBlending, depthWrite: false, depthTest: !ghost, side: DoubleSide, fog: false, toneMapped: false,
        });
        const m = new Mesh(geo, material);
        m.position.y = y;
        m.renderOrder = ghost ? 4 : 3;
        m.frustumCulled = false;
        materials.push(material);
        meshes.push(m);
        group.add(m);
        return m;
      };
      const lowerY = cfg.liftM + cfg.bandHeightM / 2;
      const upperY = cfg.liftM + cfg.bandHeightM * 1.5 + cfg.bandGapM;
      add(floor, cfg.floorOpacity, false, cfg.liftM);
      add(band, cfg.bandOpacity, false, lowerY);
      const upper = add(band, cfg.bandOpacity, false, upperY);
      add(floor, cfg.floorOpacity, true, cfg.liftM);
      add(band, cfg.bandOpacity, true, lowerY);
      const ghostUpper = add(band, cfg.bandOpacity, true, upperY);
      scene.add(group);
      this.rings.push({ group, upper, ghostUpper, materials });
    }
  }

  /** Put the ring of `slot` at a target's feet: blue and double-banded when `crouch`, else white and single. */
  show(slot: number, crouch: boolean, x: number, y: number, z: number): void {
    const r = this.rings[slot];
    if (!r) return;
    r.group.position.set(x, y, z);
    r.upper.visible = r.ghostUpper.visible = crouch;
    this.paint(r, crouch ? stanceRingColours.crouch : stanceRingColours.stand);
    r.group.visible = true;
  }

  /** The first bullet was judged: the ring turns green (right stance, below the deadzone) or red (it was not). */
  judge(slot: number, ok: boolean): void {
    const r = this.rings[slot];
    if (r) this.paint(r, ok ? palette.ok : palette.alert);
  }

  hide(slot: number): void {
    const r = this.rings[slot];
    if (r) r.group.visible = false;
  }

  hideAll(): void {
    for (let i = 0; i < SLOTS; i++) this.hide(i);
  }

  /** Whether the ring of `slot` is up (the debug snapshot). */
  visible(slot: number): boolean {
    return this.rings[slot]?.group.visible ?? false;
  }

  update(_frame: RenderFrame): void {}

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const r of this.rings) {
      for (const m of r.materials) m.dispose();
      r.group.removeFromParent();
    }
  }

  private paint(r: Ring, color: number): void {
    for (const m of r.materials) m.color.setHex(color);
  }
}
