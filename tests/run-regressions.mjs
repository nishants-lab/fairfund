/** Execute real production TypeScript with Node's built-in test runner.
 * No new dependencies: esbuild is already installed through Vite.
 * Optional arguments select tests; default is every tests/*.test.ts.
 * Bundles live in a scratch directory and are removed on success or failure.
 */
import { execFileSync } from 'node:child_process'
import { buildSync } from 'esbuild'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const args = process.argv.slice(2)
const inputs = args.length ? args.map(p => resolve(root, p))
  : readdirSync(here).filter(p => p.endsWith('.test.ts')).sort().map(p => join(here, p))
if (!inputs.length) throw new Error('No regression tests found')
const akiTmp = join(homedir(), '.aki', 'tmp')
const scratchBase = process.env.FF_TEST_TMPDIR || (existsSync(akiTmp) ? akiTmp : tmpdir())
const scratch = mkdtempSync(join(scratchBase, 'ff-regressions-'))
try {
  const outputs = inputs.map((input, i) => {
    const output = join(scratch, `${i}-${basename(input, '.ts')}.cjs`)
    // esbuild/bin/esbuild becomes a native executable on Unix after npm install.
    // Use the supported JS API rather than asking Node to parse that binary.
    buildSync({
      absWorkingDir: root, entryPoints: [input], bundle: true,
      platform: 'node', format: 'cjs', external: ['pdfjs-dist'],
      define: { __DATA_VERSION__: '"test"', 'import.meta.env': '{"BASE_URL":"./"}' },
      logOverride: { 'empty-import-meta': 'silent' }, outfile: output,
    })
    return output
  })
  execFileSync(process.execPath, ['--test', ...outputs], { cwd: root, stdio: 'inherit' })
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
