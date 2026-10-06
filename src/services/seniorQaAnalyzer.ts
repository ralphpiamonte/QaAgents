import OpenAI, { AzureOpenAI } from "openai";
import { QaOutputSchema, type QaOutput } from "../schemas/qaOutput";
import type { JiraAttachment, JiraComment, JiraIssue, JiraIssueLink } from "../types/jira";
import { adfToPlainText } from "../utils/adf";

type AnalyzerConfig =
  | {
      provider: "openai";
      apiKey: string;
      model: string;
    }
  | {
      provider: "azure";
      endpoint: string;
      apiKey: string;
      apiVersion: string;
      deployment: string;
    }
  | {
      provider: "azure_apim";
      baseUrl: string;
      subscriptionKey: string;
      bearerToken: string;
      supplierHeader?: string;
      model: string;
    };

interface AnalyzeInput {
  issue: JiraIssue;
  issueType: "Story" | "Bug";
  comments: JiraComment[];
  attachments: JiraAttachment[];
  linkedIssues: JiraIssueLink[];
}

const SYSTEM_INSTRUCTIONS = `
You are a Senior Software QA Analyst.
You produce thorough but realistic QA analysis from Jira artifacts.
Do not invent requirements that are not present in the provided issue context.
When data is missing, explicitly list it as missing information and generate clarification questions.
For bugs, include repro/fix/negative/edge/boundary/regression/integration perspectives.
For stories, include requirements, ambiguity, dependency, risk, edge and boundary analysis.
Output ONLY valid JSON that matches the schema in the user prompt.
`.trim();

export class SeniorQaAnalyzer {
  private readonly openAiClient?: OpenAI;
  private readonly azureClient?: AzureOpenAI;

  constructor(private readonly config: AnalyzerConfig) {
    if (config.provider === "openai") {
      this.openAiClient = new OpenAI({ apiKey: config.apiKey });
    } else if (config.provider === "azure") {
      this.azureClient = new AzureOpenAI({
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        apiVersion: config.apiVersion,
        deployment: config.deployment
      });
    }
  }

  async analyze(input: AnalyzeInput): Promise<QaOutput> {
    const summary = input.issue.fields.summary ?? "(No summary in Jira)";
    const description = adfToPlainText(input.issue.fields.description);
    const comments = input.comments
      .map((c, idx) => `Comment ${idx + 1}: ${adfToPlainText(c.body)}`)
      .filter(Boolean)
      .join("\n");
    const attachments = input.attachments
      .map((a) => `- ${a.filename} (${a.mimeType ?? "unknown mime"}, ${a.size ?? "unknown size"} bytes)`)
      .join("\n");
    const links = input.linkedIssues
      .map((link) => {
        const outward = link.outwardIssue
          ? `${link.outwardIssue.key} | ${link.outwardIssue.fields?.issuetype?.name ?? "Unknown"} | ${link.outwardIssue.fields?.summary ?? "No summary"}`
          : "";
        const inward = link.inwardIssue
          ? `${link.inwardIssue.key} | ${link.inwardIssue.fields?.issuetype?.name ?? "Unknown"} | ${link.inwardIssue.fields?.summary ?? "No summary"}`
          : "";
        return [outward, inward].filter(Boolean).join(" ; ");
      })
      .filter(Boolean)
      .join("\n");

    const prompt = `
Generate QA analysis and test design for Jira issue ${input.issue.key}.

Issue type: ${input.issueType}
Summary: ${summary}
Description:
${description || "(No description)"}

Comments:
${comments || "(No comments)"}

Attachments:
${attachments || "(No attachments)"}

Linked issues:
${links || "(No linked issues)"}

Return JSON with these exact keys:
- jiraIssueSummary: string
- requirementOrBugAnalysis: string[]
- missingInformation: string[]
- ambiguities: string[]
- risks: string[]
- dependencies: string[]
- clarificationQuestions: string[]
- recommendedTestScenarios: string[]
- detailedTestCases: [{ title, priority(Critical|High|Medium|Low), type, preconditions[], steps[{action, expected}] }]
- regressionConsiderations: string[]

Rules:
1) Do not make up missing requirements. If unknown, state it explicitly.
2) Keep test cases concrete and executable.
3) Ensure expected results are specific and verifiable.
4) Cover relevant negative/edge/boundary/regression impacts.
5) Test case titles must be grammatically correct and concise.
6) Prefer title pattern: "Verify that <subject> <observable behavior>".
7) Output only JSON; no markdown, no prose outside JSON.
`.trim();

    const raw = await this.generateModelOutput(prompt);
    if (!raw) {
      throw new Error("AI provider returned no textual output.");
    }

    const parsed = parseJsonOutput(raw);
    return QaOutputSchema.parse(parsed);
  }

  private async generateModelOutput(prompt: string): Promise<string> {
    if (this.config.provider === "openai") {
      if (!this.openAiClient) {
        throw new Error("OpenAI client was not initialized.");
      }

      const response = await this.openAiClient.responses.create({
        model: this.config.model,
        instructions: SYSTEM_INSTRUCTIONS,
        input: prompt
      });

      return response.output_text?.trim() ?? "";
    }

    if (this.config.provider === "azure") {
      if (!this.azureClient) {
        throw new Error("Azure OpenAI client was not initialized.");
      }

      const completion = await this.azureClient.chat.completions.create({
        model: this.config.deployment,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTIONS },
          { role: "user", content: prompt }
        ]
      });

      return extractChatCompletionContent(completion.choices[0]?.message?.content).trim();
    }

    return await this.callApimResponsesApi(prompt);
  }

  private async callApimResponsesApi(prompt: string): Promise<string> {
    if (this.config.provider !== "azure_apim") {
      throw new Error("APIM request called for non-APIM provider.");
    }

    const base = this.config.baseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/responses`);
    url.searchParams.set("subscription-key", this.config.subscriptionKey);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.bearerToken}`
    };

    if (this.config.supplierHeader) {
      headers["x-openai-supplier"] = this.config.supplierHeader;
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        instructions: SYSTEM_INSTRUCTIONS,
        input: prompt
      })
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`Azure APIM responses API error ${response.status}: ${rawText}`);
    }

    const parsed = parsePossiblyStringifiedJson(rawText);
    const outputText = extractOutputTextFromResponsesPayload(parsed);
    if (!outputText) {
      throw new Error(`Azure APIM responses API returned no output text. Payload: ${rawText}`);
    }

    return outputText.trim();
  }
}

function parseJsonOutput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(cleaned);
  }
}

function parsePossiblyStringifiedJson(raw: string): unknown {
  let parsed: unknown = raw;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  if (typeof parsed === "string") {
    try {
      return JSON.parse(parsed);
    } catch {
      return parsed;
    }
  }

  return parsed;
}

function extractOutputTextFromResponsesPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const typed = payload as {
    output_text?: unknown;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (typeof typed.output_text === "string" && typed.output_text.trim().length > 0) {
    return typed.output_text;
  }

  if (!Array.isArray(typed.output)) {
    return "";
  }

  const collected: string[] = [];
  for (const item of typed.output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const contentItem of item.content) {
      if (contentItem?.type === "output_text" && typeof contentItem.text === "string") {
        collected.push(contentItem.text);
      }
    }
  }

  return collected.join("\n");
}

function extractChatCompletionContent(
  content: string | Array<{ type?: string; text?: string }> | null | undefined
): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => (typeof item?.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

