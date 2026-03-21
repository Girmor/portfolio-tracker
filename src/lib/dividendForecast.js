const MONTHS_SHORT = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']

function monthLabel(yyyyMM) {
  const [year, month] = yyyyMM.split('-').map(Number)
  return `${MONTHS_SHORT[month - 1]} ${String(year).slice(2)}`
}

function toYYYYMM(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function addMonths(yyyyMM, n) {
  const [year, month] = yyyyMM.split('-').map(Number)
  const d = new Date(year, month - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function detectFrequency(sortedDates) {
  if (sortedDates.length < 2) return 'unknown'
  const gaps = []
  for (let i = 1; i < sortedDates.length; i++) {
    const diff = (new Date(sortedDates[i]) - new Date(sortedDates[i - 1])) / (1000 * 60 * 60 * 24)
    gaps.push(diff)
  }
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  if (median < 45) return 'monthly'
  if (median < 120) return 'quarterly'
  if (median < 240) return 'semiannual'
  return 'annual'
}

const FREQ_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }
const FREQ_LOOKBACK = { monthly: 6, quarterly: 4, semiannual: 3, annual: 2 }
const FREQ_LABEL = {
  monthly: 'щомісячно',
  quarterly: 'щоквартально',
  semiannual: 'раз на півроку',
  annual: 'щорічно',
  unknown: 'невідомо',
}

export function buildTickerForecast(tickerDividends) {
  const sorted = [...tickerDividends].sort((a, b) => new Date(a.date) - new Date(b.date))
  const dates = sorted.map(d => d.date)
  const frequency = detectFrequency(dates)

  if (frequency === 'unknown') {
    return { ticker: sorted[0]?.ticker, frequency, avgPayment: 0, forecastEvents: [], freqLabel: FREQ_LABEL.unknown }
  }

  const lookback = FREQ_LOOKBACK[frequency]
  const recent = sorted.slice(-lookback)
  const avgPayment = recent.reduce((s, d) => s + Number(d.amount), 0) / recent.length

  const lastDate = new Date(sorted[sorted.length - 1].date)
  const lastYYYYMM = toYYYYMM(lastDate)
  const now = new Date()
  const nowYYYYMM = toYYYYMM(now)
  const endYYYYMM = addMonths(nowYYYYMM, 12)

  const stepMonths = FREQ_MONTHS[frequency]
  const forecastEvents = []
  let cursor = addMonths(lastYYYYMM, stepMonths)

  while (cursor <= endYYYYMM) {
    if (cursor > nowYYYYMM) {
      forecastEvents.push({ month: cursor, amount: avgPayment })
    }
    cursor = addMonths(cursor, stepMonths)
  }

  return {
    ticker: sorted[0]?.ticker,
    frequency,
    freqLabel: FREQ_LABEL[frequency],
    avgPayment,
    forecastEvents,
  }
}

export function buildForecast(allDividends) {
  if (!allDividends || allDividends.length === 0) {
    return { trailing12M: 0, forward12M: 0, monthlyRunRate: 0, growthPct: null, series: [], perTicker: [] }
  }

  // Group by ticker
  const byTicker = {}
  allDividends.forEach(d => {
    if (!byTicker[d.ticker]) byTicker[d.ticker] = []
    byTicker[d.ticker].push(d)
  })

  const perTicker = Object.values(byTicker).map(buildTickerForecast)

  // Aggregate forecast by month
  const forecastByMonth = {}
  perTicker.forEach(t => {
    t.forecastEvents.forEach(e => {
      forecastByMonth[e.month] = (forecastByMonth[e.month] || 0) + e.amount
    })
  })

  // Build actual by month (last 12 months)
  const now = new Date()
  const nowYYYYMM = toYYYYMM(now)
  const start12M = addMonths(nowYYYYMM, -11)

  const actualByMonth = {}
  allDividends.forEach(d => {
    const m = toYYYYMM(d.date)
    if (m >= start12M && m <= nowYYYYMM) {
      actualByMonth[m] = (actualByMonth[m] || 0) + Number(d.amount)
    }
  })

  const trailing12M = Object.values(actualByMonth).reduce((s, v) => s + v, 0)
  const forward12M = Object.values(forecastByMonth).reduce((s, v) => s + v, 0)
  const monthlyRunRate = forward12M / 12
  const growthPct = trailing12M > 0 ? ((forward12M - trailing12M) / trailing12M) * 100 : null

  // Build unified 24-month series: 12 actual + 12 forecast
  const series = []
  for (let i = -11; i <= 12; i++) {
    const month = addMonths(nowYYYYMM, i)
    const isPast = month <= nowYYYYMM
    series.push({
      month,
      label: monthLabel(month),
      actual: isPast ? (actualByMonth[month] || 0) : null,
      forecast: !isPast ? (forecastByMonth[month] || 0) : null,
    })
  }

  // Sort perTicker by projected annual descending
  const sortedPerTicker = [...perTicker].sort((a, b) => {
    const aAnnual = a.frequency === 'unknown' ? 0 : a.forecastEvents.reduce((s, e) => s + e.amount, 0)
    const bAnnual = b.frequency === 'unknown' ? 0 : b.forecastEvents.reduce((s, e) => s + e.amount, 0)
    return bAnnual - aAnnual
  })

  return { trailing12M, forward12M, monthlyRunRate, growthPct, series, perTicker: sortedPerTicker }
}
