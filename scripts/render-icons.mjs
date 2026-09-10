import sharp from 'sharp';
import { readFileSync } from 'fs';

for (const name of ['a', 'b', 'c', 'd']) {
  const svg = readFileSync(`/tmp/icon-options/${name}.svg`);
  await sharp(svg, { density: 144 })
    .resize(512, 512)
    .png()
    .toFile(`/tmp/icon-options/${name}.png`);
  console.log(`Rendered ${name}.png`);
}
