export function formatMoney(amount, currency = 'USD') {
  if (amount == null) return '—'

  const absAmount = Math.abs(amount)
  let maxDecimals = 2

  if (absAmount > 0 && absAmount < 0.01) {
    const magnitude = Math.floor(Math.log10(absAmount))
    maxDecimals = Math.min(10, Math.abs(magnitude) + 2)
  }

  return new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  }).format(amount)
}

export function formatNumber(num, decimals = 2) {
  if (num == null) return '—'
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num)
}

export function formatPercent(num) {
  if (num == null) return '—'
  const sign = num >= 0 ? '+' : ''
  return `${sign}${num.toFixed(2)}%`
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  // Use local noon to avoid UTC midnight rolling back 1 day in UTC+2/+3
  const s = dateStr.split('T')[0]
  return new Date(s + 'T12:00:00').toLocaleDateString('uk-UA')
}

export function pnlColor(value) {
  if (value > 0) return 'text-green-400'
  if (value < 0) return 'text-red-400'
  return 'text-slate-400'
}
