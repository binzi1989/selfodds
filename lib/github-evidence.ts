export type RepositoryEvidence = {
  status: "verified" | "unavailable" | "not_github";
  full_name?: string;
  html_url?: string;
  description?: string;
  stars?: number;
  forks?: number;
  open_issues?: number;
  language?: string;
  topics?: string[];
  license?: string;
  created_at?: string;
  pushed_at?: string;
  archived?: boolean;
  fork?: boolean;
  default_branch?: string;
  root_files?: string[];
  readme_excerpt?: string;
  warning?: string;
};

type FetchLike = typeof fetch;

export function parseGitHubRepository(input: string) {
  const value = input.trim();
  if (!value) return null;
  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/i, "");
    if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
    return { owner, repo, fullName: `${owner}/${repo}` };
  } catch {
    return null;
  }
}

async function githubFetch(path: string, fetchImpl: FetchLike, accept = "application/vnd.github+json") {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "SelfOdds-Preflight-Agent",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetchImpl(`https://api.github.com${path}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
}

export async function fetchRepositoryEvidence(input: string, fetchImpl: FetchLike = fetch): Promise<RepositoryEvidence> {
  const parsed = parseGitHubRepository(input);
  if (!parsed) return { status: input.trim() ? "not_github" : "unavailable", warning: "No supported GitHub repository URL was supplied" };

  try {
    const base = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
    const [metadataResponse, readmeResponse, rootResponse] = await Promise.all([
      githubFetch(base, fetchImpl),
      githubFetch(`${base}/readme`, fetchImpl, "application/vnd.github.raw+json"),
      githubFetch(`${base}/contents`, fetchImpl),
    ]);
    if (!metadataResponse.ok) {
      return { status: "unavailable", full_name: parsed.fullName, warning: `GitHub metadata request returned ${metadataResponse.status}` };
    }

    const metadata = await metadataResponse.json() as Record<string, unknown>;
    const readme = readmeResponse.ok ? (await readmeResponse.text()).slice(0, 7_000) : "";
    const root = rootResponse.ok ? await rootResponse.json() as Array<{ name?: string; type?: string }> : [];

    return {
      status: "verified",
      full_name: String(metadata.full_name || parsed.fullName),
      html_url: String(metadata.html_url || `https://github.com/${parsed.fullName}`),
      description: typeof metadata.description === "string" ? metadata.description : "",
      stars: Number(metadata.stargazers_count || 0),
      forks: Number(metadata.forks_count || 0),
      open_issues: Number(metadata.open_issues_count || 0),
      language: typeof metadata.language === "string" ? metadata.language : "Unknown",
      topics: Array.isArray(metadata.topics) ? metadata.topics.slice(0, 12).map(String) : [],
      license: typeof metadata.license === "object" && metadata.license && "spdx_id" in metadata.license
        ? String((metadata.license as { spdx_id?: string }).spdx_id || "Unknown")
        : "Unknown",
      created_at: typeof metadata.created_at === "string" ? metadata.created_at : undefined,
      pushed_at: typeof metadata.pushed_at === "string" ? metadata.pushed_at : undefined,
      archived: Boolean(metadata.archived),
      fork: Boolean(metadata.fork),
      default_branch: typeof metadata.default_branch === "string" ? metadata.default_branch : undefined,
      root_files: Array.isArray(root) ? root.slice(0, 40).map((item) => `${item.type || "item"}:${item.name || "unknown"}`) : [],
      readme_excerpt: readme,
    };
  } catch (error) {
    return {
      status: "unavailable",
      full_name: parsed.fullName,
      warning: error instanceof Error ? error.message.slice(0, 160) : "GitHub evidence request failed",
    };
  }
}

export function compactRepositoryEvidence(evidence: RepositoryEvidence) {
  if (evidence.status !== "verified") return JSON.stringify(evidence);
  return JSON.stringify({
    source: "GitHub REST API",
    ...evidence,
    readme_excerpt: evidence.readme_excerpt?.slice(0, 7_000),
  });
}
