# TMX identity

Editable, font-independent SVG artwork:

- `tmx-mark.svg`: transparent cyan terminal symbol.
- `tmx-wordmark.svg`: symbol and outlined TMX lettering, for dark surfaces.
- `tmx-app.svg`: desktop icon master, including transparent platform padding.
- `tmx-app.png`: 1024px runtime icon, generated from the master.

The title bar uses the wordmark; About uses the app icon. Native packaging uses
`build/icon.png`, `build/icon.ico`, and `build/icon.icns`; the browser uses
`public/favicon.ico`. Development on macOS also sets the Dock icon.

From the repository root, run `node scripts/export-icons.mjs` after editing the
app master. Requires Python 3 with Pillow and Playwright Chromium
(`npx playwright install chromium`). Set `TMX_CHROMIUM_PATH` to use an existing
Chromium executable. Generate ICNS on macOS, which supplies `iconutil`.

Design: a broad angular command prompt and cyan cursor on a deep navy tile.
All SVGs were authored directly; no external fonts or image-generation API are required.
