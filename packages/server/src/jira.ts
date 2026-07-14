export interface JiraClient {
  /** `parentEpic`, when given, links the new issue under that epic. */
  createIssue(summary: string, description: string, parentEpic?: string): Promise<{ key: string; url: string }>;
}

/** Dev/no-credentials client: fabricates ticket keys so the workflow runs without real Jira. */
export class StubJiraClient implements JiraClient {
  private n = 0;
  constructor(private readonly baseUrl = 'https://jira.local', private readonly project = 'CFG') {}
  async createIssue(): Promise<{ key: string; url: string }> {
    this.n += 1;
    const key = `${this.project}-${1000 + this.n}`;
    return { key, url: `${this.baseUrl}/browse/${key}` };
  }
}

export interface JiraConfig { baseUrl: string; project: string; email: string; token: string; }

/** Real Jira Cloud/Server client via the REST API (Basic auth: email + API token). */
export class HttpJiraClient implements JiraClient {
  constructor(private readonly cfg: JiraConfig) {}
  async createIssue(summary: string, description: string, parentEpic?: string): Promise<{ key: string; url: string }> {
    const auth = Buffer.from(`${this.cfg.email}:${this.cfg.token}`).toString('base64');
    const fields: Record<string, unknown> = { project: { key: this.cfg.project }, summary, description, issuetype: { name: 'Task' } };
    if (parentEpic) fields.parent = { key: parentEpic }; // link under the config-changes epic
    const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/rest/api/2/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { key: string };
    return { key: data.key, url: `${this.cfg.baseUrl.replace(/\/$/, '')}/browse/${data.key}` };
  }
}

/** Real client when JIRA_* env is fully set, otherwise the stub. */
export function makeJiraClient(env: NodeJS.ProcessEnv): JiraClient {
  const { JIRA_BASE_URL, JIRA_PROJECT_KEY, JIRA_EMAIL, JIRA_API_TOKEN } = env;
  if (JIRA_BASE_URL && JIRA_PROJECT_KEY && JIRA_EMAIL && JIRA_API_TOKEN) {
    return new HttpJiraClient({ baseUrl: JIRA_BASE_URL, project: JIRA_PROJECT_KEY, email: JIRA_EMAIL, token: JIRA_API_TOKEN });
  }
  return new StubJiraClient();
}
