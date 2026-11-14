import { Color, DoubleSide, BackSide, ShaderMaterial, Vector2, Vector3, Vector4, type IUniform } from 'three';
import { echoPresets, type EchoPresetId } from '../config/palette';
import type { EchoTunables } from '../config/echo';
import type { RenderTunables } from '../config/render';
import type { HitTunables } from '../config/targets';

/**
 * The shared Echo `ShaderMaterial` family (design section 11). One set of uniforms drives every
 * enemy type, so a colour-preset or quality change is a few value writes, never a recompile.
 *
 *  - unlit flat colour with facet shading that only ever LIFTS the colour towards white (so the
 *    preset colour is the minimum rendered colour: the 7:1 contrast guarantee holds),
 *  - fresnel rim, a brighter head node (Echo head, Beacon core, Gnat core),
 *  - hit flash (white, per instance), death dissolve (per-triangle shrink in the VERTEX shader:
 *    no per-pixel discard), crouch morph and idle lean (vertex shader),
 *  - optional inverted-hull outline (a second, back-face material on the same instances),
 *  - fog is deliberately off: an Echo stays the highest-contrast thing on screen at any range.
 *
 * Per-instance state (`aState`): x = flash 0..1, y = dissolve 0..1, z = crouch 0|1, w = lean in
 * metres (Echo) or spin phase in radians (Gnat; so a Gnat's spin does not jump when the
 * instance order changes).
 */
export interface EchoUniforms {
  uColor: IUniform<Color>;
  uHead: IUniform<Color>;
  uOutline: IUniform<Color>;
  uTime: IUniform<number>;
  uLightDir: IUniform<Vector3>;
  /** x = rim exponent, y = rim strength. */
  uRim: IUniform<Vector2>;
  /** x = facet lift, y = head glow, z = outline width (px). */
  uLook: IUniform<Vector3>;
  /** Head centre height standing / crouched (the idle lean shears about it). */
  uHeadY: IUniform<Vector2>;
  /** Drawing-buffer size in pixels (outline width). */
  uViewport: IUniform<Vector2>;
  /** x = spin (rad/s), y = tilt (rad). */
  uGnat: IUniform<Vector2>;
  /** Shards: x = life, y = speed min, z = speed max, w = bias speed. */
  uShardA: IUniform<Vector4>;
  /** Shards: x = gravity, y = size min, z = size max, w = spin (rad/s). */
  uShardB: IUniform<Vector4>;
  uFloor: IUniform<number>;
}

export function createEchoUniforms(e: EchoTunables, r: RenderTunables, hit: HitTunables): EchoUniforms {
  const u: EchoUniforms = {
    uColor: { value: new Color() },
    uHead: { value: new Color() },
    uOutline: { value: new Color() },
    uTime: { value: 0 },
    uLightDir: { value: new Vector3(...r.light.dir).normalize() },
    uRim: { value: new Vector2(e.rim.power, e.rim.strength) },
    uLook: { value: new Vector3(e.facetLift, e.headGlow, e.outlinePx) },
    uHeadY: { value: new Vector2(hit.headCentreStand, hit.headCentreCrouch) },
    uViewport: { value: new Vector2(1, 1) },
    uGnat: { value: new Vector2(e.gnat.spinRadPerSec, e.gnat.tiltRad) },
    uShardA: { value: new Vector4(e.shatter.lifeSec, e.shatter.speedMin, e.shatter.speedMax, e.shatter.biasSpeed) },
    uShardB: { value: new Vector4(e.shatter.gravity, e.shatter.sizeMin, e.shatter.sizeMax, e.shatter.spinRadPerSec) },
    uFloor: { value: e.shatter.floorY },
  };
  applyEchoPreset(u, 'ember');
  return u;
}

export function applyEchoPreset(u: EchoUniforms, id: EchoPresetId): void {
  const p = echoPresets[id];
  u.uColor.value.set(p.color);
  u.uHead.value.set(p.head);
  u.uOutline.value.set(p.outline);
}

export type EchoMaterialKind = 'echo' | 'beacon' | 'gnat';

const VERT = /* glsl */ `
  attribute vec3 aPosC;
  attribute vec3 aCent;
  attribute vec3 aCentC;
  attribute vec3 aSmooth;
  attribute vec2 aMeta;
  attribute vec4 aState;
  uniform vec3 uLightDir;
  uniform vec2 uHeadY;
  uniform vec2 uGnat;
  uniform float uTime;
  uniform vec3 uLook;
  uniform vec2 uViewport;
  varying vec3 vNView;
  varying vec3 vPView;
  varying float vFacet;
  varying float vNode;
  varying float vFlash;

  void main() {
    vec3 p = position;
    vec3 c = aCent;
    vec3 fn = normal;
    vec3 sn = aSmooth;
    #ifdef ECHO_BODY
      float crouch = aState.z;
      p = mix(position, aPosC, crouch);
      c = mix(aCent, aCentC, crouch);
      float hy = mix(uHeadY.x, uHeadY.y, crouch);
      p.x += aState.w * (p.y / hy);
      c.x += aState.w * (c.y / hy);
    #endif
    #ifdef GNAT
      float a = uTime * uGnat.x + aState.w; // aState.w = per-Gnat spin phase
      float ca = cos(a), sa = sin(a), ct = cos(uGnat.y), st = sin(uGnat.y);
      mat3 R = mat3(1.0, 0.0, 0.0, 0.0, ct, st, 0.0, -st, ct) * mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca);
      p = R * p; c = R * c; fn = R * fn; sn = R * sn;
    #endif
    // Dissolve: every triangle shrinks to its centroid and drifts along its normal, staggered per face.
    float k = clamp(aState.y * 1.6 - aMeta.y * 0.6, 0.0, 1.0);
    p = mix(p, c, k) + (fn * 0.2 + vec3(0.0, -0.3, 0.0)) * k;

    mat4 M = modelMatrix * instanceMatrix;
    vec4 mv = viewMatrix * (M * vec4(p, 1.0));
    vec4 clip = projectionMatrix * mv;
    vec3 nv = normalize(mat3(viewMatrix) * (mat3(M) * sn));
    #ifdef OUTLINE
      vec2 d = nv.xy;
      float dl = length(d);
      d = dl > 1e-4 ? d / dl : vec2(0.0);
      clip.xy += d * (uLook.z * 2.0 / uViewport) * clip.w;
    #endif
    gl_Position = clip;
    vNView = nv;
    vPView = mv.xyz;
    // 0 for faces turned away from the light (the preset colour itself), up to 1 facing it.
    vFacet = clamp(2.0 * (dot(normalize(mat3(M) * fn), uLightDir) - 0.15), 0.0, 1.0);
    vNode = aMeta.x > 1.5 ? 1.0 : 0.0;
    vFlash = aState.x;
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHead;
  uniform vec3 uOutline;
  uniform vec2 uRim;
  uniform vec3 uLook;
  varying vec3 vNView;
  varying vec3 vPView;
  varying float vFacet;
  varying float vNode;
  varying float vFlash;

  void main() {
    #ifdef OUTLINE
      gl_FragColor = vec4(uOutline, 1.0);
    #else
      vec3 n = normalize(vNView);
      float ndv = clamp(abs(dot(n, normalize(-vPView))), 0.0, 1.0);
      float fres = pow(1.0 - ndv, uRim.x);
      // Every mix below goes towards a lighter colour, never a darker one.
      vec3 col = mix(uColor, vec3(1.0), uLook.x * vFacet);
      #ifdef ECHO_BODY
        col = mix(col, vec3(1.0), uRim.y * fres);
        col = mix(col, uHead, uLook.y * vNode * (1.0 - 0.5 * fres));
      #else
        col = mix(col, vec3(1.0), 0.4 * uRim.y * fres);
        col = mix(col, uHead, uLook.y * pow(ndv, 3.0));
      #endif
      col = mix(col, vec3(1.0), vFlash);
      gl_FragColor = vec4(col, 1.0);
    #endif
    #include <colorspace_fragment>
  }`;

function defines(kind: EchoMaterialKind, outline: boolean): Record<string, string> {
  const d: Record<string, string> = {};
  d[kind === 'echo' ? 'ECHO_BODY' : kind === 'beacon' ? 'BEACON' : 'GNAT'] = '1';
  if (outline) d.OUTLINE = '1';
  return d;
}

/** The body material of one enemy type (front faces). */
export function createEchoMaterial(u: EchoUniforms, kind: EchoMaterialKind): ShaderMaterial {
  return new ShaderMaterial({ uniforms: { ...u }, vertexShader: VERT, fragmentShader: FRAG, defines: defines(kind, false), fog: false });
}

/** The inverted-hull outline of one enemy type (back faces pushed out in screen space). */
export function createEchoOutlineMaterial(u: EchoUniforms, kind: EchoMaterialKind): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...u }, vertexShader: VERT, fragmentShader: FRAG, defines: defines(kind, true), fog: false, side: BackSide,
  });
}

const SHARD_VERT = /* glsl */ `
  attribute vec4 aKill;
  attribute vec3 aBias;
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec4 uShardA;
  uniform vec4 uShardB;
  uniform float uFloor;
  varying float vU;
  varying float vR;

  void main() {
    float t = uTime - aKill.w;
    float u = t / uShardA.x;
    vU = u;
    vR = aSeed.w;
    if (t < 0.0 || u >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume: a dead shard costs no fragments
      return;
    }
    float speed = mix(uShardA.y, uShardA.z, aSeed.w);
    vec3 pos = aKill.xyz + (aSeed.xyz * speed + aBias * uShardA.w) * t;
    pos.y = max(pos.y - 0.5 * uShardB.x * t * t, uFloor);
    float size = mix(uShardB.y, uShardB.z, aSeed.w) * (1.0 - u * u);
    vec3 axis = normalize(aSeed.zxy + vec3(0.1, 0.2, 0.3));
    float ang = t * uShardB.w * (0.5 + aSeed.w);
    vec3 v = vec3(position.x * (0.6 + 0.8 * aSeed.w), position.y, 0.0) * size;
    float ca = cos(ang), sa = sin(ang);
    v = v * ca + cross(axis, v) * sa + axis * dot(axis, v) * (1.0 - ca);
    gl_Position = projectionMatrix * viewMatrix * (modelMatrix * vec4(pos + v, 1.0));
  }`;

const SHARD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHead;
  varying float vU;
  varying float vR;
  void main() {
    vec3 col = mix(uHead, uColor, smoothstep(0.0, 0.4, vU));
    col = mix(col, vec3(1.0), 0.2 * vR * (1.0 - vU));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

/** Kill-shatter shards: all motion is computed in the vertex shader from per-shard data. */
export function createShardMaterial(u: EchoUniforms): ShaderMaterial {
  return new ShaderMaterial({ uniforms: { ...u }, vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, fog: false, side: DoubleSide });
}
