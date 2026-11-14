import {
  CanvasTexture, DoubleSide, Group, LineBasicMaterial, LineSegments, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, PlaneGeometry,
  SRGBColorSpace, type Scene,
} from 'three';
import { palette } from '../config/palette';
import { drawDoorFace, FACE_H, FACE_W, type DoorFacts } from './gateGlyphs';
import type { RenderFrame, RenderLayer } from './gameRenderer';

/** Geometry and numbers the view needs from `config/sweep.ts` `gate` (structural, so render does not import the config's owner). */
export interface GateViewConfig {
  doors: readonly [{ x: number; z: number }, { x: number; z: number }];
  doorHalfWidthM: number;
  commitSec: number;
  shieldRefillTo: number;
  hotMultiplier: number;
  hotExtraContacts: number;
}

/** Titles a light or eco sector's door announces (`sweep.conditionCopy`). */
export type ConditionTitles = Readonly<Record<'light' | 'eco', string>>;

/** Door opening height in the gate map (the lintel's underside, `levels/gate.json`). */
const DOOR_HEIGHT_M = 2.6;
/** How far in front of the door plane the faces hang, so they never z-fight the lintel's face. */
const FACE_LIFT_M = 0.06;

interface DoorView {
  face: Mesh;
  faceMat: MeshBasicMaterial;
  tex: CanvasTexture;
  canvas: HTMLCanvasElement;
  shutter: Mesh;
  frame: LineSegments;
}

/**
 * The gate's two doors (design §4.5, #205): each hangs a **face** in its doorway, the three facts and
 * the stake of the sector behind it, drawn once when the gate is entered (`gateGlyphs.ts`). When a
 * door is walked through the other one's **shutter** drops over its doorway and its face dims, so
 * the closing reads in the world and not in a menu. Everything is built once; `update` moves two
 * numbers, so it allocates nothing.
 */
export class GateView implements RenderLayer {
  private readonly root = new Group();
  private readonly doors: DoorView[] = [];
  private readonly frameMat = new LineBasicMaterial({ color: palette.trim, transparent: true, opacity: 0.9, fog: false });
  private readonly shutterMat = new MeshBasicMaterial({ color: palette.ink, side: DoubleSide, fog: false });
  /** Seconds since a door was chosen (-1: none chosen) and which one. */
  private chosenAt = -1;
  private chosen = -1;
  private time = 0;

  constructor(private readonly scene: Scene, private readonly cfg: GateViewConfig, private readonly titles?: ConditionTitles) {
    const w = cfg.doorHalfWidthM * 2;
    const faceGeo = new PlaneGeometry(w - 0.12, DOOR_HEIGHT_M - 0.1);
    const shutterGeo = new PlaneGeometry(w, DOOR_HEIGHT_M);
    // The doorway's outline in trim light.
    const hw = cfg.doorHalfWidthM;
    const outline = new BufferGeometry();
    outline.setAttribute('position', new Float32BufferAttribute([
      -hw, 0, 0, -hw, DOOR_HEIGHT_M, 0, -hw, DOOR_HEIGHT_M, 0, hw, DOOR_HEIGHT_M, 0, hw, DOOR_HEIGHT_M, 0, hw, 0, 0,
    ], 3));
    for (let d = 0; d < 2; d++) {
      const door = cfg.doors[d]!;
      const canvas = document.createElement('canvas');
      canvas.width = FACE_W;
      canvas.height = FACE_H;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      const faceMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
      const face = new Mesh(faceGeo, faceMat);
      face.position.set(door.x, DOOR_HEIGHT_M / 2, door.z + FACE_LIFT_M);
      face.renderOrder = 6;
      const shutter = new Mesh(shutterGeo, this.shutterMat);
      shutter.position.set(door.x, DOOR_HEIGHT_M / 2, door.z + FACE_LIFT_M / 2);
      shutter.scale.y = 0.0001;
      shutter.renderOrder = 5;
      const frame = new LineSegments(outline, this.frameMat);
      frame.position.set(door.x, 0, door.z + FACE_LIFT_M * 1.5);
      this.root.add(shutter, face, frame);
      this.doors.push({ face, faceMat, tex, canvas, shutter, frame });
    }
    this.root.visible = false;
    scene.add(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** The gate is entered: draw each door's face from its facts and show both doors open. */
  show(facts: readonly [DoorFacts, DoorFacts]): void {
    const opts = { shieldTo: this.cfg.shieldRefillTo, hotMult: this.cfg.hotMultiplier, hotExtra: this.cfg.hotExtraContacts, conditionTitles: this.titles };
    for (let d = 0; d < 2; d++) {
      const v = this.doors[d]!;
      drawDoorFace(v.canvas.getContext('2d')!, facts[d]!, opts);
      v.tex.needsUpdate = true;
      v.faceMat.opacity = 1;
      v.shutter.scale.y = 0.0001;
    }
    this.chosen = -1;
    this.chosenAt = -1;
    this.root.visible = true;
  }

  /** A door was walked through: the other one closes. */
  choose(door: 0 | 1): void {
    this.chosen = door;
    this.chosenAt = this.time;
  }

  hide(): void {
    this.root.visible = false;
    this.chosen = -1;
  }

  /** Progress (0..1) of the other door's closing, for tests and the debug hook. */
  get closing(): number {
    return this.chosen < 0 ? 0 : Math.min(1, (this.time - this.chosenAt) / Math.max(1e-3, this.cfg.commitSec * 0.7));
  }

  update(frame: RenderFrame): void {
    if (!this.root.visible) return;
    this.time += frame.dt;
    if (this.chosen < 0) return;
    const p = this.closing;
    // Ease-out: the shutter drops fast, then settles.
    const e = 1 - (1 - p) * (1 - p);
    const other = this.doors[1 - this.chosen]!;
    other.shutter.scale.y = Math.max(0.0001, e);
    // Anchored at the lintel: it grows downwards.
    other.shutter.position.y = DOOR_HEIGHT_M - (DOOR_HEIGHT_M * other.shutter.scale.y) / 2;
    other.faceMat.opacity = 1 - 0.85 * e;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const v of this.doors) {
      v.tex.dispose();
      v.faceMat.dispose();
    }
    this.doors[0]?.face.geometry.dispose();
    this.doors[0]?.shutter.geometry.dispose();
    this.doors[0]?.frame.geometry.dispose();
    this.frameMat.dispose();
    this.shutterMat.dispose();
  }
}
