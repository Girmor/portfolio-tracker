/**
 * Shared IBKR CSV parser — TypeScript port of src/lib/ibkrParser.js
 * Used by import-ibkr-preview and import-ibkr-commit Edge Functions.
 */

export interface TradeRow {
  symbol: string
  dateTime: string
  date: string
  quantity: number
  type: 'buy' | 'sell'
  price: number
  proceeds: number
  commission: number
  assetCategory: string
  currency: string
}

export interface DividendRow {
  ticker: string
  date: string
  amount: number
  currency: string
  description: string
}

export interface ParseResult {
  trades: TradeRow[]
  dividends: DividendRow[]
  endingCash: number | null
  startingCash: number | null
  errors: string[]
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current.trim())
  return fields
}

function extractTickerFromDescription(description: string): string | null {
  const match = description.match(/^(\w+)\(/)
  return match ? match[1] : null
}

interface RawDividend {
  ticker: string
  date: string
  amount: number
  currency: string
  description: string
}

function mergeDividendsAndTaxes(rawDividends: RawDividend[], rawTaxes: RawDividend[]): DividendRow[] {
  const result: DividendRow[] = []

  if (rawDividends.length > 0) {
    const grossMap = new Map<string, RawDividend>()
    for (const d of rawDividends) {
      const key = `${d.ticker}|${d.date}`
      const existing = grossMap.get(key)
      if (existing) {
        existing.amount += d.amount
      } else {
        grossMap.set(key, { ...d })
      }
    }

    const taxMap = new Map<string, RawDividend>()
    for (const t of rawTaxes) {
      const key = `${t.ticker}|${t.date}`
      const existing = taxMap.get(key)
      if (existing) {
        existing.amount += t.amount
      } else {
        taxMap.set(key, { ...t })
      }
    }

    for (const [key, gross] of grossMap) {
      const tax = taxMap.get(key)
      const taxAmount = tax ? tax.amount : 0
      const netAmount = gross.amount + taxAmount

      result.push({
        ticker: gross.ticker,
        date: gross.date,
        amount: Math.round(netAmount * 100) / 100,
        currency: gross.currency,
        description: tax
          ? `Gross: $${gross.amount.toFixed(2)}, Tax: $${taxAmount.toFixed(2)}`
          : `Gross: $${gross.amount.toFixed(2)}`,
      })
    }
  } else if (rawTaxes.length > 0) {
    const taxMap = new Map<string, RawDividend>()
    for (const t of rawTaxes) {
      const key = `${t.ticker}|${t.date}`
      const existing = taxMap.get(key)
      if (existing) {
        existing.amount += t.amount
      } else {
        taxMap.set(key, { ...t })
      }
    }

    for (const [, entry] of taxMap) {
      result.push({
        ticker: entry.ticker,
        date: entry.date,
        amount: Math.round(entry.amount * 100) / 100,
        currency: entry.currency,
        description: 'Withholding Tax',
      })
    }
  }

  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

export function parseIBKRCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  const trades: TradeRow[] = []
  let endingCash: number | null = null
  let startingCash: number | null = null
  const errors: string[] = []
  const rawDividends: RawDividend[] = []
  const rawTaxes: RawDividend[] = []

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const fields = parseCsvLine(lines[lineIdx])
    const section = fields[0]
    const rowType = fields[1]

    if (section === 'Trades' && rowType === 'Data' && fields[2] === 'Order') {
      try {
        const assetCategory = fields[3] || ''
        const currency = fields[4] || 'USD'
        const symbol = fields[5] || ''
        const dateTime = fields[6] || ''
        const rawQuantity = parseFloat(fields[7])
        const price = parseFloat(fields[8])
        const proceeds = parseFloat(fields[10])
        const commission = parseFloat(fields[11])

        if (!symbol || isNaN(rawQuantity) || isNaN(price)) {
          errors.push(`Row ${lineIdx + 1}: cannot parse trade (symbol=${symbol})`)
          continue
        }

        if (assetCategory !== 'Stocks') continue

        const type = rawQuantity < 0 ? 'sell' : 'buy'
        const quantity = Math.abs(rawQuantity)
        const date = dateTime.split(',')[0].trim()

        trades.push({
          symbol,
          dateTime,
          date,
          quantity,
          type,
          price,
          proceeds: isNaN(proceeds) ? 0 : proceeds,
          commission: isNaN(commission) ? 0 : commission,
          assetCategory,
          currency,
        })
      } catch {
        errors.push(`Row ${lineIdx + 1}: parse error`)
      }
    }

    if (section === 'Dividends' && rowType === 'Data') {
      if (fields[2] === 'Total') continue
      try {
        const currency = fields[2] || 'USD'
        const date = fields[3] || ''
        const description = fields[4] || ''
        const amount = parseFloat(fields[5])
        const ticker = extractTickerFromDescription(description)
        if (ticker && !isNaN(amount) && date) {
          rawDividends.push({ ticker, date, amount, currency, description })
        }
      } catch {
        errors.push(`Row ${lineIdx + 1}: dividend parse error`)
      }
    }

    if (section === 'Withholding Tax' && rowType === 'Data') {
      if (fields[2] === 'Total') continue
      try {
        const currency = fields[2] || 'USD'
        const date = fields[3] || ''
        const description = fields[4] || ''
        const amount = parseFloat(fields[5])
        const ticker = extractTickerFromDescription(description)
        if (ticker && !isNaN(amount) && date) {
          rawTaxes.push({ ticker, date, amount, currency, description })
        }
      } catch {
        errors.push(`Row ${lineIdx + 1}: tax parse error`)
      }
    }

    if (section === 'Cash Report' && rowType === 'Data') {
      const label = fields[2]
      const currencySummary = fields[3]
      if (currencySummary === 'Base Currency Summary') {
        const value = parseFloat(fields[4])
        if (label === 'Ending Cash' && !isNaN(value)) endingCash = value
        if (label === 'Starting Cash' && !isNaN(value)) startingCash = value
      }
    }
  }

  const dividends = mergeDividendsAndTaxes(rawDividends, rawTaxes)

  if (trades.length === 0) {
    errors.push('No trades found in file (Trades section is empty or missing)')
  }

  return { trades, dividends, endingCash, startingCash, errors }
}

export function tradeFingerprint(trade: Pick<TradeRow, 'symbol' | 'date' | 'type' | 'quantity' | 'price'>): string {
  return `${trade.symbol}|${trade.date}|${trade.type}|${trade.quantity}|${trade.price}`
}
