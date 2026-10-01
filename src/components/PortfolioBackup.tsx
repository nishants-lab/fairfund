import { useId, useRef, useState } from 'react'
import type { ParsedPortfolio } from '../lib/portfolio'
import { decryptPortfolioBackup, encryptPortfolioBackup, PortfolioBackupError, readPortfolioBackupFile } from '../lib/portfolioBackup'

interface PortfolioBackupProps {
  portfolio: ParsedPortfolio | null
  onRestore: (portfolio: ParsedPortfolio) => void | Promise<void>
}

const inputClass = 'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg focus:border-brand-500 focus:outline-none'
const buttonClass = 'rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50'
const rupees = (value: number) => value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

export default function PortfolioBackup({ portfolio, onRestore }: PortfolioBackupProps) {
  const id = useId()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ParsedPortfolio | null>(null)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const operation = useRef(false)

  function clearPreview() {
    setPreview(null)
    setApproved(false)
    setError('')
    setStatus('')
  }

  async function run(action: () => Promise<void>) {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof PortfolioBackupError ? err.message : 'The backup operation could not be completed. Check available browser storage or try again.')
    } finally {
      setPassword('')
      setConfirmation('')
      operation.current = false
      setBusy(false)
    }
  }

  function download() {
    if (!portfolio) return
    void run(async () => {
      if (password !== confirmation) throw new PortfolioBackupError('password', 'The passwords do not match. Enter the same password twice.')
      const encrypted = await encryptPortfolioBackup(portfolio, password)
      const url = URL.createObjectURL(new Blob([encrypted], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'fairfund-portfolio.ffbackup'
      document.body.appendChild(link)
      try {
        link.click()
        setStatus('Encrypted backup download requested. Keep the file and password somewhere safe.')
      } finally {
        link.remove()
        // Keep the blob alive until the browser has accepted the download.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    })
  }

  function unlock() {
    if (!file) return
    clearPreview()
    void run(async () => {
      const restored = await decryptPortfolioBackup(await readPortfolioBackupFile(file), password)
      setPreview(restored)
      setStatus('Backup unlocked for review. Your saved portfolio has not changed.')
    })
  }

  function restore() {
    if (!preview || !approved) return
    void run(async () => {
      await onRestore(preview)
      setPreview(null)
      setApproved(false)
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setStatus('Portfolio restored in this browser.')
    })
  }

  const summaries = preview?.fundSummaries ?? []
  const statementValue = summaries.reduce((sum, s) => sum + s.marketValue, 0)

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-5" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg">Encrypted portfolio backup</h2>
      <p className="text-sm text-muted">Download a password-protected copy or restore one on this device. Backup contents and passwords are processed only in your browser and are not uploaded.</p>
      <p className="text-sm text-muted">Choose a strong, unique passphrase of at least 12 characters. FairFund cannot recover a forgotten password. Only the backup file is encrypted; the portfolio saved in this browser remains in local browser storage.</p>
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <div>
          <label htmlFor={`${id}-password`} className="mb-1 block text-sm font-medium text-fg">Backup password</label>
          <input id={`${id}-password`} type="password" autoComplete="off" maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
        </div>
        <div className="space-y-2">
          <label htmlFor={`${id}-confirmation`} className="block text-sm font-medium text-fg">Confirm password for download</label>
          <input id={`${id}-confirmation`} type="password" autoComplete="off" maxLength={1024} value={confirmation} onChange={e => setConfirmation(e.target.value)} className={inputClass} />
          <button type="button" onClick={download} disabled={!portfolio || !password || !confirmation} className={buttonClass}>Download encrypted backup</button>
          {!portfolio && <p className="text-xs text-muted">Save a portfolio before downloading a backup.</p>}
        </div>
        <div className="space-y-2 border-t border-line pt-4">
          <label htmlFor={`${id}-file`} className="block text-sm font-medium text-fg">Restore a backup file (up to 8 MB)</label>
          <input ref={fileInput} id={`${id}-file`} type="file" accept=".ffbackup,.json" className="block w-full text-sm text-fg" onChange={e => { clearPreview(); setFile(e.target.files?.[0] ?? null) }} />
          <button type="button" onClick={unlock} disabled={!file || !password} className={buttonClass}>Unlock and preview backup</button>
        </div>
        {preview && (
          <div className="space-y-3 rounded-lg border border-line bg-bg p-4">
            <h3 className="font-semibold text-fg">Review before restoring</h3>
            <p className="text-sm text-muted">Original import: {new Date(preview.uploadedAt).toLocaleString()}. {summaries.length} statement positions, {preview.fundCodes.length} matched funds, {preview.transactions.length} transactions.</p>
            <p className="text-sm text-muted">Statement market values total: {rupees(statementValue)}. These are saved statement values, not live valuations. Missing statement values are counted as zero here.</p>
            <div className="max-h-60 overflow-auto">
              <table className="w-full text-left text-xs text-fg">
                <thead><tr><th className="p-2">Fund from statement</th><th className="p-2">Matched code</th><th className="p-2">Statement value</th></tr></thead>
                <tbody>{summaries.map((s, index) => <tr key={index} className="border-t border-line"><td className="p-2">{s.fundName}</td><td className="p-2">{s.fundCode || 'Unmatched'}</td><td className="p-2">{rupees(s.marketValue)}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="text-sm text-muted">Restoring replaces the entire saved portfolio in this browser, including its transactions. Download your current backup first if you want to keep it.</p>
            <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} className="mt-1" />I have reviewed this backup and approve replacing the saved portfolio.</label>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={!approved} onClick={restore} className={buttonClass}>Replace saved portfolio</button>
              <button type="button" onClick={() => { clearPreview(); setPassword(''); setConfirmation('') }} className="text-sm font-medium text-muted underline">Cancel restore</button>
            </div>
          </div>
        )}
      </fieldset>
      {busy && <p role="status" className="text-sm text-muted">Processing backup on this device...</p>}
      {status && <p role="status" className="text-sm text-muted">{status}</p>}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
    </section>
  )
}
