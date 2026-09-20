// Render the editable SVG master with Chromium, then export native icon formats.
// Requires the project's Playwright browser and Python Pillow; ICNS uses macOS iconutil.
import { chromium } from 'playwright';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'tmx-icons-'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.TMX_CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await mkdir(path.join(root, 'build'), { recursive: true });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${await readFile(path.join(root, 'public/brand/tmx-app.svg'), 'utf8')}`);
  await page.screenshot({ path: path.join(root, 'build/icon.png'), omitBackground: true });
  execFileSync('python3', ['-c', `
from PIL import Image
from pathlib import Path
import sys
root, scratch = map(Path, sys.argv[1:])
im = Image.open(root / 'build/icon.png')
im.save(root / 'public/brand/tmx-app.png')
im.save(root / 'build/icon.ico', sizes=[(s,s) for s in (16,24,32,48,64,128,256)])
im.save(root / 'public/favicon.ico', sizes=[(s,s) for s in (16,24,32,48,64)])
folder = scratch / 'tmx.iconset'
folder.mkdir()
for size in (16,32,128,256,512):
    for scale in (1,2):
        suffix = '@2x' if scale == 2 else ''
        im.resize((size*scale,size*scale), Image.Resampling.LANCZOS).save(folder / f'icon_{size}x{size}{suffix}.png')
`, root, scratch], { stdio: 'inherit' });
  if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', path.join(scratch, 'tmx.iconset'), '-o', path.join(root, 'build/icon.icns')], { stdio: 'inherit' });
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
