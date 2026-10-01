import type { ParsedPortfolio } from './portfolio'
import { isIsoDate } from './marketDate'

export const MAX_BACKUP_BYTES = 8 * 1024 * 1024
const MAX_PORTFOLIO_BYTES = 5 * 1024 * 1024
const MAX_TRANSACTIONS = 20_000
const MAX_FUNDS = 2_000
const ITERATIONS = 600_000
const FORMAT = 'fairfund-portfolio'
const encoder = new TextEncoder()

export class PortfolioBackupError extends Error {
  constructor(public readonly code: 'size' | 'format' | 'version' | 'schema' | 'password' | 'authentication' | 'unavailable', message: string) {
    super(message)
    this.name = 'PortfolioBackupError'
  }
}

function invalidSchema(): never {
  throw new PortfolioBackupError('schema', 'This backup does not contain a valid FairFund portfolio. Nothing has been replaced.')
}

function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalidSchema()
  const result = value as Record<string, unknown>
  if (required.some(key => !Object.hasOwnProperty.call(result, key)) || Object.keys(result).some(key => !required.includes(key) && !optional.includes(key))) invalidSchema()
  return result
}

function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value)
}

function amount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e15
}

function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalidSchema()
  return value
}

function optionalDate(value: unknown): boolean {
  return value === undefined || value === null || isIsoDate(value)
}

export function validateBackupPortfolio(value: unknown): asserts value is ParsedPortfolio {
  const p = record(value, ['id', 'uploadedAt', 'investorName', 'pan', 'transactions', 'fundSummaries', 'fundCodes'], ['matcherVersion', 'diagnostics'])
  if (!text(p.id, 128) || !text(p.investorName, 500, true) || typeof p.pan !== 'string' || (p.pan !== '' && !/^XXXX[a-zA-Z0-9]{4}$/.test(p.pan))) invalidSchema()
  if (typeof p.uploadedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.uploadedAt) || !Number.isFinite(Date.parse(p.uploadedAt)) || new Date(p.uploadedAt).toISOString() !== p.uploadedAt) invalidSchema()
  if (p.matcherVersion !== undefined && !integer(p.matcherVersion, 1_000_000)) invalidSchema()
  const foundCodes = new Set<number>()
  for (const entry of array(p.transactions, MAX_TRANSACTIONS)) {
    const t = record(entry, ['fundCode', 'fundName', 'date', 'type', 'units', 'amount', 'nav'])
    if (!integer(t.fundCode, 999_999_999) || !text(t.fundName, 1000) || !isIsoDate(t.date) || !['purchase', 'redeem', 'sip', 'switch_in', 'switch_out', 'dividend'].includes(t.type as string) || !amount(t.units) || !amount(t.amount) || !amount(t.nav)) invalidSchema()
    if (t.fundCode > 0) foundCodes.add(t.fundCode)
  }
  for (const entry of array(p.fundSummaries, MAX_FUNDS)) {
    const s = record(entry, ['fundCode', 'fundName', 'closingUnits', 'totalCost', 'latestNav', 'marketValue'], ['navDate', 'marketValueDate', 'openingUnits', 'historyUnusable'])
    if (!integer(s.fundCode, 999_999_999) || !text(s.fundName, 1000) || !amount(s.closingUnits) || !amount(s.totalCost) || !amount(s.latestNav) || !amount(s.marketValue) || !optionalDate(s.navDate) || !optionalDate(s.marketValueDate)) invalidSchema()
    if (s.openingUnits !== undefined && s.openingUnits !== null && !amount(s.openingUnits)) invalidSchema()
    if (s.historyUnusable !== undefined && typeof s.historyUnusable !== 'boolean') invalidSchema()
    if (s.fundCode > 0) foundCodes.add(s.fundCode)
  }
  const codes = array(p.fundCodes, MAX_FUNDS)
  for (const code of codes) if (!integer(code, 999_999_999) || code === 0 || !foundCodes.has(code)) invalidSchema()
  if (new Set(codes).size !== codes.length || codes.length !== foundCodes.size) invalidSchema()
  if (p.diagnostics !== undefined) {
    const d = record(p.diagnostics, ['isinCount', 'schemesParsed', 'activeHoldings', 'closedPositions', 'missingValueFunds', 'statedTotalValue'])
    for (const field of ['isinCount', 'schemesParsed', 'activeHoldings', 'closedPositions']) if (!integer(d[field], MAX_TRANSACTIONS)) invalidSchema()
    for (const name of array(d.missingValueFunds, MAX_FUNDS)) if (!text(name, 1000)) invalidSchema()
    if (d.statedTotalValue !== null && !amount(d.statedTotalValue)) invalidSchema()
  }
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) throw new PortfolioBackupError('unavailable', 'Encrypted backups require a supported browser on HTTPS or localhost.')
  return globalThis.crypto
}

function checkPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024 || !password.trim()) {
    throw new PortfolioBackupError('password', 'Use a password or passphrase between 12 and 1,024 characters.')
  }
}

function checkSize(size: number, max = MAX_BACKUP_BYTES): void {
  if (!Number.isSafeInteger(size) || size <= 0 || size > max) throw new PortfolioBackupError('size', 'The backup is empty or too large. The maximum backup file size is 8 MB (5 MB of portfolio data).')
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

function unbase64(value: unknown, min: number, max: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) invalidFormat()
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
  if (bytes.length < min || bytes.length > max || base64(bytes) !== value) invalidFormat()
  return bytes
}

function invalidFormat(): never {
  throw new PortfolioBackupError('format', 'This is not a complete FairFund encrypted backup. The file may be damaged or truncated.')
}

function header(salt: string, iv: string) {
  return { format: FORMAT, version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt, iv }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
  const crypto = requireCrypto()
  const passwordBytes = encoder.encode(password)
  try {
    const material = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey'])
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [usage])
  } finally {
    passwordBytes.fill(0)
  }
}

export async function encryptPortfolioBackup(portfolio: ParsedPortfolio, password: string): Promise<string> {
  checkPassword(password)
  validateBackupPortfolio(portfolio)
  const plaintext = encoder.encode(JSON.stringify(portfolio))
  try {
    checkSize(plaintext.byteLength, MAX_PORTFOLIO_BYTES)
    const crypto = requireCrypto()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const metadata = header(base64(salt), base64(iv))
    const key = await deriveKey(password, salt, 'encrypt')
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(JSON.stringify(metadata)), tagLength: 128 }, key, plaintext)
    const output = JSON.stringify({ ...metadata, ciphertext: base64(new Uint8Array(ciphertext)) })
    checkSize(encoder.encode(output).byteLength)
    return output
  } finally {
    plaintext.fill(0)
  }
}

export async function decryptPortfolioBackup(content: string, password: string): Promise<ParsedPortfolio> {
  checkSize(content.length)
  checkSize(encoder.encode(content).byteLength)
  let value: unknown
  try { value = JSON.parse(content) } catch { invalidFormat() }
  let envelope: Record<string, unknown>
  try { envelope = record(value, ['format', 'version', 'cipher', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext']) } catch { invalidFormat() }
  if (envelope.format !== FORMAT) invalidFormat()
  if (envelope.version !== 1) throw new PortfolioBackupError('version', 'This backup version is not supported. Nothing has been replaced.')
  if (envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS) invalidFormat()
  const salt = unbase64(envelope.salt, 16, 16)
  const iv = unbase64(envelope.iv, 12, 12)
  const ciphertext = unbase64(envelope.ciphertext, 17, MAX_PORTFOLIO_BYTES + 16)
  checkPassword(password)
  const key = await deriveKey(password, salt, 'decrypt')
  let plaintext: ArrayBuffer
  try {
    plaintext = await requireCrypto().subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(JSON.stringify(header(envelope.salt as string, envelope.iv as string))), tagLength: 128 }, key, ciphertext)
  } catch {
    throw new PortfolioBackupError('authentication', 'Could not unlock this backup. The password is incorrect or the file has been changed or damaged. Nothing has been replaced.')
  }
  const bytes = new Uint8Array(plaintext)
  try {
    checkSize(bytes.byteLength, MAX_PORTFOLIO_BYTES)
    let portfolio: unknown
    try { portfolio = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { invalidSchema() }
    validateBackupPortfolio(portfolio)
    return portfolio
  } finally {
    bytes.fill(0)
  }
}

export async function readPortfolioBackupFile(file: Pick<File, 'size' | 'text'>): Promise<string> {
  checkSize(file.size)
  const content = await file.text()
  checkSize(content.length)
  checkSize(encoder.encode(content).byteLength)
  return content
}
