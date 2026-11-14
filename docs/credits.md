# Credits and licences

Everything Flickline ships is original or openly licensed. This file lists what is not written by the project, and under which licence. Nothing is loaded from a third-party host at runtime: every file below is bundled with the build.

## Fonts

Both families are licensed under the **SIL Open Font License, Version 1.1** (https://openfontlicense.org). Neither declares a Reserved Font Name, so the subset files may keep the family name. They are redistributed here as **woff2 subsets** (Basic Latin plus `· × — – ° … ’ ‘ “ ” ± −`) cut from the upstream release with `subset-font`; no glyph was redrawn. The three files together are about 37 kB.

| Family | Used for | Weights shipped | Files | Copyright | Source |
|---|---|---|---|---|---|
| Barlow | Interface text | 500, 700 | `src/assets/fonts/barlow-500.woff2`, `barlow-700.woff2` | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) | https://github.com/jpt/barlow |
| JetBrains Mono | Numbers (scores, dials, key hints) | 600 | `src/assets/fonts/jetbrains-mono-600.woff2` | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | https://github.com/JetBrains/JetBrainsMono |

The upstream files came from the `@fontsource/barlow` and `@fontsource/jetbrains-mono` npm packages (version 5.3.0), which repackage the upstream fonts unchanged under the same licence. They are not a dependency of the project.

### SIL Open Font License 1.1, summary of what it allows

You may use, study, copy, embed, modify and redistribute the fonts, including in commercial products, provided that the copyright notice and licence travel with them, the fonts are not sold on their own, and a modified version does not use a Reserved Font Name (none is declared for these two families). The full licence texts, with each family's copyright notice, are kept in this repository: [`licenses/barlow-OFL.txt`](licenses/barlow-OFL.txt) and [`licenses/jetbrains-mono-OFL.txt`](licenses/jetbrains-mono-OFL.txt).

## Icons and wordmark

The wordmark and every icon (`src/ui/kit/wordmark.ts`, `src/ui/kit/icons.ts`) are drawn for this project as inline SVG. They are not taken from any icon set or font.

## Audio

All audio is synthesised by code in `src/audio/`. See `docs/audio.md`.

## Art

All visuals are procedural; there are no textures or image files. See design section 11 and section 16.
