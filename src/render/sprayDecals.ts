import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { palette } from '../config/palette';
import type { SprayDecals } from '../feedback/sprayDecals';
import type { GameRenderer, RenderFrame, RenderLayer } from './gameRenderer';

/**
 * Spray Wall's wall marks as one instanced draw (design §7.1 in-world): every bullet of the spray
 * is a mark on the panel, drawn in the shape language of the shot cues so it reads without colour:
 * a hollow ring = missed the Post, a disc = body, a disc inside a ring = head. The instance buffers
 * are rewritten only when the pure `SprayDecals` buffer changed (`version`), never per frame, and
 * the mesh is hidden (no draw call) while the wall is clean.
 */

const VERT = /* glsl */ `
attribute float aKind;
varying vec2 vUv;
varying float vKind;
void main() {
  vUv = uv;
  vKind = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uMiss;
uniform vec3 uBody;
uniform vec3 uHead;
uniform vec3 uCore;
varying vec2 vUv;
varying float vKind;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float aa = fwidth(r) * 1.2 + 0.02;
  vec3 col;
  float a;
  if (vKind < 0.5) { // miss: hollow ring
    a = smoothstep(0.55 - aa, 0.55 + aa, r) * (1.0 - smoothstep(0.95 - aa, 0.95 + aa, r));
    col = uMiss;
  } else if (vKind < 1.5) { // body: disc
    a = 1.0 - smoothstep(0.8 - aa, 0.8 + aa, r);
    col = uBody;
  } else { // head: bright core inside a ring
    float core = 1.0 - smoothstep(0.42 - aa, 0.42 + aa, r);
    float ring = smoothstep(0.66 - aa, 0.66 + aa, r) * (1.0 - smoothstep(0.95 - aa, 0.95 + aa, r));
    a = max(core, ring);
    col = mix(uHead, uCore, core);
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a * 0.95);
  #include <colorspace_fragment>
}`;

export class SprayDecalLayer implements RenderLayer {
  private readonly mesh: InstancedMesh;
  private readonly kinds: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private readonly matrix = new Matrix4();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly quat = new Quaternion();
  private readonly normal = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private version = -1;

  constructor(renderer: GameRenderer, private readonly decals: SprayDecals) {
    const geometry = new PlaneGeometry(1, 1);
    this.kinds = new InstancedBufferAttribute(new Float32Array(decals.capacity), 1);
    geometry.setAttribute('aKind', this.kinds);
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uMiss: { value: new Color(palette.alert) },
        uBody: { value: new Color(palette.ok) },
        uHead: { value: new Color(palette.gold) },
        uCore: { value: new Color(palette.core) },
      },
    });
    this.mesh = new InstancedMesh(geometry, this.material, decals.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    renderer.scene.add(this.mesh);
  }

  update(_frame: RenderFrame): void {
    const d = this.decals;
    if (d.version === this.version) return;
    this.version = d.version;
    const s = d.radius * 2;
    this.scale.set(s, s, 1);
    const kinds = this.kinds.array as Float32Array;
    for (let i = 0; i < d.count; i++) {
      this.normal.set(d.nx[i]!, d.ny[i]!, d.nz[i]!);
      this.quat.setFromUnitVectors(this.forward, this.normal);
      this.pos.set(d.x[i]!, d.y[i]!, d.z[i]!);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      kinds[i] = d.kind[i]!;
    }
    this.mesh.count = d.count;
    this.mesh.visible = d.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.kinds.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
