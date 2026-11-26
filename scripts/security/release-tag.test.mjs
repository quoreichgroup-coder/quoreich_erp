import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
const wf = yaml.load(readFileSync('.github/workflows/livraison.yml', 'utf8'));
const SHA = 'a'.repeat(40);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
for (const name of ['Publication GHCR', 'Version GitHub']) {
  test('release tag revalidation precedes writes in ' + name, () => {
    const step = wf.jobs.version.steps.find(s => s.name === name);
    const match = step.run.match(/# BEGIN TAG CHECK\n([\s\S]*?)# END TAG CHECK/);
    assert.ok(match, 'Tag must be revalidated in this write step after environment approval');
    assert.equal(step.env.AUTHORIZED_SHA, '${{ needs.authorize-release.outputs.sha }}');
    for (const [initial, nested, code] of [
      ['commit\t' + SHA, '', 0],
      ['tag\t' + 'b'.repeat(40), 'commit\t' + SHA, 0],
      ['commit\t' + 'b'.repeat(40), '', 1],
      ['tag\t' + 'b'.repeat(40), 'commit\t' + 'c'.repeat(40), 1],
      ['tag\t' + 'b'.repeat(40), 'tag\t' + 'b'.repeat(40), 1],
      ['blob\t' + SHA, '', 1],
    ]) {
      // Stub only emits classifier data; no GitHub/publish command runs.
      const stub = 'gh() { if [[ "$*" == *"/git/ref/tags/"* ]]; then printf "%s\\n" "$TEST_INITIAL"; else printf "%s\\n" "$TEST_NESTED"; fi; };\n';
      const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', stub + match[1]], {
        encoding: 'utf8', windowsHide: true,
        env: { ...process.env, AUTHORIZED_SHA: SHA, GITHUB_REPOSITORY: 'quoreichgroup-coder/quoreich_erp',
          GITHUB_REF_NAME: 'v1.2.3', TEST_INITIAL: initial, TEST_NESTED: nested },
      });
      assert.equal(result.status, code, result.stderr || initial);
    }
    assert.ok(step.run.indexOf('# END TAG CHECK') < step.run.indexOf(name === 'Publication GHCR' ? 'docker login' : 'gh release create'));
  });
}
