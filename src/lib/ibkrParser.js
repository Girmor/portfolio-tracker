/**
 * Parser for Interactive Brokers (IBKR) Activity Statement CSV files.
 *
 * IBKR CSV is multi-section: each line starts with a section name
 * (e.g. "Trades", "Cash Report") followed by a row type
 * ("Header", "Data", "SubTotal", "Total").
 */

/**
 * Parse a single CSV line handling quoted fields.
 * IBKR uses standard CSV quoting: fields with commas are wrapped in "".
 */
function parseCsvLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
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

/**
 * Parse an IBKR Activity Statement CSV.
 *
 * @param {string} csvText - Raw file content
 * @returns {{
 *   trades: Array<{
 *     symbol: string,
 *     dateTime: string,
 *     date: string,
 *     quantity: number,
 *     type: 'buy'|'sell',
 *     price: number,
 *     proceeds: number,
 *     commission: number,
 *     assetCategory: string,
 *     currency: string
 *   }>,
 *   endingCash: number|null,
 *   startingCash: number|null,
 *   errors: string[]
 * }}
 */
/**
 * Extract ticker from IBKR dividend description.
 * e.g. "BST(US09258G1040) Cash Dividend USD 0.25 per Share (Ordinary Dividend)" → "BST"
 * e.g. "BST(US09258G1040) Cash Dividend USD 0.25 per Share - US Tax" → "BST"
 */
function extractTickerFromDescription(description) {
  const match = description.match(/^(\w+)\(/)
  return match ? match[1] : null
}

export function parseIBKRCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  const trades = []
  let endingCash = null
  let startingCash = null
  const errors = []

  // Raw dividend/tax entries before merging
  const rawDividends = []  // from "Dividends" section (gross amounts)
  const rawTaxes = []      // from "Withholding Tax" section

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const fields = parseCsvLine(lines[lineIdx])
    const section = fields[0]
    const rowType = fields[1]

    // ── Trades section ──
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
          errors.push(`Рядок ${lineIdx + 1}: неможливо розпарсити угоду (symbol=${symbol}, qty=${fields[7]}, price=${fields[8]})`)
          continue
        }

        // Only import Stocks for now
        if (assetCategory !== 'Stocks') continue

        const type = rawQuantity < 0 ? 'sell' : 'buy'
        const quantity = Math.abs(rawQuantity)
        // Date from "2026-02-06, 11:42:58" → "2026-02-06"
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
        errors.push(`Рядок ${lineIdx + 1}: помилка парсингу`)
      }
    }

    // ── Dividends section ──
    // Format: Dividends,Data,USD,2024-02-29,BST(US09258G1040) Cash Dividend...,16.57
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
        errors.push(`Рядок ${lineIdx + 1}: помилка парсингу дивіденду`)
      }
    }

    // ── Withholding Tax section ──
    // Format: Withholding Tax,Data,USD,2024-02-29,BST(US09258G1040) Cash Dividend... - US Tax,-2.49
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
        errors.push(`Рядок ${lineIdx + 1}: помилка парсингу податку`)
      }
    }

    // ── Cash Report section ──
    if (section === 'Cash Report' && rowType === 'Data') {
      const label = fields[2]
      const currencySummary = fields[3]
      if (currencySummary === 'Base Currency Summary') {
        const value = parseFloat(fields[4])
        if (label === 'Ending Cash' && !isNaN(value)) {
          endingCash = value
        }
        if (label === 'Starting Cash' && !isNaN(value)) {
          startingCash = value
        }
      }
    }
  }

  // ── Merge dividends and taxes ──
  const dividends = mergeDividendsAndTaxes(rawDividends, rawTaxes)

  if (trades.length === 0) {
    errors.push('У файлі не знайдено жодної угоди (секція "Trades" порожня або відсутня)')
  }

  return { trades, dividends, endingCash, startingCash, errors }
}

/**
 * Merge Dividends (gross) and Withholding Tax entries.
 *
 * Case 1: Both sections exist → net = gross + tax (tax is negative), notes show breakdown
 * Case 2: Only Withholding Tax → use amounts as-is (net cash inflow)
 */
function mergeDividendsAndTaxes(rawDividends, rawTaxes) {
  const result = []

  if (rawDividends.length > 0) {
    // Case 1: Have gross dividends — group by ticker+date, match with taxes
    const grossMap = new Map() // key: "ticker|date"
    for (const d of rawDividends) {
      const key = `${d.ticker}|${d.date}`
      const existing = grossMap.get(key)
      if (existing) {
        existing.amount += d.amount
      } else {
        grossMap.set(key, { ...d })
      }
    }

    const taxMap = new Map()
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
      const netAmount = gross.amount + taxAmount // tax is negative → net < gross

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
    // Case 2: Only withholding tax — use as-is (amounts may be positive = net cash inflow)
    const taxMap = new Map()
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
        description: `Withholding Tax`,
      })
    }
  }

  // Sort by date
  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

/**
 * Generate a fingerprint for duplicate detection.
 * Format: "SYMBOL|DATE|TYPE|QUANTITY|PRICE"
 */
export function tradeFingerprint(trade) {
  return `${trade.symbol}|${trade.date}|${trade.type}|${trade.quantity}|${trade.price}`
}
