// Render the editable SVG master with Chromium, then export native icon formats.
// Requires the project's Playwright browser and Python Pillow; ICNS uses macOS iconutil.
import { chromium } from 'playwright';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const scratch = await mkdtemp(path.join(tmpdir(), 'tmx-icons-'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.TMX_CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await mkdir(path.join(root, 'build'), { recursive: true });
  const svg = await readFile(path.join(root, 'public/brand/tmx-app.svg'), 'utf8');
  const style = '<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>';
  await page.setContent(style + svg);
  await page.screenshot({ path: path.join(root, 'build/icon.png'), omitBackground: true });
  // Windows draws icons edge to edge, while the master tile keeps the macOS-style
  // inset. Re-render cropped to the tile so the desktop/taskbar icon matches the
  // size of native app icons instead of looking ~15% smaller.
  const box = await page.evaluate(() => {
    const r = document.querySelector('svg rect');
    return [r.x.baseVal.value, r.y.baseVal.value, r.width.baseVal.value, r.height.baseVal.value];
  });
  const flat = path.join(scratch, 'icon-flat.png');
  await page.setContent(style + svg.replace('viewBox="0 0 1024 1024"', `viewBox="${box.join(' ')}"`));
  await page.screenshot({ path: flat, omitBackground: true });
  execFileSync(python, ['-c', `
from PIL import Image
from pathlib import Path
import sys
root, scratch, flat = map(Path, sys.argv[1:])
im = Image.open(root / 'build/icon.png')
im.save(root / 'public/brand/tmx-app.png')
edge = Image.open(flat)
edge.save(root / 'build/icon.ico', sizes=[(s,s) for s in (16,24,32,48,64,128,256)])
edge.save(root / 'public/favicon.ico', sizes=[(s,s) for s in (16,24,32,48,64)])
folder = scratch / 'tmx.iconset'
folder.mkdir()
for size in (16,32,128,256,512):
    for scale in (1,2):
        suffix = '@2x' if scale == 2 else ''
        im.resize((size*scale,size*scale), Image.Resampling.LANCZOS).save(folder / f'icon_{size}x{size}{suffix}.png')
`, root, scratch, flat], { stdio: 'inherit' });
  if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', path.join(scratch, 'tmx.iconset'), '-o', path.join(root, 'build/icon.icns')], { stdio: 'inherit' });
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
