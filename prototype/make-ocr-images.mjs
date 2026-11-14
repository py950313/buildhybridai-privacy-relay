// Render synthetic documents to PNG: 5 clean screenshots and 5 "phone photo" versions
// (rotation, blur, noise, uneven light). Output: prototype/ocr-images/*.png + manifest.json.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const samples = JSON.parse(readFileSync('prototype/samples.json', 'utf8'));
const picks = [
  ...samples.zh.filter((s) => s.expected.length).slice(0, 3),
  ...samples.en.filter((s) => s.expected.length).slice(0, 2),
];
mkdirSync('prototype/ocr-images', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 360 } });
const manifest = [];
let i = 0;
for (const s of picks) {
  for (const photo of [false, true]) {
    const style = photo
      ? 'transform: rotate(-3.5deg) skewX(2deg); filter: blur(0.9px) contrast(0.8) brightness(1.05);' +
        'background: radial-gradient(circle at 30% 20%, #fff 0%, #e9e4d8 70%, #cfc8b8 100%);'
      : 'background: #fff;';
    const noise = photo
      ? `<canvas id="n" width="900" height="360" style="position:absolute;inset:0;opacity:.18"></canvas>
         <script>const c=document.getElementById('n').getContext('2d');const d=c.createImageData(900,360);
         for(let k=0;k<d.data.length;k+=4){const v=Math.random()*255;d.data[k]=d.data[k+1]=d.data[k+2]=v;d.data[k+3]=255}c.putImageData(d,0,0)</script>`
      : '';
    await page.setContent(`<html><body style="margin:0">
      <div style="position:relative;width:900px;height:360px;overflow:hidden;${style}">
        <div style="padding:40px 48px;font:22px/1.7 'Microsoft JhengHei UI','Segoe UI',sans-serif;color:#222">
          <div style="font-size:15px;color:#777;margin-bottom:12px">Message · 2026-11-14 10:32</div>${s.text}
        </div>${noise}
      </div></body></html>`);
    const name = `${String(++i).padStart(2, '0')}-${photo ? 'photo' : 'screen'}.png`;
    await page.screenshot({ path: `prototype/ocr-images/${name}` });
    manifest.push({ name, photo, expected: s.expected, text: s.text });
  }
}
writeFileSync('prototype/ocr-images/manifest.json', JSON.stringify(manifest, null, 2));
await browser.close();
console.log('wrote', manifest.length, 'images');
