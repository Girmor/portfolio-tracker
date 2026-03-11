import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, corsResponse, jsonResponse, errorResponse } from '../_shared/cors.ts'

const FINNHUB_KEY = Deno.env.get('FINNHUB_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

interface SymbolInput {
  symbol: string
  type: 'stock' | 'crypto'
  coinGeckoId?: string
}

async function fetchFinnhubPrice(ticker: string): Promise<number | null> {
  if (!FINNHUB_KEY) return null
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.c || null
  } catch {
    return null
  }
}

async function fetchCoinGeckoPrices(coinIds: string[]): Promise<Record<string, number>> {
  if (!coinIds.length) return {}
  try {
    const ids = coinIds.map(id => encodeURIComponent(id)).join(',')
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    )
    if (!res.ok) return {}
    const data = await res.json()
    const result: Record<string, number> = {}
    for (const id of coinIds) {
      if (data[id]?.usd != null) result[id] = data[id].usd
    }
    return result
  } catch {
    return {}
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()

  try {
    const { symbols } = await req.json() as { symbols?: SymbolInput[] }

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return errorResponse('symbols array is required')
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    const stocks = symbols.filter(s => s.type === 'stock')
    const cryptos = symbols.filter(s => s.type === 'crypto')

    // Fetch stock prices from Finnhub
    const stockResults = await Promise.all(
      stocks.map(async s => ({
        symbol: s.symbol,
        type: 'stock' as const,
        price: await fetchFinnhubPrice(s.symbol),
      }))
    )

    // Fetch crypto prices from CoinGecko in batch
    const coinIds = cryptos.map(c => c.coinGeckoId || c.symbol.toLowerCase())
    const coinPrices = await fetchCoinGeckoPrices([...new Set(coinIds)])

    const cryptoResults = cryptos.map((c, i) => ({
      symbol: c.symbol,
      type: 'crypto' as const,
      coinGeckoId: coinIds[i],
      price: coinPrices[coinIds[i]] ?? null,
    }))

    // Build prices map (keyed by symbol)
    const prices: Record<string, number | null> = {}
    for (const s of stockResults) {
      prices[s.symbol] = s.price
    }
    for (const c of cryptoResults) {
      prices[c.symbol] = c.price
    }

    // Upsert into price_cache
    const cacheRows = [
      ...stockResults
        .filter(s => s.price != null)
        .map(s => ({
          symbol: s.symbol,
          asset_type: 'stock',
          price: s.price,
          currency: 'USD',
          provider: 'finnhub',
          fetched_at: new Date().toISOString(),
        })),
      ...cryptoResults
        .filter(c => c.price != null)
        .map(c => ({
          symbol: c.symbol,
          asset_type: 'crypto',
          price: c.price,
          currency: 'USD',
          provider: 'coingecko',
          fetched_at: new Date().toISOString(),
        })),
    ]

    if (cacheRows.length > 0) {
      await supabase
        .from('price_cache')
        .upsert(cacheRows, { onConflict: 'symbol,asset_type' })
    }

    return jsonResponse({
      prices,
      cachedAt: new Date().toISOString(),
    })
  } catch (err) {
    return errorResponse(`Internal error: ${err instanceof Error ? err.message : String(err)}`, 500)
  }
})
