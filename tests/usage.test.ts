import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createUsageTracker, usageEnabled, usageRequest, usageRoute, type UsageEvent, type UsageHit } from '../src/lib/usage'

function fixture() {
  const hits: UsageHit[] = []
  let ready = false
  let enabled = true
  let flush = () => {}
  const tracker = createUsageTracker({
    enabled: () => enabled,
    sink: () => ready ? hit => hits.push(hit) : undefined,
    onReady: callback => { flush = callback },
  })
  return { tracker, hits, load: () => { ready = true; flush() }, disable: () => { enabled = false } }
}

test('route templates never contain scheme IDs, names, search text, fragments or private subpaths', () => {
  for (const [path, expected] of [
    ['/', '/'], ['/explore?search=SECRET', '/explore'], ['/fund/123456/Secret-Scheme', '/fund'],
    ['/category/secret-category', '/category'], ['/compare?funds=123456,999999#SECRET', '/compare'],
    ['/my/portfolio?pan=ABCDE1234F', '/my/portfolio'], ['/my/portfolio/secret', undefined],
    ['/unknown/SECRET', undefined], ['/fund', undefined], ['/category', undefined],
  ]) assert.equal(usageRoute(path!), expected)
})

test('StrictMode repeated effect and rerenders deduplicate; new navigation and back count', () => {
  const { tracker, hits, load } = fixture()
  load()
  tracker.route('/fund/123456', 'a')
  tracker.route('/fund/123456', 'a')
  tracker.route('/fund/999999', 'b')
  tracker.route('/fund/123456', 'a')
  tracker.route('/compare', 'c')
  tracker.route('/compare?funds=SECRET', 'd')
  assert.deepEqual(hits.map(hit => hit.path), ['/fund', '/fund', '/fund', '/compare', '/compare'])
  for (const hit of hits) assert.deepEqual(Object.keys(hit).sort(), ['event', 'path', 'referrer', 'title'])
  assert(hits.every(hit => hit.title === '' && hit.referrer === '' && !hit.event))
})

test('only two fixed completion names are accepted and neither accepts properties', () => {
  const { tracker, hits, load } = fixture()
  load()
  tracker.event('comparison_completed')
  tracker.event('portfolio_import_completed')
  tracker.event('SECRET' as UsageEvent)
  assert.deepEqual(hits, [
    { path: 'comparison_completed', event: true, title: '', referrer: '' },
    { path: 'portfolio_import_completed', event: true, title: '', referrer: '' },
  ])
})

test('delayed script load flushes ordered bounded queue once without polling', () => {
  const { tracker, hits, load } = fixture()
  tracker.route('/compare?SECRET', 'a')
  tracker.event('comparison_completed')
  assert.equal(hits.length, 0)
  load()
  load()
  assert.deepEqual(hits.map(hit => hit.path), ['/compare', 'comparison_completed'])
  const bounded = fixture()
  for (let i = 0; i < 100; i++) bounded.tracker.route('/fund/SECRET', String(i))
  bounded.tracker.event('portfolio_import_completed')
  bounded.load()
  assert.equal(bounded.hits.length, 32)
  assert.equal(bounded.hits.at(-1)?.path, 'portfolio_import_completed')
})

test('DNT enabled before load drops pending events and blocks later events', () => {
  const { tracker, hits, load, disable } = fixture()
  tracker.event('portfolio_import_completed')
  disable()
  load()
  tracker.route('/my/portfolio', 'a')
  tracker.event('comparison_completed')
  assert.deepEqual(hits, [])
})

test('production deployment only, localhost, tests and Do Not Track are excluded', () => {
  const location = { hostname: 'nishants-lab.github.io', pathname: '/fairfund/', protocol: 'https:' }
  assert.equal(usageEnabled(true, location), true)
  assert.equal(usageEnabled(false, location), false)
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'example.test', '192.168.1.2'])
    assert.equal(usageEnabled(true, { ...location, hostname }), false)
  assert.equal(usageEnabled(true, { ...location, pathname: '/another-project/' }), false)
  assert.equal(usageEnabled(true, { ...location, protocol: 'http:' }), false)
  for (const value of ['1', 'yes']) {
    assert.equal(usageEnabled(true, location, value), false)
    assert.equal(usageEnabled(true, location, '0', value), false)
  }
})

test('outbound provider URL is reconstructed without query, title, referrer or dimensions', () => {
  const hit: UsageHit = { path: '/my/portfolio', title: '', referrer: '', event: false }
  const url = usageRequest('https://fairfund.goatcounter.com/count?p=SECRET&q=ABCDE1234F&t=SECRET&r=SECRET&s=1920&future=SECRET&b=153&rnd=abc12#SECRET', hit)!
  assert.equal(url, 'https://fairfund.goatcounter.com/count?p=%2Fmy%2Fportfolio&b=153')
  assert.equal(usageRequest('https://example.test/count', hit), undefined)
  assert.equal(usageRequest('https://fairfund.goatcounter.com/other', hit), undefined)
  assert.equal(usageRequest('https://fairfund.goatcounter.com/count?b=SECRET', { ...hit, path: 'comparison_completed', event: true }),
    'https://fairfund.goatcounter.com/count?p=comparison_completed&e=true')
})

test('telemetry failure cannot throw into navigation or import confirmation', () => {
  const tracker = createUsageTracker({ enabled: () => true, sink: () => () => { throw Error('blocked') }, onReady: () => {} })
  assert.doesNotThrow(() => tracker.event('portfolio_import_completed'))
  assert.doesNotThrow(() => tracker.route('/my/portfolio', 'a'))
})

test('HTML disables automatic page and click counting without changing palette loading', () => {
  const html = readFileSync('index.html', 'utf8')
  const tag = html.match(/<script data-goatcounter=[^>]+>/)![0]
  const settings = JSON.parse(tag.match(/data-goatcounter-settings='([^']+)'/)![1])
  assert.deepEqual(settings, { no_onload: true, no_events: true, path: '/', title: '', referrer: '' })
  assert.match(tag, /referrerpolicy="no-referrer"/)
  assert.match(html, /<script src="\.\/palette.js"><\/script>/)
})
