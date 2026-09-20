// pricing quotes a seat selection. Amounts are integers in the currency's
// minor unit — cents, not dollars — because that is the invariant the
// money-float lesson breaks.
const express = require('express')
const redis = require('redis')

const PORT = process.env.PORT || 8082
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 60)

const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' })
client.on('error', (err) => console.error('redis error', err))
client.connect().catch((err) => console.error('redis connect failed', err))

// Row A is the expensive one. Prices are per seat, in minor units.
const SEAT_PRICE = { A: 4500, B: 3500, C: 2500 }
const DEFAULT_PRICE = 2000
const FEE_BASIS_POINTS = 500 // 5% booking fee
const RATE_FROM_USD = { USD: 1, EUR: 0.92, GBP: 0.79 }

function seatPrice(seat) {
  return SEAT_PRICE[seat[0]] ?? DEFAULT_PRICE
}

// Integer arithmetic throughout. Converting currency rounds once, at the end of
// each component, so subtotal + fees always equals total.
function quote(seats, currency) {
  const rate = RATE_FROM_USD[currency]
  const subtotalUsd = seats.reduce((sum, seat) => sum + seatPrice(seat), 0)
  const subtotal = Math.round(subtotalUsd * rate)
  const fees = Math.round((subtotal * FEE_BASIS_POINTS) / 10000)
  return { currency, subtotal, fees, total: subtotal + fees }
}

// The cache key carries the currency. Dropping it is the cache-stale lesson:
// a request for EUR is served a price computed in USD.
function cacheKey(showId, seats, currency) {
  return `quote:${showId}:${currency}:${[...seats].sort().join(',')}`
}

const app = express()
app.use(express.json())

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }))

app.post('/quotes', async (req, res, next) => {
  const { showId, seats, currency = 'USD' } = req.body || {}
  if (!showId || !Array.isArray(seats) || seats.length === 0) {
    return res.status(400).json({ error: 'showId and a non-empty seats array are required' })
  }
  if (!RATE_FROM_USD[currency]) {
    return res.status(400).json({ error: `unsupported currency: ${currency}` })
  }

  try {
    const key = cacheKey(showId, seats, currency)
    const cached = await client.get(key)
    if (cached) {
      return res.json(JSON.parse(cached))
    }

    const result = quote(seats, currency)
    await client.setEx(key, CACHE_SECONDS, JSON.stringify(result))
    res.json(result)
  } catch (err) {
    next(err)
  }
})

app.use((err, _req, res, _next) => {
  console.error('pricing error', err)
  res.status(500).json({ error: 'pricing is unavailable' })
})

app.listen(PORT, () => console.log(`pricing listening on ${PORT}`))
