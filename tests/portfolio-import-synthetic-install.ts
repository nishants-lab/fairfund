// Side-effect module: import it FIRST in a test so it runs before src/lib/data.ts
// and src/lib/matcherUniverse.ts read these JSON objects (esbuild keeps import order).
import universe from '../src/data/matcher_universe.json'
import indexData from '../src/data/funds.json'
import { mergeSynthetic } from './portfolio-import-synthetic-data.mjs'
mergeSynthetic(universe as never, indexData as never)
