import type { EventSink } from '../core/eventBus';
import { clamp, DEG2RAD } from '../core/math';
import { degreesPerCount } from '../core/sensitivity';
import { SLOT_INDEX } from '../sim/loadout';
import type { TickInput } from '../sim/types';
import type { KeyBindings } from '../settings/keys';
import { defaultBindings, indexBindings, withKeys, type Bindings, type BoundAction } from './bindings';

/** Events the input layer emits. */
export interface InputEvents {
  /** Pointer lock gained/lost; the game is "live" only while locked. */
  pointerLockChanged: { locked: boolean };
  /**
   * Whether the last pointer lock request got raw (unadjusted) mouse input. `on: false` means the
   * browser lacks it and the OS pointer acceleration may apply.
   */
  rawInputChanged: { on: boolean; /** Whether the player's setting asked for it. */ requested: boolean };
}

declare module '../core/gameEvents' {
  interface GameEvents extends InputEvents {}
}

/**
 * Browser input: keyboard, raw mouse, pointer lock.
 *
 * Latency design: mouse deltas are applied to `look` (yaw/pitch) inside the mousemove handler, so
 * the camera can render the freshest angles every frame with no tick-rate delay. sample() copies
 * the current state into a TickInput once per rendered frame; ticks run in that frame reuse it.
 * Edge inputs (jump, reload, fire click) persist until a tick actually consumes them (endFrame).
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
  private reloadEdge = false;
  /** Loadout slot of the last swap key pressed since a tick consumed it, or -1. */
  private switchEdge = -1;
  private readonly codeToAction = new Map<string, BoundAction>();
  private bindings: Bindings;
  /** Mouse up looks down (the setting `invertY`). */
  private pitchSign = -1;
  /** Ask for raw (unadjusted) mouse input when locking (the setting `rawInput`). */
  private wantRaw = true;
  /** What `wantRaw` was when `rawInputChanged` last fired (so a change of the setting alone is reported too). */
  private rawReported = true;
  onToggleDebug: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: EventSink<InputEvents>,
    bindings: Bindings = defaultBindings,
  ) {
    this.bindings = bindings;
    indexBindings(bindings, this.codeToAction);
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

  /** The player's key bindings; takes effect on the next key event (keys held across the change are released). */
  setKeys(keys: Readonly<KeyBindings>): void {
    this.bindings = withKeys(keys);
    indexBindings(this.bindings, this.codeToAction);
    this.down.clear();
  }

  /** Invert the vertical mouse axis. */
  setInvertY(on: boolean): void {
    this.pitchSign = on ? 1 : -1;
  }

  /** Whether the next pointer lock asks for raw mouse input. */
  setRawWanted(on: boolean): void {
    this.wantRaw = on;
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
    if (!this.wantRaw) {
      try {
        const r = this.canvas.requestPointerLock() as Promise<void> | void;
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch {
        return;
      }
      this.setRaw(false);
      return;
    }
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
    if (this.rawInput === on && this.rawReported === this.wantRaw) return;
    this.rawInput = on;
    this.rawReported = this.wantRaw;
    this.events.emit('rawInputChanged', { on, requested: this.wantRaw });
  }

  private isDown(action: BoundAction): boolean {
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
    out.reload = this.reloadEdge;
    out.switchTo = this.switchEdge;
  }

  /** Call after the frame's ticks: edges are cleared only if a tick consumed them. */
  endFrame(ticksRan: number): void {
    if (ticksRan > 0) {
      this.jumpEdge = false;
      this.fireEdge = false;
      this.reloadEdge = false;
      this.switchEdge = -1;
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
    this.pitch = clamp(this.pitch + this.pitchSign * e.movementY * this.degPerCount * DEG2RAD, -this.maxPitch, this.maxPitch);
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
    if (action === 'fullscreen') {
      if (!e.repeat) toggleFullscreen();
      e.preventDefault();
      return;
    }
    if (!this.locked) return;
    if (action) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    if (action === 'jump') this.jumpEdge = true;
    if (action === 'reload') this.reloadEdge = true;
    if (action === 'slotPrimary') this.switchEdge = SLOT_INDEX.primary;
    if (action === 'slotSidearm') this.switchEdge = SLOT_INDEX.sidearm;
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

/** Enter or leave fullscreen (needs a user gesture: called from a key press). */
function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  } catch {
    /* ignore */
  }
}
