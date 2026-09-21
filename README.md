# Boxoffice: a reusable runtime verification example

Boxoffice is a small seat-hold API for tutorials about agentic development. Its three services
run against real PostgreSQL and Redis. Lessons change one service while preserving its deployment
interface, so a Signadot sandbox can exercise the change against the remaining baseline services.

| Service | Responsibility | Dependency |
| --- | --- | --- |
| storefront | Validate a request, acquire a hold, return a quote | inventory, pricing |
| inventory | Own seats, enforce idempotency, expire holds | PostgreSQL |
| pricing | Calculate integer minor-unit amounts and cache quotes | Redis |

This is a teaching application. It does not charge customers, confirm purchases, or send
notifications. PostgreSQL and Redis are disposable in these manifests. A pricing failure after
inventory succeeds leaves a hold until expiry; there is no distributed transaction or checkout
workflow. Sandboxes share the database: request routing alone does not isolate stored data.

## Prerequisites

- A **disposable** Kubernetes test environment with the [Signadot Operator](https://www.signadot.com/docs/installation/signadot-operator).
- Docker and the [Signadot CLI](https://www.signadot.com/docs/getting-started/installation/signadot-cli).
- For minikube, the profile named `minikube`. Use explicit context and image-loading options for another test cluster.
- For Jobs: a [Job Runner Group](https://www.signadot.com/docs/reference/job-runner-groups) with Node.js 18+.
- For Smart Tests: at least one ready managed Smart Test runner in the intended cluster.

Commands below run from this example's directory. Use the matching example revision supplied
with your tutorial; previously published personal-account images do not automatically include
local changes to this checkout.

## 1. Deploy the baseline

```bash
make images
make deploy KUBE_CONTEXT=minikube
```

`make images` builds and loads all three baseline images into the default minikube profile.
`make deploy` initializes one show (`show-1`) with 36 seats in namespace `boxoffice`.
It waits for all five deployments. The application services use DevMesh sidecars and should be
`2/2`; PostgreSQL and Redis have one container each. DevMesh is the routing choice in these
manifests; other Signadot-supported meshes have different setup requirements.

For a registry-backed test cluster, use a registry you own and a context you intend to test on:

```bash
make images REGISTRY=ghcr.io/YOUR_OWNER LOAD="docker push"
make deploy REGISTRY=ghcr.io/YOUR_OWNER KUBE_CONTEXT=YOUR_TEST_CONTEXT
```

Ensure the cluster can pull those images. GHCR packages may need their visibility or pull
credentials configured. Rebuilding a mutable tag does not necessarily replace a cached image;
use a new `TAG` for a changed baseline. The PR workflow below uses image digests instead.

## 2. Run the conventional guard

If you need a runner, a Signadot admin can create the supplied one after deploying the namespace:

```bash
signadot jobrunnergroup apply -f signadot/job-runner-group.yaml --set cluster=YOUR_CLUSTER
```

Wait until the runner has a ready pod, then run against baseline. **The empty sandbox substitution
is required**; omitting it leaves an unexpanded template variable.

```bash
signadot job submit -f signadot/reservation-guard-job.yaml \
  --set runnerGroup=boxoffice-tests --set sandbox= --attach
```

The guard checks the actual JSON contract: a held reservation, correct fees and total, an
identical retry during the active hold, and exactly `409` for a competing reservation. A `5xx`,
malformed JSON, missing fields, transport failure or timeout fails verification.

It reserves C11/C12 using `guard-hold-v2`. The competing key is `guard-conflict-v2`. These are
reserved fixtures: do not use them for manual bookings. Retrying the owning key reuses the hold
until it expires (15 minutes by default); after expiry it acquires a new hold with a new expiry.
Reservation IDs are deterministic, but responses are not timeless or universally byte-identical.
Idempotency binds the hold's show and seat set; currency is a separate quote choice.

## 3. Compare a broken change and a safe change

```bash
make lesson LESSON=swallow-errors
signadot sandbox apply -f signadot/lesson-sandbox.yaml \
  --set cluster=YOUR_CLUSTER --set registry=signadot \
  --set service=storefront --set lesson=swallow-errors --wait-timeout 5m
signadot job submit -f signadot/reservation-guard-job.yaml \
  --set sandbox=storefront-swallow-errors --set runnerGroup=boxoffice-tests --attach
```

The second key now receives `201` with a quote but no hold. The guard must fail. Static review
can also identify this bug; the runtime demonstration establishes what actually happened.

Repeat with `LESSON=safe-refactor` and `lesson=safe-refactor`; use sandbox
`storefront-safe-refactor` for the job. That change extracts validation into a helper and should
pass the same contract. For another cluster, build lessons with the same `REGISTRY` and `LOAD`
options used for baseline and pass that registry to the sandbox.

The third lesson, `drop-fees`, forks **pricing**. It removes fees from the quote and total.
Both test formats detect it. See [the lesson catalogue](lessons/README.md).

## 4. Configure automatic hosted Smart Tests

External `.star` files do not run merely because a sandbox exists. To run this test on creation:

1. Enable at least one managed Smart Test runner for the cluster in Signadot's **Platform → Managed Runners** page.
2. Create a **hosted Smart Test** named `boxoffice-reservation-contract` in the dashboard. Paste the contents of `smart-tests/reservations/create-reservation.star`.
3. In its **Triggers** tab, add the intended cluster and `Deployment`, namespace `boxoffice`, workload `storefront`. Enable traffic comparison for the execution.
4. Add a second trigger for `Deployment` / `boxoffice` / `pricing` for the `drop-fees` lesson.
5. Create or update a matching sandbox, then inspect the resulting **hosted** execution and its baseline and sandbox checks. Existing external executions do not prove the trigger is configured.

This is the documented [hosted-trigger mechanism](https://www.signadot.com/docs/reference/smart-tests/spec#triggers).
It does not require a separate test-run MCP tool or a CLI key in the reviewer's shell.
The test uses B11/B12 and separate fixed fixture keys, so it can run alongside the conventional guard.

An execution can be `succeeded` while an assertion failed. Read
`status.testExecutions.checks.failed` as well as `phaseCounts`. The
[sandbox status reference](https://www.signadot.com/docs/reference/sandboxes/status) explains the
summary fields. Ordinary Jobs are summarized separately under `status.jobs`.

For an explicit external run from a git checkout, you can also use:

```bash
signadot smart-test run --sandbox storefront-safe-refactor --publish --wait
```

Hosted and external tests are separate copies. After editing the `.star` file, update the hosted
copy before claiming that a sandbox ran the new contract.

## 5. Use the example in a PR tutorial

For GitHub workflows, place this example at the **root of a repository you control**, including
its dotfiles. Nested `.github/workflows` inside an examples monorepo do not run automatically.

- `Publish boxoffice images` publishes baseline and convenience lesson tags. Its packages must be pullable by the cluster.
- `Build PR image` builds the selected service from an actual same-repository PR head, without applying a lesson overlay. It records repository, PR, full SHA, service and digest in `build-identity.json` and its run summary.
- `signadot/pr-sandbox.yaml` uses that full digest and revision labels. Compute its name with `node scripts/sandbox-name.cjs OWNER/REPO PR FULL_HEAD_SHA`. It is specific to the repository, PR and commit and fits Signadot's 30-character limit.
- `.coderabbit.yaml` proposes a read-only evidence check and an explicitly invoked MCP verification recipe. Configure connection tools and scope in CodeRabbit separately. A review instruction is interpreted by an agent; it is not a deterministic CI status check.
- `.claude/skills/signadot-cli/SKILL.md` describes verification and its failure conditions. It respects tool confirmation and cancellation, and does not rename credentials.
- `scripts/check-evidence.cjs` deterministically checks the sandbox summary against an expected build identity. It does not prove which named test ran; inspect the hosted execution too.
- `scripts/publish-runtime-status.cjs` additionally verifies the successful exact-head build artifact and the named hosted execution's five baseline and sandbox checks, then publishes a GitHub commit status.

After invoking `@coderabbitai run verify-in-signadot`, open the **Coding Agent task started**
link in the reply. Read the proposed sandbox specification and answer its confirmation in
**Steer the agent**. A task-list status of **No changes made** can mean the task is waiting for
that answer; it does not prove a sandbox or test was created. The templates explicitly specify
the environment override's `container` and `operation: upsert`, as required by MCP.

**Live validation limitation (2026-09-21):** In the tested CodeRabbit connection, both lesson PRs'
creation calls reported client cancellation after the specifications were confirmed. Both tasks
stopped without confirmed sandbox creation or hosted test results. Application tests, hosted triggers and
MCP result reads have been verified separately; the full CodeRabbit creation-to-review loop
is not yet verified. Respect cancellation and diagnose the client interaction before retrying.

A new commit needs a new build and sandbox. Never pass the old lesson tag off as the current PR's
code. A passing runtime check supplements static findings; it does not automatically make a change
safe or guarantee CodeRabbit approval.

### Enforce runtime verification in GitHub

CodeRabbit's [Inconclusive result does not block a PR](https://docs.coderabbit.ai/pr-reviews/pre-merge-checks#results-in-the-walkthrough),
even with an error-mode custom check. Require the deterministic **Signadot / reservation-contract**
status in GitHub branch protection, alongside the approving-review requirement. Preserve stale
approval dismissal and account for any maintainer bypass permissions.

From a trusted checkout of this baseline, authenticate `gh` for the repository and the Signadot
CLI for the intended organization. Use Node.js 22. The GitHub credential needs permission to
write commit statuses; the Signadot credential only needs to read the sandbox and test results.
After the hosted test completes, run:

```bash
node scripts/publish-runtime-status.cjs OWNER/REPO PR_NUMBER BUILD_RUN_ID
```

Use the successful **Build PR image** run for that PR's current head. The publisher reads evidence
directly, rejects missing/pending/stale/failed results, and publishes failure on retrieval errors.
It does not create infrastructure or execute PR code. Run it from trusted baseline code, never an
unreviewed PR checkout containing a modified publisher. Keep status-writing credentials with the
trusted publisher. After its first run, select this exact status name in branch protection.

This is a point-in-time verification: rerun after relevant test or environment changes and before
merging. A new PR commit requires a new image, sandbox and successful status. CodeRabbit's review
and the deterministic status serve different purposes; neither replaces the other.

## Local regression tests

Install Node.js 22, PostgreSQL 16 command-line tools, and Redis. On macOS, PostgreSQL and Redis
are available through Homebrew. Then:

```bash
make test
```

The harness installs locked Node dependencies and starts disposable local databases on
`127.0.0.1:15432` and `127.0.0.1:16379`. Those ports and application ports 18080–18088 must be free.
It cleans up its own processes and data afterwards. Tests exercise concurrent reservations,
idempotency, expiry, invalid input, dependency failures, routing-header propagation, cache
separation, lesson outcomes, and missing or stale verification evidence.

These are application tests, not a substitute for cluster routing and live CodeRabbit validation.

## Extending the example

Keep lesson changes narrow and retain the same routes, ports and dependencies. Add an explicit
behavioral expectation and test both the correct baseline and the changed service. Do not depend
on a reviewer missing a bug or agreeing with a persuasive comment.

Storefront forwards `baggage`, `traceparent`, `tracestate` and `x-request-id`. Pricing keys include
`CACHE_NAMESPACE`, show, currency and seats. Sandbox specs set a separate cache namespace, so a
warm baseline cache cannot hide or be contaminated by a changed pricing implementation.

Inventory serializes mutations per show and locks all requested seat rows. This deliberately
simple policy suits a 36-seat demo; it is not a high-throughput booking architecture.

## Cleanup

Delete only the sandboxes you created. Disable or remove the hosted test's triggers if the
cluster will no longer be used for this example. An administrator can remove a dedicated runner
group when it is no longer needed.

```bash
signadot sandbox delete storefront-swallow-errors
signadot sandbox delete storefront-safe-refactor
signadot sandbox delete pricing-drop-fees
# Deletes the entire disposable application namespace and its database contents:
make clean KUBE_CONTEXT=minikube
```
