---
name: signadot-cli
description: Create a Signadot sandbox for a pull request and run this repository's tests against it, using the signadot CLI with an API key. Use when an agent running outside the cluster — a hosted code reviewer, a CI job — needs to verify a change against real dependencies.
---

# Verifying a change in a Signadot sandbox

Signadot's published skills assume a developer's laptop: they want a devbox or `signadot local
connect`, and they reach services over in-cluster DNS. An agent running somewhere else has
neither. This skill covers that case — an API key, outbound HTTPS, and nothing else.

## What you need

- The `signadot` CLI on the path. Install it with
  `curl -sSLf https://raw.githubusercontent.com/signadot/cli/main/scripts/install.sh | sh`.
- `SIGNADOT_API_KEY` and `SIGNADOT_ORG` in the environment. Never print either.
- The repository checked out, so the specs under `signadot/` are available.

Confirm all three before going further:

```bash
signadot cluster list
```

If that fails, stop and report the error. Everything below depends on it.

## Creating the sandbox

The sandbox forks one service onto the image built from this pull request and leaves every other
service in the cluster alone. That is the point: the change runs against real dependencies, not
against mocks.

```bash
signadot sandbox apply -f signadot/pr-sandbox.yaml \
  --set cluster="$CLUSTER" \
  --set registry="$REGISTRY" \
  --set service="$SERVICE" \
  --set image="$IMAGE_TAG" \
  --set repo="$REPO" \
  --set pr="$PR_NUMBER" \
  --wait-timeout 5m
```

Both GitHub labels are set together — Signadot rejects one without the other, and checks that the
pull request exists. Those labels are how a reviewer later finds the sandbox belonging to this
pull request.

## Running the tests

```bash
signadot job submit -f signadot/reservation-guard-job.yaml \
  --set sandbox="$SANDBOX_NAME" \
  --set runnerGroup="$RUNNER_GROUP" \
  --attach
```

`--attach` streams the output and exits non-zero when the job fails, so the exit code is the
result. Report the output verbatim, including the HTTP status codes it prints: those are the
evidence, and a summary of them is not.

To read a finished job again:

```bash
signadot job get "$JOB_NAME" -o json
signadot logs --job "$JOB_NAME"
```

## Cleaning up

Delete the sandbox unless you were asked to leave it running. A reviewer reading the sandbox after
the fact needs it alive, so check before removing it.

```bash
signadot sandbox delete "$SANDBOX_NAME"
```

## Rules

- **Report failures as failures.** A job that exits non-zero means the change behaved differently
  from the baseline. Do not describe it as a flaky test or a test that needs updating.
- **Never print the API key,** and never write it into a file that the repository tracks.
- **Do not edit repository files** while verifying. Verification and fixing are separate jobs.
- **One sandbox per pull request.** Applying the same spec again updates the existing sandbox
  rather than creating a second one.
