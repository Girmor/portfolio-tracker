import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { parseIBKRCsv, tradeFingerprint } from '../lib/ibkrParser'
import { formatMoney, formatDate, formatNumber } from '../lib/formatters'
import { useImportsQuery, useRefreshImports } from '../hooks/useImportsQuery'
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react'

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
      const { data: previewRefresh } = await supabase.auth.refreshSession()
      const previewToken = previewRefresh?.session?.access_token
      const { data, error } = await supabase.functions.invoke('import-ibkr-preview', {
        body: { portfolioId: selectedPortfolio.id, csvText },
        ...(previewToken ? { headers: { Authorization: `Bearer ${previewToken}` } } : {}),
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
      const { data: refreshResult } = await supabase.auth.refreshSession()
      const accessToken = refreshResult?.session?.access_token
      if (!accessToken) throw new Error('Сесія закінчилась — перезавантажте сторінку і увійдіть знову.')
      const { data, error } = await supabase.functions.invoke('import-ibkr-commit', {
        body: { portfolioId: selectedPortfolio.id, csvText, filename: file.name, skipDuplicates: true },
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (error) {
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
      const { data: importRows } = await supabase
        .from('import_rows')
        .select('created_record_id, created_record_type')
        .eq('import_id', imp.id)
      const tradeIds = (importRows || []).filter(r => r.created_record_type === 'trade').map(r => r.created_record_id)
      const dividendIds = (importRows || []).filter(r => r.created_record_type === 'dividend').map(r => r.created_record_id)
      let positionIds = []
      if (tradeIds.length > 0) {
        const { data: tradesData } = await supabase.from('trades').select('position_id').in('id', tradeIds)
        positionIds = [...new Set((tradesData || []).map(t => t.position_id))]
      }
      if (tradeIds.length > 0) await supabase.from('trades').delete().in('id', tradeIds)
      if (dividendIds.length > 0) await supabase.from('dividends').delete().in('id', dividendIds)
      for (const posId of positionIds) {
        const { data: remaining } = await supabase.from('trades').select('id').eq('position_id', posId).limit(1)
        if (!remaining || remaining.length === 0) await supabase.from('positions').delete().eq('id', posId)
      }
      const prevCash = imp.rollback_data?.previous_cash_balance
      if (prevCash != null) {
        const { data: portfolio } = await supabase.from('portfolios').select('cash_balance').eq('id', imp.portfolio_id).single()
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
      await supabase.from('import_rows').delete().eq('import_id', imp.id)
      await supabase.from('imports').update({ status: 'rolled_back' }).eq('id', imp.id)
      await sweepEmptyPositions()
      toast.success(`Імпорт "${imp.filename}" відкочено`)
      refreshAll()
    } catch (err) {
      toast.error(`Помилка відкату: ${err.message}`)
    }
  }

  async function handleCleanupOrphans(imp) {
    if (!confirm('Видалити залишкові угоди та позиції цього імпорту?')) return
    try {
      const { data: importRows } = await supabase
        .from('import_rows')
        .select('created_record_id, created_record_type')
        .eq('import_id', imp.id)
      const tradeIds = (importRows || []).filter(r => r.created_record_type === 'trade').map(r => r.created_record_id)
      const dividendIds = (importRows || []).filter(r => r.created_record_type === 'dividend').map(r => r.created_record_id)
      if (tradeIds.length === 0 && dividendIds.length === 0) {
        toast.success('Залишкових даних не знайдено')
        return
      }
      let positionIds = []
      if (tradeIds.length > 0) {
        const { data: tradesData } = await supabase.from('trades').select('position_id').in('id', tradeIds)
        positionIds = [...new Set((tradesData || []).map(t => t.position_id).filter(Boolean))]
      }
      if (tradeIds.length > 0) await supabase.from('trades').delete().in('id', tradeIds)
      if (dividendIds.length > 0) await supabase.from('dividends').delete().in('id', dividendIds)
      for (const posId of positionIds) {
        const { data: remaining } = await supabase.from('trades').select('id').eq('position_id', posId).limit(1)
        if (!remaining || remaining.length === 0) await supabase.from('positions').delete().eq('id', posId)
      }
      await supabase.from('import_rows').delete().eq('import_id', imp.id)
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

  if (isLoading) return <div className="text-slate-400 animate-pulse">Завантаження...</div>

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Імпорт транзакцій</h2>
        {step === 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                const count = await sweepEmptyPositions()
                refreshAll()
                if (count > 0) toast.success(`Видалено ${count} порожніх позицій`)
                else toast.success('Порожніх позицій не знайдено')
              }}
              className="flex items-center gap-1.5 text-sm text-orange-400 border border-orange-400/30 rounded-lg px-3 py-1.5 hover:bg-orange-400/10 transition-colors"
            >
              Очистити порожні позиції
            </button>
            <button
              onClick={() => document.getElementById('import-history')?.scrollIntoView({ behavior: 'smooth' })}
              className="flex items-center gap-1.5 text-sm text-slate-400 border border-white/10 rounded-lg px-3 py-1.5 hover:bg-white/5 transition-colors"
            >
              Історія імпортів
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
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${step >= n ? 'bg-blue-600 text-white' : 'bg-white/10 text-slate-400'}`}>
              {step > n ? '✓' : n}
            </div>
            <span className={`text-sm ${step >= n ? 'text-white font-medium' : 'text-slate-500'}`}>{label}</span>
            {n < 4 && <div className={`w-8 h-0.5 ${step > n ? 'bg-blue-600' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Portfolio */}
      {step === 1 && (
        <div className="glass-card rounded-xl p-6">
          <h3 className="text-lg font-semibold text-slate-200 mb-4">Оберіть портфель для імпорту</h3>
          {portfolios.length === 0 ? (
            <p className="text-slate-400 text-center py-8">Немає портфелів. Спочатку створіть портфель.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {portfolios.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPortfolio(p); setStep(2) }}
                  className="text-left glass-card rounded-xl p-5 transition-all hover:bg-white/[0.10] hover:border-blue-400/40"
                >
                  <div className="font-semibold text-white text-lg">{p.name}</div>
                  <div className="text-sm text-slate-400 mt-1">{p.positions?.length || 0} позицій</div>
                  <div className="text-sm text-slate-400">Готівка: {formatMoney(Number(p.cash_balance) || 0)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Select Broker */}
      {step === 2 && (
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={goBack} className="text-slate-400 hover:text-slate-200 text-sm transition-colors">← Назад</button>
            <h3 className="text-lg font-semibold text-slate-200">Оберіть брокера</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <button
              onClick={() => setStep(3)}
              className="text-left glass-card rounded-xl p-5 transition-all hover:bg-white/[0.10] hover:border-blue-400/40"
            >
              <div className="text-3xl mb-2 text-blue-400 font-bold">IB</div>
              <div className="font-semibold text-white">Interactive Brokers</div>
              <div className="text-sm text-slate-400 mt-1">Імпорт з CSV-звіту IBKR (Activity Statement)</div>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Upload File */}
      {step === 3 && (
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={goBack} className="text-slate-400 hover:text-slate-200 text-sm transition-colors">← Назад</button>
            <h3 className="text-lg font-semibold text-slate-200">Завантажити виписку Interactive Brokers</h3>
          </div>
          {lastImport && (
            <div className="bg-blue-500/10 border border-blue-400/25 rounded-lg p-3 mb-4 flex items-center gap-2 text-sm">
              <span className="text-blue-400">ℹ</span>
              <span className="text-blue-300">
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
              dragActive
                ? 'border-blue-400/60 bg-blue-500/10'
                : 'border-white/15 hover:border-white/25 hover:bg-white/[0.03]'
            }`}
          >
            <div className="flex justify-center mb-4"><Upload size={32} className="text-slate-400" /></div>
            <div className="text-slate-200 font-medium">Перетягніть CSV файл сюди</div>
            <div className="text-sm text-slate-400 mt-1">або натисніть для вибору файлу</div>
            <div className="text-xs text-slate-500 mt-3">Формати, що підтримуються: .csv</div>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
          </div>
        </div>
      )}

      {/* Step 4: Preview & Confirm */}
      {step === 4 && parsedData && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <button onClick={goBack} className="text-slate-400 hover:text-slate-200 text-sm transition-colors">← Назад</button>
            <h3 className="text-lg font-semibold text-slate-200">Попередній перегляд — {file?.name}</h3>
          </div>
          {parsedData.errors.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/25 rounded-xl p-4 mb-4">
              <div className="font-medium text-yellow-400 mb-2 flex items-center gap-1"><AlertTriangle size={14} /> Попередження:</div>
              <ul className="text-sm text-yellow-300 list-disc ml-4">
                {parsedData.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="glass-card rounded-xl p-4">
              <div className="text-sm text-slate-400">Нових угод</div>
              <div className="text-xl font-bold text-white">{newTrades.length}</div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="text-sm text-slate-400">Дублікатів</div>
              <div className={`text-xl font-bold ${duplicateCount > 0 ? 'text-yellow-400' : 'text-white'}`}>{duplicateCount}</div>
            </div>
            <div className="glass-card rounded-xl p-4">
              <div className="text-sm text-slate-400">Тікерів</div>
              <div className="text-xl font-bold text-white">{uniqueTickers.length}</div>
              <div className="text-xs text-slate-500 mt-0.5 truncate">{uniqueTickers.join(', ')}</div>
            </div>
            {parsedData.dividends?.length > 0 && (
              <div className="glass-card rounded-xl p-4">
                <div className="text-sm text-slate-400">Дивіденди</div>
                <div className="text-xl font-bold text-green-400">{formatMoney(parsedData.dividends.reduce((s, d) => s + d.amount, 0))}</div>
                <div className="text-xs text-slate-500 mt-0.5">{parsedData.dividends.length} записів</div>
              </div>
            )}
            {parsedData.endingCash != null && (
              <div className="glass-card rounded-xl p-4">
                <div className="text-sm text-slate-400">Баланс рахунку</div>
                <div className="text-xl font-bold text-white">{formatMoney(parsedData.endingCash)}</div>
                {parsedData.startingCash != null && <div className="text-xs text-slate-500 mt-0.5">Було: {formatMoney(parsedData.startingCash)}</div>}
              </div>
            )}
          </div>

          <div className="glass-card rounded-xl overflow-x-auto mb-6">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Статус</th>
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Дата</th>
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Тікер</th>
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Тип</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Ціна</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Кількість</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Сума</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Комісія</th>
                </tr>
              </thead>
              <tbody>
                {parsedData.trades.map((t, i) => {
                  const fp = tradeFingerprint(t)
                  const isDuplicate = duplicates.has(fp)
                  return (
                    <tr key={i} className={`border-b border-white/[0.06] ${isDuplicate ? 'bg-yellow-500/5 opacity-60' : 'hover:bg-white/5'}`}>
                      <td className="py-3 px-3">
                        {isDuplicate ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-400 bg-yellow-500/15 px-2 py-0.5 rounded"><AlertTriangle size={10} /> Дублікат</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-500/15 px-2 py-0.5 rounded"><CheckCircle2 size={10} /> Новий</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-200">{formatDate(t.date)}</td>
                      <td className="py-3 px-3 font-medium text-white">{t.symbol}</td>
                      <td className="py-3 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${t.type === 'buy' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                          {t.type === 'buy' ? 'Купівля' : 'Продаж'}
                        </span>
                      </td>
                      <td className="text-right py-3 px-3 text-slate-200">{formatMoney(t.price)}</td>
                      <td className="text-right py-3 px-3 text-slate-200">{formatNumber(t.quantity, 4)}</td>
                      <td className="text-right py-3 px-3 font-medium text-white">{formatMoney(t.price * t.quantity)}</td>
                      <td className="text-right py-3 px-3 text-slate-400">{formatMoney(Math.abs(t.commission))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {parsedData.dividends?.length > 0 && (
            <div className="glass-card rounded-xl overflow-x-auto mb-6">
              <div className="px-4 py-3 border-b border-white/10 bg-white/5">
                <h4 className="text-sm font-semibold text-slate-200">Дивіденди ({parsedData.dividends.length})</h4>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.03]">
                    <th className="text-left py-2.5 px-3 font-medium text-slate-300">Дата</th>
                    <th className="text-left py-2.5 px-3 font-medium text-slate-300">Тікер</th>
                    <th className="text-right py-2.5 px-3 font-medium text-slate-300">Сума (net)</th>
                    <th className="text-left py-2.5 px-3 font-medium text-slate-300">Деталі</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.dividends.map((d, i) => (
                    <tr key={i} className="border-b border-white/[0.06] hover:bg-white/5">
                      <td className="py-2.5 px-3 text-slate-200">{formatDate(d.date)}</td>
                      <td className="py-2.5 px-3 font-medium text-white">{d.ticker}</td>
                      <td className="text-right py-2.5 px-3 font-medium text-green-400">{formatMoney(d.amount)}</td>
                      <td className="py-2.5 px-3 text-slate-400 text-xs">{d.description}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/10 bg-white/5">
                    <td colSpan="2" className="py-2.5 px-3 text-sm font-medium text-slate-300">Всього</td>
                    <td className="text-right py-2.5 px-3 text-sm font-bold text-green-400">
                      {formatMoney(parsedData.dividends.reduce((s, d) => s + d.amount, 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {importError && (
            <div className="mb-4 bg-red-500/10 border border-red-500/25 rounded-xl p-4">
              <div className="font-semibold text-red-400 mb-1">Помилка імпорту:</div>
              <div className="text-sm text-red-300 font-mono break-all">{importError}</div>
              <button onClick={() => setImportError(null)} className="text-xs text-red-400 mt-2 hover:underline">Закрити</button>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button onClick={goBack} className="btn btn-ghost">Назад</button>
            <button
              onClick={() => { setImportError(null); handleImport() }}
              disabled={importing || (newTrades.length === 0 && (!parsedData.dividends || parsedData.dividends.length === 0))}
              className="btn btn-primary"
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
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Історія імпортів</h3>
        {importHistory.length === 0 ? (
          <p className="text-slate-400 text-center py-8 glass-card rounded-xl">Немає імпортів</p>
        ) : (
          <div className="glass-card rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Дата</th>
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Портфель</th>
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Брокер</th>
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Файл</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Угод</th>
                  <th className="text-left py-3 px-3 font-medium text-slate-300">Тікери</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Баланс</th>
                  <th className="text-center py-3 px-3 font-medium text-slate-300">Статус</th>
                  <th className="text-right py-3 px-3 font-medium text-slate-300">Дії</th>
                </tr>
              </thead>
              <tbody>
                {importHistory.map(imp => (
                  <tr key={imp.id} className="border-b border-white/[0.06] hover:bg-white/5">
                    <td className="py-3 px-3 text-slate-200">{formatDate(imp.imported_at)}</td>
                    <td className="py-3 px-3 text-slate-200">{imp.portfolio?.name || '—'}</td>
                    <td className="py-3 px-3 text-slate-200 uppercase text-xs font-medium">{imp.broker}</td>
                    <td className="py-3 px-3 text-slate-200 max-w-[200px] truncate" title={imp.filename}>{imp.filename}</td>
                    <td className="text-right py-3 px-3 text-slate-200">{imp.trade_count}</td>
                    <td className="py-3 px-3 text-slate-400 text-xs max-w-[200px] truncate">{imp.summary?.tickers?.join(', ') || '—'}</td>
                    <td className="text-right py-3 px-3 text-slate-200">{imp.summary?.ending_cash != null ? formatMoney(imp.summary.ending_cash) : '—'}</td>
                    <td className="text-center py-3 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${imp.status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-white/8 text-slate-400'}`}>
                        {imp.status === 'active' ? 'Активний' : 'Відкочений'}
                      </span>
                    </td>
                    <td className="text-right py-3 px-3 whitespace-nowrap">
                      {imp.status === 'active' && (
                        <button onClick={() => handleRollback(imp)} className="text-red-400 hover:text-red-300 text-xs font-medium transition-colors">
                          Відкотити
                        </button>
                      )}
                      {imp.status === 'rolled_back' && (
                        <button onClick={() => handleCleanupOrphans(imp)} className="text-orange-400 hover:text-orange-300 text-xs font-medium transition-colors">
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
