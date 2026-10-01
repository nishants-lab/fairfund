/** Own an ephemeral loopback Vite server for actual React browser regressions.
 * Default: development server, including internal index-immutability assertions.
 * --built: production dist/ (run the full build first), with black-box UI checks.
 * Playwright Chromium must already be installed. No statements leave the browser.
 * Listen completion is awaited directly, with no polling or sleep loop.
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, preview } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--built')) throw new Error('Usage: node tests/run-browser-regressions.mjs [--built]')
const built = args.includes('--built')
// Vite/Tailwind resolve some plugins relative to cwd.
process.chdir(root)
const listen = { host: '127.0.0.1', port: 0, strictPort: true, open: false }
const server = built ? await preview({ root, preview: listen }) : await createServer({ root, server: listen })
try {
  if (!built) await server.listen()
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('No loopback listen address')
  const env = { ...process.env, FF_TEST_BASE_URL: `http://127.0.0.1:${address.port}`, FF_TEST_BUILT: built ? '1' : '0' }
  for (const file of ['hydration-browser.cjs', 'homepage-browser.cjs', 'portfolio-browser.cjs', 'copy-browser.cjs', ...(built ? ['seo-browser.cjs'] : [])]) {
    console.log(`${built ? 'PRODUCTION' : 'DEVELOPMENT'} BROWSER ${file}`)
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(root, 'tests', file)], { cwd: root, env, stdio: 'inherit' })
      const timer = setTimeout(() => { child.kill(); reject(new Error(`${file} deadline exceeded`)) }, 120000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        code === 0 ? resolve() : reject(new Error(`${file} failed: ${code ?? signal}`))
      })
    })
  }
  console.log(`ALL ${built ? 'BUILT-ARTIFACT' : 'DEVELOPMENT'} BROWSER JOURNEYS PASSED`)
} finally {
  if (built) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  else await server.close()
}
