import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { parseIBKRCsv, tradeFingerprint } from '../lib/ibkrParser'
import { formatMoney, formatDate, formatNumber } from '../lib/formatters'

export default function ImportTrades() {
  const [step, setStep] = useState(1)
  const [portfolios, setPortfolios] = useState([])
  const [selectedPortfolio, setSelectedPortfolio] = useState(null)
  const [file, setFile] = useState(null)
  const [parsedData, setParsedData] = useState(null)
  const [duplicates, setDuplicates] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importHistory, setImportHistory] = useState([])
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef(null)

  // Fetch portfolios and import history
  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: pData }, { data: iData }] = await Promise.all([
      supabase
        .from('portfolios')
        .select('*, positions(id)')
        .order('created_at', { ascending: true }),
      supabase
        .from('imports')
        .select('*, portfolio:portfolios!inner(id, name)')
        .order('imported_at', { ascending: false }),
    ])
    setPortfolios(pData || [])
    setImportHistory(iData || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Last import date for the selected portfolio
  const lastImport = selectedPortfolio
    ? importHistory.find(i => i.portfolio_id === selectedPortfolio.id && i.status === 'active')
    : null

  // ── File handling ──

  function handleDragOver(e) {
    e.preventDefault()
    setDragActive(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    setDragActive(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragActive(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  function handleFileChange(e) {
    const f = e.target.files[0]
    if (f) processFile(f)
  }

  async function processFile(f) {
    setError(null)
    setFile(f)

    try {
      const csvText = await f.text()

      // Use server-side preview (parses CSV + detects duplicates in one call)
      const { data, error } = await supabase.functions.invoke('import-ibkr-preview', {
        body: { portfolioId: selectedPortfolio.id, csvText },
      })

      if (error) throw new Error(error.message || 'Preview failed')

      // data.trades already have isDuplicate flag from server
      const previewResult = {
        trades: data.trades || [],
        dividends: data.dividends || [],
        endingCash: data.endingCash ?? null,
        startingCash: data.startingCash ?? null,
        errors: data.parseErrors || [],
      }
      setParsedData(previewResult)

      // Build duplicates set from server response
      const duplicateFingerprints = new Set(
        (data.trades || [])
          .filter(t => t.isDuplicate)
          .map(t => tradeFingerprint(t))
      )
      setDuplicates(duplicateFingerprints)
      setStep(4)
    } catch (err) {
      // Fallback: client-side parsing if Edge Function unavailable
      try {
        const text = await f.text()
        const result = parseIBKRCsv(text)
        setParsedData(result)

        const { data: existingPositions } = await supabase
          .from('positions')
          .select('*, trades(*)')
          .eq('portfolio_id', selectedPortfolio.id)

        const existingFingerprints = new Set()
        ;(existingPositions || []).forEach(pos => {
          ;(pos.trades || []).forEach(t => {
            existingFingerprints.add(
              `${pos.ticker}|${t.date}|${t.type}|${Number(t.quantity)}|${Number(t.price)}`
            )
          })
        })
        setDuplicates(existingFingerprints)
        setStep(4)
      } catch (fallbackErr) {
        setError(`Помилка читання файлу: ${fallbackErr.message}`)
      }
    }
  }

  // ── Import execution ──

  async function handleImport() {
    if (!parsedData || importing) return
    setImporting(true)
    setError(null)

    try {
      const newTrades = parsedData.trades.filter(t => !duplicates.has(tradeFingerprint(t)))
      const hasDividends = parsedData.dividends?.length > 0
      if (newTrades.length === 0 && !hasDividends) {
        setError('Немає нових угод або дивідендів для імпорту')
        setImporting(false)
        return
      }

      // Re-read the file for the commit call
      const csvText = await file.text()

      const { data, error } = await supabase.functions.invoke('import-ibkr-commit', {
        body: {
          portfolioId: selectedPortfolio.id,
          csvText,
          filename: file.name,
          skipDuplicates: true,
        },
      })

      if (error) throw new Error(error.message || 'Import failed')

      const parts = []
      if (data.tradesImported > 0) parts.push(`${data.tradesImported} угод`)
      if (data.dividendsImported > 0) parts.push(`${data.dividendsImported} дивідендів`)
      if (parsedData.endingCash != null) parts.push(`баланс оновлено до ${formatMoney(parsedData.endingCash)}`)
      if (data.skippedDuplicates > 0) parts.push(`${data.skippedDuplicates} дублікатів пропущено`)

      setSuccess(`Імпортовано: ${parts.join(', ')}`)
      setStep(1)
      setFile(null)
      setParsedData(null)
      setSelectedPortfolio(null)
      fetchData()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  // ── Rollback ──

  async function handleRollback(imp) {
    if (!confirm('Відкотити цей імпорт? Усі імпортовані угоди будуть видалені.')) return

    try {
      const { rollback_data } = imp

      // 1. Delete imported trades
      if (rollback_data.created_trade_ids?.length > 0) {
        await supabase
          .from('trades')
          .delete()
          .in('id', rollback_data.created_trade_ids)
      }

      // 2. Delete imported dividends
      if (rollback_data.created_dividend_ids?.length > 0) {
        await supabase
          .from('dividends')
          .delete()
          .in('id', rollback_data.created_dividend_ids)
      }

      // 4. Delete auto-created positions (only if empty)
      for (const posId of (rollback_data.created_position_ids || [])) {
        const { data: remaining } = await supabase
          .from('trades')
          .select('id')
          .eq('position_id', posId)
          .limit(1)

        if (!remaining || remaining.length === 0) {
          await supabase.from('positions').delete().eq('id', posId)
        }
      }

      // 5. Restore cash balance
      if (rollback_data.previous_cash_balance != null) {
        const { data: portfolio } = await supabase
          .from('portfolios')
          .select('cash_balance')
          .eq('id', imp.portfolio_id)
          .single()

        const currentCash = Number(portfolio?.cash_balance) || 0

        await supabase.from('cash_adjustments').insert({
          portfolio_id: imp.portfolio_id,
          previous_balance: currentCash,
          new_balance: rollback_data.previous_cash_balance,
          date: new Date().toISOString().split('T')[0],
          notes: `Відкат імпорту — ${imp.filename}`,
        })

        await supabase
          .from('portfolios')
          .update({ cash_balance: rollback_data.previous_cash_balance })
          .eq('id', imp.portfolio_id)
      }

      // 6. Mark import as rolled back
      await supabase
        .from('imports')
        .update({ status: 'rolled_back' })
        .eq('id', imp.id)

      setSuccess(`Імпорт "${imp.filename}" відкочено`)
      fetchData()
    } catch (err) {
      setError(`Помилка відкату: ${err.message}`)
    }
  }

  // ── Navigation helpers ──

  function goBack() {
    setError(null)
    if (step === 4) { setStep(3); setFile(null); setParsedData(null) }
    else if (step === 3) setStep(2)
    else if (step === 2) setStep(1)
  }

  // ── Computed values for step 4 ──

  const newTrades = parsedData
    ? parsedData.trades.filter(t => !duplicates.has(tradeFingerprint(t)))
    : []
  const duplicateCount = parsedData ? parsedData.trades.length - newTrades.length : 0
  const uniqueTickers = parsedData ? [...new Set(parsedData.trades.map(t => t.symbol))] : []

  if (loading) return <div className="text-gray-500">Завантаження...</div>

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Імпорт транзакцій</h2>
        {step === 1 && (
          <button
            onClick={() => {
              const el = document.getElementById('import-history')
              el?.scrollIntoView({ behavior: 'smooth' })
            }}
            className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50"
          >
            🕐 Історія імпортів
          </button>
        )}
      </div>

      {/* Success message */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-4 mb-4 flex items-center justify-between">
          <span>✅ {success}</span>
          <button onClick={() => setSuccess(null)} className="text-green-600 hover:text-green-800 text-sm">✕</button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 mb-4 flex items-center justify-between">
          <span>❌ {error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 text-sm">✕</button>
        </div>
      )}

      {/* Steps indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[
          { n: 1, label: 'Портфель' },
          { n: 2, label: 'Брокер' },
          { n: 3, label: 'Файл' },
          { n: 4, label: 'Підтвердження' },
        ].map(({ n, label }) => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
              step >= n ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}>
              {step > n ? '✓' : n}
            </div>
            <span className={`text-sm ${step >= n ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>
              {label}
            </span>
            {n < 4 && <div className={`w-8 h-0.5 ${step > n ? 'bg-blue-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* ─── Step 1: Select Portfolio ─── */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">Оберіть портфель для імпорту</h3>
          {portfolios.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Немає портфелів. Спочатку створіть портфель.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {portfolios.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPortfolio(p); setStep(2) }}
                  className="text-left bg-white rounded-xl border-2 border-gray-200 p-5 transition-all hover:border-blue-400 hover:shadow-sm"
                >
                  <div className="font-semibold text-gray-800 text-lg">{p.name}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    {p.positions?.length || 0} позицій
                  </div>
                  <div className="text-sm text-gray-500">
                    Готівка: {formatMoney(Number(p.cash_balance) || 0)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Step 2: Select Broker ─── */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={goBack} className="text-gray-400 hover:text-gray-600 text-sm">← Назад</button>
            <h3 className="text-lg font-semibold text-gray-700">Оберіть брокера</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <button
              onClick={() => setStep(3)}
              className="text-left bg-white rounded-xl border-2 border-gray-200 p-5 transition-all hover:border-blue-400 hover:shadow-sm"
            >
              <div className="text-3xl mb-2">🏦</div>
              <div className="font-semibold text-gray-800">Interactive Brokers</div>
              <div className="text-sm text-gray-500 mt-1">
                Імпорт з CSV-звіту IBKR (Activity Statement)
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Upload File ─── */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={goBack} className="text-gray-400 hover:text-gray-600 text-sm">← Назад</button>
            <h3 className="text-lg font-semibold text-gray-700">
              Завантажити виписку Interactive Brokers
            </h3>
          </div>

          {/* Last import hint */}
          {lastImport && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-sm">
              <span className="text-blue-600">ℹ️</span>
              <span className="text-blue-800">
                Останній імпорт у цей портфель: <strong>{formatDate(lastImport.imported_at)}</strong>
                {' — '}{lastImport.filename} ({lastImport.trade_count} угод)
              </span>
            </div>
          )}

          {/* Drag & drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-colors ${
              dragActive
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400 bg-gray-50'
            }`}
          >
            <div className="text-5xl mb-4">📄</div>
            <div className="text-gray-700 font-medium">
              Перетягніть CSV файл сюди
            </div>
            <div className="text-sm text-gray-500 mt-1">
              або натисніть для вибору файлу
            </div>
            <div className="text-xs text-gray-400 mt-3">
              Формати, що підтримуються: .csv
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* ─── Step 4: Preview & Confirm ─── */}
      {step === 4 && parsedData && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <button onClick={goBack} className="text-gray-400 hover:text-gray-600 text-sm">← Назад</button>
            <h3 className="text-lg font-semibold text-gray-700">
              Попередній перегляд — {file?.name}
            </h3>
          </div>

          {/* Parse errors */}
          {parsedData.errors.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4">
              <div className="font-medium text-yellow-800 mb-2">⚠️ Попередження:</div>
              <ul className="text-sm text-yellow-700 list-disc ml-4">
                {parsedData.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Нових угод</div>
              <div className="text-xl font-bold text-gray-800">{newTrades.length}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Дублікатів</div>
              <div className={`text-xl font-bold ${duplicateCount > 0 ? 'text-yellow-600' : 'text-gray-800'}`}>
                {duplicateCount}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Тікерів</div>
              <div className="text-xl font-bold text-gray-800">{uniqueTickers.length}</div>
              <div className="text-xs text-gray-400 mt-0.5 truncate">{uniqueTickers.join(', ')}</div>
            </div>
            {parsedData.dividends?.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Дивіденди</div>
                <div className="text-xl font-bold text-green-600">
                  {formatMoney(parsedData.dividends.reduce((s, d) => s + d.amount, 0))}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{parsedData.dividends.length} записів</div>
              </div>
            )}
            {parsedData.endingCash != null && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Баланс рахунку</div>
                <div className="text-xl font-bold text-gray-800">{formatMoney(parsedData.endingCash)}</div>
                {parsedData.startingCash != null && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    Було: {formatMoney(parsedData.startingCash)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Trades preview table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Статус</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Дата</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Тікер</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Тип</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Ціна</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Кількість</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Сума</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Комісія</th>
                </tr>
              </thead>
              <tbody>
                {parsedData.trades.map((t, i) => {
                  const fp = tradeFingerprint(t)
                  const isDuplicate = duplicates.has(fp)
                  return (
                    <tr key={i} className={`border-b border-gray-100 ${isDuplicate ? 'bg-yellow-50 opacity-60' : 'hover:bg-gray-50'}`}>
                      <td className="py-3 px-3">
                        {isDuplicate ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded">
                            ⚠️ Дублікат
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded">
                            ✅ Новий
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-gray-700">{formatDate(t.date)}</td>
                      <td className="py-3 px-3 font-medium text-gray-800">{t.symbol}</td>
                      <td className="py-3 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          t.type === 'buy'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {t.type === 'buy' ? 'Купівля' : 'Продаж'}
                        </span>
                      </td>
                      <td className="text-right py-3 px-3 text-gray-700">{formatMoney(t.price)}</td>
                      <td className="text-right py-3 px-3 text-gray-700">{formatNumber(t.quantity, 4)}</td>
                      <td className="text-right py-3 px-3 font-medium text-gray-800">
                        {formatMoney(t.price * t.quantity)}
                      </td>
                      <td className="text-right py-3 px-3 text-gray-500">
                        {formatMoney(Math.abs(t.commission))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Dividends preview table */}
          {parsedData.dividends?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-700">
                  💵 Дивіденди ({parsedData.dividends.length})
                </h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50">
                    <th className="text-left py-2.5 px-3 font-medium text-gray-600">Дата</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-600">Тікер</th>
                    <th className="text-right py-2.5 px-3 font-medium text-gray-600">Сума (net)</th>
                    <th className="text-left py-2.5 px-3 font-medium text-gray-600">Деталі</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.dividends.map((d, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-3 text-gray-700">{formatDate(d.date)}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800">{d.ticker}</td>
                      <td className="text-right py-2.5 px-3 font-medium text-green-600">
                        {formatMoney(d.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs">{d.description}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50/50">
                    <td colSpan="2" className="py-2.5 px-3 text-sm font-medium text-gray-600">Всього</td>
                    <td className="text-right py-2.5 px-3 text-sm font-bold text-green-600">
                      {formatMoney(parsedData.dividends.reduce((s, d) => s + d.amount, 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Confirm/Cancel */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={goBack}
              className="text-gray-500 px-4 py-2 text-sm hover:text-gray-700"
            >
              Назад
            </button>
            <button
              onClick={handleImport}
              disabled={importing || (newTrades.length === 0 && (!parsedData.dividends || parsedData.dividends.length === 0))}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing
                ? 'Імпортується...'
                : `Імпортувати ${newTrades.length} угод${parsedData.dividends?.length ? ` + ${parsedData.dividends.length} дивідендів` : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ─── Import History ─── */}
      <div id="import-history" className="mt-10">
        <h3 className="text-lg font-semibold text-gray-700 mb-4">Історія імпортів</h3>

        {importHistory.length === 0 ? (
          <p className="text-gray-500 text-center py-8 bg-white rounded-xl border border-gray-200">
            Немає імпортів
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Дата</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Портфель</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Брокер</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Файл</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Угод</th>
                  <th className="text-left py-3 px-3 font-medium text-gray-600">Тікери</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Баланс</th>
                  <th className="text-center py-3 px-3 font-medium text-gray-600">Статус</th>
                  <th className="text-right py-3 px-3 font-medium text-gray-600">Дії</th>
                </tr>
              </thead>
              <tbody>
                {importHistory.map(imp => (
                  <tr key={imp.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3 text-gray-700">{formatDate(imp.imported_at)}</td>
                    <td className="py-3 px-3 text-gray-700">{imp.portfolio?.name || '—'}</td>
                    <td className="py-3 px-3 text-gray-700 uppercase text-xs font-medium">{imp.broker}</td>
                    <td className="py-3 px-3 text-gray-700 max-w-[200px] truncate" title={imp.filename}>
                      {imp.filename}
                    </td>
                    <td className="text-right py-3 px-3 text-gray-700">{imp.trade_count}</td>
                    <td className="py-3 px-3 text-gray-500 text-xs max-w-[200px] truncate">
                      {imp.summary?.tickers?.join(', ') || '—'}
                    </td>
                    <td className="text-right py-3 px-3 text-gray-700">
                      {imp.summary?.ending_cash != null ? formatMoney(imp.summary.ending_cash) : '—'}
                    </td>
                    <td className="text-center py-3 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        imp.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {imp.status === 'active' ? 'Активний' : 'Відкочений'}
                      </span>
                    </td>
                    <td className="text-right py-3 px-3 whitespace-nowrap">
                      {imp.status === 'active' && (
                        <button
                          onClick={() => handleRollback(imp)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium"
                        >
                          Відкотити
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
