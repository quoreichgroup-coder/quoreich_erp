"""Read-only plugin review. Commands are JSON DATA sent to hooks, never executed.
Copies Go sources to a temporary directory; leaves installed plugins and live gate state intact.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--megapowers-root", type=Path, required=True)
parser.add_argument("--one-shot-root", type=Path, required=True)
parser.add_argument("--go", required=True)
parser.add_argument("--bash", required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
report = {"method": "isolated classifiers; candidate shell commands never executed", "plugins": {}}
for name, root in [("megapowers", args.megapowers_root), ("one-shot-prompting", args.one_shot_root)]:
    report["plugins"][name] = json.loads((root / ".claude-plugin/plugin.json").read_text())["version"]

go_test = r'''
package main
import ("bytes"; "encoding/json"; "strings"; "testing")
func TestQERPRepeatedCatastrophicGuard(t *testing.T) {
  home := t.TempDir()
  getenv := func(key string) string {
    if key == "HOME" || key == "XDG_CACHE_HOME" { return home }; return ""
  }
  payload, _ := json.Marshal(map[string]any{"session_id":"isolated-qerp-review",
    "tool_input":map[string]string{"command":"rm -rf /"}})
  for attempt := 1; attempt <= 3; attempt++ {
    var output, errors bytes.Buffer
    rc := runHook([]string{"deny-destructive"}, getenv, bytes.NewReader(payload), &output, &errors)
    if rc != 0 || !strings.Contains(output.String(), "\"permissionDecision\":\"deny\"") {
      t.Fatalf("attempt %d: expected denial, rc=%d", attempt, rc)
    }
  }
}
'''
with tempfile.TemporaryDirectory(prefix="qerp-hook-review-") as scratch:
    root = Path(scratch)
    shutil.copytree(args.megapowers_root / "hooks", root / "hooks")
    (root / "go.mod").write_text("module qerp-hook-review\n\ngo 1.25\n")
    (root / "hooks/qerp_review_test.go").write_text(go_test)
    result = subprocess.run([args.go, "test", "./hooks", "-run",
        "TestQERPRepeatedCatastrophicGuard|TestGateStopsGitDiscardOncePerCommand|TestCommandLengthBoundary|TestGateDeniesOncePerSessionAndSkill|TestGateDiscardFallsBackToContextWithoutMarker",
        "-count=1", "-v"], cwd=root, capture_output=True, text=True, check=False)
    report["megapowers_classifier_tests"] = {"exit_code": result.returncode,
        "stdout": result.stdout, "stderr": result.stderr}
    if result.returncode:
        raise SystemExit(result.stdout + result.stderr)

env = os.environ.copy()
env["CLAUDE_PLUGIN_ROOT"] = str(args.one_shot_root)
cases = [
    ("safe read-only text", "printf hello", 0),
    ("secret word false positive", "printf 'secret audit'", 2),
    ("repeat same false positive", "printf 'secret audit'", 2),
    ("force-before-main string", "git push --force origin main", 2),
    ("force-after-main string", "git push origin main --force", 0),
]
report["one_shot_cases"] = []
hook = args.one_shot_root / "hooks/block-bad-commands.sh"
for name, command, expected in cases:
    result = subprocess.run([args.bash, str(hook)],
        input=json.dumps({"tool_input": {"command": command}}),
        capture_output=True, text=True, env=env, check=False)
    report["one_shot_cases"].append({"case": name, "exit_code": result.returncode,
        "expected_observed_exit_code": expected, "stderr": result.stderr.strip()})
    if result.returncode != expected:
        raise SystemExit("Hook behavior changed: " + name + ": " + result.stderr)
report["one_shot_regex_compilation_error_reproduced"] = False
report["source_sha256"] = {}
for root, paths in [(args.megapowers_root, ["hooks/deny_destructive.go", "hooks/hook_runner.go", "hooks/gate_context.go"]),
                    (args.one_shot_root, ["hooks/block-bad-commands.sh", "hooks/guard-file-writes.sh", "hooks/validate-after-write.sh"])]:
    for relative in paths:
        report["source_sha256"][root.name + "/" + relative] = hashlib.sha256((root / relative).read_bytes()).hexdigest()
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"go_tests_exit": report["megapowers_classifier_tests"]["exit_code"],
    "one_shot_cases": len(cases), "report": str(args.output)}))
