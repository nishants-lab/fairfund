import test from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import RiskBadge from "../src/components/RiskBadge"
import { riskColor } from "../src/lib/format"
import { RISK_LEVELS } from "../src/lib/moversVocab"
import { mergeFundDetail } from "../src/lib/data"
import type { Fund } from "../src/types"

const levels = ["Low", "Low to Moderate", "Moderate", "Moderately High", "High", "Very High"]

test("all six SEBI levels have badge colors, labels and Movers filters", () => {
  assert.deepEqual(RISK_LEVELS, levels)
  for (const level of levels) {
    assert.notEqual(riskColor(level), riskColor("unknown"))
    const html = renderToStaticMarkup(createElement(RiskBadge, { level }))
    assert.ok(html.includes("SEBI riskometer: " + level))
    assert.ok(html.includes(level + " risk"))
    assert.ok(html.includes(riskColor(level)))
  }
})

test("detail hydration preserves the index risk and observation date", () => {
  const index = { code: 1, sebiRisk: "Moderately High", sebiRiskAsOf: "2026-01-02" } as Fund
  const detail = { sebiRisk: "Low", sebiRiskAsOf: "2020-01-01" }
  assert.equal(mergeFundDetail(index, detail).sebiRisk, index.sebiRisk)
  assert.equal(mergeFundDetail(index, detail).sebiRiskAsOf, index.sebiRiskAsOf)
  assert.equal(mergeFundDetail({ code: 2 } as Fund, detail).sebiRisk, undefined)
})
