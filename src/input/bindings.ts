/** Default key bindings by KeyboardEvent.code (layout independent). Data, so rebinding is easy later. */
export interface Bindings {
  forward: string[];
  back: string[];
  left: string[];
  right: string[];
  jump: string[];
  crouch: string[];
  walk: string[];
  reload: string[];
  toggleDebug: string[];
}

export const defaultBindings: Bindings = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  walk: ['ShiftLeft'],
  reload: ['KeyR'],
  toggleDebug: ['Backquote'],
};
