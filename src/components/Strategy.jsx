import { useState, useEffect } from 'react'
import { PlusCircle, Trash2 } from 'lucide-react'

// ── Calculation logic ─────────────────────────────────────────────────────────

const MATRIX = {
  '1': { A: 100, B: 75,  C: 50,  D: 25 },
  '2': { A: 75,  B: 50,  C: 35,  D: 15 },
  '3': { A: 50,  B: 35,  C: 20,  D: 10 },
  '4': { A: 25,  B: 15,  C: 10,  D: null }, // null = SKIP
}

const MODIFIERS = {
  oversold:     1.25,
  mod_oversold: 1.10,
  neutral:      1.00,
  sl_overbought: 0.75,
  overbought:   0.50,
}

function getFsvzoZone(v) {
  const n = Number(v)
  if (v === '' || isNaN(n)) return null
  if (n < -60) return 'A'
  if (n < 0)   return 'B'
  if (n <= 60) return 'C'
  return 'D'
}

function getUvsZone(v) {
  const n = Number(v)
  if (v === '' || isNaN(n)) return null
  if (n < -2.5) return '1'
  if (n < -1)   return '2'
  if (n <= 1)   return '3'
  return '4'
}

function calcAsset(asset) {
  const fsvzoZone = getFsvzoZone(asset.fsvzo)
  const uvsZone   = getUvsZone(asset.uvs)
  const modifier  = MODIFIERS[asset.signal] ?? 1.0
  if (!fsvzoZone || !uvsZone) return { fsvzoZone, uvsZone, basePercent: null, isSkip: false, modifier, finalPercent: null }
  const basePercent = MATRIX[uvsZone][fsvzoZone]
  const isSkip      = basePercent === null
  const finalPercent = isSkip ? null : basePercent * modifier
  return { fsvzoZone, uvsZone, basePercent, isSkip, modifier, finalPercent }
}

// ── Visual helpers ────────────────────────────────────────────────────────────

const ZONE_F_COLOR = { A: '#66bb6a', B: '#9ccc65', C: '#ffb74d', D: '#ef5350' }
const ZONE_U_COLOR = { '1': '#66bb6a', '2': '#9ccc65', '3': '#ffb74d', '4': '#ef5350' }

const SIGNAL_STYLE = {
  oversold:      { color: '#a5d6a7', background: 'rgba(27,94,32,0.45)',    label: 'Oversold' },
  mod_oversold:  { color: '#c5e1a5', background: 'rgba(51,105,30,0.4)',    label: 'Mod. Oversold' },
  neutral:       { color: '#fff176', background: 'rgba(78,78,16,0.45)',    label: 'Neutral' },
  sl_overbought: { color: '#ffcc80', background: 'rgba(230,81,0,0.3)',     label: 'Sl. Overbought' },
  overbought:    { color: '#ff8a80', background: 'rgba(183,28,28,0.35)',   label: 'Overbought' },
}

function pctColor(pct) {
  if (pct === null) return '#b71c1c'
  if (pct >= 70)   return '#66bb6a'
  if (pct >= 40)   return '#9ccc65'
  if (pct >= 20)   return '#fff176'
  if (pct > 0)     return '#ffb74d'
  return '#ef5350'
}

function barGradient(sharePct) {
  if (sharePct >= 30) return 'linear-gradient(90deg,#1b5e20,#66bb6a)'
  if (sharePct >= 15) return 'linear-gradient(90deg,#33691e,#9ccc65)'
  if (sharePct >= 8)  return 'linear-gradient(90deg,#f57f17,#ffb74d)'
  return 'linear-gradient(90deg,#c62828,#ef5350)'
}

// ── Defaults & persistence ────────────────────────────────────────────────────

const DEFAULT_ASSETS = [
  { id: 1, ticker: 'IVV',  fsvzo: '', uvs: '', signal: 'neutral' },
  { id: 2, ticker: 'VXUS', fsvzo: '', uvs: '', signal: 'neutral' },
  { id: 3, ticker: 'BND',  fsvzo: '', uvs: '', signal: 'neutral' },
  { id: 4, ticker: 'VWO',  fsvzo: '', uvs: '', signal: 'neutral' },
  { id: 5, ticker: 'IAU',  fsvzo: '', uvs: '', signal: 'neutral' },
  { id: 6, ticker: 'INDA', fsvzo: '', uvs: '', signal: 'neutral' },
]

const STORAGE_KEY = 'strategy_v1'

// ── Component ─────────────────────────────────────────────────────────────────

export default function Strategy() {
  const [budget, setBudget] = useState(1000)
  const [assets, setAssets]  = useState(DEFAULT_ASSETS)
  const [nextId, setNextId]  = useState(7)

  // Restore from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const d = JSON.parse(saved)
        if (d.budget !== undefined) setBudget(d.budget)
        if (d.assets)               setAssets(d.assets)
        if (d.nextId)               setNextId(d.nextId)
      }
    } catch {}
  }, [])

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ budget, assets, nextId }))
  }, [budget, assets, nextId])

  function updateAsset(id, field, value) {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a))
  }

  function addAsset() {
    setAssets(prev => [...prev, { id: nextId, ticker: '', fsvzo: '', uvs: '', signal: 'neutral' }])
    setNextId(n => n + 1)
  }

  function removeAsset(id) {
    setAssets(prev => prev.filter(a => a.id !== id))
  }

  // ── Derived calculations ────────────────────────────────────────────────────

  const calculated = assets.map(a => ({ ...a, ...calcAsset(a) }))

  const completeAssets = calculated.filter(a => a.fsvzo !== '' && a.uvs !== '')
  const validAssets    = completeAssets.filter(a => a.finalPercent !== null && a.finalPercent > 0)
  const allSkip        = completeAssets.length > 0 && validAssets.length === 0
  const sumFinal       = validAssets.reduce((s, a) => s + a.finalPercent, 0)

  function getAmount(asset) {
    if (allSkip && asset.fsvzo !== '' && asset.uvs !== '') {
      return (budget * 0.3) / completeAssets.length
    }
    if (!asset.finalPercent || sumFinal === 0) return null
    return budget * (asset.finalPercent / sumFinal)
  }

  const oversoldCount = calculated.filter(a => a.signal === 'oversold' && a.fsvzo !== '' && a.uvs !== '').length
  const showResults = validAssets.length > 0 || allSkip

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-5xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white font-mono tracking-wide">СТРАТЕГІЯ ІНВЕСТУВАННЯ</h1>
        <p className="text-sm text-slate-400 mt-1">Механічний розподіл бюджету на основі FSVZO × UVS × UVS Signal</p>
      </div>

      {/* Budget row */}
      <div className="flex flex-wrap items-center gap-4 bg-white/5 border border-white/10 rounded-xl px-5 py-4">
        <div>
          <label className="text-xs text-slate-500 font-mono uppercase tracking-wider block mb-1">Місячний бюджет</label>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-mono">$</span>
            <input
              type="number"
              value={budget}
              min={0}
              onChange={e => setBudget(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-lg font-bold w-32 focus:outline-none focus:border-blue-500/50"
            />
          </div>
        </div>

        {oversoldCount >= 3 && (
          <div className="px-4 py-2 rounded-lg border" style={{ background: 'rgba(27,94,32,0.3)', borderColor: 'rgba(102,187,106,0.3)' }}>
            <p className="text-xs font-mono font-bold" style={{ color: '#66bb6a' }}>🚨 ПРАВИЛО КРАХУ</p>
            <p className="text-xs mt-0.5" style={{ color: '#a5d6a7' }}>{oversoldCount} активи Oversold — дозволено до 1.5× бюджету з резерву</p>
          </div>
        )}

        {allSkip && (
          <div className="px-4 py-2 rounded-lg border" style={{ background: 'rgba(66,165,245,0.1)', borderColor: 'rgba(66,165,245,0.25)' }}>
            <p className="text-xs font-mono font-bold text-blue-400">🛡️ ПРАВИЛО БЕЗПЕКИ</p>
            <p className="text-xs mt-0.5 text-blue-300">Всі активи SKIP — розподіляємо 30% рівномірно</p>
          </div>
        )}
      </div>

      {/* Input table */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/8 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider">Індикатори активів</h2>
          <button
            onClick={addAsset}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <PlusCircle size={13} />
            Додати актив
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                {['Актив', 'FSVZO\n−120…+120', 'UVS\n−5…+5', 'UVS Signal', 'Зона\nFSVZO', 'Зона\nUVS', 'Базовий %', 'Мод.', 'Фінал %', 'Сума $', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-center text-xs text-slate-500 font-mono uppercase whitespace-pre-line leading-tight first:text-left last:w-8">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {calculated.map(asset => {
                const amount = getAmount(asset)
                const ss = SIGNAL_STYLE[asset.signal]

                return (
                  <tr key={asset.id} className="hover:bg-white/[0.03] transition-colors">

                    {/* Ticker */}
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        value={asset.ticker}
                        onChange={e => updateAsset(asset.id, 'ticker', e.target.value.toUpperCase())}
                        placeholder="TICKER"
                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white font-mono font-bold text-sm w-20 focus:outline-none focus:border-blue-500/50 uppercase placeholder:text-slate-600"
                      />
                    </td>

                    {/* FSVZO */}
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        value={asset.fsvzo}
                        onChange={e => updateAsset(asset.id, 'fsvzo', e.target.value)}
                        placeholder="0"
                        min="-120" max="120"
                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white font-mono text-sm w-20 text-center focus:outline-none focus:border-blue-500/50 placeholder:text-slate-600"
                      />
                    </td>

                    {/* UVS */}
                    <td className="px-3 py-2.5">
                      <input
                        type="number"
                        value={asset.uvs}
                        onChange={e => updateAsset(asset.id, 'uvs', e.target.value)}
                        placeholder="0.00"
                        min="-5" max="5" step="0.01"
                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white font-mono text-sm w-20 text-center focus:outline-none focus:border-blue-500/50 placeholder:text-slate-600"
                      />
                    </td>

                    {/* UVS Signal */}
                    <td className="px-3 py-2.5">
                      <select
                        value={asset.signal}
                        onChange={e => updateAsset(asset.id, 'signal', e.target.value)}
                        className="border rounded px-2 py-1 text-xs font-mono font-bold focus:outline-none cursor-pointer"
                        style={{ color: ss.color, background: ss.background, borderColor: ss.color + '55' }}
                      >
                        {Object.entries(SIGNAL_STYLE).map(([k, v]) => (
                          <option key={k} value={k} style={{ background: '#181a20', color: v.color }}>{v.label}</option>
                        ))}
                      </select>
                    </td>

                    {/* FSVZO Zone */}
                    <td className="px-3 py-2.5 text-center font-mono font-bold">
                      {asset.fsvzoZone
                        ? <span style={{ color: ZONE_F_COLOR[asset.fsvzoZone] }}>{asset.fsvzoZone}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>

                    {/* UVS Zone */}
                    <td className="px-3 py-2.5 text-center font-mono font-bold">
                      {asset.uvsZone
                        ? <span style={{ color: ZONE_U_COLOR[asset.uvsZone] }}>{asset.uvsZone}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>

                    {/* Base % */}
                    <td className="px-3 py-2.5 text-center font-mono">
                      {asset.isSkip
                        ? <span className="text-xs line-through" style={{ color: '#b71c1c', opacity: 0.7 }}>SKIP</span>
                        : asset.basePercent !== null
                          ? <span style={{ color: pctColor(asset.basePercent) }}>{asset.basePercent}%</span>
                          : <span className="text-slate-700">—</span>}
                    </td>

                    {/* Modifier */}
                    <td className="px-3 py-2.5 text-center font-mono text-xs">
                      <span style={{ color: asset.modifier > 1 ? '#66bb6a' : asset.modifier < 1 ? '#ffb74d' : '#9e9e9e' }}>
                        ×{asset.modifier.toFixed(2)}
                      </span>
                    </td>

                    {/* Final % */}
                    <td className="px-3 py-2.5 text-center font-mono font-bold">
                      {asset.isSkip
                        ? <span className="text-xs line-through" style={{ color: '#b71c1c', opacity: 0.7 }}>SKIP</span>
                        : asset.finalPercent !== null
                          ? <span style={{ color: pctColor(asset.finalPercent) }}>{asset.finalPercent.toFixed(1)}%</span>
                          : <span className="text-slate-700">—</span>}
                    </td>

                    {/* Amount */}
                    <td className="px-3 py-2.5 text-center font-mono font-bold">
                      {amount !== null
                        ? <span className="text-white">${amount.toFixed(0)}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>

                    {/* Remove */}
                    <td className="pr-3 py-2.5 text-right">
                      <button
                        onClick={() => removeAsset(asset.id)}
                        className="text-slate-700 hover:text-red-400 transition-colors p-0.5"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Results — allocation bars */}
      {showResults && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <h2 className="text-xs font-bold text-slate-400 font-mono uppercase tracking-wider mb-4">Розподіл Бюджету</h2>
          <div className="space-y-3">
            {calculated
              .filter(a => getAmount(a) !== null && getAmount(a) > 0)
              .sort((a, b) => (getAmount(b) ?? 0) - (getAmount(a) ?? 0))
              .map(asset => {
                const amount  = getAmount(asset) ?? 0
                const sharePct = (amount / budget) * 100
                return (
                  <div key={asset.id} className="flex items-center gap-3">
                    <span className="font-mono font-bold text-sm text-white w-14 shrink-0">{asset.ticker || '—'}</span>
                    <div className="flex-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)', height: 18 }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(sharePct, 100)}%`, background: barGradient(sharePct) }}
                      />
                    </div>
                    <span className="font-mono text-xs text-slate-400 w-9 text-right shrink-0">{sharePct.toFixed(0)}%</span>
                    <span className="font-mono font-bold text-white text-sm w-16 text-right shrink-0">${amount.toFixed(0)}</span>
                  </div>
                )
              })}
          </div>
          <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between">
            <span className="text-xs text-slate-500">Загальний бюджет</span>
            <span className="font-mono font-bold text-white text-base">${budget.toFixed(0)}</span>
          </div>
        </div>
      )}

      {/* Reference: indicator zones */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300 font-mono uppercase tracking-wider select-none list-none flex items-center gap-1.5">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
          Довідка: зони та матриця
        </summary>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* FSVZO */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="font-mono font-bold text-sm mb-3" style={{ color: '#90caf9' }}>FSVZO (−120…+120)</h3>
            {[['A', '< −60', '#2e7d32', '#66bb6a', 'Глибокий oversold'],
              ['B', '−60 … 0', '#558b2f', '#9ccc65', 'Помірно низько'],
              ['C', '0 … +60', '#ff8f00', '#ffb74d', 'Нейтрально-дорого'],
              ['D', '> +60',  '#c62828', '#ef5350', 'Overbought']].map(([z, r, bg, c, d]) => (
              <div key={z} className="flex items-center gap-2 py-1 text-xs">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: bg }} />
                <span className="font-mono font-bold w-4" style={{ color: c }}>{z}</span>
                <span className="font-mono text-slate-500 w-20">{r}</span>
                <span className="text-slate-400">{d}</span>
              </div>
            ))}
          </div>

          {/* UVS */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="font-mono font-bold text-sm mb-3" style={{ color: '#ce93d8' }}>UVS (−5…+5)</h3>
            {[['1', '< −2.5',    '#2e7d32', '#66bb6a', 'Сильно дешево'],
              ['2', '−2.5…−1',  '#558b2f', '#9ccc65', 'Помірно дешево'],
              ['3', '−1 … +1',  '#ff8f00', '#ffb74d', 'Нейтрально'],
              ['4', '> +1',     '#c62828', '#ef5350', 'Дорого']].map(([z, r, bg, c, d]) => (
              <div key={z} className="flex items-center gap-2 py-1 text-xs">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: bg }} />
                <span className="font-mono font-bold w-4" style={{ color: c }}>{z}</span>
                <span className="font-mono text-slate-500 w-20">{r}</span>
                <span className="text-slate-400">{d}</span>
              </div>
            ))}
          </div>

          {/* UVS Signal */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="font-mono font-bold text-sm mb-3" style={{ color: '#00bcd4' }}>UVS Signal → Модифікатор</h3>
            {Object.entries(SIGNAL_STYLE).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 py-1 text-xs">
                <span className="font-mono px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ color: v.color, background: v.background }}>{v.label}</span>
                <span className="font-mono font-bold ml-auto" style={{ color: v.color }}>×{MODIFIERS[k].toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Matrix */}
        <div className="mt-4 bg-white/5 border border-white/10 rounded-xl p-4 overflow-x-auto">
          <h3 className="font-mono font-bold text-xs text-yellow-400 uppercase tracking-wider mb-3 text-center">
            Матриця — Базовий % (UVS ↓ × FSVZO →)
          </h3>
          <table className="mx-auto border-separate border-spacing-1 text-center text-xs font-mono">
            <thead>
              <tr>
                <th className="text-slate-600 w-24"></th>
                {['A\n< −60', 'B\n−60…0', 'C\n0…+60', 'D\n> +60'].map(h => (
                  <th key={h} className="px-4 py-2 rounded" style={{ background: '#1e2030', color: '#90caf9', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['1: < −2.5',   [['100%','#1b5e20','#a5d6a7'],['75%','#33691e','#c5e1a5'],['50%','rgba(240,185,11,0.15)','#f0b90b'],['25%','rgba(255,152,0,0.12)','#ff9800']]],
                ['2: −2.5…−1', [['75%','#33691e','#c5e1a5'],['50%','rgba(240,185,11,0.15)','#f0b90b'],['35%','rgba(255,152,0,0.12)','#ff9800'],['15%','rgba(239,83,80,0.12)','#ef5350']]],
                ['3: −1…+1',   [['50%','rgba(240,185,11,0.15)','#f0b90b'],['35%','rgba(255,152,0,0.12)','#ff9800'],['20%','rgba(239,83,80,0.12)','#ef5350'],['10%','rgba(239,83,80,0.12)','#ef5350']]],
                ['4: > +1',    [['25%','rgba(255,152,0,0.12)','#ff9800'],['15%','rgba(239,83,80,0.12)','#ef5350'],['10%','rgba(239,83,80,0.12)','#ef5350'],['SKIP','rgba(239,83,80,0.08)','#b71c1c']]],
              ].map(([rowLabel, cells]) => (
                <tr key={rowLabel}>
                  <th className="px-3 py-2 rounded text-right pr-4" style={{ background: '#1e2030', color: '#ce93d8' }}>{rowLabel}</th>
                  {cells.map(([val, bg, color], i) => (
                    <td key={i} className="px-4 py-2 rounded font-bold" style={{ background: bg, color, textDecoration: val === 'SKIP' ? 'line-through' : 'none', opacity: val === 'SKIP' ? 0.75 : 1 }}>
                      {val}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* Rules */}
      <div className="grid grid-cols-2 gap-3">
        {[
          ['🛡️', 'text-blue-400', 'Правило Безпеки', 'Якщо ВСІ активи у зоні SKIP — все одно інвестуй мінімум 30% бюджету рівномірно.'],
          ['⚖️', 'text-purple-400', 'Правило Балансу', 'Раз на квартал перевір, чи один актив не зайняв >40% портфеля. Якщо так — зменш його % на половину.'],
          ['🔒', 'text-green-400', 'Правило Дисципліни', 'Не дивись портфель посередині місяця. TradingView → цифри → порахував → купив → закрив.'],
          ['🚨', 'text-red-400', 'Правило Краху', 'Якщо 3+ активи мають UVS Signal = Oversold одночасно — дозволь до 1.5× бюджету із резерву.'],
        ].map(([emoji, cls, title, text]) => (
          <div key={title} className="bg-white/5 border border-white/10 rounded-xl p-4">
            <p className={`text-xs font-mono font-bold uppercase tracking-wide mb-1.5 ${cls}`}>{emoji} {title}</p>
            <p className="text-xs text-slate-400 leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-slate-700 font-mono pb-2">БЕЗ ЕМОЦІЙ · ТІЛЬКИ ЦИФРИ · ДОВІРЯЙ СИСТЕМІ</p>
    </div>
  )
}
