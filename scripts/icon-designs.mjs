import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';

const out = 'C:/tmp/icon-options';
mkdirSync(out, { recursive: true });

const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2563eb"/><stop offset="100%" stop-color="#1d4ed8"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/>`;

const designs = {
  // 1. Bold FF
  '01-ff': `${bg}<text x="256" y="310" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="260" fill="#fff" letter-spacing="-12">FF</text>`,

  // 2. F with rising bars
  '02-f-bars': `${bg}<text x="148" y="358" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="320" fill="#fff">F</text><rect x="305" y="280" width="36" height="80" rx="8" fill="rgba(255,255,255,0.5)"/><rect x="352" y="230" width="36" height="130" rx="8" fill="rgba(255,255,255,0.7)"/><rect x="399" y="170" width="36" height="190" rx="8" fill="#10b981"/>`,

  // 3. Clean centered F
  '03-f-clean': `${bg}<text x="256" y="362" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="360" fill="#fff">F</text>`,

  // 4. Three ascending bars (centered, balanced, with baseline)
  '04-bars-centered': `${bg}<rect x="120" y="270" width="70" height="120" rx="14" fill="#fff"/><rect x="221" y="200" width="70" height="190" rx="14" fill="#fff"/><rect x="322" y="130" width="70" height="260" rx="14" fill="#10b981"/><rect x="100" y="400" width="312" height="14" rx="7" fill="rgba(255,255,255,0.6)"/>`,

  // 5. Upward trend line with dot
  '05-trend': `${bg}<polyline points="100,350 200,300 310,200 410,130" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><circle cx="410" cy="130" r="24" fill="#10b981"/><line x1="100" y1="400" x2="410" y2="400" stroke="rgba(255,255,255,0.4)" stroke-width="8" stroke-linecap="round"/>`,

  // 6. F built from bars (the letter F made of horizontal bars)
  '06-f-from-bars': `${bg}<rect x="140" y="100" width="50" height="310" rx="12" fill="#fff"/><rect x="200" y="100" width="180" height="50" rx="12" fill="#fff"/><rect x="200" y="220" width="140" height="45" rx="12" fill="#10b981"/>`,

  // 7. Four bars like an equalizer (ascending then one shorter)
  '07-quad-bars': `${bg}<rect x="100" y="290" width="60" height="100" rx="12" fill="rgba(255,255,255,0.5)"/><rect x="186" y="220" width="60" height="170" rx="12" fill="rgba(255,255,255,0.7)"/><rect x="272" y="140" width="60" height="250" rx="12" fill="#fff"/><rect x="358" y="180" width="60" height="210" rx="12" fill="#10b981"/><rect x="80" y="400" width="358" height="12" rx="6" fill="rgba(255,255,255,0.4)"/>`,

  // 8. Shield/badge with F
  '08-badge-f': `${bg}<path d="M256 90 L390 160 L390 300 Q390 410 256 430 Q122 410 122 300 L122 160 Z" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.6)" stroke-width="8"/><text x="256" y="340" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="240" fill="#fff">F</text>`,

  // 9. Stacked horizontal bars (like a chart rotated, abstract data viz)
  '09-h-bars': `${bg}<rect x="130" y="120" width="260" height="48" rx="12" fill="#fff"/><rect x="130" y="192" width="200" height="48" rx="12" fill="rgba(255,255,255,0.7)"/><rect x="130" y="264" width="240" height="48" rx="12" fill="rgba(255,255,255,0.5)"/><rect x="130" y="336" width="290" height="48" rx="12" fill="#10b981"/>`,

  // 10. F + sparkline (small upward sparkline under the F)
  '10-f-spark': `${bg}<text x="256" y="300" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="300" fill="#fff">F</text><polyline points="140,400 200,390 260,370 320,360 380,340" fill="none" stroke="#10b981" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><circle cx="380" cy="340" r="12" fill="#10b981"/>`,
};

for (const [name, inner] of Object.entries(designs)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner}</svg>`;
  writeFileSync(`${out}/${name}.svg`, svg);
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(512, 512)
    .png()
    .toFile(`${out}/${name}.png`);
  console.log(name);
}
console.log('Done');
