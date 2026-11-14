import type { EventSink } from '../core/eventBus';
import { clamp, DEG2RAD } from '../core/math';
import { degreesPerCount } from '../core/sensitivity';
import type { TickInput } from '../sim/types';
import type { AppEvents } from '../app/events';
import { defaultBindings, type Bindings } from './bindings';

/**
 * Browser input: keyboard, raw mouse, pointer lock.
 *
 * Latency design: mouse deltas are applied to `look` (yaw/pitch) inside the mousemove handler, so
 * the camera can render the freshest angles every frame with no tick-rate delay. sample() copies
 * the current state into a TickInput once per rendered frame; ticks run in that frame reuse it.
 * Edge inputs (jump, fire click) persist until a tick actually consumes them (endFrame).
 */
export class InputManager {
  /** Live view angles in radians (yaw 0 = -Z, + = left; pitch + = up). */
  yaw = 0;
  pitch = 0;
  locked = false;
  /** Degrees of rotation per raw count; kept in sync with the sensitivity setting. */
  private degPerCount = degreesPerCount(0.4);
  maxPitch = 89 * DEG2RAD;

  private readonly down = new Set<string>();
  private mouseFire = false;
  private fireEdge = false;
  private jumpEdge = false;
  private readonly codeToAction = new Map<string, keyof Bindings>();
  onToggleDebug: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: EventSink<AppEvents>,
    private readonly bindings: Bindings = defaultBindings,
  ) {
    for (const action of Object.keys(bindings) as (keyof Bindings)[]) {
      for (const code of bindings[action]) this.codeToAction.set(code, action);
    }
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
  }

  /** Is the fire button physically held right now. */
  get fireHeld(): boolean {
    return this.mouseFire;
  }

  setSensitivity(sensitivity: number): void {
    this.degPerCount = degreesPerCount(sensitivity);
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -this.maxPitch, this.maxPitch);
  }

  /** Raw-input state of the last lock request: null until one was made. */
  rawInput: boolean | null = null;

  /**
   * Must be called from a user gesture. Requests raw (unadjusted) mouse input. A browser that
   * lacks it (or that rejects the option) gets a plain lock and `rawInputChanged {on: false}`.
   */
  requestLock(): void {
    const c = this.canvas as HTMLCanvasElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    // Real feature detection: only a browser that implements the option reads this member.
    let optionRead = false;
    const options = {
      get unadjustedMovement(): boolean {
        optionRead = true;
        return true;
      },
    };
    let result: Promise<void> | void;
    try {
      result = c.requestPointerLock(options);
    } catch {
      return;
    }
    if (!optionRead || !result || typeof result.then !== 'function') {
      this.setRaw(false);
      return;
    }
    result.then(
      () => this.setRaw(true),
      (err: unknown) => {
        // Only "not supported" means raw input is unavailable; a SecurityError (lock just left,
        // no gesture) says nothing about it, the player simply clicks again.
        if ((err as { name?: string } | null)?.name !== 'NotSupportedError') return;
        this.setRaw(false);
        try {
          const r2 = c.requestPointerLock();
          if (r2 && typeof r2.catch === 'function') r2.catch(() => {});
        } catch {
          /* ignore */
        }
      },
    );
  }

  private setRaw(on: boolean): void {
    if (this.rawInput === on) return;
    this.rawInput = on;
    this.events.emit('rawInputChanged', { on });
  }

  private isDown(action: keyof Bindings): boolean {
    const codes = this.bindings[action];
    for (let i = 0; i < codes.length; i++) if (this.down.has(codes[i]!)) return true;
    return false;
  }

  /** Write the current input state into `out` (no allocation). */
  sample(out: TickInput): void {
    let mx = 0;
    let mz = 0;
    if (this.locked) {
      if (this.isDown('right')) mx += 1;
      if (this.isDown('left')) mx -= 1;
      if (this.isDown('forward')) mz += 1;
      if (this.isDown('back')) mz -= 1;
    }
    out.moveX = mx;
    out.moveZ = mz;
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    out.jump = this.jumpEdge;
    out.crouch = this.locked && this.isDown('crouch');
    out.walk = this.locked && this.isDown('walk');
    out.fire = this.mouseFire || this.fireEdge;
  }

  /** Call after the frame's ticks: edges are cleared only if a tick consumed them. */
  endFrame(ticksRan: number): void {
    if (ticksRan > 0) {
      this.jumpEdge = false;
      this.fireEdge = false;
    }
  }

  private readonly onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.releaseAll();
    this.events.emit('pointerLockChanged', { locked: this.locked });
  };

  private readonly onLockError = (): void => {
    this.locked = false;
    this.events.emit('pointerLockChanged', { locked: false });
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.yaw -= e.movementX * this.degPerCount * DEG2RAD;
    this.pitch = clamp(this.pitch - e.movementY * this.degPerCount * DEG2RAD, -this.maxPitch, this.maxPitch);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.locked || e.button !== 0) return;
    this.mouseFire = true;
    this.fireEdge = true;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseFire = false;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const action = this.codeToAction.get(e.code);
    if (action === 'toggleDebug') {
      if (!e.repeat) this.onToggleDebug?.();
      e.preventDefault();
      return;
    }
    if (!this.locked) return;
    if (action) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (action === 'jump') this.jumpEdge = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly releaseAll = (): void => {
    this.down.clear();
    this.mouseFire = false;
  };

  dispose(): void {
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
  }
}
