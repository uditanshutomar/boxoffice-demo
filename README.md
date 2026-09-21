# Boxoffice

A seat reservation system for demonstrating runtime verification. It exists to answer one
question: when a change reads as an improvement but behaves differently, what catches it?

Every lesson in `lessons/` is a small, plausible edit — the kind an AI agent writes while tidying
code up — published as a tag on one service's image. Run a lesson in a Signadot sandbox and its
behaviour diverges from the baseline while the diff still looks reasonable.

## What you will build

Three services and their dependencies, in one namespace:

| Service | Role | Backed By |
| --- | --- | --- |
| `storefront` | The API you call. Holds seats, then prices them. | — |
| `inventory` | Owns the seats. Reserves them with a hold that expires. | Postgres |
| `pricing` | Quotes a seat selection. | Redis |

`POST /reservations` returns the contract everything here compares:

```json
{
  "reservationId": "rsv_0d0b7cd01fa4",
  "status": "held",
  "seats": ["C11", "C12"],
  "expiresAt": "2026-09-20T17:26:13.236Z",
  "quote": { "currency": "USD", "subtotal": 5000, "fees": 250, "total": 5250 },
  "idempotencyKey": "guard-hold"
}
```

The same request always returns the same response. A reservation's id is derived from its
idempotency key and a retry returns the stored reservation, so comparing a sandbox against the
baseline shows real differences rather than noise.

## Prerequisites

- A Kubernetes cluster with the [Signadot Operator](https://www.signadot.com/docs/installation/signadot-operator) installed
- The [Signadot CLI](https://www.signadot.com/docs/getting-started/installation/signadot-cli)
- A [Job Runner Group](https://www.signadot.com/docs/reference/job-runner-groups) for running the guard job
- Docker, and `minikube` if that is where you are running

## Step 1: Deploy the baseline

```bash
make images
make deploy
```

This builds each service at `:baseline`, loads the images into the cluster, applies the manifests
and seeds one show with three rows of twelve seats.

`make images` loads images straight into minikube. On any other cluster, push them to a registry
it can pull from and deploy from the same place:

```bash
make images REGISTRY=ghcr.io/you LOAD="docker push"
make deploy REGISTRY=ghcr.io/you
```

`make deploy` rewrites the image registry in the manifests to match, so the two stay in step.

The deployments carry `sidecar.signadot.com/inject: "true"`. Signadot's DevMesh sidecar is what
routes a request to a sandbox; without it a sandbox stays at `RoutingNotReady`.

## Step 2: Run the guard against the baseline

```bash
signadot job submit -f signadot/reservation-guard-job.yaml \
  --set runnerGroup=<your-runner-group> --attach
```

It asserts the two things a reservation has to get right: a request that can be served holds seats
and is quoted with its fees, and seats that are already held are refused. Against the baseline it
passes.

The job holds seats C11 and C12 under a fixed idempotency key, so every run returns the same
reservation rather than consuming more of the show. That is why it can be run repeatedly, and why
the second request in it is always a genuine conflict.

## Step 3: Run a lesson

```bash
make lesson LESSON=swallow-errors

signadot sandbox apply -f signadot/lesson-sandbox.yaml \
  --set cluster=<your-cluster> --set registry=signadot \
  --set service=storefront --set lesson=swallow-errors \
  --wait-timeout 5m

signadot job submit -f signadot/reservation-guard-job.yaml \
  --set sandbox=storefront-swallow-errors --set runnerGroup=<your-runner-group> --attach
```

The sandbox runs the lesson's `storefront` against the same inventory, pricing, Postgres and Redis
as everything else. The same job now fails:

```
POST /reservations (seats held)  -> HTTP 201 {"quote":{"currency":"USD","subtotal":5000,"fees":250,"total":5250},...}
FAIL: seats that are already held returned HTTP 201.
      The caller is told the booking succeeded while holding nothing.
```

Read the change that caused it:

```bash
diff -u pkg/storefront/app.js lessons/swallow-errors/storefront/app.js
```

Four lines, with a comment explaining why they are an improvement.

## Step 4: Run the counter-example

```bash
make lesson LESSON=safe-refactor
signadot sandbox apply -f signadot/lesson-sandbox.yaml \
  --set cluster=<your-cluster> --set registry=signadot \
  --set service=storefront --set lesson=safe-refactor \
  --wait-timeout 5m
signadot job submit -f signadot/reservation-guard-job.yaml \
  --set sandbox=storefront-safe-refactor --set runnerGroup=<your-runner-group> --attach
```

This one really is a refactor. The job passes, identical to the baseline. A verification step that
only ever fails teaches nothing, so the counter-example matters as much as the regression.

`lessons/README.md` lists what each lesson does and what it looks like in review.

The repository also ships Smart Tests under `smart-tests/`, which compare a sandbox's responses
against the baseline rather than asserting on them. They need Smart Test Runners enabled for your
cluster under **Platform → Managed Runners**, and — this is the part to check — at least one
runner pod actually running in the cluster. If `Smart Test Runners` shows as "Not configured" for
your cluster, or runs end in `timed out after 5m` with no pod appearing, the runner has not been
provisioned and no Smart Test will execute. The guard job above needs only a Job Runner Group and
is unaffected.

## Notes for extending this

- **Forward the routing header.** `storefront` passes `baggage` on to its downstream calls. A
  service that does not forward it sends every request to the baseline, so a sandbox of anything behind it
  never runs.
- **Mind caches.** A cache entry written by the baseline will be served to a sandbox, and a test
  then passes against code that never ran. `pricing` keeps a short time to live for this reason.
- **Stay drop-in.** A lesson changes one service's code and nothing else — same routes, same
  ports, same environment — so it can be forked against untouched dependencies.

## What the CodeRabbit files are for

Three files here belong to the
[runtime-aware code review](https://www.signadot.com/docs/tutorials/runtime-aware-code-review)
tutorial, which has CodeRabbit create the sandbox, run the guard job and read the result over
Signadot's MCP server. They are inert unless you follow it.

| Path | Role |
| --- | --- |
| `.coderabbit.yaml` | The review settings, the `verify-in-signadot` recipe and the pre-merge check that reads the sandbox |
| `.claude/skills/signadot-cli/` | The skill an agent follows to create a sandbox and run the job with an API key alone |
| `scripts/coderabbit-setup.sh` | Setup script for a CodeRabbit coding environment; installs a pinned Signadot CLI |

## Cleanup

```bash
signadot sandbox delete <sandbox-name>
make clean
```

## Conclusion

A diff shows you what changed. A sandbox shows you what it does. Boxoffice exists so you can see
the gap between those two, on changes small enough to approve without thinking.
