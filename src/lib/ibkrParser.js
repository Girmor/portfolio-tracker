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
export function parseIBKRCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  const trades = []
  let endingCash = null
  let startingCash = null
  const errors = []

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

  if (trades.length === 0) {
    errors.push('У файлі не знайдено жодної угоди (секція "Trades" порожня або відсутня)')
  }

  return { trades, endingCash, startingCash, errors }
}

/**
 * Generate a fingerprint for duplicate detection.
 * Format: "SYMBOL|DATE|TYPE|QUANTITY|PRICE"
 */
export function tradeFingerprint(trade) {
  return `${trade.symbol}|${trade.date}|${trade.type}|${trade.quantity}|${trade.price}`
}
