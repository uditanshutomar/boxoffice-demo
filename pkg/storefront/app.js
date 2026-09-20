// storefront is the API a client calls. It holds seats through inventory,
// prices them through pricing, and composes the reservation the caller sees.
// Tests run against this service; the lessons usually live behind it.
const express = require('express')

const PORT = process.env.PORT || 8080
const INVENTORY_URL = process.env.INVENTORY_URL || 'http://inventory:8081'
const PRICING_URL = process.env.PRICING_URL || 'http://pricing:8082'

// Signadot routes a request to a sandbox by a key it carries in the `baggage`
// header. A service that does not forward that header sends every downstream
// call to the baseline, so a sandbox of inventory or pricing would never see
// this request. Forwarding the tracing headers alongside it keeps a trace whole.
const PROPAGATED = ['baggage', 'traceparent', 'tracestate', 'x-request-id']

function propagatedHeaders(req) {
  const headers = { 'content-type': 'application/json' }
  for (const name of PROPAGATED) {
    const value = req.get(name)
    if (value) headers[name] = value
  }
  return headers
}

async function callJson(req, url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: propagatedHeaders(req),
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

const app = express()
app.use(express.json())

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }))

// Reserve seats and quote them. The response is the contract every tutorial
// compares: a status, the seats held, when the hold lapses, and the money.
app.post('/reservations', async (req, res) => {
  const { showId, seats, currency = 'USD', idempotencyKey } = req.body || {}
  if (!showId || !Array.isArray(seats) || seats.length === 0 || !idempotencyKey) {
    return res
      .status(400)
      .json({ error: 'showId, a non-empty seats array and idempotencyKey are required' })
  }

  const held = await callJson(req, `${INVENTORY_URL}/reservations`, { showId, seats, idempotencyKey })
  if (!held.ok) {
    // The caller has to learn that no seats were taken. Passing the status
    // through keeps a conflict a conflict and a fault a fault.
    console.error('inventory refused the reservation', held.status, held.payload)
    return res.status(held.status).json({
      error: held.payload.error || 'could not hold the requested seats',
      unavailable: held.payload.unavailable,
    })
  }

  const priced = await callJson(req, `${PRICING_URL}/quotes`, { showId, seats, currency })
  if (!priced.ok) {
    console.error('pricing refused the quote', priced.status, priced.payload)
    return res.status(502).json({ error: 'could not price the requested seats' })
  }

  res.status(201).json({
    reservationId: held.payload.reservationId,
    status: held.payload.status,
    seats: held.payload.seats,
    expiresAt: held.payload.expiresAt,
    quote: priced.payload,
    idempotencyKey,
  })
})

app.use((err, _req, res, _next) => {
  console.error('storefront error', err)
  res.status(500).json({ error: 'the storefront is unavailable' })
})

app.listen(PORT, () => console.log(`storefront listening on ${PORT}`))
