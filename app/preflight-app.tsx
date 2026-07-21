"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Outcome = "success" | "failed" | "pending";

type Run = {
  id: string;
  task: string;
  repo: string;
  probability: number;
  cost: number;
  minutes: number;
  route: "AUTORUN" | "REVIEW" | "ESCALATE";
  risk: "LOW" | "MEDIUM" | "HIGH";
  outcome: Outcome;
  createdAt: string;
  risks: string[];
  checks: string[];
};

const STORAGE_KEY = "selfodds-runs-v1";

const sampleRuns: Run[] = [
  {
    id: "sample-1",
    task: "Fix duplicate webhook processing and add an idempotency test",
    repo: "payments/api",
    probability: 61,
    cost: 2.18,
    minutes: 34,
    route: "REVIEW",
    risk: "HIGH",
    outcome: "failed",
    createdAt: "Jul 20, 2026",
    risks: ["State mutation", "Concurrency edge case"],
    checks: ["Run payment tests", "Verify idempotency under concurrency"],
  },
  {
    id: "sample-2",
    task: "Correct mobile spacing in the pricing comparison",
    repo: "web/marketing",
    probability: 91,
    cost: 0.54,
    minutes: 8,
    route: "AUTORUN",
    risk: "LOW",
    outcome: "success",
    createdAt: "Jul 20, 2026",
    risks: ["Visual regression"],
    checks: ["Build application", "Check responsive layout"],
  },
  {
    id: "sample-3",
    task: "Upgrade auth middleware without invalidating active sessions",
    repo: "platform/core",
    probability: 48,
    cost: 3.42,
    minutes: 52,
    route: "ESCALATE",
    risk: "HIGH",
    outcome: "failed",
    createdAt: "Jul 19, 2026",
    risks: ["Authentication boundary", "Missing runtime context"],
    checks: ["Run auth integration tests", "Verify existing sessions"],
  },
  {
    id: "sample-4",
    task: "Add CSV export to the resolved runs table",
    repo: "ops/console",
    probability: 83,
    cost: 0.91,
    minutes: 16,
    route: "REVIEW",
    risk: "MEDIUM",
    outcome: "success",
    createdAt: "Jul 18, 2026",
    risks: ["Data formatting"],
    checks: ["Test escaped values", "Build application"],
  },
];

const benchmarkRows = [
  { name: "Codex runner", tasks: 128, success: 76, calibration: 88, brier: ".142" },
  { name: "Claude runner", tasks: 128, success: 79, calibration: 81, brier: ".168" },
  { name: "Gemini runner", tasks: 128, success: 71, calibration: 73, brier: ".194" },
];

function hashText(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createAssessment(task: string, repo: string): Run {
  const normalized = task.toLowerCase();
  const dangerous = [
    "production",
    "payment",
    "database",
    "delete",
    "migration",
    "auth",
    "security",
    "deploy",
    "infra",
    "permission",
  ].filter((term) => normalized.includes(term));
  const simple = ["copy", "css", "typo", "readme", "docs", "spacing"].filter(
    (term) => normalized.includes(term),
  );
  const ambiguity = task.trim().length < 45 ? 12 : 0;
  const contextPenalty = repo.trim() ? 0 : 9;
  const riskScore = Math.max(
    8,
    Math.min(100, 31 + dangerous.length * 13 + ambiguity + contextPenalty - simple.length * 9),
  );
  const jitter = (hashText(`${task}:${repo}`) % 11) - 5;
  const probability = Math.max(22, Math.min(94, Math.round(101 - riskScore * 0.68 + jitter)));
  const risk = probability >= 82 ? "LOW" : probability >= 58 ? "MEDIUM" : "HIGH";
  const route = probability >= 85 ? "AUTORUN" : probability >= 58 ? "REVIEW" : "ESCALATE";
  const minutes = Math.round(7 + riskScore * 0.52 + (hashText(task) % 9));
  const cost = Number((0.28 + riskScore * 0.031 + (hashText(repo) % 25) / 100).toFixed(2));

  const risks: string[] = [];
  if (dangerous.some((term) => ["payment", "database", "delete", "migration"].includes(term))) {
    risks.push("Irreversible state mutation");
  }
  if (dangerous.some((term) => ["auth", "security", "permission"].includes(term))) {
    risks.push("Security boundary");
  }
  if (dangerous.some((term) => ["production", "deploy", "infra"].includes(term))) {
    risks.push("Production blast radius");
  }
  if (!repo.trim()) risks.push("Repository context missing");
  if (ambiguity) risks.push("Success criteria are underspecified");
  if (risks.length === 0) risks.push("Regression outside the changed surface");

  const checks = ["Run the repository test suite", "Inspect the final diff against task scope"];
  if (normalized.includes("database") || normalized.includes("migration")) {
    checks.unshift("Validate migration on an isolated database");
  }
  if (normalized.includes("auth") || normalized.includes("security")) {
    checks.unshift("Run authentication and authorization checks");
  }
  if (simple.length) checks.push("Verify responsive and visual behavior");

  return {
    id: `run-${Date.now()}`,
    task: task.trim(),
    repo: repo.trim() || "Context not supplied",
    probability,
    cost,
    minutes,
    route,
    risk,
    outcome: "pending",
    createdAt: new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date()),
    risks,
    checks,
  };
}

function brierScore(runs: Run[]) {
  const resolved = runs.filter((run) => run.outcome !== "pending");
  if (!resolved.length) return 0;
  const total = resolved.reduce((sum, run) => {
    const outcome = run.outcome === "success" ? 1 : 0;
    return sum + (run.probability / 100 - outcome) ** 2;
  }, 0);
  return total / resolved.length;
}

export function PreflightApp() {
  const [task, setTask] = useState(
    "Fix duplicate webhook processing in the payment service and add an idempotency test",
  );
  const [repo, setRepo] = useState("github.com/acme/payments-api");
  const [runs, setRuns] = useState<Run[]>(sampleRuns);
  const [activeRun, setActiveRun] = useState<Run>(() =>
    createAssessment(
      "Fix duplicate webhook processing in the payment service and add an idempotency test",
      "github.com/acme/payments-api",
    ),
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [activeView, setActiveView] = useState<"runs" | "benchmark">("runs");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setRuns(JSON.parse(stored) as Run[]);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  }, [runs]);

  const metrics = useMemo(() => {
    const resolved = runs.filter((run) => run.outcome !== "pending");
    const successes = resolved.filter((run) => run.outcome === "success").length;
    const brier = brierScore(runs);
    return {
      resolved: resolved.length,
      successRate: resolved.length ? Math.round((successes / resolved.length) * 100) : 0,
      calibration: resolved.length ? Math.max(0, Math.round((1 - brier) * 100)) : 0,
      brier: brier.toFixed(3),
    };
  }, [runs]);

  function runPreflight(event: FormEvent) {
    event.preventDefault();
    if (!task.trim()) return;
    setAnalyzing(true);
    window.setTimeout(() => {
      const assessment = createAssessment(task, repo);
      setActiveRun(assessment);
      setRuns((current) => [assessment, ...current]);
      setAnalyzing(false);
    }, 520);
  }

  function resolveRun(id: string, outcome: Exclude<Outcome, "pending">) {
    setRuns((current) =>
      current.map((run) => (run.id === id ? { ...run, outcome } : run)),
    );
    if (activeRun.id === id) setActiveRun((current) => ({ ...current, outcome }));
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="SelfOdds home">
          <span className="brand-mark" aria-hidden="true">S/O</span>
          <span>SELFODDS</span>
        </a>
        <div className="header-status">
          <span className="live-dot" aria-hidden="true" />
          PREFLIGHT ENGINE · LOCAL MVP
        </div>
        <a className="header-link" href="#ledger">OPEN LEDGER ↓</a>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span>01</span> AGENT RELIABILITY LAYER</div>
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>Know before<br />they <em>go.</em></h1>
            <p>
              Predict whether an AI agent will succeed before it spends money,
              edits code, or touches production.
            </p>
          </div>
          <div className="hero-proof">
            <div className="proof-number">{metrics.calibration}<small>/100</small></div>
            <span>CALIBRATION SCORE</span>
            <p>Every forecast is locked before execution and scored against the real outcome.</p>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="Agent preflight workspace">
        <form className="task-panel" onSubmit={runPreflight}>
          <div className="panel-heading">
            <span>NEW ASSESSMENT</span>
            <span className="step-label">INPUT / 01</span>
          </div>
          <label htmlFor="task">TASK BRIEF</label>
          <textarea
            id="task"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={5}
            placeholder="Describe what the agent should accomplish..."
            required
          />
          <label htmlFor="repo">REPOSITORY OR CONTEXT</label>
          <input
            id="repo"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder="github.com/org/repo"
          />
          <div className="input-meta">
            <span>MODEL ROUTE: AUTO</span>
            <span>VERIFIER: TEST + DIFF</span>
          </div>
          <button className="primary-button" type="submit" disabled={analyzing}>
            <span>{analyzing ? "ASSESSING TASK" : "RUN PREFLIGHT"}</span>
            <b aria-hidden="true">{analyzing ? "···" : "↗"}</b>
          </button>
        </form>

        <article className={`result-panel risk-${activeRun.risk.toLowerCase()}`} aria-live="polite">
          <div className="panel-heading dark">
            <span>DECISION TOKEN</span>
            <span className="sealed">SEALED · {activeRun.createdAt}</span>
          </div>
          <div className="decision-topline">
            <div className="probability-wrap">
              <div className="probability">{activeRun.probability}<sup>%</sup></div>
              <span>SUCCESS PROBABILITY</span>
            </div>
            <div className="route-badge">
              <span>ROUTE</span>
              <strong>{activeRun.route}</strong>
            </div>
          </div>
          <div className="confidence-track" aria-label={`${activeRun.probability}% predicted success`}>
            <span style={{ width: `${activeRun.probability}%` }} />
          </div>
          <div className="estimate-grid">
            <div><span>RISK</span><strong>{activeRun.risk}</strong></div>
            <div><span>EST. TIME</span><strong>{activeRun.minutes} MIN</strong></div>
            <div><span>EST. COST</span><strong>${activeRun.cost.toFixed(2)}</strong></div>
          </div>
          <div className="result-lists">
            <div>
              <h2>LIKELY FAILURE MODES</h2>
              <ul>{activeRun.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
            </div>
            <div>
              <h2>REQUIRED VERIFICATION</h2>
              <ol>{activeRun.checks.map((check) => <li key={check}>{check}</li>)}</ol>
            </div>
          </div>
          <div className="policy-line">
            <span>POLICY</span>
            <p>
              {activeRun.route === "AUTORUN" && "Proceed autonomously; keep verification enabled."}
              {activeRun.route === "REVIEW" && "Execute in a sandbox; require human review before merge."}
              {activeRun.route === "ESCALATE" && "Pause execution; request context or route to a stronger agent."}
            </p>
          </div>
        </article>
      </section>

      <section className="ledger" id="ledger">
        <div className="section-title-row">
          <div>
            <div className="eyebrow"><span>02</span> REALITY LEDGER</div>
            <h2>Confidence meets consequence.</h2>
          </div>
          <div className="view-tabs" role="tablist" aria-label="Ledger views">
            <button
              role="tab"
              aria-selected={activeView === "runs"}
              className={activeView === "runs" ? "active" : ""}
              onClick={() => setActiveView("runs")}
            >RUNS</button>
            <button
              role="tab"
              aria-selected={activeView === "benchmark"}
              className={activeView === "benchmark" ? "active" : ""}
              onClick={() => setActiveView("benchmark")}
            >BENCHMARK</button>
          </div>
        </div>

        <div className="metric-strip">
          <div><span>RESOLVED RUNS</span><strong>{metrics.resolved}</strong></div>
          <div><span>ACTUAL SUCCESS</span><strong>{metrics.successRate}%</strong></div>
          <div><span>CALIBRATION</span><strong>{metrics.calibration}</strong></div>
          <div><span>BRIER SCORE ↓</span><strong>{metrics.brier}</strong></div>
        </div>

        {activeView === "runs" ? (
          <div className="run-list" role="tabpanel">
            <div className="run-row run-head">
              <span>TASK</span><span>PREDICTION</span><span>ROUTE</span><span>OUTCOME</span>
            </div>
            {runs.slice(0, 8).map((run) => (
              <div className="run-row" key={run.id}>
                <div className="run-task">
                  <strong>{run.task}</strong>
                  <span>{run.repo} · {run.createdAt}</span>
                </div>
                <div className="run-prediction"><strong>{run.probability}%</strong><span>{run.risk} RISK</span></div>
                <div><span className={`mini-route route-${run.route.toLowerCase()}`}>{run.route}</span></div>
                <div className="outcome-cell">
                  {run.outcome === "pending" ? (
                    <div className="resolve-actions" aria-label={`Resolve ${run.task}`}>
                      <button onClick={() => resolveRun(run.id, "success")}>PASS</button>
                      <button onClick={() => resolveRun(run.id, "failed")}>FAIL</button>
                    </div>
                  ) : (
                    <span className={`outcome outcome-${run.outcome}`}>
                      {run.outcome === "success" ? "PASSED" : "FAILED"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="benchmark" role="tabpanel">
            <div className="benchmark-note">SAMPLE BENCHMARK DATA · REPLACE WITH LIVE RUNS</div>
            {benchmarkRows.map((row, index) => (
              <div className="benchmark-row" key={row.name}>
                <span className="rank">0{index + 1}</span>
                <strong>{row.name}</strong>
                <span>{row.tasks} TASKS</span>
                <span>{row.success}% SUCCESS</span>
                <span>{row.calibration} CALIBRATION</span>
                <span>{row.brier} BRIER</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="manifesto">
        <p>CAPABILITY IS NOT RELIABILITY.</p>
        <p>CONFIDENCE WITHOUT CALIBRATION IS JUST VOLUME.</p>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">S/O</span><span>SELFODDS</span></div>
        <p>THE AGENT SHOULD KNOW WHEN IT DOESN&apos;T KNOW.</p>
        <span>PROTOTYPE · 2026</span>
      </footer>
    </main>
  );
}
