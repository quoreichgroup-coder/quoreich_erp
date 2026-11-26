import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize, githubApi } from './authorize-workflow.mjs';

const REPO = 'quoreichgroup-coder/quoreich_erp';
const ID = 1451852155;
const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const gates = ['Client web', 'E2E simulés', 'API Java', "Image de l'API"];

function fixture(mode = 'image') {
  const repository = { full_name: REPO, id: ID };
  const run = { id: 41, workflow_id: 9, path: '.github/workflows/ci.yml', name: 'CI',
    event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main',
    head_sha: SHA, head_repository: repository, repository, run_attempt: 2, run_number: 7 };
  const context = { mode, target: 'staging', eventName: 'workflow_run', ref: 'refs/heads/main',
    sha: SHA, repository: REPO, repositoryId: String(ID), actor: 'maintainer', triggeringActor: 'maintainer',
    event: { repository, workflow_run: structuredClone(run) } };
  const state = { run, runs: [run], jobs: gates.map(name => ({ name, conclusion: 'success', status: 'completed' })),
    tip: SHA, tag: { type: 'commit', sha: SHA }, comparison: 'identical',
    permission: 'write', role: 'write', environment: { name: 'supabase-staging', can_admins_bypass: false,
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }, protection_rules: [] },
    policies: [{ name: 'main', type: 'branch' }] };
  const calls = [];
  const api = async path => {
    calls.push(path);
    const url = new URL('https://api.github.com' + path);
    const route = url.pathname;
    const page = Number(url.searchParams.get('page') || 1);
    if (route.endsWith('/branches/main')) return { commit: { sha: state.tip } };
    if (route.endsWith('/actions/workflows/ci.yml')) return { id: 9, path: '.github/workflows/ci.yml', state: 'active' };
    if (route.endsWith('/actions/workflows/9/runs')) return { workflow_runs: page === 1 ? state.runs : [] };
    if (/\/actions\/runs\/[0-9]+$/.test(route)) return state.runs.find(r => r.id === Number(route.split('/').pop()));
    if (route.endsWith('/attempts/2/jobs')) return { jobs: page === 1 ? state.jobs : [] };
    if (route.includes('/compare/')) return { status: state.comparison };
    if (route.includes('/git/ref/tags/')) return { object: state.tag };
    if (route.includes('/git/tags/')) return { object: { type: 'commit', sha: SHA } };
    if (route.endsWith('/permission')) return { permission: state.permission, role_name: state.role };
    if (route.endsWith('/deployment-branch-policies')) return { branch_policies: state.policies };
    if (route.includes('/environments/')) return state.environment;
    throw new Error('Unexpected API request: ' + path);
  };
  return { context, state, api, calls };
}

test('legitimate main push authorizes the exact SHA and latest attempt gates', async () => {
  const f = fixture();
  assert.equal(await authorize(f.context, f.api), SHA);
  assert.ok(f.calls.some(p => p.includes('/attempts/2/jobs')));
});

for (const [name, mutate] of [
  ['fork PR named main', f => { f.context.event.workflow_run.event = 'pull_request'; f.context.event.workflow_run.head_repository = { full_name: 'fork/qerp', id: 1 }; }],
  ['same repository PR', f => { f.context.event.workflow_run.event = 'pull_request'; }],
  ['manual CI upstream', f => { f.context.event.workflow_run.event = 'workflow_dispatch'; }],
  ['failed CI', f => { f.context.event.workflow_run.conclusion = 'failure'; }],
  ['cancelled CI', f => { f.context.event.workflow_run.conclusion = 'cancelled'; }],
  ['wrong head branch', f => { f.context.event.workflow_run.head_branch = 'feature'; }],
  ['foreign head repository', f => { f.context.event.workflow_run.head_repository = { full_name: 'fork/qerp', id: 1 }; }],
  ['recreated repository identity', f => { f.context.event.workflow_run.head_repository.id = 1; }],
  ['missing head repository', f => { delete f.context.event.workflow_run.head_repository; }],
  ['malformed SHA', f => { f.context.event.workflow_run.head_sha = 'main\nsha=bad'; }],
  ['stale main run', f => { f.state.tip = OLD; }],
  ['API run changed event', f => { f.state.run.event = 'pull_request'; }],
  ['API run wrong workflow', f => { f.state.run.workflow_id = 8; }],
  ['API run wrong path', f => { f.state.run.path = '.github/workflows/fake.yml'; }],
  ['API run SHA mismatch', f => { f.state.run.head_sha = OLD; }],
  ['API run foreign repository', f => { f.state.run.repository = { full_name: 'fork/qerp', id: 1 }; }],
  ['missing mandatory gate', f => { f.state.jobs.pop(); }],
  ['skipped mandatory gate', f => { f.state.jobs[0].conclusion = 'skipped'; }],
  ['failed mandatory gate', f => { f.state.jobs[0].conclusion = 'failure'; }],
  ['duplicate gate', f => { f.state.jobs.push(f.state.jobs[0]); }],
  ['forked workflow repository', f => { f.context.repository = 'fork/qerp'; }],
]) {
  test('rejects ' + name, async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(authorize(f.context, f.api));
  });
}

function dispatch(mode = 'deploy') {
  const f = fixture(mode);
  f.context.eventName = 'workflow_dispatch';
  delete f.context.event.workflow_run;
  f.context.event.inputs = { cible: 'staging' };
  return f;
}

test('main dispatch needs successful push/main CI and validates environment', async () => {
  const f = dispatch();
  assert.equal(await authorize(f.context, f.api), SHA);
  const query = f.calls.find(p => p.includes('/actions/workflows/9/runs'));
  assert.match(query, /event=push/); assert.match(query, /branch=main/); assert.match(query, /head_sha=/);
});

for (const [name, mutate] of [
  ['feature dispatch', f => { f.context.ref = 'refs/heads/feature'; }],
  ['tag dispatch', f => { f.context.ref = 'refs/tags/v1.2.3'; }],
  ['stale dispatch', f => { f.context.sha = OLD; }],
  ['invalid target', f => { f.context.target = 'other'; }],
  ['manual without push CI', f => { f.state.runs = []; }],
  ['newer failed run hides older success', f => { f.state.runs = [{ ...f.state.run, id: 42, run_number: 8, conclusion: 'failure' }, f.state.run]; }],
  ['read-only initiating actor', f => { f.state.permission = 'read'; }],
  ['broad environment policy', f => { f.state.environment.deployment_branch_policy = null; }],
  ['wildcard environment branch', f => { f.state.policies = [{ name: '*', type: 'branch' }]; }],
  ['unexpected environment tag', f => { f.state.policies.push({ name: 'v*', type: 'tag' }); }],
  ['missing production reviewers', f => { f.context.target = 'production'; f.state.environment.name = 'supabase-production'; }],
]) {
  test('rejects ' + name, async () => {
    const f = dispatch(); mutate(f); await assert.rejects(authorize(f.context, f.api));
  });
}

test('protected production dispatch is authorized only after metadata checks', async () => {
  const f = dispatch();
  f.context.target = 'production';
  f.state.environment.name = 'supabase-production';
  f.state.environment.protection_rules = [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer: { id: 12 } }] }];
  f.state.policies.push({ name: 'v*', type: 'tag' });
  assert.equal(await authorize(f.context, f.api), SHA);
});

function release() {
  const f = fixture('release');
  f.context.eventName = 'push'; f.context.ref = 'refs/tags/v1.2.3'; f.state.permission = 'write'; f.state.role = 'maintain';
  f.context.event = { repository: f.context.event.repository, deleted: false };
  f.state.environment.name = 'supabase-production';
  f.state.environment.protection_rules = [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User' }] }];
  f.state.policies.push({ name: 'v*', type: 'tag' });
  return f;
}

test('release allows a main ancestor with verified annotated tag and CI', async () => {
  const f = release(); f.state.tip = OLD; f.state.comparison = 'ahead';
  f.state.tag = { type: 'tag', sha: OLD };
  assert.equal(await authorize(f.context, f.api), SHA);
});
for (const [name, mutate] of [
  ['tag outside main', f => { f.state.comparison = 'diverged'; }],
  ['tag moved', f => { f.state.tag.sha = OLD; }],
  ['tag shell metacharacters', f => { f.context.ref = 'refs/tags/v1.2.3;bad'; }],
  ['deleted release tag', f => { f.context.event.deleted = true; }],
  ['write-only release actor', f => { f.state.permission = 'write'; f.state.role = 'write'; }],
  ['production self approval', f => { f.state.environment.protection_rules[0].prevent_self_review = false; }],
  ['production administrator bypass', f => { f.state.environment.can_admins_bypass = true; }],
]) {
  test('rejects ' + name, async () => {
    const f = release(); mutate(f); await assert.rejects(authorize(f.context, f.api));
  });
}

test('API failure fails closed', async () => {
  await assert.rejects(authorize(fixture().context, async () => { throw new Error('HTTP 403'); }));
});
test('pagination exhausts jobs before asserting required checks', async () => {
  const f = fixture();
  const first = Array.from({ length: 100 }, (_, i) => ({ name: 'other-' + i, conclusion: 'success' }));
  const api = path => path.includes('/attempts/2/jobs')
    ? Promise.resolve({ jobs: path.includes('page=2') ? f.state.jobs : first }) : f.api(path);
  assert.equal(await authorize(f.context, api), SHA);
});
test('functions dispatch uses the same main provenance policy', async () => {
  const f = dispatch('functions'); assert.equal(await authorize(f.context, f.api), SHA);
});
test('scheduled connected E2E uses only main', async () => {
  const f = fixture('nightly'); f.context.eventName = 'schedule'; delete f.context.event.workflow_run;
  assert.equal(await authorize(f.context, f.api), SHA);
});

test('REST transport supports compare provenance paths without redirects or retries', async () => {
  const calls = [];
  const api = githubApi('test-token', async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ status: 'ahead' }) };
  });
  assert.equal((await api('/repos/' + REPO + '/compare/' + SHA + '...' + OLD)).status, 'ahead');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, 'error');
});
test('REST errors are sanitized, fail closed and never retried', async () => {
  let count = 0;
  const api = githubApi('test-token', async () => { count++; return { ok: false, status: 403 }; });
  await assert.rejects(api('/repos/' + REPO + '/branches/main'), /HTTP 403/);
  assert.equal(count, 1);
});

test('rejects a superseded triggering upstream attempt', async () => {
  const f = fixture(); f.context.event.workflow_run.run_attempt = 1;
  await assert.rejects(authorize(f.context, f.api), /attempt/);
});
test('release accepts the actual GitHub maintain role representation', async () => {
  const f = release(); f.state.permission = 'write'; f.state.role = 'maintain';
  assert.equal(await authorize(f.context, f.api), SHA);
});
