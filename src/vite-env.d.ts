/// <reference types="vite/client" />

declare const __DATA_VERSION__: string

// Served by build/split-regimes.ts; typed precisely in src/lib/regimesByFund.ts.
declare module 'virtual:fund-regimes' {
  const regimes: Record<string, unknown[]>
  export default regimes
}
