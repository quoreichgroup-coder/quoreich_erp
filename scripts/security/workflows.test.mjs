import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import yaml from 'js-yaml';
const dir = '.github/workflows/';
const workflows = Object.fromEntries(readdirSync(dir).filter(n => /\.ya?ml$/.test(n)).map(n => [n, yaml.load(readFileSync(dir + n, 'utf8'))]));
const privileged = ['livraison.yml', 'deploy-supabase.yml', 'deploy-fonctions.yml', 'parcours-nocturnes.yml'];

test('preserves all four mandatory CI gates and original verification commands', () => {
  assert.deepEqual(Object.values(workflows['ci.yml'].jobs).map(j => j.name).sort(),
    ['Client web', 'E2E simulés', 'API Java', "Image de l'API"].sort());
  const text = readFileSync(dir + 'ci.yml', 'utf8');
  for (const command of ['npm run lint', 'npm test', 'npm run api:check', 'npm run db:check-twins',
    'npm run build', 'npm audit --omit=dev --audit-level=critical', 'npm run test:e2e', './mvnw -B -ntp verify', 'docker build']) {
    assert.ok(text.includes(command), command);
  }
});
test('all actions use immutable SHAs and every checkout discards credentials', () => {
  for (const [file, wf] of Object.entries(workflows)) {
    assert.deepEqual(wf.permissions, { contents: 'read' }, file);
    assert.ok(!wf.on.pull_request_target && !wf.on.repository_dispatch, file);
    for (const job of Object.values(wf.jobs)) {
      for (const step of job.steps || []) {
        if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/, file);
        if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false, file);
        assert.ok(!step.uses?.startsWith('actions/download-artifact@'), file);
      }
    }
  }
});
test('privileged jobs depend on authorization and checkout only its SHA', () => {
  for (const file of privileged) {
    const wf = workflows[file];
    for (const [id, job] of Object.entries(wf.jobs)) {
      if (job.uses) {
        assert.equal(job.uses, './.github/workflows/authorize.yml', file);
        assert.equal(job.permissions.actions, 'read', file);
        assert.match(job.if, /github.repository == 'quoreichgroup-coder\/quoreich_erp'/);
        continue;
      }
      assert.ok(job.needs, file + ':' + id);
      const gate = wf.jobs[job.needs];
      assert.equal(gate.uses, './.github/workflows/authorize.yml', file);
      assert.match(job.if, /needs\..*\.result == 'success'/);
      const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout@'));
      assert.equal(checkout.with.ref, '${{ needs.' + job.needs + '.outputs.sha }}', file);
      for (const step of job.steps) {
        assert.ok(!step.with?.cache, file);
        if (step.uses?.startsWith('actions/setup-node@')) assert.equal(step.with['package-manager-cache'], false, file);
      }
      if (file === 'parcours-nocturnes.yml') assert.ok(!job.steps.some(s => s.uses?.startsWith('actions/upload-artifact@')));
    }
  }
});
test('workflow_run entry guards reject PRs, forks, failed runs and wrong branch', () => {
  for (const file of ['livraison.yml', 'deploy-supabase.yml']) {
    const wf = workflows[file];
    assert.deepEqual(wf.on.workflow_run, { workflows: ['CI'], types: ['completed'], branches: ['main'] });
    const job = wf.jobs['authorize-main'] || wf.jobs.authorize;
    for (const required of ["workflow_run.event == 'push'", "workflow_run.conclusion == 'success'",
      "workflow_run.head_branch == 'main'", 'workflow_run.head_repository.full_name == github.repository',
      'workflow_run.head_repository.id == github.repository_id']) assert.ok(job.if.includes(required), file + ': ' + required);
  }
});
test('dispatch entry gates require main and fixed staging/production inputs', () => {
  for (const file of ['deploy-supabase.yml', 'deploy-fonctions.yml', 'parcours-nocturnes.yml']) {
    const wf = workflows[file];
    assert.match(wf.jobs.authorize.if, /github.ref == 'refs\/heads\/main'/, file);
    if (file !== 'parcours-nocturnes.yml') {
      assert.deepEqual(wf.on.workflow_dispatch.inputs.cible.options, ['staging', 'production']);
    }
  }
  assert.equal(workflows['deploy-supabase.yml'].on.workflow_dispatch.inputs.dry_run.default, true);
});
test('read-only authorization checks trusted main without caches or environment secrets', () => {
  const job = workflows['authorize.yml'].jobs.authorize;
  assert.deepEqual(job.permissions, { contents: 'read', actions: 'read' });
  assert.equal(job.environment, undefined);
  const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, 'main');
  assert.equal(checkout.with['sparse-checkout'], 'scripts/security');
  const text = readFileSync(dir + 'authorize.yml', 'utf8');
  assert.ok(!text.includes('secrets.'));
  assert.ok(!text.includes('cache:'));
});
test('write tokens are limited to publication jobs and builds precede GHCR login', () => {
  for (const [file, wf] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(wf.jobs)) {
      const writes = Object.entries(job.permissions || {}).filter(([, value]) => value === 'write');
      if (writes.length) {
        assert.equal(file, 'livraison.yml');
        assert.ok(['image-main', 'version'].includes(id));
        assert.deepEqual(job.permissions, id === 'image-main'
          ? { contents: 'read', packages: 'write' } : { contents: 'write', packages: 'write' });
      }
    }
  }
  for (const id of ['image-main', 'version']) {
    const steps = workflows['livraison.yml'].jobs[id].steps;
    const build = steps.findIndex(s => s.run?.includes('docker build'));
    const login = steps.findIndex(s => s.run?.includes('docker login'));
    assert.ok(build >= 0 && login > build);
    assert.ok(!steps[build].env?.GH_TOKEN);
    assert.ok(steps[login].run.includes('--password-stdin'));
    assert.ok(steps[login].run.includes('docker logout'));
  }
});

test('actual job expressions reject fork main PRs and manual feature refs', () => {
  const github = { repository: 'quoreichgroup-coder/quoreich_erp', repository_id: 1451852155,
    ref: 'refs/heads/main', event_name: 'workflow_run', event: { workflow_run: {
      event: 'push', conclusion: 'success', head_branch: 'main',
      head_repository: { full_name: 'quoreichgroup-coder/quoreich_erp', id: 1451852155 } } } };
  for (const file of ['livraison.yml', 'deploy-supabase.yml']) {
    const expression = (workflows[file].jobs['authorize-main'] || workflows[file].jobs.authorize).if;
    const evaluate = g => vm.runInNewContext(expression, { github: g, inputs: { cible: 'staging' } });
    assert.equal(evaluate(github), true);
    for (const change of [
      g => { g.event.workflow_run.event = 'pull_request'; },
      g => { g.event.workflow_run.head_repository.full_name = 'fork/qerp'; },
      g => { g.event.workflow_run.head_repository.id = 1; },
      g => { g.event.workflow_run.conclusion = 'cancelled'; },
      g => { g.event.workflow_run.head_branch = 'feature'; },
      g => { g.repository = 'fork/qerp'; },
    ]) {
      const g = structuredClone(github); change(g);
      assert.equal(evaluate(g), false, file);
    }
  }
  for (const file of ['deploy-supabase.yml', 'deploy-fonctions.yml', 'parcours-nocturnes.yml']) {
    const expression = workflows[file].jobs.authorize.if;
    const g = structuredClone(github); g.event_name = 'workflow_dispatch'; g.ref = 'refs/heads/feature';
    assert.equal(vm.runInNewContext(expression, { github: g, inputs: { cible: 'production' } }), false, file);
  }
});

test('only freshly authorized jobs enter concurrency queues', () => {
  for (const file of privileged) {
    assert.equal(workflows[file].concurrency, undefined, file);
    for (const job of Object.values(workflows[file].jobs).filter(j => !j.uses)) {
      assert.equal(job.concurrency['cancel-in-progress'], false);
      const gate = job.needs;
      const expression = job.if.replace(/needs\.([\w-]+)\./g, (_, id) => 'needs[' + JSON.stringify(id) + '].');
      const evaluate = attempt => vm.runInNewContext(expression, {
        github: { run_attempt: 2 }, needs: { [gate]: { result: 'success', outputs: { attempt } } } });
      assert.equal(evaluate('1'), false, file + ': stale selective retry');
      assert.equal(evaluate('2'), true, file + ': fresh all-jobs retry');
    }
  }
  assert.equal(workflows['authorize.yml'].on.workflow_call.outputs.attempt.value, '${{ jobs.authorize.outputs.attempt }}');
});
