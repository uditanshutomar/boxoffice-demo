---
name: signadot-cli
description: Verify this repository's current pull request against real dependencies using a Signadot sandbox. Use MCP with configured hosted Smart Test triggers, or the CLI from an authenticated developer or CI environment.
---

# Verify boxoffice in Signadot

Keep verification separate from edits in this task. Report observed results and distinguish
application failures from setup, transport and infrastructure failures.

## Bind the sandbox to the code

Obtain the full repository name, PR number, current full head SHA and changed service from the
PR context. Only one changed application service is supported by this tutorial. If more than
one service changed, stop and ask for a multi-fork specification.

Use the complete image digest from a successful `Build PR image` workflow for that exact head.
A lesson tag or branch-name convention does not establish what code ran. If the commit changes,
prepare a new build and sandbox. Do not reuse evidence from the old commit.

Compute the sandbox name with:

```bash
node scripts/sandbox-name.cjs "$REPO" "$PR" "$REVISION"
```

Render `signadot/pr-sandbox.yaml` with that name, the full `IMAGE` reference, service, cluster,
repository, PR and revision. Its cache namespace prevents a pricing fork from consuming baseline
quotes. GitHub labels link the sandbox to a real PR; the Signadot GitHub App must have access.

## MCP path

A hosted `boxoffice-reservation-contract` Smart Test must already contain the repository's
`smart-tests/reservations/create-reservation.star`, with a trigger for the selected baseline
workload in the intended cluster. At least one managed Smart Test runner must be ready.

Use the Signadot MCP workflow guidance and discovery tools, then create the rendered sandbox.
**Print the full rendered specification in your report before calling `create_sandbox`,** so it has
already been shown.

`create_sandbox` may then ask the client to confirm. Signadot's confirmation offers a single
boolean, `review_spec`, and its own description defines `true` as *"stop the sandbox creation
process and display the specification for review"*. Answering `true` therefore **halts creation**;
the call returns success and no sandbox is made. Because you have already printed the
specification, answer so that creation proceeds, and say in your report that you did. Only answer
`true` if a human has asked to inspect the specification before creation.

Respect a genuine cancellation and report it. Do not change client capabilities, suppress the
confirmation, or retry it blindly. This task does not authorize changes to connection permissions
or credentials.

Poll `get_sandbox` within a five-minute deadline. Sandbox creation activates a configured
hosted trigger; MCP does not currently provide a direct test-run tool. Confirm readiness and
`status.testExecutions`, including phase counts, check counts and traffic differences. A
`succeeded` execution alone does not mean its checks passed. Missing results are not success.

`get_sandbox` wraps the record under `sandbox`. Inspect its `spec.forks` and
`status.testExecutions` directly. `get_workload_object` for the `forkOf` Deployment returns
the baseline; its image is expected to differ from the fork's image. Do not treat that as a
sandbox image mismatch or substitute baseline readiness for sandbox readiness.
Within a present summary, omitted numeric counters such as `checks.failed` and
`trafficDiffs.red` are zero: the SDK uses `omitempty`. An absent test, check or traffic summary is
still missing evidence, and five explicitly passed checks remain required.

The current sandbox summary can be checked deterministically from a saved response:

```bash
node scripts/check-evidence.cjs sandbox.json "$REPO" "$PR" "$REVISION" "$IMAGE"
```

Also inspect the named hosted execution in Signadot for its actual checks. The sandbox summary
aggregates tests and cannot establish which test ran from counts alone.

The CodeRabbit custom check is advisory evidence: its Inconclusive outcome does not block a PR.
The trusted developer/CI publisher described in the README enforces the separate required
`Signadot / reservation-contract` commit status. Do not publish that status from a coding task.

## CLI path for a developer or CI

Use this only where Signadot CLI authentication is intentionally provisioned. Read
`scripts/coderabbit-setup.sh` if a Linux CLI installation is needed. Use `SIGNADOT_API_KEY` and
`SIGNADOT_ORG` normally; never print the key, put it in source, or disguise its variable name to
work around a hosted environment's behavior.

```bash
signadot sandbox apply -f signadot/pr-sandbox.yaml \
  --set name="$SANDBOX" --set cluster="$CLUSTER" --set service="$SERVICE" \
  --set image="$IMAGE" --set repo="$REPO" --set pr="$PR" --set revision="$REVISION" \
  --wait-timeout 5m
```

With hosted triggers configured, inspect the resulting Smart Test. To run the conventional
guard independently, use a Job Runner Group with Node.js 18 or newer:

```bash
signadot job submit -f signadot/reservation-guard-job.yaml \
  --set sandbox="$SANDBOX" --set runnerGroup="$RUNNER_GROUP" --attach
```

Job evidence appears under `status.jobs`; Smart Test evidence appears under
`status.testExecutions`. They are different. The included MCP check requires the Smart Test.

## Report and cleanup

Report repository, PR head, sandbox name, image digest, readiness, preview URL, execution ID,
check outcomes and actual failure output. Say explicitly when no test ran. Do not present a
local CLI or direct MCP probe as a CodeRabbit agent run. Leave the sandbox for the reviewer;
delete it after review or let its eight-hour TTL expire.
