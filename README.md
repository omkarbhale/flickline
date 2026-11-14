# Flickline

Start with the vision: [docs/vision.md](docs/vision.md) says what Flickline is for, and every design decision is checked against it.

A first-person aim and movement trainer with tactical-shooter gunplay, instant feedback, and skill-matched difficulty. Browser game: TypeScript, three.js (WebGL), Vite, hosted on GitHub Pages.

## Run

```
npm install
npm run dev         # play at http://127.0.0.1:5173/ (click to lock the mouse)
npm run typecheck
npm test
npm run build       # production build in dist/
```

Controls: WASD move, Space jump, Ctrl/C crouch, Shift walk, 1-3 weapons, R reload, left mouse shoot, Backspace restart, Esc menu/settings, backtick debug overlay. Every key can be rebound in Settings > Keys.

## Contributing

Read the architecture issue in full before touching code: [Architecture and conventions (read first)](https://github.com/omkarbhale/flickline/issues/54). Work is tracked in GitHub issues and pull requests.
