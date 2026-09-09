import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = 'C:/Users/nisan/.aki/tmp/ff-disc/public';
const svg = readFileSync(join(root, 'favicon.svg'));

for (const size of [192, 512]) {
  await sharp(svg, { density: Math.ceil(size / 32 * 72) })
    .resize(size, size)
    .png()
    .toFile(join(root, `pwa-${size}.png`));
  console.log(`Created pwa-${size}.png`);
}

// Apple touch icon (180x180)
await sharp(svg, { density: Math.ceil(180 / 32 * 72) })
  .resize(180, 180)
  .png()
  .toFile(join(root, 'apple-touch-icon.png'));
console.log('Created apple-touch-icon.png');
