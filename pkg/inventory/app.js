// inventory holds the seats for a show and reserves them with a hold that
// expires. It is the service the tutorials fork, because it owns the two
// invariants worth breaking: a seat is never sold twice, and a retry with the
// same idempotency key returns the reservation that already exists.
const express = require('express')
const crypto = require('crypto')
const { Pool } = require('pg')

const PORT = process.env.PORT || 8081
const HOLD_SECONDS = Number(process.env.HOLD_SECONDS || 900)

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://boxoffice:boxoffice@postgres:5432/boxoffice',
})

// A reservation id is derived from the idempotency key rather than generated,
// so the same request always names the same reservation. Every tutorial that
// compares a sandbox against the baseline depends on this.
function reservationId(idempotencyKey) {
  const digest = crypto.createHash('sha256').update(idempotencyKey).digest('hex')
  return `rsv_${digest.slice(0, 12)}`
}

const app = express()
app.use(express.json())

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }))

// Seats currently held or sold for a show.
app.get('/shows/:showId/seats', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select seat, status from seats where show_id = $1 order by seat`,
      [req.params.showId]
    )
    res.json({ showId: req.params.showId, seats: rows })
  } catch (err) {
    next(err)
  }
})

// Reserve seats. Returns the existing reservation when the idempotency key has
// been seen before, so a retry is never a second booking.
app.post('/reservations', async (req, res, next) => {
  const { showId, seats, idempotencyKey } = req.body || {}
  if (!showId || !Array.isArray(seats) || seats.length === 0 || !idempotencyKey) {
    return res
      .status(400)
      .json({ error: 'showId, a non-empty seats array and idempotencyKey are required' })
  }

  const id = reservationId(idempotencyKey)
  const client = await pool.connect()
  try {
    await client.query('begin')

    const existing = await client.query(
      `select reservation_id, seats, status, expires_at from reservations where reservation_id = $1`,
      [id]
    )
    if (existing.rowCount > 0) {
      await client.query('commit')
      const row = existing.rows[0]
      return res.json({
        reservationId: row.reservation_id,
        status: row.status,
        seats: row.seats,
        expiresAt: row.expires_at.toISOString(),
      })
    }

    // Take the seats, but only the ones still free. Locking the rows keeps two
    // concurrent reservations from both believing they won.
    const taken = await client.query(
      `select seat from seats
        where show_id = $1 and seat = any($2::text[]) and status <> 'free'
        for update`,
      [showId, seats]
    )
    if (taken.rowCount > 0) {
      await client.query('rollback')
      return res.status(409).json({
        error: 'seats are not available',
        unavailable: taken.rows.map((r) => r.seat),
      })
    }

    const expiresAt = new Date(Date.now() + HOLD_SECONDS * 1000)
    await client.query(
      `update seats set status = 'held' where show_id = $1 and seat = any($2::text[])`,
      [showId, seats]
    )
    await client.query(
      `insert into reservations (reservation_id, show_id, seats, status, expires_at)
       values ($1, $2, $3, 'held', $4)`,
      [id, showId, seats, expiresAt]
    )
    await client.query('commit')

    res.status(201).json({
      reservationId: id,
      status: 'held',
      seats,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (err) {
    await client.query('rollback').catch(() => {})
    next(err)
  } finally {
    client.release()
  }
})

// Errors carry a generic message; the detail belongs in the log.
app.use((err, _req, res, _next) => {
  console.error('inventory error', err)
  res.status(500).json({ error: 'inventory is unavailable' })
})

app.listen(PORT, () => console.log(`inventory listening on ${PORT}`))
