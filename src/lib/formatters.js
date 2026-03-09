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
  return new Date(dateStr).toLocaleDateString('uk-UA')
}

export function pnlColor(value) {
  if (value > 0) return 'text-green-600'
  if (value < 0) return 'text-red-600'
  return 'text-gray-600'
}
