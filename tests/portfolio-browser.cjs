/**
 * Local browser regression for the portfolio holdings table, against the actual
 * React page. Guards that a holding's XIRR is labelled with the statement's own
 * valuation date, that an undated (legacy) holding shows the re-import prompt
 * instead of a number, and that neither changes when the clock moves.
 *
 * Start npm run dev -- --host 127.0.0.1 --port 4190 in the repo, then run:
 *   node tests/portfolio-browser.cjs
 * Override the local URL with FF_TEST_BASE_URL. Requires installed Playwright
 * Chromium.
 *
 * No real statement data: the portfolio is synthetic and injected into
 * localStorage, which is the only state the page reads. Nothing is uploaded, no
 * artifact is written, and live NAV is stubbed offline.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const base = process.env.FF_TEST_BASE_URL || 'http://127.0.0.1:4190';
// Read the fixture version from the source for this build without importing a
// dev-only module URL. This keeps the same UI checks runnable against dist/.
const matcherSource = fs.readFileSync(`${root}/src/lib/camsParser.ts`, 'utf8');
const matcherMatch = matcherSource.match(/^export const MATCHER_VERSION = (\d+)\s*;?$/m);
assert.ok(matcherMatch, 'MATCHER_VERSION must be a numeric source constant');
const matcherVersion = Number(matcherMatch[1]);

// Three funds that exist in the bundled index, so every row is "covered" and the
// holdings table renders it.
const DATED_CODE = 122639;        // dated statement, complete history: a number
const UNDATED_CODE = 149936;      // no statement date: the re-import prompt
const DATED_NO_NUMBER_CODE = 125497; // dated, but the history cannot support a number
const DATED_NAME = 'Parag Parikh Flexi Cap Fund';
const UNDATED_NAME = 'Axis Nifty Midcap 50 Index Fund';
const DATED_NO_NUMBER_NAME = 'SBI Small Cap Fund';
// Fixture dates only. The valuation date is deliberately old, so a clock-dated
// terminal flow would be visibly wrong rather than merely stale, and so a label
// without a year would misread as this year.
const VALUATION_DATE = '2024-03-28';
const VALUATION_LABEL = '28 Mar 2024';
// A cell without a number says so, without naming a reason: a missing date is
// only one of them. The as-of line is independent, so a known valuation date is
// still shown. The re-import advice lives in the section paragraph, as general
// guidance, not per row.
const UNAVAILABLE_COPY = 'XIRR unavailable.';
const REIMPORT_COPY = 'Re-import older statements to capture missing dates.';

/** A parsed statement in the shape localStorage holds, with one dated holding and one legacy one. */
function syntheticPortfolio(matcherVersion) {
  return {
    id: 'browser-test',
    uploadedAt: '2026-09-30T00:00:00.000Z',
    matcherVersion,
    investorName: 'Test Investor',
    pan: 'XXXX1234',
    transactions: [
      { fundCode: DATED_CODE, fundName: 'Dated Scheme', date: '2023-03-28', type: 'purchase', units: 100, amount: 100000, nav: 1000 },
      { fundCode: UNDATED_CODE, fundName: 'Legacy Scheme', date: '2023-03-28', type: 'purchase', units: 100, amount: 100000, nav: 1000 },
      { fundCode: DATED_NO_NUMBER_CODE, fundName: 'Partial Scheme', date: '2023-03-28', type: 'purchase', units: 100, amount: 100000, nav: 1000 },
    ],
    fundSummaries: [
      {
        fundCode: DATED_CODE, fundName: 'Dated Scheme', closingUnits: 100, totalCost: 100000,
        latestNav: 2000, marketValue: 200000,
        navDate: VALUATION_DATE, marketValueDate: VALUATION_DATE, openingUnits: 0, historyUnusable: false,
      },
      // No navDate / marketValueDate at all: a portfolio parsed before the
      // statement dates were captured.
      { fundCode: UNDATED_CODE, fundName: 'Legacy Scheme', closingUnits: 100, totalCost: 100000, latestNav: 1500, marketValue: 150000 },
      // Dated, but the opening balance was never read, so no return can be
      // derived. The date is known, so this row must NOT prompt a re-import.
      {
        fundCode: DATED_NO_NUMBER_CODE, fundName: 'Partial Scheme', closingUnits: 100, totalCost: 100000,
        latestNav: 1500, marketValue: 150000, navDate: VALUATION_DATE, marketValueDate: VALUATION_DATE,
      },
    ],
    fundCodes: [DATED_CODE, UNDATED_CODE, DATED_NO_NUMBER_CODE],
    diagnostics: { isinCount: 3, schemesParsed: 3, activeHoldings: 3, closedPositions: 0, missingValueFunds: [], statedTotalValue: 500000 },
  };
}

/** A row of the holdings table, located by the fund name link it carries. */
function rowFor(page, name) {
  return page.getByRole('row').filter({ hasText: name });
}

async function openPortfolio(context, { clockOffsetDays = 0 } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.mfapi.in/**', route => route.abort());
  // Statement values are the source of truth for this table; no NAV history
  // keeps the 1-day column out of the assertions.
  await page.route('**/nav/*.json*', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/fund-data/*.json*', route => {
    const code = route.request().url().match(/fund-data\/(\d+)/)[1];
    const file = `${root}/public/fund-data/${code}.json`;
    if (!fs.existsSync(file)) return route.fulfill({ contentType: 'application/json', body: '{}' });
    return route.fulfill({ contentType: 'application/json', body: fs.readFileSync(file, 'utf8') });
  });
  if (clockOffsetDays) {
    await page.addInitScript(offset => {
      const shift = offset * 86400000;
      const RealDate = Date;
      const now = () => RealDate.now() + shift;
      // eslint-disable-next-line no-global-assign
      Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [now()])); }
        static now() { return now(); }
      };
    }, clockOffsetDays);
  }
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(p => { localStorage.setItem('fairfund_portfolio', JSON.stringify(p)); }, syntheticPortfolio(matcherVersion));
  await page.evaluate(() => { location.hash = '/my/portfolio'; });
  await page.getByRole('columnheader', { name: /XIRR/ }).waitFor();
  await rowFor(page, DATED_NAME).first().waitFor();
  return { page, errors };
}

/** The XIRR cell text of a row: the percentage plus its caption. */
async function xirrCell(page, name) {
  const cells = rowFor(page, name).first().locator('td');
  return (await cells.nth(4).innerText()).replace(/\s+/g, ' ').trim();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const allErrors = [];

    // Mobile: both labels present, and no page-level horizontal overflow.
    const mobile = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const { page, errors } = await openPortfolio(mobile);
    allErrors.push(...errors);

    const datedCell = await xirrCell(page, DATED_NAME);
    // 100,000 on 28 Mar 2023 worth 200,000 on the statement's 28 Mar 2024: a
    // doubling over one year, so about +100%. A terminal flow dated from the
    // clock instead would spread that doubling over every year since and read
    // far lower, which is the regression this pins.
    const datedPct = Number(datedCell.match(/^\+(\d+\.\d)%/)?.[1]);
    assert.ok(datedPct > 95 && datedPct < 105, `dated XIRR must be the statement-window return, got ${datedCell}`);
    assert.match(datedCell, new RegExp(`as of ${VALUATION_LABEL}$`), `dated XIRR must be labelled with the statement date, got ${datedCell}`);
    console.log('PASS dated holding shows its statement valuation date:', datedCell);

    // Neither holding has a number. Both say so, and neither carries the
    // paragraph's re-import advice.
    const legacyCell = await xirrCell(page, UNDATED_NAME);
    const partialCell = await xirrCell(page, DATED_NO_NUMBER_NAME);
    for (const [label, cell] of [['undated', legacyCell], ['partial-history', partialCell]]) {
      assert.ok(cell.startsWith('\u2014'), `${label} XIRR must be blank, got ${cell}`);
      assert.ok(cell.includes(UNAVAILABLE_COPY), `${label} cell must read as unavailable, got ${cell}`);
      assert.equal(cell.includes(REIMPORT_COPY), false, `${label} cell must not carry the paragraph advice, got ${cell}`);
    }
    // The two differ in exactly one way: the statement gave a date for one of
    // them, and that date survives the absence of a number.
    assert.equal(legacyCell.includes('as of'), false, `an undated holding must not claim a date, got ${legacyCell}`);
    assert.match(partialCell, new RegExp(`as of ${VALUATION_LABEL}$`), `a known valuation date must survive, got ${partialCell}`);
    console.log('PASS unavailable holdings say so; a known valuation date is still shown');

    // The re-import advice is general guidance, so it appears once in the section
    // paragraph rather than in any row.
    const holdingsCopy = await page.getByText(REIMPORT_COPY, { exact: false }).first().innerText();
    assert.ok(holdingsCopy.includes('XIRR uses the statement valuation date.'), `holdings paragraph copy, got ${holdingsCopy}`);
    console.log('PASS the holdings paragraph carries the valuation-date and re-import copy');

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page-level overflow at 360px');
    console.log('PASS no page-level overflow at 360px');
    await mobile.close();

    // Desktop: same two labels, same return, no page-level overflow.
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const wide = await openPortfolio(desktop);
    allErrors.push(...wide.errors);
    assert.equal(await xirrCell(wide.page, DATED_NAME), datedCell, 'desktop must report the same dated XIRR');
    assert.ok((await xirrCell(wide.page, UNDATED_NAME)).includes(UNAVAILABLE_COPY), 'desktop unavailable cell');
    assert.equal(await xirrCell(wide.page, DATED_NO_NUMBER_NAME), partialCell, 'desktop partial-history parity');
    assert.equal(await wide.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'desktop page-level overflow at 1280px');
    console.log('PASS desktop parity and no page-level overflow at 1280px');
    await desktop.close();

    // The clock moved two years and the statement did not. Both the number and
    // its date label must be byte-identical to the first load.
    const future = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const later = await openPortfolio(future, { clockOffsetDays: 730 });
    allErrors.push(...later.errors);
    assert.equal(await xirrCell(later.page, DATED_NAME), datedCell, 'XIRR must not move with the clock');
    assert.ok((await xirrCell(later.page, UNDATED_NAME)).includes(UNAVAILABLE_COPY), 'an undated holding stays unavailable');
    assert.equal(await xirrCell(later.page, DATED_NO_NUMBER_NAME), partialCell, 'the date label must not drift with the clock');
    console.log('PASS XIRR and its date label are unchanged after a two-year clock shift');

    // Reload invariant: the same stored statement renders the same cells.
    await later.page.reload({ waitUntil: 'networkidle' });
    await later.page.getByRole('columnheader', { name: /XIRR/ }).waitFor();
    assert.equal(await xirrCell(later.page, DATED_NAME), datedCell, 'reload must not change the XIRR');
    console.log('PASS XIRR is unchanged across a reload');
    await future.close();

    assert.deepEqual(allErrors, [], 'browser page errors');
    console.log('PASS no browser page errors');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
