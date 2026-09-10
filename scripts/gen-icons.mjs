import sharp from 'sharp';
import { readFileSync } from 'fs';

const root = 'C:/Users/nisan/.aki/tmp/ff-disc/public';
const svg = readFileSync(`${root}/favicon.svg`);

for (const size of [192, 512]) {
  await sharp(svg, { density: Math.ceil(size / 512 * 144) })
    .resize(size, size)
    .png()
    .toFile(`${root}/pwa-${size}.png`);
  console.log(`pwa-${size}.png`);
}

await sharp(svg, { density: Math.ceil(180 / 512 * 144) })
  .resize(180, 180)
  .png()
  .toFile(`${root}/apple-touch-icon.png`);
console.log('apple-touch-icon.png');
