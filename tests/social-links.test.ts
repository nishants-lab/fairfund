import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const IG = 'https://www.instagram.com/fairfund_mutualfunds/'

test('the site footer links to the FairFund Instagram account in a new tab', () => {
  const src = readFileSync('src/components/Footer.tsx', 'utf-8')
  assert.match(src, /INSTAGRAM_HANDLE = 'fairfund_mutualfunds'/)
  assert.match(src, /https:\/\/www\.instagram\.com\/\$\{INSTAGRAM_HANDLE\}\//)
  assert.match(src, /href=\{INSTAGRAM_URL\}[\s\S]{0,80}target="_blank"[\s\S]{0,40}rel="noopener noreferrer"/)
})

test('pre-built crawler pages carry the same Instagram link', () => {
  assert.ok(readFileSync('scripts/gen-unfurls.mjs', 'utf-8').includes(`href="${IG}"`))
})
