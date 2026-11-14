import {
  Color,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import { HORIZON_GLOW, palette } from '../config/palette';
import type { QualityPreset, RenderTunables } from '../config/render';

/**
 * Procedural materials for the Lightline environment. No textures: every pattern is computed in
 * the fragment shader. All materials read one shared set of uniforms, so a quality switch is a
 * handful of value writes (no allocation, no recompile).
 */
export interface EnvUniforms {
  uLightDir: IUniform<Vector3>;
  /** x = ambient, y = sun. */
  uLight: IUniform<Vector2>;
  /** x = shade at y = 0, y = height (m) at which shade reaches 1. */
  uGrad: IUniform<Vector2>;
  /** Floor fill (linear). */
  uFloor: IUniform<Color>;
  /** Trim colour (linear, unscaled). */
  uTrim: IUniform<Color>;
  /** x = minor weight, y = major weight, z = tick weight, w = line width px. */
  uGridW: IUniform<Vector4>;
  /** x = minor period, y = major period (m), z/w = depth (m) over which ticks fade out. */
  uGridP: IUniform<Vector4>;
  /** 0, 1 or 2 (see QualityPreset.gridDetail). */
  uGridDetail: IUniform<number>;
  /** Sky: trim glow colour (linear, already weighted by HORIZON_GLOW). */
  uGlowColor: IUniform<Color>;
  /** Sky: 0 = gradient only, 1 = plus the narrow horizon band. */
  uBand: IUniform<number>;
  uVoid: IUniform<Color>;
}

export function createEnvUniforms(r: RenderTunables, envColors: { floor: number }): EnvUniforms {
  return {
    uLightDir: { value: new Vector3(...r.light.dir).normalize() },
    uLight: { value: new Vector2(r.light.ambient, r.light.sun) },
    uGrad: { value: new Vector2(r.gradient.low, r.gradient.height) },
    uFloor: { value: new Color(envColors.floor) },
    uTrim: { value: new Color(palette.trim) },
    uGridW: { value: new Vector4(r.grid.minorWeight, r.grid.majorWeight, r.grid.tickWeight, r.grid.lineWidthPx) },
    uGridP: { value: new Vector4(r.grid.minor, r.grid.major, r.grid.tickFadeNear, r.grid.tickFadeFar) },
    uGridDetail: { value: 2 },
    uGlowColor: { value: new Color(palette.trim).multiplyScalar(HORIZON_GLOW) },
    uBand: { value: 1 },
    uVoid: { value: new Color(palette.ink) },
  };
}

/** Quality-dependent uniform writes. */
export function applyEnvQuality(u: EnvUniforms, p: QualityPreset): void {
  u.uGridDetail.value = p.gridDetail;
  u.uBand.value = p.skyGlow ? 1 : 0;
}

/** Fraction of the glow colour present at the horizon (matches the sky shader's gradient + band terms). */
export const SKY_GRADIENT_PEAK = 0.4;
export const SKY_BAND_PEAK = 0.6;

/** Sky colour at the horizon, written into `out` (also the fog colour). */
export function horizonColor(u: EnvUniforms, out: Color): Color {
  const k = SKY_GRADIENT_PEAK + SKY_BAND_PEAK * u.uBand.value;
  const v = u.uVoid.value;
  const g = u.uGlowColor.value;
  return out.setRGB(v.r + g.r * k, v.g + g.g * k, v.b + g.b * k);
}

function fogUniforms(): Record<string, IUniform> {
  return UniformsUtils.clone(UniformsLib.fog);
}

/** Flat-shaded instanced boxes: per-instance colour, vertical gradient, one directional light. */
export function createBoxMaterial(u: EnvUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...fogUniforms(), uLightDir: u.uLightDir, uLight: u.uLight, uGrad: u.uGrad },
    vertexShader: /* glsl */ `
      uniform vec3 uLightDir;
      uniform vec2 uLight;
      uniform vec2 uGrad;
      varying vec3 vColor;
      #include <fog_pars_vertex>
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(position, 1.0);
        vec3 n = normalize(mat3(m) * normal);
        float shade = uLight.x + uLight.y * max(dot(n, uLightDir), 0.0);
        float g = mix(uGrad.x, 1.0, clamp(wp.y / uGrad.y, 0.0, 1.0));
        vColor = instanceColor * (shade * g);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
    // Push surfaces back a hair so the trim lines on their edges never z-fight.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** Procedural grid floor: derivative-antialiased 1 m / 5 m lines and 5 m intersection ticks. */
export function createFloorMaterial(u: EnvUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...fogUniforms(),
      uFloor: u.uFloor,
      uTrim: u.uTrim,
      uGridW: u.uGridW,
      uGridP: u.uGridP,
      uGridDetail: u.uGridDetail,
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorldXZ;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldXZ = wp.xz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFloor;
      uniform vec3 uTrim;
      uniform vec4 uGridW;
      uniform vec4 uGridP;
      uniform float uGridDetail;
      varying vec2 vWorldXZ;
      #include <fog_pars_fragment>

      // Pixel distance to the nearest grid line (per axis) for lines every \`period\` metres.
      vec2 lineDist(vec2 p, float period, out vec2 fw) {
        vec2 g = p / period;
        fw = max(fwidth(g), vec2(1e-5));
        return abs(fract(g - 0.5) - 0.5) / fw;
      }
      // Filtered line coverage; lines denser than ~one per 5-12 px fade out instead of aliasing.
      float lineCov(vec2 p, float period, float px) {
        vec2 fw;
        vec2 d = lineDist(p, period, fw);
        float cov = clamp(px * 0.5 + 0.5 - min(d.x, d.y), 0.0, 1.0);
        return cov * (1.0 - smoothstep(0.08, 0.2, max(fw.x, fw.y)));
      }
      // Ticks where the lines of period \`period\` cross.
      float tickCov(vec2 p, float period) {
        vec2 fw;
        vec2 d = lineDist(p, period, fw);
        // Per-axis pixel distances keep the tick square on screen even at grazing angles.
        vec2 c = clamp(vec2(3.0) - d, 0.0, 1.0);
        return c.x * c.y * (1.0 - smoothstep(0.03, 0.08, max(fw.x, fw.y)));
      }
      void main() {
        float px = uGridW.w;
        float major = lineCov(vWorldXZ, uGridP.y, px) * uGridW.y;
        float minor = uGridDetail > 0.5 ? lineCov(vWorldXZ, uGridP.x, px) * uGridW.x : 0.0;
        float tick = uGridDetail > 1.5 ? tickCov(vWorldXZ, uGridP.y) * uGridW.z * (1.0 - smoothstep(uGridP.z, uGridP.w, vFogDepth)) : 0.0;
        float k = max(max(major, minor), tick);
        gl_FragColor = vec4(uFloor + uTrim * k, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** Sky dome: dark gradient with a faint horizon glow. Drawn first, no depth. */
export function createSkyMaterial(u: EnvUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uVoid: u.uVoid, uGlowColor: u.uGlowColor, uBand: u.uBand },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uVoid;
      uniform vec3 uGlowColor;
      uniform float uBand;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        float wide = ${SKY_GRADIENT_PEAK.toFixed(2)} * (1.0 - smoothstep(0.0, 0.7, h));
        float band = ${SKY_BAND_PEAK.toFixed(2)} * exp(-abs(h) * 16.0) * uBand;
        gl_FragColor = vec4(uVoid + uGlowColor * (wide + band), 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
}

/** Soft round blob under Echoes and pillars. Per-instance alpha rides on instanceColor.r. */
export function createBlobMaterial(opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vA;
      void main() {
        vUv = uv;
        vA = instanceColor.r;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vA;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.0, 1.0, d));
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * vA * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
}
