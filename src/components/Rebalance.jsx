import { useState, useMemo, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Scale, Trash2 } from 'lucide-react'
import { usePortfoliosQuery, usePortfolioDetailQuery } from '../hooks/usePortfoliosQuery'
import { usePricesQuery } from '../hooks/usePricesQuery'
import { formatMoney, formatNumber } from '../lib/formatters'
import { calculateRebalance } from '../lib/rebalanceCalc'
import { searchStocks, searchCrypto } from '../lib/priceService'

// ─── localStorage helpers ────────────────────────────────────────────────────

const LS_KEY = 'rebalance_templates_v1'

function loadTemplates() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveTemplates(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data))
}

function getTemplatesForPortfolio(portfolioId) {
  return loadTemplates()[portfolioId] || []
}

function upsertTemplate(portfolioId, template) {
  const all = loadTemplates()
  const list = all[portfolioId] || []
  const idx = list.findIndex(t => t.id === template.id)
  if (idx >= 0) {
    list[idx] = template
  } else {
    list.push(template)
  }
  saveTemplates({ ...all, [portfolioId]: list })
}

function deleteTemplate(portfolioId, templateId) {
  const all = loadTemplates()
  const list = (all[portfolioId] || []).filter(t => t.id !== templateId)
  saveTemplates({ ...all, [portfolioId]: list })
}

// ─── calcPosition (same logic as PortfolioDetail) ────────────────────────────

function calcPosition(pos, prices) {
  const trades = pos.trades || []
  let totalBuyQty = 0, totalBuyCost = 0, totalSellQty = 0
  trades.forEach(t => {
    const qty = Number(t.quantity)
    const price = Number(t.price)
    if (t.type === 'buy') { totalBuyQty += qty; totalBuyCost += price * qty }
    else { totalSellQty += qty }
  })
  const avgPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0
  const remainingQty = totalBuyQty - totalSellQty
  const currentPrice = prices[pos.ticker] ?? 0
  const marketValue = remainingQty * currentPrice
  return { totalQty: remainingQty, avgPrice, currentPrice, marketValue }
}

// ─── Category label helpers ───────────────────────────────────────────────────

const CATEGORY_LABELS = {
  cash: 'Готівка',
  stocks: 'Акції',
  crypto: 'Криптовалюта',
  alternatives: 'Альтернативні',
}

const CATEGORY_ORDER = ['cash', 'stocks', 'crypto', 'alternatives']

// ─── TemplateEditor ───────────────────────────────────────────────────────────

function TemplateEditor({ template, portfolioPositions, prices, onSave, onBack }) {
  const [name, setName] = useState(template.name || '')
  const [rebalanceDate, setRebalanceDate] = useState(template.rebalanceDate || '')
  const [assets, setAssets] = useState(template.assets || [])
  const [showAddAsset, setShowAddAsset] = useState(false)
  const [customTicker, setCustomTicker] = useState('')
  const [customName, setCustomName] = useState('')
  const [customCategory, setCustomCategory] = useState('stocks')
  const [suggestions, setSuggestions] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchTimerRef = useRef(null)

  const totalPct = assets.reduce((s, a) => s + Number(a.targetPercent || 0), 0)
  const remaining = 100 - totalPct
  const isValid = name.trim() && Math.abs(totalPct - 100) < 0.01

  function updateAsset(symbol, field, value) {
    setAssets(prev => prev.map(a => a.symbol === symbol ? { ...a, [field]: value } : a))
  }

  function removeAsset(symbol) {
    setAssets(prev => prev.filter(a => a.symbol !== symbol))
  }

  function addFromPosition(pos) {
    if (assets.find(a => a.symbol === pos.ticker)) return
    setAssets(prev => [...prev, {
      symbol: pos.ticker,
      name: pos.name || pos.ticker,
      category: pos.type === 'crypto' ? 'crypto' : 'stocks',
      targetPercent: 0,
      includedInRebalance: true,
    }])
  }

  function handleTickerInput(value) {
    setCustomTicker(value.toUpperCase())
    setCustomName('')
    setShowSuggestions(true)
    clearTimeout(searchTimerRef.current)
    if (value.length < 1) { setSuggestions([]); return }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true)
      const [stocks, crypto] = await Promise.all([searchStocks(value), searchCrypto(value)])
      setSuggestions([...stocks, ...crypto])
      setSearchLoading(false)
    }, 300)
  }

  function selectSuggestion(item) {
    setCustomTicker(item.ticker)
    setCustomName(item.name)
    setCustomCategory(item.type === 'crypto' ? 'crypto' : 'stocks')
    setSuggestions([])
    setShowSuggestions(false)
  }

  function addCustomAsset() {
    const ticker = customTicker.trim().toUpperCase()
    if (!ticker) return
    if (assets.find(a => a.symbol === ticker)) return
    setAssets(prev => [...prev, {
      symbol: ticker,
      name: customName.trim() || ticker,
      category: customCategory,
      targetPercent: 0,
      includedInRebalance: true,
    }])
    setCustomTicker('')
    setCustomName('')
    setCustomCategory('stocks')
    setSuggestions([])
    setShowAddAsset(false)
  }

  function handleSave() {
    if (!isValid) return
    const t = {
      ...template,
      name: name.trim(),
      rebalanceDate,
      assets,
    }
    onSave(t)
  }

  const grouped = CATEGORY_ORDER.map(cat => ({
    cat,
    items: assets.filter(a => a.category === cat),
  })).filter(g => g.items.length > 0)

  // Positions not yet in template
  const availablePositions = portfolioPositions.filter(
    p => !assets.find(a => a.symbol === p.ticker)
  )

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors mb-6">
        <ArrowLeft size={16} />
        Назад
      </button>

      <h2 className="text-xl font-bold text-white mb-6">
        {template.id ? 'Редагувати шаблон' : 'Новий шаблон'}
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-slate-300 mb-1">Назва шаблону</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="glass-input w-full"
            placeholder="Мій збалансований портфель"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-300 mb-1">Дата наступного ребалансування</label>
          <input
            type="date"
            value={rebalanceDate}
            onChange={e => setRebalanceDate(e.target.value)}
            className="glass-input w-full"
          />
        </div>
      </div>

      {/* Allocation indicator */}
      <div className={`glass-card rounded-xl p-3 mb-4 flex items-center justify-between ${Math.abs(totalPct - 100) < 0.01 ? 'border border-emerald-500/30' : totalPct > 100 ? 'border border-red-500/30' : 'border border-white/8'}`}>
        <span className="text-sm text-slate-300">Розподілено</span>
        <div className="flex items-center gap-3">
          <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${totalPct > 100 ? 'bg-red-500' : Math.abs(totalPct - 100) < 0.01 ? 'bg-emerald-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(100, totalPct)}%` }}
            />
          </div>
          <span className={`text-sm font-semibold tabular-nums ${totalPct > 100 ? 'text-red-400' : Math.abs(totalPct - 100) < 0.01 ? 'text-emerald-400' : 'text-slate-200'}`}>
            {totalPct.toFixed(1)}%
          </span>
          {Math.abs(totalPct - 100) >= 0.01 && (
            <span className="text-xs text-slate-500">
              {remaining > 0 ? `Залишилось ${remaining.toFixed(1)}%` : `Перевищено на ${Math.abs(remaining).toFixed(1)}%`}
            </span>
          )}
        </div>
      </div>

      {/* Asset groups */}
      {assets.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-8">Додайте активи до шаблону</p>
      )}

      {grouped.map(({ cat, items }) => (
        <div key={cat} className="mb-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {CATEGORY_LABELS[cat]}
          </div>
          <div className="glass-card rounded-xl overflow-hidden">
            {items.map((asset, i) => {
              const pos = portfolioPositions.find(p => p.ticker === asset.symbol)
              const calc = pos ? calcPosition(pos, prices) : null
              const currentPct = calc && calc.marketValue > 0 ? null : null
              return (
                <div
                  key={asset.symbol}
                  className={`flex items-center gap-3 px-4 py-3 ${i < items.length - 1 ? 'border-b border-white/[0.06]' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white text-sm">{asset.symbol}</span>
                      <span className="text-xs text-slate-500 truncate">{asset.name}</span>
                    </div>
                    {calc && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {formatMoney(calc.marketValue)} · {formatNumber(calc.totalQty, 4)} шт.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={asset.targetPercent}
                      onChange={e => updateAsset(asset.symbol, 'targetPercent', Number(e.target.value))}
                      className="glass-input w-20 text-right"
                      placeholder="0"
                    />
                    <span className="text-slate-400 text-sm w-4">%</span>
                    <select
                      value={asset.category}
                      onChange={e => updateAsset(asset.symbol, 'category', e.target.value)}
                      className="glass-input text-xs"
                    >
                      {CATEGORY_ORDER.map(c => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={asset.includedInRebalance}
                        onChange={e => updateAsset(asset.symbol, 'includedInRebalance', e.target.checked)}
                        className="accent-blue-500"
                      />
                      Вкл.
                    </label>
                    <button
                      onClick={() => removeAsset(asset.symbol)}
                      className="text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Add asset section — relative + z-10 lifts this stacking context above the save button below */}
      <div className="mb-6 relative z-10">
        {!showAddAsset ? (
          <button
            onClick={() => setShowAddAsset(true)}
            className="btn btn-ghost text-sm"
          >
            <Plus size={14} className="mr-1" />
            Додати актив
          </button>
        ) : (
          <div className="glass-card rounded-xl p-4">
            <div className="text-sm font-medium text-slate-300 mb-3">Додати актив</div>
            {availablePositions.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-slate-500 mb-2">З портфеля:</div>
                <div className="flex flex-wrap gap-2">
                  {availablePositions.map(p => (
                    <button
                      key={p.ticker}
                      onClick={() => addFromPosition(p)}
                      className="px-3 py-1 text-xs rounded-lg bg-white/8 hover:bg-white/12 text-slate-200 transition-colors border border-white/10"
                    >
                      {p.ticker}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="text-xs text-slate-500 mb-2">Або вручну:</div>
            <div className="flex gap-2 items-end flex-wrap">
              <div className="relative">
                <input
                  type="text"
                  autoComplete="off"
                  value={customTicker}
                  onChange={e => handleTickerInput(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="glass-input w-40"
                  placeholder="Пошук активу..."
                />
                {searchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">...</div>
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 mt-1 w-72 glass-modal rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {suggestions.map((item, i) => (
                      <button
                        key={`${item.ticker}-${i}`}
                        type="button"
                        onMouseDown={() => selectSuggestion(item)}
                        className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center justify-between text-sm border-b border-white/[0.06] last:border-0"
                      >
                        <div>
                          <span className="font-medium text-white">{item.ticker}</span>
                          <span className="text-slate-400 ml-2 text-xs">{item.name}</span>
                        </div>
                        {item.type && <span className="text-xs text-slate-500 shrink-0 ml-2">{item.type}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {customName && (
                  <div className="absolute left-0 top-full mt-1 text-xs text-emerald-400 whitespace-nowrap">
                    {customTicker} — {customName}
                  </div>
                )}
              </div>
              <div className="mt-5">
                <select
                  value={customCategory}
                  onChange={e => setCustomCategory(e.target.value)}
                  className="glass-input"
                >
                  {CATEGORY_ORDER.map(c => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <button onClick={addCustomAsset} className="btn btn-primary text-sm mt-5">
                Додати
              </button>
              <button onClick={() => setShowAddAsset(false)} className="btn btn-ghost text-sm mt-5">
                Скасувати
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={!isValid}
          className="btn btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          title={!isValid ? 'Сума % має дорівнювати 100' : ''}
        >
          Зберегти шаблон
        </button>
        <button onClick={onBack} className="btn btn-ghost">
          Скасувати
        </button>
      </div>
    </div>
  )
}

// ─── RebalanceOverview ────────────────────────────────────────────────────────

function RebalanceOverview({
  portfolios,
  selectedPortfolioId,
  onSelectPortfolio,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onNewTemplate,
  onEditTemplate,
  onDeleteTemplate,
  positions,
  prices,
  cashBalance,
}) {
  const [deposit, setDeposit] = useState('')
  const [isWithdrawal, setIsWithdrawal] = useState(false)
  const [allowSales, setAllowSales] = useState(false)
  const [results, setResults] = useState(null)
  const [excludedSymbols, setExcludedSymbols] = useState(new Set())

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)

  // Reset results when template or portfolio changes
  useEffect(() => {
    setResults(null)
    setExcludedSymbols(new Set())
  }, [selectedTemplateId, selectedPortfolioId])

  // Build currentValues from positions
  const currentValues = useMemo(() => {
    const map = {}
    positions.forEach(pos => {
      const calc = calcPosition(pos, prices)
      map[pos.ticker] = calc.marketValue
    })
    return map
  }, [positions, prices])

  function runCalculate(excl = excludedSymbols) {
    if (!selectedTemplate) return
    const depositAmt = Math.max(0, Number(deposit) || 0)
    const result = calculateRebalance({
      assets: selectedTemplate.assets,
      currentValues,
      cashBalance,
      deposit: isWithdrawal ? 0 : depositAmt,
      withdrawal: isWithdrawal ? depositAmt : 0,
      allowSales,
      prices,
      excludedSymbols: excl,
    })
    setResults(result)
  }

  function handleCalculate() { runCalculate() }

  function toggleExcluded(symbol) {
    const next = new Set(excludedSymbols)
    if (next.has(symbol)) next.delete(symbol)
    else next.add(symbol)
    setExcludedSymbols(next)
    // Pass the new set directly — no stale closure
    if (results) runCalculate(next)
  }

  // Summary calculations
  const summary = useMemo(() => {
    if (!results) return null
    const totalBuy = results.filter(r => r.action === 'buy').reduce((s, r) => s + r.delta, 0)
    const totalSell = results.filter(r => r.action === 'sell').reduce((s, r) => s + Math.abs(r.delta), 0)
    const depositAmt = Math.max(0, Number(deposit) || 0)
    const cashUsed = isWithdrawal ? -depositAmt : depositAmt
    const currentTotal = Object.values(currentValues).reduce((s, v) => s + v, 0) + cashBalance
    const newBalance = currentTotal + (isWithdrawal ? -depositAmt : depositAmt)
    return { totalBuy, totalSell, cashUsed: depositAmt, deposit: isWithdrawal ? 0 : depositAmt, withdrawal: isWithdrawal ? depositAmt : 0, newBalance, currentTotal }
  }, [results, deposit, isWithdrawal, currentValues, cashBalance])

  const canCalculate = !!selectedPortfolioId && !!selectedTemplateId

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Scale size={22} className="text-blue-400" />
        <h2 className="text-2xl font-bold text-white">Ребалансування</h2>
      </div>

      {/* Portfolio selector */}
      {portfolios.length > 1 && (
        <div className="mb-5">
          <label className="block text-sm text-slate-400 mb-1.5">Портфель</label>
          <select
            value={selectedPortfolioId || ''}
            onChange={e => onSelectPortfolio(e.target.value)}
            className="glass-input"
          >
            <option value="">Оберіть портфель...</option>
            {portfolios.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Template cards */}
      {selectedPortfolioId && (
        <div className="mb-5">
          <div className="text-sm text-slate-400 mb-2">Шаблони</div>
          <div className="flex flex-wrap gap-3">
            {templates.map(t => (
              <div
                key={t.id}
                onClick={() => onSelectTemplate(t.id === selectedTemplateId ? null : t.id)}
                className={`glass-card rounded-xl p-4 cursor-pointer w-52 border transition-all ${
                  t.id === selectedTemplateId
                    ? 'border-blue-500/50 bg-blue-500/8'
                    : 'border-white/8 hover:border-white/20'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-white text-sm truncate">{t.name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {t.assets.length} активів
                    </div>
                    {t.rebalanceDate && (
                      <div className="text-xs text-slate-500 mt-0.5">→ {t.rebalanceDate}</div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); onEditTemplate(t) }}
                      className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); onDeleteTemplate(t.id) }}
                      className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={onNewTemplate}
              className="glass-card rounded-xl p-4 w-52 border border-dashed border-white/20 hover:border-white/40 text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center gap-2 text-sm"
            >
              <Plus size={16} />
              Новий шаблон
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      {selectedPortfolioId && (
        <div className="glass-card rounded-xl p-4 mb-5">
          <div className="flex flex-wrap items-end gap-4">
            {/* Deposit / Withdrawal toggle */}
            <div>
              <div className="text-xs text-slate-400 mb-1.5">Тип</div>
              <div className="flex bg-white/8 rounded-lg p-0.5">
                <button
                  onClick={() => setIsWithdrawal(false)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                    !isWithdrawal
                      ? 'bg-emerald-500/20 text-emerald-400 font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Поповнення
                </button>
                <button
                  onClick={() => setIsWithdrawal(true)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                    isWithdrawal
                      ? 'bg-red-500/20 text-red-400 font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Зняття
                </button>
              </div>
            </div>

            {/* Amount */}
            <div>
              <div className="text-xs text-slate-400 mb-1.5">Сума (USD)</div>
              <input
                type="number"
                min="0"
                step="any"
                value={deposit}
                onChange={e => setDeposit(e.target.value)}
                className="glass-input w-32"
                placeholder="0"
              />
            </div>

            {/* Allow sales toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAllowSales(v => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  allowSales ? 'bg-blue-500' : 'bg-white/20'
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${allowSales ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm text-slate-300">Дозволити продажі</span>
            </div>

            {/* Calculate button */}
            <button
              onClick={handleCalculate}
              disabled={!canCalculate}
              className="btn btn-primary disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
            >
              Розрахувати
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {results && summary && (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Table — 3/4 */}
          <div className="lg:flex-[3] glass-card rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 bg-white/5">
              <h3 className="text-sm font-semibold text-slate-200">Дії для ребалансування</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-slate-400 w-8"></th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-slate-400">Актив</th>
                  <th className="text-right py-2.5 px-4 text-xs font-medium text-slate-400">Поточна вар.</th>
                  <th className="text-right py-2.5 px-4 text-xs font-medium text-slate-400">Алокація</th>
                  <th className="text-right py-2.5 px-4 text-xs font-medium text-slate-400">Ціль %</th>
                  <th className="text-right py-2.5 px-4 text-xs font-medium text-slate-400">Дія</th>
                  <th className="text-right py-2.5 px-4 text-xs font-medium text-slate-400">Сума</th>
                  <th className="text-right py-2.5 px-4 text-xs font-medium text-slate-400">Акцій</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {results.map(row => {
                  const isExcluded = row.action === 'excluded'
                  return (
                    <tr
                      key={row.symbol}
                      className={`hover:bg-white/5 transition-colors ${isExcluded ? 'opacity-50' : ''}`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={row.action !== 'excluded'}
                          onChange={() => toggleExcluded(row.symbol)}
                          className="accent-blue-500"
                          title={row.action === 'excluded' ? 'Включити в розрахунок' : 'Виключити з розрахунку'}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">{row.symbol}</div>
                        <div className="text-xs text-slate-500 truncate max-w-[120px]">{row.name}</div>
                      </td>
                      <td className="text-right py-3 px-4 text-slate-200">{formatMoney(row.currentValue)}</td>
                      <td className="text-right py-3 px-4 text-slate-400">{row.currentPct.toFixed(1)}%</td>
                      <td className="text-right py-3 px-4 text-slate-400">{row.targetPct}%</td>
                      <td className="text-right py-3 px-4">
                        {isExcluded ? (
                          <span className="text-xs px-2 py-0.5 rounded-md bg-white/8 text-slate-500">Виключено</span>
                        ) : row.action === 'buy' ? (
                          <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 font-medium">Купити</span>
                        ) : row.action === 'sell' ? (
                          <span className="text-xs px-2 py-0.5 rounded-md bg-red-500/15 text-red-400 font-medium">Продати</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-md bg-white/8 text-slate-400">Тримати</span>
                        )}
                      </td>
                      <td className={`text-right py-3 px-4 font-medium tabular-nums ${
                        row.action === 'buy' ? 'text-emerald-400'
                        : row.action === 'sell' ? 'text-red-400'
                        : 'text-slate-500'
                      }`}>
                        {isExcluded || row.action === 'hold' ? '—' : formatMoney(Math.abs(row.delta))}
                      </td>
                      <td className="text-right py-3 px-4 text-slate-300 tabular-nums">
                        {isExcluded || row.action === 'hold' ? '—' : formatNumber(row.units, 4)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Summary panel — 1/4 */}
          <div className="lg:flex-1 flex flex-col gap-3">
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-4">Підсумок</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Поточний баланс</span>
                  <span className="text-white font-medium">{formatMoney(summary.currentTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Готівка (кеш)</span>
                  <span className="text-white">{formatMoney(cashBalance)}</span>
                </div>
                {summary.deposit > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Депозит</span>
                    <span className="text-emerald-400">+{formatMoney(summary.deposit)}</span>
                  </div>
                )}
                {summary.withdrawal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Зняття</span>
                    <span className="text-red-400">-{formatMoney(summary.withdrawal)}</span>
                  </div>
                )}
                <div className="border-t border-white/10 pt-3 flex justify-between text-sm">
                  <span className="text-slate-400">Всього придбано</span>
                  <span className="text-emerald-400 font-medium">+{formatMoney(summary.totalBuy)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Всього продано</span>
                  <span className={summary.totalSell > 0 ? 'text-red-400 font-medium' : 'text-slate-500'}>
                    {summary.totalSell > 0 ? `-${formatMoney(summary.totalSell)}` : '—'}
                  </span>
                </div>
                <div className="border-t border-white/10 pt-3 flex justify-between text-sm font-semibold">
                  <span className="text-slate-300">Новий баланс</span>
                  <span className="text-white">{formatMoney(summary.newBalance)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty state when portfolio selected but no templates */}
      {selectedPortfolioId && templates.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          <Scale size={32} className="mx-auto mb-3 opacity-30" />
          <p className="mb-4">Шаблонів ще немає. Створіть перший!</p>
          <button onClick={onNewTemplate} className="btn btn-primary">
            <Plus size={14} className="mr-1.5" />
            Новий шаблон
          </button>
        </div>
      )}

      {/* Prompt to select portfolio */}
      {!selectedPortfolioId && portfolios.length > 1 && (
        <div className="text-center py-12 text-slate-500">
          <Scale size={32} className="mx-auto mb-3 opacity-30" />
          <p>Оберіть портфель, щоб почати</p>
        </div>
      )}
    </div>
  )
}

// ─── Main Rebalance component ─────────────────────────────────────────────────

export default function Rebalance() {
  const { data: portfolios = [], isLoading: portfoliosLoading } = usePortfoliosQuery()

  const [view, setView] = useState('overview') // 'overview' | 'edit'
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [selectedPortfolioId, setSelectedPortfolioId] = useState(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)
  const [templates, setTemplates] = useState([])

  // Auto-select first portfolio
  useEffect(() => {
    if (portfolios.length === 1 && !selectedPortfolioId) {
      setSelectedPortfolioId(portfolios[0].id)
    }
  }, [portfolios])

  // Load templates when portfolio changes
  useEffect(() => {
    if (selectedPortfolioId) {
      setTemplates(getTemplatesForPortfolio(selectedPortfolioId))
      setSelectedTemplateId(null)
    }
  }, [selectedPortfolioId])

  const { data: portfolioDetail } = usePortfolioDetailQuery(selectedPortfolioId)
  const positions = portfolioDetail?.positions || []
  const cashBalance = Number(portfolioDetail?.portfolio?.cash_balance) || 0

  // Merge portfolio positions with template assets so we get prices for everything
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)
  const positionsForPricing = useMemo(() => {
    if (!selectedTemplate) return positions
    const portfolioTickers = new Set(positions.map(p => p.ticker))
    const extraPositions = (selectedTemplate.assets || [])
      .filter(a => !portfolioTickers.has(a.symbol))
      .map(a => ({ ticker: a.symbol, type: a.category === 'crypto' ? 'crypto' : 'stock' }))
    return [...positions, ...extraPositions]
  }, [positions, selectedTemplate])

  const { data: prices = {} } = usePricesQuery(positionsForPricing)

  function handleSelectPortfolio(id) {
    setSelectedPortfolioId(id || null)
  }

  function handleNewTemplate() {
    setEditingTemplate({
      id: null,
      name: '',
      rebalanceDate: '',
      assets: [],
    })
    setView('edit')
  }

  function handleEditTemplate(t) {
    setEditingTemplate(t)
    setView('edit')
  }

  function handleDeleteTemplate(templateId) {
    if (!confirm('Видалити шаблон?')) return
    deleteTemplate(selectedPortfolioId, templateId)
    setTemplates(getTemplatesForPortfolio(selectedPortfolioId))
    if (selectedTemplateId === templateId) setSelectedTemplateId(null)
  }

  function handleSaveTemplate(t) {
    const saved = { ...t, id: t.id || crypto.randomUUID() }
    upsertTemplate(selectedPortfolioId, saved)
    setTemplates(getTemplatesForPortfolio(selectedPortfolioId))
    setSelectedTemplateId(saved.id)
    setView('overview')
    setEditingTemplate(null)
  }

  function handleBack() {
    setView('overview')
    setEditingTemplate(null)
  }

  if (portfoliosLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-white/10 rounded w-48 mb-6" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2].map(i => <div key={i} className="glass-card rounded-xl h-24" />)}
        </div>
      </div>
    )
  }

  if (view === 'edit' && editingTemplate) {
    return (
      <TemplateEditor
        template={editingTemplate}
        portfolioPositions={positions}
        prices={prices}
        onSave={handleSaveTemplate}
        onBack={handleBack}
      />
    )
  }

  return (
    <RebalanceOverview
      portfolios={portfolios}
      selectedPortfolioId={selectedPortfolioId}
      onSelectPortfolio={handleSelectPortfolio}
      templates={templates}
      selectedTemplateId={selectedTemplateId}
      onSelectTemplate={setSelectedTemplateId}
      onNewTemplate={handleNewTemplate}
      onEditTemplate={handleEditTemplate}
      onDeleteTemplate={handleDeleteTemplate}
      positions={positions}
      prices={prices}
      cashBalance={cashBalance}
    />
  )
}
