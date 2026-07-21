#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function argumentsMap(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    result[item.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true";
  }
  return result;
}

function runCommand(command, cwd) {
  if (!command) return Promise.resolve({ attempted: false, passed: null, output: "" });
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-12000); process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-12000); process.stderr.write(chunk); });
    child.on("close", (code) => resolve({ attempted: true, passed: code === 0, output: output.slice(-4000), exitCode: code }));
  });
}

async function git(cwd, args, fallback = "") {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, windowsHide: true });
    return stdout.trim();
  } catch {
    return fallback;
  }
}

async function request(api, token, body) {
  const response = await fetch(`${api.replace(/\/$/, "")}/api/runner`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-selfodds-runner-token": token } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.code || `HTTP_${response.status}`);
  return payload;
}

const args = argumentsMap(process.argv.slice(2));
if (!args.run) {
  console.error("Usage: node scripts/selfodds-runner.mjs --run <id> [--api http://localhost:3000] [--repo .] [--test \"npm test\"] [--build \"npm run build\"] [--max-diff-files 25]");
  process.exit(2);
}

const api = args.api || "http://localhost:3000";
const repo = args.repo || process.cwd();
const runnerName = args.runner || "local-runner";
const token = process.env.RUNNER_SHARED_SECRET || "";
const baselineCommit = await git(repo, ["rev-parse", "HEAD"]);
await request(api, token, { action: "start", run_id: args.run, runner_name: runnerName, baseline_commit: baselineCommit || null });

const testResult = await runCommand(args.test || null, repo);
const buildResult = testResult.passed === false ? { attempted: false, passed: null, output: "skipped after test failure" } : await runCommand(args.build || null, repo);
const finalCommit = await git(repo, ["rev-parse", "HEAD"]);
const numstat = await git(repo, ["diff", "--numstat", baselineCommit || "HEAD"]);
const changed = numstat ? numstat.split(/\r?\n/).filter(Boolean) : [];
let additions = 0;
let deletions = 0;
for (const line of changed) {
  const [added, deleted] = line.split("\t");
  additions += Number.isFinite(Number(added)) ? Number(added) : 0;
  deletions += Number.isFinite(Number(deleted)) ? Number(deleted) : 0;
}
const maxDiffFiles = Math.max(1, Number(args["max-diff-files"] || 25));
const diffWithinScope = changed.length <= maxDiffFiles;
const failureSummary = [
  testResult.passed === false ? `Tests failed: ${testResult.output}` : "",
  buildResult.passed === false ? `Build failed: ${buildResult.output}` : "",
  !diffWithinScope ? `Diff touched ${changed.length} files; limit is ${maxDiffFiles}` : "",
].filter(Boolean).join("\n").slice(0, 1000) || null;

const settled = await request(api, token, {
  action: "settle",
  run_id: args.run,
  runner_name: runnerName,
  test_command: args.test || null,
  build_command: args.build || null,
  test_passed: testResult.passed,
  build_passed: buildResult.passed,
  diff_within_scope: diffWithinScope,
  diff_files: changed.length,
  diff_additions: additions,
  diff_deletions: deletions,
  baseline_commit: baselineCommit || null,
  final_commit: finalCommit || null,
  failure_summary: failureSummary,
  verification: { test_exit_code: testResult.exitCode ?? null, build_exit_code: buildResult.exitCode ?? null, max_diff_files: maxDiffFiles },
});

console.log(JSON.stringify({ ok: true, run: settled.run }, null, 2));
