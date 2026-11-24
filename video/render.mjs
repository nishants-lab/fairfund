// Renders the monthly fund buying video from ../src/data/holdings_report.json.
//   node render.mjs            mp4 + poster into ../public/media, manifest into ../src/data/report_video.json
//   node render.mjs --stills   one PNG per scene into out/, for review
// Set REMOTION_BROWSER to a Chrome or chrome-headless-shell binary to skip Remotion's browser download.
// Older months' videos are removed so the repository keeps one.
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { videoProps } from './props.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const report = JSON.parse(readFileSync(join(ROOT, 'src/data/holdings_report.json'), 'utf-8'))
const inputProps = videoProps(report)
if (!inputProps) { console.error('[video] no lead month in the report'); process.exit(1) }
writeFileSync(join(HERE, 'src/props.json'), JSON.stringify(inputProps, null, 2) + '\n')

const browserExecutable = process.env.REMOTION_BROWSER || null
const t0 = Date.now()
const serveUrl = await bundle({ entryPoint: join(HERE, 'src/index.ts') })
const composition = await selectComposition({ serveUrl, id: 'FundBuying', inputProps, browserExecutable })

if (process.argv.includes('--stills')) {
  mkdirSync(join(HERE, 'out'), { recursive: true })
  // Late in each scene, once its animation has settled.
  const at = [75, 245, 445, 640, 790, 930, 1040].filter(f => f < composition.durationInFrames)
  for (const frame of at) {
    await renderStill({ composition, serveUrl, inputProps, frame, output: join(HERE, `out/frame-${frame}.png`), browserExecutable })
  }
  console.log(`[video] ${at.length} stills in out/ (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
} else {
  const media = join(ROOT, 'public/media')
  mkdirSync(media, { recursive: true })
  for (const f of readdirSync(media)) if (/^fund-buying-\d{4}-\d{2}\.(mp4|jpg)$/.test(f)) rmSync(join(media, f))
  const base = `fund-buying-${inputProps.month}`
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', crf: 26, pixelFormat: 'yuv420p',
    outputLocation: join(media, `${base}.mp4`), browserExecutable,
  })
  await renderStill({ composition, serveUrl, inputProps, frame: 445, imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5, output: join(media, `${base}.jpg`), browserExecutable })
  const manifest = {
    month: inputProps.month, video: `media/${base}.mp4`, poster: `media/${base}.jpg`,
    seconds: Math.round(composition.durationInFrames / composition.fps), width: 1080, height: 1920,
  }
  writeFileSync(join(ROOT, 'src/data/report_video.json'), JSON.stringify(manifest, null, 2) + '\n')
  const mb = (statSync(join(media, `${base}.mp4`)).size / 1e6).toFixed(1)
  console.log(`[video] ${inputProps.month}: ${base}.mp4 (${mb} MB, ${manifest.seconds}s) in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
