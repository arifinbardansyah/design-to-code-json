// Rasterises the SVG brand assets to PNG (Figma Community needs PNG/JPG for the
// icon + cover). Run: `npm run assets`.
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../assets');

function render(svgName, pngName, width) {
  const svg = fs.readFileSync(path.join(dir, svgName), 'utf8');
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true },
    background: 'rgba(0,0,0,0)',
  });
  const png = r.render().asPng();
  fs.writeFileSync(path.join(dir, pngName), png);
  console.log(`  ${pngName}  ${width}px  ${(png.length / 1024).toFixed(0)}kb`);
}

render('icon.svg', 'icon.png', 256); // 256px source for a 128 listing icon (crisp)
render('cover.svg', 'cover.png', 1920);
console.log('done');
