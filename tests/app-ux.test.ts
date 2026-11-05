import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryFundsLabel } from '../src/lib/format'
import { categoryDisplay, data } from '../src/lib/data'
import { fundRows } from '../src/lib/moversRows'
import { freshState } from '../src/lib/moversState'
import type { Fund } from '../src/types'
import type { MoversData } from '../src/lib/moversData'

test('category labels share the Explore mapping and avoid doubled funds', () => {
  for (const [key, value] of Object.entries(data.categories)) assert.equal(categoryDisplay(key), value.display)
  assert.equal(categoryDisplay('unknown'), 'unknown')
  assert.equal(categoryDisplay('Index-MidCap'), 'Index - Mid Cap')
  assert.equal(categoryDisplay('Value/Contra'), 'Value / Contra')
  assert.equal(categoryFundsLabel('Index Funds'), 'Index Funds')
  assert.equal(categoryFundsLabel('  INDEX FUNDS  '), 'INDEX FUNDS')
  assert.equal(categoryFundsLabel('Small Cap'), 'Small Cap funds')
})

const fixture = (extra: Partial<Fund> = {}): Fund => ({
  code: 1, name: 'Example Fund', fullName: 'Example Fund', amc: 'Example', category: 'Flexi Cap',
  categoryDisplay: 'Flexi Cap', categorySize: 1, riskLevel: 'Moderate', sebiRisk: 'Very High',
  metrics: {}, inceptionDate: '2020-01-01', expenseRatio: 0.6, ...extra,
} as Fund)
const movers: MoversData = {
  generatedAt: '2026-11-06', refMonth: '2026-10', windows: [1, 3, 6], stockWindows: [1, 3],
  funds: { '1': { t: { now: 0.6, '1': 0.3, '3': -0.1, '6': 0.2 } } }, mgrLog: [], stocks: [],
}

test('risk filters use SEBI risk and never fall back to category risk', () => {
  const s = { ...freshState('cost'), risk: ['Very High'] }
  assert.equal(fundRows([fixture()], movers, s).length, 1)
  assert.equal(fundRows([fixture()], movers, { ...s, risk: ['Moderate'] }).length, 0)
  assert.equal(fundRows([fixture({ sebiRisk: undefined })], movers, { ...s, risk: ['Moderate'] }).length, 0)
})

test('TER changes omit launch artefacts across windows without hiding current TER', () => {
  for (const win of [1, 3, 6] as const) {
    const s = { ...freshState('cost'), measure: 'terChange' as const, win }
    assert.equal(fundRows([fixture()], movers, s).length, 1)
    for (const extra of [{ isYoung: true }, { inceptionDate: '2026-01-01' }, { inceptionDate: '2025-11-07' }]) {
      const f = fixture(extra)
      assert.equal(fundRows([f], movers, s).length, 0)
      assert.equal(fundRows([f], movers, { ...s, names: ['example'] }).length, 0)
      assert.equal(fundRows([f], movers, freshState('cost')).length, 1)
    }
    assert.equal(fundRows([fixture({ inceptionDate: '2025-11-06' })], movers, s).length, 1)
  }
})
