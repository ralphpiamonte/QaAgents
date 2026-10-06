import type { JiraAttachment, JiraComment, JiraIssue, JiraIssueLink, JiraUser } from "../types/jira";

interface JiraClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

const DEFAULT_FIELDS = [
  "summary",
  "description",
  "issuetype",
  "assignee",
  "comment",
  "attachment",
  "issuelinks",
  "parent"
].join(",");

export class JiraClient {
  private readonly authHeader: string;

  constructor(private readonly config: JiraClientConfig) {
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
  }

  async getCurrentUser(): Promise<JiraUser> {
    return this.request<JiraUser>("/rest/api/3/myself");
  }

  async getMyJiraIssues(): Promise<JiraIssue[]> {
    const jql = "assignee = currentUser() AND issuetype IN (Story, Bug)";
    const query = new URLSearchParams({
      jql,
      maxResults: "50",
      fields: DEFAULT_FIELDS
    });

    const response = await this.request<{ issues: JiraIssue[] }>(`/rest/api/3/search?${query.toString()}`);

    return response.issues ?? [];
  }

  async getJiraIssue(issueKey: string): Promise<JiraIssue> {
    const query = new URLSearchParams({ fields: DEFAULT_FIELDS });
    return this.request<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?${query.toString()}`);
  }

  async getJiraComments(issueKey: string): Promise<JiraComment[]> {
    const response = await this.request<{ comments: JiraComment[] }>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`
    );
    return response.comments ?? [];
  }

  async getJiraAttachments(issueKey: string): Promise<JiraAttachment[]> {
    const issue = await this.getJiraIssue(issueKey);
    return issue.fields.attachment ?? [];
  }

  async getLinkedIssues(issueKey: string): Promise<JiraIssueLink[]> {
    const issue = await this.getJiraIssue(issueKey);
    return issue.fields.issuelinks ?? [];
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: this.authHeader
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API error ${response.status}: ${body}`);
    }

    return (await response.json()) as T;
  }
}

