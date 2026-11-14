export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

/** The post stack of one preset. Numbers are in `config/post.ts`. */
export interface PostPreset {
  /** Threshold + downsample x4 + add (one quarter-res pass, 5-tap upsample in the composite). */
  bloom: boolean;
  /** Smooth the bloom with a separable 5-tap blur at quarter resolution (two more quarter-res passes). */
  blur: boolean;
  vignette: boolean;
  /** The kill pulse is available (still off until the player turns it on, and off under Reduce flashing). */
  chromatic: boolean;
}

export interface QualityPreset {
  /** Upper bound for renderer pixel ratio (devicePixelRatio is clamped to this). */
  pixelRatioCap: number;
  /** MSAA on the default framebuffer. Fixed at context creation: a change needs a reload. */
  antialias: boolean;
  /** Which post effects run (design section 11). All false = the pipeline is off: no render targets. */
  post: PostPreset;
  maxAnisotropy: number;
  /**
   * Grid floor detail (a shader uniform, so switching is live): 0 = 5 m lines only; 1 = adds the
   * faint 1 m lines; 2 = adds 5 m intersection ticks and the full distance fade.
   */
  gridDetail: 0 | 1 | 2;
  /** Faint horizon glow in the sky (and the matching fog colour). */
  skyGlow: boolean;
  /** Inverted-hull outline on enemies (design section 11: off at Low, on at High). */
  echoOutline: boolean;
}

export interface RenderTunables {
  quality: Record<QualityLevel, QualityPreset>;
  /**
   * Soft budgets shown red in the debug overlay when exceeded. `enemyTick`: what `count` humanoid
   * Echoes playing through the shared body (#87) may add to one sim tick, ms (the perf harness measures it).
   */
  budget: { frameMs: number; drawCalls: number; triangles: number; tickMs: number; enemyTick: { count: number; ms: number } };
  fogNear: number;
  fogFar: number;
  /**
   * The single directional light plus ambient, as shade factors on the palette's environment
   * colours. `ambient + sun` must be <= 1: the environment is only ever darkened from its
   * palette colour, which is what bounds surface luminance for the Echo contrast guarantee.
   * `objectAmbient`/`objectSun` are the intensities of the matching three.js lights, which only
   * light the few lit-material objects (viewmodel placeholder, effects) not drawn by env shaders.
   */
  light: { ambient: number; sun: number; dir: [number, number, number]; objectAmbient: number; objectSun: number };
  /** Vertical vertex-colour gradient on boxes: shade at world y = 0 rising to 1 at `height` m. */
  gradient: { low: number; height: number };
  /** Trim lines: brightness (linear-light weight of `palette.trim`) at the top, and at the base; `marks` = map floor markings. */
  trim: { intensity: number; baseIntensity: number; baseHeight: number; marks: { tick: number; major: number; line: number } };
  /** Grid floor in metres and shader weights. */
  grid: { minor: number; major: number; minorWeight: number; majorWeight: number; tickWeight: number; lineWidthPx: number; tickFadeNear: number; tickFadeFar: number };
  /** Blob-shadow decals (pooled, fixed capacity). */
  blob: { capacity: number; opacity: number; echoScale: number; pillarMaxFootprint: number; pillarMinHeight: number };
}

export const render: RenderTunables = {
  quality: {
    low: { pixelRatioCap: 1, antialias: false, post: { bloom: false, blur: false, vignette: false, chromatic: false }, maxAnisotropy: 1, gridDetail: 0, skyGlow: false, echoOutline: false },
    medium: { pixelRatioCap: 1.5, antialias: true, post: { bloom: true, blur: false, vignette: false, chromatic: false }, maxAnisotropy: 4, gridDetail: 1, skyGlow: true, echoOutline: false },
    high: { pixelRatioCap: 2, antialias: true, post: { bloom: true, blur: true, vignette: true, chromatic: true }, maxAnisotropy: 8, gridDetail: 2, skyGlow: true, echoOutline: true },
  },
  budget: { frameMs: 1000 / 144, drawCalls: 150, triangles: 500_000, tickMs: 0.5, enemyTick: { count: 8, ms: 0.1 } },
  fogNear: 30,
  fogFar: 110,
  light: { ambient: 0.55, sun: 0.45, dir: [0.45, 0.8, 0.3], objectAmbient: 1.6, objectSun: 2.2 },
  gradient: { low: 0.4, height: 4 },
  trim: { intensity: 0.5, baseIntensity: 0.22, baseHeight: 3, marks: { tick: 0.18, major: 0.32, line: 0.5 } },
  grid: { minor: 1, major: 5, minorWeight: 0.1, majorWeight: 0.28, tickWeight: 0.5, lineWidthPx: 1, tickFadeNear: 4, tickFadeFar: 9 },
  blob: { capacity: 96, opacity: 0.7, echoScale: 1.5, pillarMaxFootprint: 2, pillarMinHeight: 1.8 },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { render };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
