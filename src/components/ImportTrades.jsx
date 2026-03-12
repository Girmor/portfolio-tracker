import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { parseIBKRCsv, tradeFingerprint } from '../lib/ibkrParser'
import { formatMoney, formatDate, formatNumber } from '../lib/formatters'
import { useImportsQuery, useRefreshImports } from '../hooks/useImportsQuery'

export default function ImportTrades() {
  const [step, setStep] = useState(1)
  const [selectedPortfolio, setSelectedPortfolio] = useState(null)
  const [file, setFile] = useState(null)
  const [parsedData, setParsedData] = useState(null)
  const [duplicates, setDuplicates] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef(null)

  const { data, isLoading } = useImportsQuery()
  const importHistory = data?.imports || []
  const portfolios = data?.portfolios || []
  const refreshAll = useRefreshImports()

  const lastImport = selectedPortfolio
    ? importHistory.find(i => i.portfolio_id === selectedPortfolio.id && i.status === 'active')
    : null

  function handleDragOver(e) { e.preventDefault(); setDragActive(true) }
  function handleDragLeave(e) { e.preventDefault(); setDragActive(false) }
  function handleDrop(e) { e.preventDefault(); setDragActive(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }
  function handleFileChange(e) { const f = e.target.files[0]; if (f) processFile(f) }

  async function processFile(f) {
    setFile(f)
    try {
      const csvText = await f.text()

      // Refresh JWT so edge function gateway doesn't reject with 401
      await supabase.auth.refreshSession()

      const { data, error } = await supabase.functions.invoke('import-ibkr-preview', {
        body: { portfolioId: selectedPortfolio.id, csvText },
      })
      if (error) throw new Error(error.message || 'Preview failed')
      const previewResult = {
        trades: data.trades || [],
        dividends: data.dividends || [],
        endingCash: data.endingCash ?? null,
        startingCash: data.startingCash ?? null,
        errors: data.parseErrors || [],
      }
      setParsedData(previewResult)
      const duplicateFingerprints = new Set(
        (data.trades || []).filter(t => t.isDuplicate).map(t => tradeFingerprint(t))
      )
      setDuplicates(duplicateFingerprints)
      setStep(4)
    } catch (err) {
      try {
        const text = await f.text()
        const result = parseIBKRCsv(text)
        setParsedData(result)
        const { data: existingPositions } = await supabase
          .from('positions').select('*, trades(*)').eq('portfolio_id', selectedPortfolio.id)
        const existingFingerprints = new Set()
        ;(existingPositions || []).forEach(pos => {
          ;(pos.trades || []).forEach(t => {
            existingFingerprints.add(`${pos.ticker}|${t.date}|${t.type}|${Number(t.quantity)}|${Number(t.price)}`)
          })
        })
        setDuplicates(existingFingerprints)
        setStep(4)
      } catch (fallbackErr) {
        toast.error(`Помилка читання файлу: ${fallbackErr.message}`)
      }
    }
  }

  async function handleImport() {
    if (!parsedData || importing) return
    setImporting(true)
    try {
      const newTrades = parsedData.trades.filter(t => !duplicates.has(tradeFingerprint(t)))
      const hasDividends = parsedData.dividends?.length > 0
      if (newTrades.length === 0 && !hasDividends) {
        toast.error('Немає нових угод або дивідендів для імпорту')
        setImporting(false)
        return
      }
      const csvText = await file.text()

      // Refresh JWT before calling edge function — gateway rejects expired tokens (401)
      await supabase.auth.refreshSession()

      const { data, error } = await supabase.functions.invoke('import-ibkr-commit', {
        body: { portfolioId: selectedPortfolio.id, csvText, filename: file.name, skipDuplicates: true },
      })
      if (error) {
        // Extract the real error from the edge function response body
        let msg = error.message || 'Import failed'
        try {
          const body = typeof error.context?.json === 'function'
            ? await error.context.json()
            : error.context
          if (body?.error) msg = body.error
        } catch {}
        throw new Error(msg)
      }

      const parts = []
      if (data.tradesImported > 0) parts.push(`${data.tradesImported} угод`)
      if (data.dividendsImported > 0) parts.push(`${data.dividendsImported} дивідендів`)
      if (parsedData.endingCash != null) parts.push(`баланс оновлено до ${formatMoney(parsedData.endingCash)}`)
      if (data.skippedDuplicates > 0) parts.push(`${data.skippedDuplicates} дублікатів пропущено`)

      toast.success(`Імпортовано: ${parts.join(', ')}`)
      setStep(1)
      setFile(null)
      setParsedData(null)
      setSelectedPortfolio(null)
      refreshAll()
    } catch (err) {
      console.error('[ImportTrades] commit error:', err)
      setImportError(err.message)
      toast.error(err.message)
    } finally {
      setImporting(false)
    }
  }

  // Global sweep: delete every position that has zero trades across ALL user portfolios.
  // Runs after any rollback/cleanup to catch orphaned positions left by earlier broken rollbacks.
  // Uses 2 queries (all positions + all trade position_ids) instead of N+1 per-position checks.
  async function sweepEmptyPositions() {
    const [{ data: allPositions }, { data: tradePositions }] = await Promise.all([
      supabase.from('positions').select('id'),
      supabase.from('trades').select('position_id'),
    ])
    const occupiedIds = new Set((tradePositions || []).map(t => t.position_id))
    const emptyIds = (allPositions || [])
      .filter(p => !occupiedIds.has(p.id))
      .map(p => p.id)
    if (emptyIds.length > 0) {
      await supabase.from('positions').delete().in('id', emptyIds)
    }
    return emptyIds.length
  }

  async function handleRollback(imp) {
    if (!confirm('Відкотити цей імпорт? Усі імпортовані угоди будуть видалені.')) return
    try {
      // The stored procedure only stores previous_cash_balance in rollback_data,
      // NOT trade/dividend IDs. Use import_rows table which records every created record.
      const { data: importRows } = await supabase
        .from('import_rows')
        .select('created_record_id, created_record_type')
        .eq('import_id', imp.id)

      const tradeIds = (importRows || [])
        .filter(r => r.created_record_type === 'trade')
        .map(r => r.created_record_id)

      const dividendIds = (importRows || [])
        .filter(r => r.created_record_type === 'dividend')
        .map(r => r.created_record_id)

      // Fetch position IDs from the trades BEFORE deleting them
      let positionIds = []
      if (tradeIds.length > 0) {
        const { data: tradesData } = await supabase
          .from('trades')
          .select('position_id')
          .in('id', tradeIds)
        positionIds = [...new Set((tradesData || []).map(t => t.position_id))]
      }

      // Delete trades
      if (tradeIds.length > 0) {
        await supabase.from('trades').delete().in('id', tradeIds)
      }

      // Delete dividends
      if (dividendIds.length > 0) {
        await supabase.from('dividends').delete().in('id', dividendIds)
      }

      // Delete positions that are now empty (no remaining trades)
      for (const posId of positionIds) {
        const { data: remaining } = await supabase
          .from('trades').select('id').eq('position_id', posId).limit(1)
        if (!remaining || remaining.length === 0) {
          await supabase.from('positions').delete().eq('id', posId)
        }
      }

      // Restore cash balance if it was recorded
      const prevCash = imp.rollback_data?.previous_cash_balance
      if (prevCash != null) {
        const { data: portfolio } = await supabase
          .from('portfolios').select('cash_balance').eq('id', imp.portfolio_id).single()
        const currentCash = Number(portfolio?.cash_balance) || 0
        await supabase.from('adjustments').insert({
          portfolio_id: imp.portfolio_id,
          previous_balance: currentCash,
          new_balance: prevCash,
          date: new Date().toISOString().split('T')[0],
          notes: `Відкат імпорту — ${imp.filename}`,
        })
        await supabase.from('portfolios').update({ cash_balance: prevCash }).eq('id', imp.portfolio_id)
      }

      // Delete import_rows so "Очистити" won't find stale records if clicked later
      await supabase.from('import_rows').delete().eq('import_id', imp.id)

      await supabase.from('imports').update({ status: 'rolled_back' }).eq('id', imp.id)

      // Global sweep: remove any positions left with zero trades (cross-import orphans)
      await sweepEmptyPositions()

      toast.success(`Імпорт "${imp.filename}" відкочено`)
      refreshAll()
    } catch (err) {
      toast.error(`Помилка відкату: ${err.message}`)
    }
  }

  // Cleanup orphaned trades/dividends/positions for already-rolled-back imports.
  // The old rollback code was silently a no-op (rollback_data had no IDs),
  // so records were left behind. This lets the user clean them up retroactively.
  async function handleCleanupOrphans(imp) {
    if (!confirm('Видалити залишкові угоди та позиції цього імпорту?')) return
    try {
      const { data: importRows } = await supabase
        .from('import_rows')
        .select('created_record_id, created_record_type')
        .eq('import_id', imp.id)

      const tradeIds = (importRows || [])
        .filter(r => r.created_record_type === 'trade')
        .map(r => r.created_record_id)

      const dividendIds = (importRows || [])
        .filter(r => r.created_record_type === 'dividend')
        .map(r => r.created_record_id)

      if (tradeIds.length === 0 && dividendIds.length === 0) {
        toast.success('Залишкових даних не знайдено')
        return
      }

      let positionIds = []
      if (tradeIds.length > 0) {
        const { data: tradesData } = await supabase
          .from('trades').select('position_id').in('id', tradeIds)
        positionIds = [...new Set((tradesData || []).map(t => t.position_id).filter(Boolean))]
      }

      if (tradeIds.length > 0) {
        await supabase.from('trades').delete().in('id', tradeIds)
      }
      if (dividendIds.length > 0) {
        await supabase.from('dividends').delete().in('id', dividendIds)
      }
      for (const posId of positionIds) {
        const { data: remaining } = await supabase
          .from('trades').select('id').eq('position_id', posId).limit(1)
        if (!remaining || remaining.length === 0) {
          await supabase.from('positions').delete().eq('id', posId)
        }
      }

      // Delete import_rows so subsequent "Очистити" correctly returns "no orphans"
      await supabase.from('import_rows').delete().eq('import_id', imp.id)

      // Global sweep: remove any positions still with zero trades (cross-import orphans)
      await sweepEmptyPositions()

      toast.success(`Очищено: ${tradeIds.length} угод, ${dividendIds.length} дивідендів`)
      refreshAll()
    } catch (err) {
      toast.error(`Помилка очищення: ${err.message}`)
    }
  }

  function goBack() {
    if (step === 4) { setStep(3); setFile(null); setParsedData(null) }
    else if (step === 3) setStep(2)
    else if (step === 2) setStep(1)
  }

  const newTrades = parsedData ? parsedData.trades.filter(t => !duplicates.has(tradeFingerprint(t))) : []
  const duplicateCount = parsedData ? parsedData.trades.length - newTrades.length : 0
  const uniqueTickers = parsedData ? [...new Set(parsedData.trades.map(t => t.symbol))] : []

  if (isLoading) return <div className="text-gray-500 animate-pulse">Завантаження...</div>

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Імпорт транзакцій</h2>
        {step === 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                const count = await sweepEmptyPositions()
                refreshAll()
                if (count > 0) toast.success(`Видалено ${count} порожніх позицій`)
                else toast.success('Порожніх позицій не знайдено')
              }}
              className="flex items-center gap-1.5 text-sm text-orange-600 border border-orange-200 rounded-lg px-3 py-1.5 hover:bg-orange-50"
            >
              🧹 Очистити порожні позиції
            </button>
            <button
              onClick={() => document.getElementById('import-history')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50"
            >
              🕐 Історія імпортів
            </button>
          </div>
        )}
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[
          { n: 1, label: 'Портфель' },
          { n: 2, label: 'Брокер' },
          { n: 3, label: 'Файл' },
          { n: 4, label: 'Підтвердження' },
        ].map(({ n, label }) => (
          <div key={n} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${step >= n ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {step > n ? '✓' : n}
            </div>
            <span className={`text-sm ${step >= n ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>{label}</span>
            {n < 4 && <div className={`w-8 h-0.5 ${step > n ? 'bg-blue-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Portfolio */}
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
                  <div className="text-sm text-gray-500 mt-1">{p.positions?.length || 0} позицій</div>
                  <div className="text-sm text-gray-500">Готівка: {formatMoney(Number(p.cash_balance) || 0)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Select Broker */}
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
              <div className="text-sm text-gray-500 mt-1">Імпорт з CSV-звіту IBKR (Activity Statement)</div>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Upload File */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={goBack} className="text-gray-400 hover:text-gray-600 text-sm">← Назад</button>
            <h3 className="text-lg font-semibold text-gray-700">Завантажити виписку Interactive Brokers</h3>
          </div>
          {lastImport && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center gap-2 text-sm">
              <span className="text-blue-600">ℹ️</span>
              <span className="text-blue-800">
                Останній імпорт у цей портфель: <strong>{formatDate(lastImport.imported_at)}</strong>
                {' — '}{lastImport.filename} ({lastImport.trade_count} угод)
              </span>
            </div>
          )}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-colors ${
              dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
            }`}
          >
            <div className="text-5xl mb-4">📄</div>
            <div className="text-gray-700 font-medium">Перетягніть CSV файл сюди</div>
            <div className="text-sm text-gray-500 mt-1">або натисніть для вибору файлу</div>
            <div className="text-xs text-gray-400 mt-3">Формати, що підтримуються: .csv</div>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
          </div>
        </div>
      )}

      {/* Step 4: Preview & Confirm */}
      {step === 4 && parsedData && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <button onClick={goBack} className="text-gray-400 hover:text-gray-600 text-sm">← Назад</button>
            <h3 className="text-lg font-semibold text-gray-700">Попередній перегляд — {file?.name}</h3>
          </div>
          {parsedData.errors.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-4">
              <div className="font-medium text-yellow-800 mb-2">⚠️ Попередження:</div>
              <ul className="text-sm text-yellow-700 list-disc ml-4">
                {parsedData.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Нових угод</div>
              <div className="text-xl font-bold text-gray-800">{newTrades.length}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Дублікатів</div>
              <div className={`text-xl font-bold ${duplicateCount > 0 ? 'text-yellow-600' : 'text-gray-800'}`}>{duplicateCount}</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="text-sm text-gray-500">Тікерів</div>
              <div className="text-xl font-bold text-gray-800">{uniqueTickers.length}</div>
              <div className="text-xs text-gray-400 mt-0.5 truncate">{uniqueTickers.join(', ')}</div>
            </div>
            {parsedData.dividends?.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Дивіденди</div>
                <div className="text-xl font-bold text-green-600">{formatMoney(parsedData.dividends.reduce((s, d) => s + d.amount, 0))}</div>
                <div className="text-xs text-gray-400 mt-0.5">{parsedData.dividends.length} записів</div>
              </div>
            )}
            {parsedData.endingCash != null && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Баланс рахунку</div>
                <div className="text-xl font-bold text-gray-800">{formatMoney(parsedData.endingCash)}</div>
                {parsedData.startingCash != null && <div className="text-xs text-gray-400 mt-0.5">Було: {formatMoney(parsedData.startingCash)}</div>}
              </div>
            )}
          </div>

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
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded">⚠️ Дублікат</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded">✅ Новий</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-gray-700">{formatDate(t.date)}</td>
                      <td className="py-3 px-3 font-medium text-gray-800">{t.symbol}</td>
                      <td className="py-3 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${t.type === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {t.type === 'buy' ? 'Купівля' : 'Продаж'}
                        </span>
                      </td>
                      <td className="text-right py-3 px-3 text-gray-700">{formatMoney(t.price)}</td>
                      <td className="text-right py-3 px-3 text-gray-700">{formatNumber(t.quantity, 4)}</td>
                      <td className="text-right py-3 px-3 font-medium text-gray-800">{formatMoney(t.price * t.quantity)}</td>
                      <td className="text-right py-3 px-3 text-gray-500">{formatMoney(Math.abs(t.commission))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {parsedData.dividends?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-700">💵 Дивіденди ({parsedData.dividends.length})</h4>
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
                      <td className="text-right py-2.5 px-3 font-medium text-green-600">{formatMoney(d.amount)}</td>
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

          {importError && (
            <div className="mb-4 bg-red-50 border border-red-300 rounded-xl p-4">
              <div className="font-semibold text-red-700 mb-1">Помилка імпорту:</div>
              <div className="text-sm text-red-800 font-mono break-all">{importError}</div>
              <button onClick={() => setImportError(null)} className="text-xs text-red-500 mt-2 hover:underline">Закрити</button>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button onClick={goBack} className="text-gray-500 px-4 py-2 text-sm hover:text-gray-700">Назад</button>
            <button
              onClick={() => { setImportError(null); handleImport() }}
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

      {/* Import History */}
      <div id="import-history" className="mt-10">
        <h3 className="text-lg font-semibold text-gray-700 mb-4">Історія імпортів</h3>
        {importHistory.length === 0 ? (
          <p className="text-gray-500 text-center py-8 bg-white rounded-xl border border-gray-200">Немає імпортів</p>
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
                    <td className="py-3 px-3 text-gray-700 max-w-[200px] truncate" title={imp.filename}>{imp.filename}</td>
                    <td className="text-right py-3 px-3 text-gray-700">{imp.trade_count}</td>
                    <td className="py-3 px-3 text-gray-500 text-xs max-w-[200px] truncate">{imp.summary?.tickers?.join(', ') || '—'}</td>
                    <td className="text-right py-3 px-3 text-gray-700">{imp.summary?.ending_cash != null ? formatMoney(imp.summary.ending_cash) : '—'}</td>
                    <td className="text-center py-3 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${imp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {imp.status === 'active' ? 'Активний' : 'Відкочений'}
                      </span>
                    </td>
                    <td className="text-right py-3 px-3 whitespace-nowrap">
                      {imp.status === 'active' && (
                        <button onClick={() => handleRollback(imp)} className="text-red-500 hover:text-red-700 text-xs font-medium">
                          Відкотити
                        </button>
                      )}
                      {imp.status === 'rolled_back' && (
                        <button onClick={() => handleCleanupOrphans(imp)} className="text-orange-500 hover:text-orange-700 text-xs font-medium">
                          Очистити
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
