import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENCY_PROFILES,
  aggregateAgencyVotes,
  buildAgencyProfilePrompt,
  classifyAgencyTask,
  selectAgencyTeam,
} from "../lib/agency-agents.ts";

function vote(profile, overrides = {}) {
  return {
    profile_id: profile.id,
    profile_name: profile.name,
    probability: 70,
    confidence: "HIGH",
    risk: "LOW",
    route: "AUTORUN",
    verdict: `${profile.name} verdict`,
    findings: [`finding:${profile.id}`],
    assumptions: ["tests are available"],
    verification_steps: ["run tests"],
    veto_reason: null,
    ...overrides,
  };
}

test("safe Agency profiles expose stable public metadata without full instructions", () => {
  assert.equal(AGENCY_PROFILES.length, 4);
  assert.deepEqual(AGENCY_PROFILES.map((profile) => profile.id), [
    "engineering-ai-engineer",
    "engineering-backend-architect",
    "engineering-data-engineer",
    "engineering-prompt-engineer",
  ]);
  for (const profile of AGENCY_PROFILES) {
    assert.match(profile.definitionHash, /^[a-f0-9]{64}$/);
    assert.equal(profile.version, profile.profileVersion);
    assert.ok(profile.capabilities.length > 0);
    assert.ok(profile.constraints.length > 0);
    assert.doesNotMatch(buildAgencyProfilePrompt(profile), /developer_instructions|<thinking>/i);
  }
  assert.match(buildAgencyProfilePrompt(AGENCY_PROFILES[3]), /Do not request, reveal, or fabricate hidden chain-of-thought/);
});

test("task classification and Top3 selection use task and repository context", () => {
  assert.equal(classifyAgencyTask("Build an idempotent Kafka ETL pipeline with schema checks"), "DATA_PIPELINE");
  assert.equal(classifyAgencyTask("修复支付回调 API 的数据库事务"), "BACKEND_SYSTEMS");
  assert.equal(classifyAgencyTask("Improve a tool-calling agent prompt and eval suite"), "PROMPT_AGENT");
  assert.equal(classifyAgencyTask("Add a RAG embedding model"), "AI_ML");
  assert.equal(classifyAgencyTask("rename the settings button"), "GENERAL_ENGINEERING");
  assert.equal(classifyAgencyTask("Improve this project", { topics: ["kafka", "lakehouse"] }), "DATA_PIPELINE");

  const team = selectAgencyTeam("Build an idempotent Kafka ETL pipeline with schema checks");
  assert.equal(team.strategy, "auto");
  assert.equal(team.taskClass, "DATA_PIPELINE");
  assert.equal(team.profiles.length, 3);
  assert.equal(team.profiles[0].id, "engineering-data-engineer");
  assert.equal(new Set(team.profiles.map((profile) => profile.id)).size, 3);
  assert.match(team.teamVersion, /^agency-council-v1:/);
});

test("vote aggregation is order-independent and uses the median", () => {
  const votes = [
    vote(AGENCY_PROFILES[0], { probability: 20, confidence: "LOW", risk: "MEDIUM", route: "REVIEW" }),
    vote(AGENCY_PROFILES[1], { probability: 72, findings: ["check rollback"] }),
    vote(AGENCY_PROFILES[2], { probability: 75, verification_steps: ["reconcile rows"] }),
  ];
  const forward = aggregateAgencyVotes(votes);
  const reverse = aggregateAgencyVotes([...votes].reverse());

  assert.deepEqual(reverse, forward);
  assert.equal(forward.probability, 72);
  assert.deepEqual(forward.spread, { minimum: 20, maximum: 75 });
  assert.equal(forward.route, "REVIEW");
  assert.equal(forward.risk, "MEDIUM");
  assert.equal(forward.confidence, "LOW");
  assert.ok(forward.findings.includes("check rollback"));
  assert.ok(forward.verification_steps.includes("reconcile rows"));
});

test("a specialist veto escalates while non-veto disagreement blocks autorun", () => {
  const closeButDifferent = aggregateAgencyVotes([
    vote(AGENCY_PROFILES[0], { probability: 70, route: "AUTORUN" }),
    vote(AGENCY_PROFILES[1], { probability: 72, route: "REVIEW" }),
    vote(AGENCY_PROFILES[2], { probability: 73, route: "AUTORUN" }),
  ]);
  assert.equal(closeButDifferent.route, "REVIEW");

  const vetoed = aggregateAgencyVotes([
    vote(AGENCY_PROFILES[0]),
    vote(AGENCY_PROFILES[1], { veto_reason: "Irreversible production migration has no rollback" }),
    vote(AGENCY_PROFILES[2]),
  ]);
  assert.equal(vetoed.route, "ESCALATE");
  assert.match(vetoed.veto_reason, /no rollback/);
});

test("invalid or duplicate votes cannot influence consensus", () => {
  assert.throws(() => aggregateAgencyVotes([]), /At least one/);
  assert.throws(() => aggregateAgencyVotes([
    vote(AGENCY_PROFILES[0]),
    vote(AGENCY_PROFILES[0]),
  ]), /Duplicate/);
  assert.throws(() => aggregateAgencyVotes([
    vote(AGENCY_PROFILES[0], { probability: 101 }),
  ]), /between 0 and 100/);
});
