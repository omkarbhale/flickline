/**
 * The marks Spray Wall's wall panel keeps (design §7.1 in-world: decals persist for the spray,
 * wiped before the next). A fixed-capacity buffer of plain typed arrays: no allocation after
 * construction, a full buffer drops further marks instead of growing (Pool rule, architecture §7).
 * The render layer reads it; `version` changes whenever the contents do, so the GPU buffers are
 * rewritten only when needed.
 */

/** What a mark records: where the bullet reached the wall and what it did to the Post. */
export const DECAL_MISS = 0;
export const DECAL_BODY = 1;
export const DECAL_HEAD = 2;
export type DecalKind = typeof DECAL_MISS | typeof DECAL_BODY | typeof DECAL_HEAD;

export class SprayDecals {
  /** World position of each mark, already pushed off the wall by a hair. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  /** Wall normal at the mark (unit). */
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly nz: Float32Array;
  readonly kind: Uint8Array;
  /** Marks held now (the first `count` entries of every array). */
  count = 0;
  /** Radius of the marks, metres: set per spray so the pattern reads from the stand. */
  radius = 0.1;
  /** Bumped by every change. */
  version = 0;

  constructor(readonly capacity: number) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.nx = new Float32Array(capacity);
    this.ny = new Float32Array(capacity);
    this.nz = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
  }

  /** Wipe the wall. */
  clear(radius = this.radius): void {
    this.count = 0;
    this.radius = radius;
    this.version++;
  }

  /** Add a mark; false (and nothing stored) when the buffer is full. */
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: DecalKind): boolean {
    const i = this.count;
    if (i >= this.capacity) return false;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.nx[i] = nx;
    this.ny[i] = ny;
    this.nz[i] = nz;
    this.kind[i] = kind;
    this.count = i + 1;
    this.version++;
    return true;
  }

  /** Change what the newest mark records (the impact result arrives right after the shot). */
  setLastKind(kind: DecalKind): void {
    if (this.count === 0) return;
    this.kind[this.count - 1] = kind;
    this.version++;
  }
}
