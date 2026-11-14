import { Mesh, SphereGeometry, type PerspectiveCamera } from 'three';
import { createSkyMaterial, type EnvUniforms } from './envShaders';

/**
 * Gradient sky dome with a faint horizon glow. A unit sphere recentred on the camera each frame
 * (so it is always at infinity), drawn first with no depth test. One draw call.
 */
export class Sky {
  readonly mesh: Mesh;

  constructor(uniforms: EnvUniforms, far: number) {
    this.mesh = new Mesh(new SphereGeometry(1, 24, 12), createSkyMaterial(uniforms));
    this.mesh.scale.setScalar(far * 0.9);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = true;
  }

  /** Follow the camera (no allocation). */
  follow(camera: PerspectiveCamera): void {
    this.mesh.position.copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as { dispose(): void }).dispose();
  }
}
