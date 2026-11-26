// No dependencies, checkout of candidate code, writes, secrets, or automatic retries.
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'quoreichgroup-coder/quoreich_erp';
const REPOSITORY_ID = 1451852155;
const CI_PATH = '.github/workflows/ci.yml';
const REQUIRED_GATES = ['Client web', 'E2E simulés', 'API Java', "Image de l'API"];
const PREFIX = '/repos/' + REPOSITORY;
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const validSha = sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha);
const sameRepository = repo => repo?.full_name === REPOSITORY && repo?.id === REPOSITORY_ID;

async function list(api, path, key) {
  const items = [];
  for (let page = 1; page <= 100; page++) {
    const data = await api(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
    requireThat(Array.isArray(data[key]), 'Invalid paginated API response');
    items.push(...data[key]);
    if (data[key].length < 100) return items;
  }
  throw new Error('Pagination limit reached; refusing incomplete evidence');
}

function checkRun(run, sha, workflowId) {
  requireThat(run?.event === 'push' && run.status === 'completed' && run.conclusion === 'success',
    'CI must be a successful completed push run');
  requireThat(sameRepository(run.repository) && sameRepository(run.head_repository), 'CI repository identity mismatch');
  requireThat(run.head_branch === 'main' && run.head_sha === sha, 'CI branch or commit mismatch');
  requireThat(run.workflow_id === workflowId && run.path === CI_PATH && run.name === 'CI', 'Unexpected CI workflow');
  requireThat(Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0,
    'Invalid CI run identity');
}

async function checkEnvironment(api, target, release) {
  const name = 'supabase-' + target;
  const environment = await api(PREFIX + '/environments/' + name);
  requireThat(environment.name === name && environment.deployment_branch_policy?.custom_branch_policies === true
    && environment.deployment_branch_policy.protected_branches === false, 'Explicit environment branch policy required');
  const policies = await list(api, PREFIX + '/environments/' + name + '/deployment-branch-policies', 'branch_policies');
  const allowed = target === 'production' ? ['branch:main', 'tag:v*'] : ['branch:main'];
  const actual = policies.map(p => p.type + ':' + p.name);
  requireThat(actual.includes('branch:main') && actual.every(p => allowed.includes(p)),
    'Environment permits an unexpected ref');
  requireThat(!release || actual.includes('tag:v*'), 'Release tag environment policy missing');
  if (target === 'production') {
    const reviewers = environment.protection_rules?.find(p => p.type === 'required_reviewers');
    requireThat(reviewers?.reviewers?.length > 0 && reviewers.prevent_self_review === true
      && environment.can_admins_bypass === false, 'Production requires independent review with administrator bypass disabled');
  }
}

export async function authorize(context, api) {
  const { mode, eventName, event, ref, repository, repositoryId, actor, triggeringActor } = context;
  requireThat(repository === REPOSITORY && String(repositoryId) === String(REPOSITORY_ID)
    && sameRepository(event.repository), 'Not the QERP repository');
  requireThat(['image', 'release', 'deploy', 'functions', 'nightly'].includes(mode), 'Invalid authorization mode');
  const automatic = eventName === 'workflow_run';
  const release = mode === 'release';
  let sha = context.sha;
  if (automatic) {
    requireThat(['image', 'deploy'].includes(mode), 'This mode cannot use workflow_run');
    const run = event.workflow_run;
    requireThat(run?.event === 'push' && run.status === 'completed' && run.conclusion === 'success'
      && run.head_branch === 'main' && sameRepository(run.head_repository) && sameRepository(run.repository),
      'Untrusted upstream CI event');
    sha = run.head_sha;
  } else if (release) {
    requireThat(eventName === 'push' && event.deleted === false
      && /^refs\/tags\/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(ref),
      'Release requires a non-deleted vX.Y.Z tag push');
  } else {
    requireThat(eventName === 'workflow_dispatch' || (mode === 'nightly' && eventName === 'schedule'),
      'Unsupported event');
    requireThat(mode !== 'image' && ref === 'refs/heads/main', 'Manual and scheduled execution requires main');
  }
  requireThat(validSha(sha), 'Invalid source SHA');
  const target = automatic ? 'staging' : (context.target || 'staging');
  requireThat(['staging', 'production'].includes(target), 'Invalid deployment target');

  if (eventName === 'workflow_dispatch' || release) {
    for (const login of new Set([actor, triggeringActor])) {
      requireThat(typeof login === 'string' && /^[a-zA-Z0-9\[\]-]+$/.test(login), 'Invalid actor');
      const { permission, role_name: role } = await api(PREFIX + '/collaborators/' + encodeURIComponent(login) + '/permission');
      requireThat(release ? (permission === 'admin' || (permission === 'write' && role === 'maintain'))
        : ['admin', 'write'].includes(permission), 'Actor is not authorized for this operation');
    }
  }
  const main = await api(PREFIX + '/branches/main');
  requireThat(validSha(main.commit?.sha), 'Missing main provenance');
  if (release) {
    let { object } = await api(PREFIX + '/git/ref/tags/' + encodeURIComponent(ref.slice('refs/tags/'.length)));
    for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) {
      requireThat(validSha(object.sha), 'Invalid annotated tag');
      ({ object } = await api(PREFIX + '/git/tags/' + object.sha));
    }
    requireThat(object?.type === 'commit' && object.sha === sha, 'Release tag does not resolve to this commit');
    const compare = await api(PREFIX + '/compare/' + sha + '...' + main.commit.sha);
    requireThat(['identical', 'ahead'].includes(compare.status), 'Release commit is outside main history');
  } else {
    requireThat(sha === main.commit.sha, 'Source is no longer the current main commit');
  }
  const workflow = await api(PREFIX + '/actions/workflows/ci.yml');
  requireThat(workflow.path === CI_PATH && workflow.state === 'active' && Number.isSafeInteger(workflow.id),
    'Expected active CI workflow missing');
  let run;
  if (automatic) {
    requireThat(Number.isSafeInteger(event.workflow_run.id) && event.workflow_run.id > 0, 'Invalid upstream run ID');
    run = await api(PREFIX + '/actions/runs/' + event.workflow_run.id);
    requireThat(run.id === event.workflow_run.id && run.run_attempt === event.workflow_run.run_attempt,
      'Upstream CI attempt has been superseded');
  } else {
    const runs = await list(api, PREFIX + '/actions/workflows/' + workflow.id + '/runs?event=push&branch=main&head_sha=' + sha, 'workflow_runs');
    requireThat(runs.length > 0, 'No push/main CI for this commit');
    run = runs.sort((a, b) => b.run_number - a.run_number || b.id - a.id)[0];
    // Read the current attempt again: do not authorize a cached previous success.
    run = await api(PREFIX + '/actions/runs/' + run.id);
  }
  checkRun(run, sha, workflow.id);
  const jobs = await list(api, PREFIX + '/actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs', 'jobs');
  for (const name of REQUIRED_GATES) {
    const matches = jobs.filter(job => job.name === name);
    requireThat(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success',
      'Mandatory CI gate is not uniquely successful: ' + name);
  }
  if (['deploy', 'functions', 'nightly'].includes(mode) || release) {
    await checkEnvironment(api, release ? 'production' : target, release);
  }
  return sha;
}

export function githubApi(token, fetchImpl = fetch) {
  requireThat(typeof token === 'string' && token.length > 0, 'GitHub read token missing');
  return async path => {
    requireThat(path.startsWith(PREFIX + '/') && !path.split('/').includes('..'), 'Unexpected API path');
    const response = await fetchImpl('https://api.github.com' + path, {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    requireThat(response.ok, 'GitHub provenance API failed (HTTP ' + response.status + ')');
    return response.json();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env;
    const sha = await authorize({
      repository: env.GITHUB_REPOSITORY, repositoryId: env.GITHUB_REPOSITORY_ID,
      actor: env.GITHUB_ACTOR, triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
      eventName: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, sha: env.GITHUB_SHA,
      mode: env.AUTHORIZATION_MODE, target: env.AUTHORIZATION_TARGET,
      event: JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')),
    }, githubApi(env.GH_TOKEN));
    appendFileSync(env.GITHUB_OUTPUT, 'sha=' + sha + '\n');
    console.log('Authorized QERP source commit: ' + sha);
  } catch (error) {
    console.error('Authorization refused: ' + error.message);
    process.exitCode = 1;
  }
}
