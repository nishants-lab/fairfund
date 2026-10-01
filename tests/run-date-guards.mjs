/** Run date guards through the cross-platform production-code regression runner. */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
execFileSync(process.execPath, [join(here, 'run-regressions.mjs'), 'tests/date_guards.test.ts'], { stdio: 'inherit' })
