import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace, type Scene } from 'three';

/**
 * One floating in-world text hint ("Click the orb"): a single sprite made once from a small
 * canvas, so showing/hiding it costs nothing per frame and never allocates.
 */
export class WorldHint {
  private readonly sprite: Sprite;

  constructor(scene: Scene, text: string, widthM = 3.2) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(10,14,20,0.78)';
    g.beginPath();
    g.roundRect(4, 4, 504, 120, 28);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#ff6a3d';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '700 58px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const mat = new SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false });
    this.sprite = new Sprite(mat);
    this.sprite.scale.set(widthM, widthM / 4, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  get visible(): boolean {
    return this.sprite.visible;
  }

  show(x: number, y: number, z: number): void {
    this.sprite.position.set(x, y, z);
    this.sprite.visible = true;
  }

  hide(): void {
    this.sprite.visible = false;
  }
}
