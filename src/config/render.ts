export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export interface QualityPreset {
  /** Upper bound for renderer pixel ratio (devicePixelRatio is clamped to this). */
  pixelRatioCap: number;
  /** MSAA on the default framebuffer. Fixed at context creation: a change needs a reload. */
  antialias: boolean;
  /** Whether the post-processing slot runs its effects. */
  postProcessing: boolean;
  maxAnisotropy: number;
}

export interface RenderTunables {
  quality: Record<QualityLevel, QualityPreset>;
  /** Soft budgets shown red in the debug overlay when exceeded. */
  budget: { frameMs: number; drawCalls: number; triangles: number; tickMs: number };
  skyColor: number;
  fogNear: number;
  fogFar: number;
}

export const render: RenderTunables = {
  quality: {
    low: { pixelRatioCap: 1, antialias: false, postProcessing: false, maxAnisotropy: 1 },
    medium: { pixelRatioCap: 1.5, antialias: true, postProcessing: false, maxAnisotropy: 4 },
    high: { pixelRatioCap: 2, antialias: true, postProcessing: true, maxAnisotropy: 8 },
  },
  budget: { frameMs: 1000 / 144, drawCalls: 150, triangles: 500_000, tickMs: 0.5 },
  skyColor: 0x9db4c8,
  fogNear: 40,
  fogFar: 120,
};
