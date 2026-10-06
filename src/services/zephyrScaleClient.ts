interface ZephyrScaleClientConfig {
  baseUrl: string;
  apiToken: string;
}

export class ZephyrApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly method: "GET" | "POST" | "PUT" | "DELETE",
    public readonly path: string
  ) {
    super(message);
    this.name = "ZephyrApiError";
  }
}

export interface ZephyrCreatedResource {
  id?: number;
  key?: string;
  self?: string;
}

export interface ZephyrIssueLinkReference {
  testCaseKey: string;
  version?: number;
}

export type ZephyrFolderType = "TEST_CASE";

export interface ZephyrFolder {
  id: number;
  name: string;
  parentId?: number | null;
  projectKey?: string;
  folderType?: ZephyrFolderType;
}

export interface ZephyrTestCase {
  id: number;
  key: string;
  name: string;
  project?: { id?: number; self?: string };
  objective?: string | null;
  precondition?: string | null;
  estimatedTime?: number | null;
  labels?: string[];
  component?: { id?: number; self?: string } | null;
  priority?: { id?: number; self?: string };
  status?: { id?: number; self?: string };
  folder?: { id?: number; self?: string } | null;
  owner?: { accountId?: string; self?: string } | null;
  customFields?: Record<string, unknown>;
}

interface CreateTestCaseInput {
  projectKey: string;
  name: string;
  folderId?: number;
  objective?: string;
  precondition?: string;
  labels?: string[];
}

interface CreateFolderInput {
  name: string;
  projectKey: string;
  folderType: ZephyrFolderType;
  parentId?: number;
}

interface ListTestCasesInput {
  projectKey?: string;
  folderId?: number;
}

interface TestStepInput {
  description: string;
  expectedResult: string;
  testData?: string;
}

export interface ZephyrIssueLink {
  id: number;
  issueId: number;
}

export interface ZephyrStatus {
  id: number;
  name: string;
  archived?: boolean;
}

export class ZephyrScaleClient {
  private readonly baseUrl: string;

  constructor(private readonly config: ZephyrScaleClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
  }

  async listIssueLinkedTestCases(issueKey: string): Promise<ZephyrIssueLinkReference[]> {
    const payload = await this.request<unknown>("GET", `/issuelinks/${encodeURIComponent(issueKey)}/testcases`);

    if (!Array.isArray(payload) && !(payload && typeof payload === "object")) {
      return [];
    }

    const items = Array.isArray(payload) ? payload : (payload as { values?: unknown }).values;
    if (!Array.isArray(items)) {
      return [];
    }

    const links: ZephyrIssueLinkReference[] = [];
    items.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const candidate = item as { testCaseKey?: unknown; key?: unknown; version?: unknown };
      const resolvedKey =
        typeof candidate.testCaseKey === "string"
          ? candidate.testCaseKey
          : typeof candidate.key === "string"
            ? candidate.key
            : "";
      if (resolvedKey.trim().length === 0) return;
      links.push({
        testCaseKey: resolvedKey,
        ...(typeof candidate.version === "number" ? { version: candidate.version } : {})
      });
    });

    return links;
  }

  async createTestCase(input: CreateTestCaseInput): Promise<ZephyrCreatedResource> {
    return this.request<ZephyrCreatedResource>("POST", "/testcases", input);
  }

  async listTestCases(input: ListTestCasesInput = {}): Promise<ZephyrTestCase[]> {
    const pageSize = 200;
    const testCases: ZephyrTestCase[] = [];
    let startAt = 0;

    while (true) {
      const query = new URLSearchParams();
      query.set("maxResults", String(pageSize));
      query.set("startAt", String(startAt));
      if (input.projectKey) {
        query.set("projectKey", input.projectKey);
      }
      if (typeof input.folderId === "number") {
        query.set("folderId", String(input.folderId));
      }

      const payload = await this.request<unknown>("GET", `/testcases?${query.toString()}`);
      if (!payload || typeof payload !== "object") {
        break;
      }

      const values = (payload as { values?: unknown }).values;
      if (!Array.isArray(values) || values.length === 0) {
        break;
      }

      let validInPage = 0;
      values.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const candidate = item as ZephyrTestCase;
        if (typeof candidate.key !== "string" || typeof candidate.name !== "string" || typeof candidate.id !== "number") {
          return;
        }
        testCases.push(candidate);
        validInPage += 1;
      });

      const total = (payload as { total?: unknown }).total;
      startAt += values.length;
      if (typeof total === "number" && startAt >= total) {
        break;
      }
      if (values.length < pageSize || validInPage === 0) {
        break;
      }
    }

    return testCases;
  }

  async listFolders(projectKey: string, folderType: ZephyrFolderType = "TEST_CASE"): Promise<ZephyrFolder[]> {
    const pageSize = 200;
    const folders: ZephyrFolder[] = [];
    let startAt = 0;

    while (true) {
      const payload = await this.request<unknown>(
        "GET",
        `/folders?projectKey=${encodeURIComponent(projectKey)}&folderType=${encodeURIComponent(folderType)}&maxResults=${pageSize}&startAt=${startAt}`
      );
      if (!payload || typeof payload !== "object") {
        break;
      }

      const values = (payload as { values?: unknown }).values;
      if (!Array.isArray(values) || values.length === 0) {
        break;
      }

      values.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const candidate = item as {
          id?: unknown;
          name?: unknown;
          parentId?: unknown;
          parent?: unknown;
          projectKey?: unknown;
          folderType?: unknown;
        };
        if (typeof candidate.id !== "number" || typeof candidate.name !== "string") return;

        const parentId = parseFolderParentId(candidate.parentId, candidate.parent);
        const folderTypeValue = parseFolderType(candidate.folderType);
        folders.push({
          id: candidate.id,
          name: candidate.name,
          ...(parentId !== undefined ? { parentId } : {}),
          ...(typeof candidate.projectKey === "string" ? { projectKey: candidate.projectKey } : {}),
          ...(folderTypeValue ? { folderType: folderTypeValue } : {})
        });
      });

      const total = (payload as { total?: unknown }).total;
      startAt += values.length;
      if (typeof total === "number" && startAt >= total) {
        break;
      }
      if (values.length < pageSize) {
        break;
      }
    }

    return folders;
  }

  async createFolder(input: CreateFolderInput): Promise<ZephyrCreatedResource> {
    return this.request<ZephyrCreatedResource>("POST", "/folders", input);
  }

  async getTestCase(testCaseKey: string): Promise<ZephyrTestCase> {
    const payload = await this.request<unknown>("GET", `/testcases/${encodeURIComponent(testCaseKey)}`);
    if (!payload || typeof payload !== "object") {
      throw new Error(`Unexpected Zephyr response while reading test case ${testCaseKey}.`);
    }
    const candidate = payload as ZephyrTestCase;
    if (typeof candidate.key !== "string" || typeof candidate.name !== "string" || typeof candidate.id !== "number") {
      throw new Error(`Invalid Zephyr test case payload for ${testCaseKey}.`);
    }
    return candidate;
  }

  async getTestCaseLinks(testCaseKey: string): Promise<ZephyrIssueLink[]> {
    const payload = await this.request<unknown>("GET", `/testcases/${encodeURIComponent(testCaseKey)}/links`);
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const issues = (payload as { issues?: unknown }).issues;
    if (!Array.isArray(issues)) {
      return [];
    }

    const links: ZephyrIssueLink[] = [];
    issues.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const candidate = item as { id?: unknown; issueId?: unknown };
      if (typeof candidate.id !== "number" || typeof candidate.issueId !== "number") return;
      links.push({ id: candidate.id, issueId: candidate.issueId });
    });

    return links;
  }

  async getTestCaseTestSteps(testCaseKey: string): Promise<TestStepInput[]> {
    const payload = await this.request<unknown>(
      "GET",
      `/testcases/${encodeURIComponent(testCaseKey)}/teststeps?maxResults=1000&startAt=0`
    );
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const values = (payload as { values?: unknown }).values;
    if (!Array.isArray(values)) {
      return [];
    }

    const steps: TestStepInput[] = [];
    values.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const inline = (item as { inline?: unknown }).inline;
      if (!inline || typeof inline !== "object") return;
      const candidate = inline as { description?: unknown; expectedResult?: unknown; testData?: unknown };
      if (typeof candidate.description !== "string" || typeof candidate.expectedResult !== "string") return;
      steps.push({
        description: candidate.description,
        expectedResult: candidate.expectedResult,
        ...(typeof candidate.testData === "string" ? { testData: candidate.testData } : {})
      });
    });

    return steps;
  }

  async listTestCaseStatuses(projectKey: string): Promise<ZephyrStatus[]> {
    const payload = await this.request<unknown>(
      "GET",
      `/statuses?projectKey=${encodeURIComponent(projectKey)}&statusType=TEST_CASE&maxResults=1000&startAt=0`
    );
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const values = (payload as { values?: unknown }).values;
    if (!Array.isArray(values)) {
      return [];
    }

    const statuses: ZephyrStatus[] = [];
    values.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const candidate = item as { id?: unknown; name?: unknown; archived?: unknown };
      if (typeof candidate.id !== "number" || typeof candidate.name !== "string") return;
      statuses.push({
        id: candidate.id,
        name: candidate.name,
        ...(typeof candidate.archived === "boolean" ? { archived: candidate.archived } : {})
      });
    });

    return statuses;
  }

  async updateTestCase(testCaseKey: string, payload: unknown): Promise<void> {
    await this.request<unknown>("PUT", `/testcases/${encodeURIComponent(testCaseKey)}`, payload);
  }

  async deleteLink(linkId: number): Promise<void> {
    await this.request<unknown>("DELETE", `/links/${linkId}`);
  }

  async overwriteTestSteps(testCaseKey: string, steps: TestStepInput[]): Promise<ZephyrCreatedResource> {
    const body = {
      mode: "OVERWRITE",
      items: steps.map((step) => ({
        inline: {
          description: step.description,
          expectedResult: step.expectedResult,
          ...(step.testData ? { testData: step.testData } : {})
        }
      }))
    };

    return this.request<ZephyrCreatedResource>(
      "POST",
      `/testcases/${encodeURIComponent(testCaseKey)}/teststeps`,
      body
    );
  }

  async createTestCaseIssueLink(testCaseKey: string, issueId: number): Promise<ZephyrCreatedResource> {
    return this.request<ZephyrCreatedResource>(
      "POST",
      `/testcases/${encodeURIComponent(testCaseKey)}/links/issues`,
      { issueId }
    );
  }

  private async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.apiToken}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new ZephyrApiError(
        `Zephyr Scale API error ${response.status} at ${method} ${path}: ${raw}`,
        response.status,
        method,
        path
      );
    }

    if (!raw.trim()) {
      return {} as T;
    }

    return JSON.parse(raw) as T;
  }
}

function parseFolderParentId(parentId: unknown, parent: unknown): number | null | undefined {
  if (typeof parentId === "number") {
    return parentId;
  }
  if (parentId === null) {
    return null;
  }
  if (parent && typeof parent === "object") {
    const parentObjectId = (parent as { id?: unknown }).id;
    if (typeof parentObjectId === "number") {
      return parentObjectId;
    }
  }
  if (parent === null) {
    return null;
  }
  return undefined;
}

function parseFolderType(value: unknown): ZephyrFolderType | undefined {
  if (value === "TEST_CASE") {
    return value;
  }
  return undefined;
}

