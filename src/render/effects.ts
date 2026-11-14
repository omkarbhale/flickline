import {
  AdditiveBlending,
  DoubleSide,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import type { FeedbackTunables } from '../config/feedback';
import {
  IMPACT_HIT,
  IMPACT_KILL,
  TRACER_MOVING,
  TRACER_NORMAL,
  type ShotCues,
} from '../feedback/shotCues';

/*
 * Per-shot world effects (design §7.1 "See", §11 "Effects"). All state lives in the pure cue model
 * (feedback/shotCues.ts); this file turns the active cues into GPU instance buffers once per
 * frame. Everything is preallocated: typed arrays, scratch vectors, four instanced draws
 * (tracer strips, billboard sparks and ghost ring, decals, shard triangles). The muzzle flash is
 * drawn on the viewmodel (render/viewmodel.ts), not here.
 * Nothing is created per shot, and an idle effect hides its mesh so it costs no draw call.
 */

const NEAR_CLIP = 0.05;

/** Camera-facing strip from A to B (tracers and the miss arrow). Dashed when aParams.y > 0.5. */
export const TRACER_VERT = /* glsl */ `
uniform float uMinPx;
uniform float uViewportH;
attribute vec3 aA;
attribute vec3 aB;
attribute vec3 aColor;
attribute vec4 aParams; // alpha, dashed, width, unused
varying vec3 vColor;
varying float vAlpha;
varying float vAcross;
varying float vAlong;
varying float vDashed;
void main() {
  if (aParams.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float along = position.y + 0.5;
  vec3 a = (viewMatrix * vec4(aA, 1.0)).xyz;
  vec3 b = (viewMatrix * vec4(aB, 1.0)).xyz;
  // Clip the segment to the near plane so a flick past the tracer cannot flip the strip.
  if (a.z > -${NEAR_CLIP.toFixed(2)} && b.z > -${NEAR_CLIP.toFixed(2)}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float len = length(aB - aA);
  if (a.z > -${NEAR_CLIP.toFixed(2)}) a = mix(a, b, (-${NEAR_CLIP.toFixed(2)} - a.z) / (b.z - a.z));
  if (b.z > -${NEAR_CLIP.toFixed(2)}) b = mix(b, a, (-${NEAR_CLIP.toFixed(2)} - b.z) / (a.z - b.z));
  vec3 p = mix(a, b, along);
  vec2 d = b.xy - a.xy;
  float l = length(d);
  vec2 dir = l > 1e-6 ? d / l : vec2(0.0, 1.0);
  // Never thinner than uMinPx pixels, so a 0.014 m strip stays visible at 20 m.
  float minWorld = uMinPx * (-p.z) * 2.0 / (projectionMatrix[1][1] * uViewportH);
  p.xy += vec2(-dir.y, dir.x) * position.x * max(aParams.z, minWorld);
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vColor = aColor;
  vAlpha = aParams.x;
  vAcross = position.x * 2.0;
  vAlong = along * len;
  vDashed = aParams.y;
}`;

export const TRACER_FRAG = /* glsl */ `
uniform float uDash;
varying vec3 vColor;
varying float vAlpha;
varying float vAcross;
varying float vAlong;
varying float vDashed;
void main() {
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vAcross));
  float dash = mix(1.0, step(0.45, fract(vAlong / uDash)), vDashed);
  gl_FragColor = vec4(vColor * (1.0 + 0.6 * edge), vAlpha * edge * dash);
  #include <colorspace_fragment>
}`;

/** Camera-facing billboards: kind 0 = spark (glow + 4-point star), 1 = thin ring (miss ghost). */
export const SPRITE_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aColor;
attribute vec4 aParams; // size, alpha, kind, rotation
varying vec3 vColor;
varying vec2 vP;
varying float vAlpha;
varying float vKind;
void main() {
  if (aParams.y <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float c = cos(aParams.w);
  float s = sin(aParams.w);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  mv.xy += q * aParams.x;
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vP = position.xy * 2.0;
  vAlpha = aParams.y;
  vKind = aParams.z;
}`;

export const SPRITE_FRAG = /* glsl */ `
varying vec3 vColor;
varying vec2 vP;
varying float vAlpha;
varying float vKind;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float a;
  if (vKind < 0.5) {
    float glow = exp(-r * r * 7.0);
    float star = exp(-abs(vP.x) * 9.0 - abs(vP.y) * 38.0) + exp(-abs(vP.y) * 9.0 - abs(vP.x) * 38.0);
    a = clamp(glow + star, 0.0, 1.0);
  } else {
    float ring = exp(-pow((r - 0.86) * 14.0, 2.0));
    a = ring * 0.95 + (1.0 - smoothstep(0.0, 0.86, r)) * 0.08;
  }
  gl_FragColor = vec4(vColor, a * vAlpha);
  #include <colorspace_fragment>
}`;

/** Dark soft disc stuck to a surface; fades by aFade. Uses the instance matrix directly. */
const DECAL_VERT = /* glsl */ `
attribute float aFade;
varying vec2 vP;
varying float vFade;
void main() {
  vec4 mv = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    mv = instanceMatrix * mv;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * mv;
  vP = position.xy * 2.0;
  vFade = aFade;
}`;

const DECAL_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vP;
varying float vFade;
void main() {
  float r = length(vP);
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * 0.65 * vFade;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

/** Kill shatter: each shard is one triangle whose motion is computed from (seed, birth) here. */
const SHARD_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aDir;
attribute vec3 aSeed; // kill seed, shard index, birth time (renderer clock, s)
uniform float uTime;
uniform float uLife;
uniform float uMinSpeed;
uniform float uMaxSpeed;
uniform float uSize;
uniform float uGravity;
uniform vec3 uColor;
varying vec3 vColor;
varying float vAlpha;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  float t = uTime - aSeed.z;
  float k = t / uLife;
  if (aSeed.z < 0.0 || k < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = aSeed.x * 17.0 + aSeed.y * 3.7;
  vec3 rnd = vec3(hash(s + 1.0), hash(s + 2.0), hash(s + 3.0)) * 2.0 - 1.0;
  vec3 dir = normalize(rnd + aDir * 0.7 + vec3(0.0, 0.25, 0.0));
  float speed = mix(uMinSpeed, uMaxSpeed, hash(s + 4.0));
  vec3 pos = aOrigin + dir * speed * (t - 0.5 * t * t / uLife) + vec3(0.0, -uGravity * 0.5 * t * t, 0.0);
  float size = uSize * (0.6 + hash(s + 5.0) * 0.9) * (1.0 - k * k);
  float ang = hash(s + 6.0) * 6.2831 + t * (hash(s + 7.0) * 2.0 - 1.0) * 18.0;
  vec2 q = vec2(cos(ang) * position.x - sin(ang) * position.y, sin(ang) * position.x + cos(ang) * position.y);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  mv.xy += q * size;
  gl_Position = projectionMatrix * mv;
  vColor = mix(vec3(1.0, 0.96, 0.86), uColor, smoothstep(0.0, 0.3, k));
  vAlpha = 1.0 - k * k;
}`;

const SHARD_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
  #include <colorspace_fragment>
}`;

/** One unit quad as the base of an instanced strip or billboard (shared with `render/enemyFx.ts`). */
export function strip(): InstancedBufferGeometry {
  const plane = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  return g;
}

export function instAttr(
  g: InstancedBufferGeometry,
  name: string,
  count: number,
  size: number,
  registry: InstancedBufferAttribute[],
): Float32Array {
  const a = new InstancedBufferAttribute(new Float32Array(count * size), size);
  g.setAttribute(name, a);
  registry.push(a);
  return a.array as Float32Array;
}

export function fxMaterial(
  vertex: string,
  fragment: string,
  uniforms: ShaderMaterial['uniforms'],
  additive: boolean,
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
    fog: false,
  });
}

export class ShotEffects {
  private readonly cfg: FeedbackTunables;
  private readonly root: Object3D[] = [];

  // Tracer strips (+ the miss arrow in the last slot).
  private readonly tracerGeo = strip();
  private readonly tracerMesh: Mesh;
  private readonly tA: Float32Array;
  private readonly tB: Float32Array;
  private readonly tColor: Float32Array;
  private readonly tParams: Float32Array;
  private readonly tracerAttrs: InstancedBufferAttribute[] = [];
  private tracersWereActive = false;

  // Sparks + ghost ring.
  private readonly spriteGeo = strip();
  private readonly spriteMesh: Mesh;
  private readonly sPos: Float32Array;
  private readonly sColor: Float32Array;
  private readonly sParams: Float32Array;
  private readonly spriteAttrs: InstancedBufferAttribute[] = [];
  private spritesWereActive = false;

  // Decals.
  private readonly decalMesh: InstancedMesh;
  private readonly decalFade: Float32Array;
  private decalsWereActive = false;

  // Shards.
  private readonly shardGeo = new InstancedBufferGeometry();
  private readonly shardMesh: Mesh;
  private readonly shOrigin: Float32Array;
  private readonly shDir: Float32Array;
  private readonly shSeed: Float32Array;
  private readonly shardMat: ShaderMaterial;
  private readonly shardAttrs: InstancedBufferAttribute[] = [];
  private shardsActive = false;

  private clock = 0;

  // Scratch (no per-frame allocation).
  private readonly colA = new Color();
  private readonly m4 = new Matrix4();
  private readonly qa = new Quaternion();
  private readonly qb = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3();
  private readonly nrm = new Vector3();
  private static readonly Z = new Vector3(0, 0, 1);

  constructor(
    scene: Scene,
    private readonly cues: ShotCues,
    cfg: FeedbackTunables,
  ) {
    this.cfg = cfg;
    const frustumOff = (m: Mesh | InstancedMesh): void => {
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 10;
      scene.add(m);
      this.root.push(m);
    };

    // --- tracers
    const nT = cfg.tracer.capacity + 1;
    this.tracerGeo.instanceCount = nT;
    this.tA = instAttr(this.tracerGeo, 'aA', nT, 3, this.tracerAttrs);
    this.tB = instAttr(this.tracerGeo, 'aB', nT, 3, this.tracerAttrs);
    this.tColor = instAttr(this.tracerGeo, 'aColor', nT, 3, this.tracerAttrs);
    this.tParams = instAttr(this.tracerGeo, 'aParams', nT, 4, this.tracerAttrs);
    this.tracerMesh = new Mesh(
      this.tracerGeo,
      fxMaterial(
        TRACER_VERT,
        TRACER_FRAG,
        { uDash: { value: cfg.tracer.dashLength }, uMinPx: { value: cfg.tracer.minPx }, uViewportH: { value: 1080 } },
        true,
      ),
    );
    (this.tracerMesh.material as ShaderMaterial).side = DoubleSide; // the strip's winding depends on screen direction
    frustumOff(this.tracerMesh);

    // --- sparks + ghost ring (one slot per impact, one for the ghost)
    const nS = cfg.impact.capacity + 1;
    this.spriteGeo.instanceCount = nS;
    this.sPos = instAttr(this.spriteGeo, 'aPos', nS, 3, this.spriteAttrs);
    this.sColor = instAttr(this.spriteGeo, 'aColor', nS, 3, this.spriteAttrs);
    this.sParams = instAttr(this.spriteGeo, 'aParams', nS, 4, this.spriteAttrs);
    this.spriteMesh = new Mesh(this.spriteGeo, fxMaterial(SPRITE_VERT, SPRITE_FRAG, {}, true));
    frustumOff(this.spriteMesh);

    // --- decals
    const nD = cfg.decal.capacity;
    const decalGeo = new PlaneGeometry(1, 1);
    this.decalFade = new Float32Array(nD);
    decalGeo.setAttribute('aFade', new InstancedBufferAttribute(this.decalFade, 1));
    const decalMat = fxMaterial(DECAL_VERT, DECAL_FRAG, { uColor: { value: new Color(cfg.decal.color) } }, false);
    decalMat.polygonOffset = true;
    decalMat.polygonOffsetFactor = -2;
    decalMat.polygonOffsetUnits = -2;
    this.decalMesh = new InstancedMesh(decalGeo, decalMat, nD);
    this.decalMesh.count = nD;
    frustumOff(this.decalMesh);
    this.decalMesh.renderOrder = 5;
    // Park every instance off-screen until used.
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < nD; i++) this.decalMesh.setMatrixAt(i, this.m4);

    // --- shards
    const nShards = cfg.shatter.capacity * cfg.shatter.shards;
    const tri = new Float32BufferAttribute([-0.5, -0.35, 0, 0.5, -0.2, 0, 0.05, 0.6, 0], 3);
    this.shardGeo.setAttribute('position', tri);
    this.shardGeo.instanceCount = nShards;
    this.shOrigin = instAttr(this.shardGeo, 'aOrigin', nShards, 3, this.shardAttrs);
    this.shDir = instAttr(this.shardGeo, 'aDir', nShards, 3, this.shardAttrs);
    this.shSeed = instAttr(this.shardGeo, 'aSeed', nShards, 3, this.shardAttrs);
    this.shSeed.fill(-1); // birth < 0 = unused shard
    const sh = cfg.shatter;
    this.shardMat = fxMaterial(
      SHARD_VERT,
      SHARD_FRAG,
      {
        uTime: { value: 0 },
        uLife: { value: sh.lifeSec },
        uMinSpeed: { value: sh.minSpeed },
        uMaxSpeed: { value: sh.maxSpeed },
        uSize: { value: sh.size },
        uGravity: { value: sh.gravity },
        uColor: { value: new Color(sh.color) },
      },
      false,
    );
    this.shardMat.side = DoubleSide; // shards tumble
    this.shardMesh = new Mesh(this.shardGeo, this.shardMat);
    frustumOff(this.shardMesh);
  }

  /** Drawing-buffer height in pixels (keeps tracers at least `tracer.minPx` thick). */
  setViewportHeight(px: number): void {
    (this.tracerMesh.material as ShaderMaterial).uniforms.uViewportH!.value = Math.max(1, px);
  }

  /** Advance the cue model by `dt` and write this frame's instance buffers. */
  update(dt: number): void {
    this.clock += dt;
    const cues = this.cues;
    cues.update(dt);
    this.syncTracers();
    this.syncSprites();
    this.syncDecals();
    this.syncShards();
  }

  private syncTracers(): void {
    const cues = this.cues;
    const tr = this.cfg.tracer;
    let any = false;
    for (let i = 0; i < cues.tracers.length; i++) {
      const c = cues.tracers[i]!;
      const j = i * 3;
      if (!c.active) {
        this.tParams[i * 4] = 0;
        continue;
      }
      any = true;
      const k = 1 - c.age / c.life;
      this.tA[j] = c.ax; this.tA[j + 1] = c.ay; this.tA[j + 2] = c.az;
      this.tB[j] = c.bx; this.tB[j + 1] = c.by; this.tB[j + 2] = c.bz;
      const hex = c.kind === TRACER_MOVING ? tr.movingColor : c.kind === TRACER_NORMAL ? tr.color : this.cfg.ghost.color;
      this.colA.setHex(hex);
      this.tColor[j] = this.colA.r; this.tColor[j + 1] = this.colA.g; this.tColor[j + 2] = this.colA.b;
      const p = i * 4;
      this.tParams[p] = k > 0 ? k : 0;
      this.tParams[p + 1] = c.kind === TRACER_MOVING ? 1 : 0;
      this.tParams[p + 2] = c.kind === TRACER_NORMAL || c.kind === TRACER_MOVING ? tr.width * (0.5 + 0.5 * k) : tr.width * 0.6;
    }
    this.finish(this.tracerMesh, this.tracerAttrs, any, this.tracersWereActive);
    this.tracersWereActive = any;
  }

  private syncSprites(): void {
    const cues = this.cues;
    const im = this.cfg.impact;
    let any = false;
    for (let i = 0; i < cues.impacts.length; i++) {
      const c = cues.impacts[i]!;
      const p = i * 4;
      if (!c.active) {
        this.sParams[p + 1] = 0;
        continue;
      }
      any = true;
      const t = Math.min(1, c.age / c.life);
      const base = c.kind === IMPACT_KILL ? im.killSize : c.kind === IMPACT_HIT ? im.hitSize : im.missSize;
      const j = i * 3;
      this.sPos[j] = c.x; this.sPos[j + 1] = c.y; this.sPos[j + 2] = c.z;
      this.colA.setHex(c.kind === IMPACT_HIT ? im.hitColor : im.missColor);
      this.sColor[j] = this.colA.r; this.sColor[j + 1] = this.colA.g; this.sColor[j + 2] = this.colA.b;
      this.sParams[p] = base * (0.5 + t * 0.9);
      this.sParams[p + 1] = (1 - t) * (1 - t);
      this.sParams[p + 2] = 0;
      this.sParams[p + 3] = i * 0.7;
    }
    // Ghost ring occupies the extra last slot.
    const gi = cues.impacts.length;
    const g = cues.ghost;
    const gp = gi * 4;
    if (g.active) {
      any = true;
      const j = gi * 3;
      this.sPos[j] = g.hx; this.sPos[j + 1] = g.hy; this.sPos[j + 2] = g.hz;
      this.colA.setHex(this.cfg.ghost.color);
      this.sColor[j] = this.colA.r; this.sColor[j + 1] = this.colA.g; this.sColor[j + 2] = this.colA.b;
      const t = Math.min(1, g.age / g.life);
      this.sParams[gp] = this.cfg.ghost.radius / 0.43; // quad size for a ring of that radius (ring sits at 0.86 of the half-extent)
      this.sParams[gp + 1] = 1 - t * t;
      this.sParams[gp + 2] = 1;
      this.sParams[gp + 3] = 0;
    } else {
      this.sParams[gp + 1] = 0;
    }
    this.finish(this.spriteMesh, this.spriteAttrs, any, this.spritesWereActive);
    this.spritesWereActive = any;
  }

  private syncDecals(): void {
    const cues = this.cues;
    if (!cues.decalsDirty) return;
    cues.decalsDirty = false;
    const d = this.cfg.decal;
    let any = false;
    for (let i = 0; i < cues.decals.length; i++) {
      const c = cues.decals[i]!;
      if (!c.active) {
        this.m4.makeScale(0, 0, 0);
        this.decalMesh.setMatrixAt(i, this.m4);
        this.decalFade[i] = 0;
        continue;
      }
      any = true;
      this.nrm.set(c.nx, c.ny, c.nz);
      this.qa.setFromUnitVectors(ShotEffects.Z, this.nrm);
      this.qb.setFromAxisAngle(ShotEffects.Z, c.variation * Math.PI * 2);
      this.qa.multiply(this.qb);
      this.pos.set(c.x, c.y, c.z);
      this.scl.setScalar(d.size * (0.8 + 0.5 * c.variation));
      this.m4.compose(this.pos, this.qa, this.scl);
      this.decalMesh.setMatrixAt(i, this.m4);
      const left = d.ttlSec - c.age;
      this.decalFade[i] = left >= d.fadeSec ? 1 : Math.max(0, left / d.fadeSec);
    }
    this.decalMesh.instanceMatrix.needsUpdate = true;
    (this.decalMesh.geometry.getAttribute('aFade') as InstancedBufferAttribute).needsUpdate = true;
    this.decalMesh.visible = any || this.decalsWereActive;
    this.decalsWereActive = any;
  }

  private syncShards(): void {
    const cues = this.cues;
    const sh = this.cfg.shatter;
    let any = false;
    for (let i = 0; i < cues.shatters.length; i++) {
      const c = cues.shatters[i]!;
      if (!c.active) continue;
      any = true;
      if (c.uploaded) continue;
      c.uploaded = true;
      const birth = this.clock - c.age;
      for (let k = 0; k < sh.shards; k++) {
        const idx = i * sh.shards + k;
        const j = idx * 3;
        this.shOrigin[j] = c.x; this.shOrigin[j + 1] = c.y; this.shOrigin[j + 2] = c.z;
        this.shDir[j] = c.dx; this.shDir[j + 1] = c.dy; this.shDir[j + 2] = c.dz;
        this.shSeed[j] = c.seed; this.shSeed[j + 1] = k; this.shSeed[j + 2] = birth;
      }
      for (let a = 0; a < this.shardAttrs.length; a++) this.shardAttrs[a]!.needsUpdate = true;
    }
    this.shardMat.uniforms.uTime!.value = this.clock;
    this.shardMesh.visible = any;
    this.shardsActive = any;
  }

  /** Show the mesh while active (plus one frame to clear) and flag its instance buffers for upload. */
  private finish(mesh: Mesh, attrs: InstancedBufferAttribute[], any: boolean, was: boolean): void {
    mesh.visible = any || was;
    if (!mesh.visible) return;
    for (let i = 0; i < attrs.length; i++) attrs[i]!.needsUpdate = true;
  }

  /** Tint the kill-shatter shards (the enemy colour preset); the burst starts warm white either way. */
  setShardColor(hex: number): void {
    (this.shardMat.uniforms.uColor!.value as Color).set(hex);
  }

  /** True while any shard is in flight (debug overlay). */
  get busy(): boolean {
    return this.shardsActive || this.tracersWereActive || this.spritesWereActive;
  }

  dispose(): void {
    for (const o of this.root) {
      const m = o as Mesh;
      m.geometry.dispose();
      (m.material as ShaderMaterial).dispose();
      m.removeFromParent();
    }
  }
}
