// Builds src/props.json, the data the video shows, from the lead month of
// ../src/data/holdings_report.json. Reuses the share-media helpers so the video,
// GIF and link card name stocks the same way.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { leadFacts, monthLong, fitName, shortName } from '../scripts/gen-report-media.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NAME_CHARS = 26

export function videoProps(report) {
  const f = leadFacts(report)
  if (!f) return null
  const mo = report.months[report.lead]
  const row = k => mo.stocks[k]
  const name = k => fitName(shortName(row(k).name), NAME_CHARS)
  const sectors = mo.sectors.filter(([n, v]) => Math.abs(v) >= 100 && !/^(unspecified|others?)$/i.test(n))
  return {
    month: f.month,
    monthLong: monthLong(f.month),
    complete: f.complete,
    net: f.totals.net,
    funds: f.totals.funds,
    houses: f.totals.houses,
    inflow: f.totals.inflow,
    cashUsed: f.totals.cashUsed,
    buys: mo.lists.buys.slice(0, 5).map(k => ({ name: name(k), net: row(k).net, funds: row(k).added })),
    sells: mo.lists.sells.slice(0, 5).map(k => ({ name: name(k), net: row(k).net, funds: row(k).cut })),
    sectorsUp: sectors.filter(([, v]) => v > 0).slice(0, 4).map(([n, v]) => ({ name: n, net: v })),
    sectorsDown: sectors.filter(([, v]) => v < 0).slice(-2).reverse().map(([n, v]) => ({ name: n, net: v })),
    newStakes: mo.lists.newEntries.map(row).filter(s => s && s.new >= 3).slice(0, 3)
      .map(s => ({ name: fitName(shortName(s.name), NAME_CHARS), funds: s.new, net: s.net })),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const report = JSON.parse(readFileSync(join(HERE, '../src/data/holdings_report.json'), 'utf-8'))
  const props = videoProps(report)
  if (!props) { console.error('[video] no lead month in the report'); process.exit(1) }
  writeFileSync(join(HERE, 'src/props.json'), JSON.stringify(props, null, 2) + '\n')
  console.log(`[video] props for ${props.month}`)
}
