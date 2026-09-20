# Lessons

Each lesson is one service's `app.js`, published as a tag on that service's image. Nothing else
about the deployment changes, so a Signadot sandbox can fork the service onto a tag and run it
against the rest of the cluster untouched.

Build one with:

```bash
make lesson LESSON=swallow-errors
```

Read one as a diff against the service it replaces:

```bash
diff -u pkg/storefront/app.js lessons/swallow-errors/storefront/app.js
```

## What Each Lesson Does

| Lesson | Service | Reads As | Actually Does |
| --- | --- | --- | --- |
| `swallow-errors` | storefront | Not failing the request when a seat is taken, so the caller can pick again without a round trip | Answers `201 Created` with a price and no reservation. The customer is quoted for seats nobody is holding. |
| `safe-refactor` | storefront | Validation pulled into a helper so the happy path reads in one screen | Nothing. Byte-identical responses. This is the counter-example. |
| `drop-fees` | pricing | Simplifying a quote that carried two amounts summing to a third | `fees` disappears from the contract and the total drops by that amount. |

## Verified Behaviour

Against the same request for a seat that is already held:

```
baseline        HTTP 409  {"error":"seats are not available","unavailable":["A1"]}
swallow-errors  HTTP 201  {"quote":{"currency":"USD","subtotal":4500,"fees":225,"total":4725},"idempotencyKey":"c-2"}
safe-refactor   HTTP 409  {"error":"seats are not available","unavailable":["A1"]}
```

And for a fresh quote:

```
baseline        "quote":{"currency":"USD","subtotal":2500,"fees":125,"total":2625}
drop-fees       "quote":{"currency":"USD","subtotal":2500,"total":2500}
```

## Adding A Lesson

Copy the service's `app.js` into `lessons/<name>/<service>/app.js` and make the smallest change
that reads as an improvement. Two rules hold it together:

1. **Stay drop-in.** Same routes, same ports, same environment. A lesson that changes the
   deployment shape cannot be forked into a sandbox against unmodified dependencies.
2. **Justify it in a comment.** A regression that announces itself teaches nothing. The comment is
   what makes a reviewer reading only the diff agree with the change.

The catalogue of lessons still to build — `enum-widened`, `money-float`, `idempotency-dropped`,
`hold-never-expires`, `cache-stale`, `retry-masks-failure` — is in the design sketch.
