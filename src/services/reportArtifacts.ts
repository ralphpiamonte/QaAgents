import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QaOutput } from "../schemas/qaOutput";
import { getIssueReportsDir, sanitizeIssueKey } from "./issueArtifactPaths";
import type { QaReviewResult } from "./qaReviewValidator";

interface WriteArtifactsInput {
  issueKey: string;
  issueType: "Story" | "Bug";
  mode: "dry-run" | "approve";
  approved: boolean;
  reportText: string;
  qaOutput: QaOutput;
  review: QaReviewResult;
}

export interface ReportArtifactsResult {
  jsonPath: string;
  markdownPath: string;
}

export async function writeReportArtifacts(input: WriteArtifactsInput): Promise<ReportArtifactsResult> {
  const reportsDir = getIssueReportsDir(input.issueKey);
  const safeKey = sanitizeIssueKey(input.issueKey);
  const jsonPath = path.join(reportsDir, `${safeKey}.analysis.json`);
  const markdownPath = path.join(reportsDir, `${safeKey}.analysis.md`);

  await mkdir(reportsDir, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    issueKey: input.issueKey,
    issueType: input.issueType,
    mode: input.mode,
    approved: input.approved,
    qaReview: input.review,
    analysis: input.qaOutput
  };

  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(markdownPath, input.reportText, "utf8");

  return { jsonPath, markdownPath };
}

