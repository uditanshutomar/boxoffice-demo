#!/usr/bin/env node
// Run from a trusted checkout with gh and Signadot CLI authentication.
// Reads Signadot evidence; writes only a GitHub commit status. Never creates a sandbox.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const context = 'Signadot / reservation-contract'
const [repo, pr, run] = process.argv.slice(2)
let head, target, temp
const execute = (command, args, input) => execFileSync(command, args, {
  encoding: 'utf8', input, timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024,
})
const json = (command, args) => JSON.parse(execute(command, args))
function publish(state, description) {
  execute('gh', ['api', '--method', 'POST', `repos/${repo}/statuses/${head}`, '--input', '-'],
    JSON.stringify({ state, context, description: description.slice(0, 140), target_url: target }))
}
try {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo || '') ||
      !/^[1-9][0-9]*$/.test(pr || '') || !/^[1-9][0-9]*$/.test(run || '')) {
    throw new Error('Usage: node scripts/publish-runtime-status.cjs OWNER/REPO PR BUILD_RUN_ID')
  }
  // Catch accidental local edits before loading verification helpers or using
  // credentials. A clean checkout still must come from a trusted revision.
  if (execute('git', ['-C', __dirname, 'status', '--porcelain']).trim()) {
    throw new Error('Refusing to publish status from a dirty checkout')
  }
  const { sandboxName } = require('./sandbox-name.cjs')
  const { checkEvidence } = require('./check-evidence.cjs')
  const { checkHostedExecution } = require('./check-hosted-execution.cjs')
  const pull = json('gh', ['api', `repos/${repo}/pulls/${pr}`])
  head = pull.head.sha
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid PR revision')
  target = `https://github.com/${repo}/actions/runs/${run}`
  publish('pending', 'Checking exact-revision sandbox and hosted reservation results')
  if (pull.state !== 'open' || pull.head.repo.full_name.toLowerCase() !== repo.toLowerCase()) {
    throw new Error('Use an open, same-repository PR')
  }
  const buildRun = json('gh', ['api', `repos/${repo}/actions/runs/${run}`])
  if (buildRun.path !== '.github/workflows/build-pr-image.yml' || buildRun.event !== 'workflow_dispatch' ||
      buildRun.status !== 'completed' || buildRun.conclusion !== 'success') {
    throw new Error('Build PR image run must succeed')
  }
  // A dispatch run's head_sha identifies the workflow ref. The artifact below
  // records the PR revision explicitly checked out and built by that workflow.
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boxoffice-evidence-'))
  execute('gh', ['run', 'download', run, '--repo', repo, '--name', 'build-identity', '--dir', temp])
  const build = JSON.parse(fs.readFileSync(path.join(temp, 'build-identity.json'), 'utf8'))
  const owner = repo.split('/')[0].toLowerCase()
  if (build.repo?.toLowerCase() !== repo.toLowerCase() || String(build.pr) !== pr ||
      build.revision !== head || !['storefront', 'inventory', 'pricing'].includes(build.service) ||
      !build.image?.startsWith(`ghcr.io/${owner}/boxoffice-demo-${build.service}@sha256:`)) {
    throw new Error('Build artifact does not match this PR, revision, service and registry')
  }
  const name = sandboxName(repo, pr, head)
  target = `https://app.signadot.com/sandbox/name/${name}`
  const sandbox = json('signadot', ['sandbox', 'get', name, '-o', 'json'])
  const entries = json('signadot', ['smart-test', 'execution', 'list', '--sandbox', name, '-o', 'json'])
  const failures = [
    ...checkEvidence(sandbox, { repo, pr, revision: head, image: build.image }),
    ...checkHostedExecution(entries, { name, cluster: sandbox.spec?.cluster }),
  ]
  if (failures.length) throw new Error(failures.join('; '))
  const latest = json('gh', ['api', `repos/${repo}/pulls/${pr}`])
  if (latest.head.sha !== head || latest.state !== 'open') throw new Error('PR changed during verification; rerun for its current head')
  publish('success', `Exact build verified; five baseline and sandbox contract checks passed (${head.slice(0, 7)})`)
  console.log(`PASS: ${repo}#${pr} ${head}; ${context}`)
} catch (error) {
  // Do not print child-process output: authenticated CLI errors may contain private details.
  const message = error.status === undefined ? error.message : 'Evidence retrieval or GitHub status publication failed'
  if (head) {
    try { publish('failure', message) } catch { console.error('Could not publish failure status; do not treat this run as verified.') }
  }
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
} finally {
  if (temp) fs.rmSync(temp, { recursive: true, force: true })
}
