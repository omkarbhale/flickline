import './styles.css';
import { Game } from './app/game';
import { installDebugHook } from './debug/hook';

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLElement;
  const menu = document.getElementById('menu') as HTMLElement;
  const debug = document.getElementById('debug') as HTMLElement;
  try {
    const game = new Game(canvas, hud, menu, debug);
    installDebugHook(game);
    game.start();
  } catch (err) {
    console.error(err);
    menu.classList.add('open');
    menu.innerHTML = '<div class="panel"><h1>FLICKLINE</h1><p class="tag">Could not start: WebGL is required.</p></div>';
  }
}

boot();
