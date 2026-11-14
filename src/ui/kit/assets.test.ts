import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const fonts = join(root, 'src', 'assets', 'fonts');

describe('bundled fonts', () => {
  const files = readdirSync(fonts).filter((f) => f.endsWith('.woff2'));

  it('are woff2 subsets under 60 kB in total', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
    const total = files.reduce((n, f) => n + statSync(join(fonts, f)).size, 0);
    expect(total).toBeLessThan(60_000);
  });

  it('are listed with their licence in docs/credits.md', () => {
    const credits = readFileSync(join(root, 'docs', 'credits.md'), 'utf8');
    expect(credits).toContain('Barlow');
    expect(credits).toContain('JetBrains Mono');
    expect(credits).toContain('SIL Open Font License');
    for (const f of files) expect(credits, f).toContain(f.replace(/\.woff2$/, ''));
  });

  it('are the only fonts the stylesheets load, from local files', () => {
    const css = readFileSync(join(root, 'src', 'ui', 'kit', 'kit.css'), 'utf8');
    const urls = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1]!);
    expect(urls.length).toBe(files.length);
    for (const u of urls) {
      expect(u).toMatch(/^\.\.\/\.\.\/assets\/fonts\/[\w-]+\.woff2$/);
    }
  });
});

describe('no external requests from the shell', () => {
  it('index.html and the stylesheets name no remote host', () => {
    for (const f of ['index.html', 'src/styles.css', 'src/ui/kit/kit.css', 'src/ui/menu.css']) {
      const text = readFileSync(join(root, f), 'utf8');
      expect(/(?:https?:)?\/\/(?!www\.w3\.org)[\w.-]+\.[a-z]{2,}/i.test(text.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '')), f).toBe(false);
    }
  });
});
