import { config as dotenvConfig } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getIssueReportsDir, sanitizeIssueKey } from "../services/issueArtifactPaths";
import { JiraClient } from "../services/jiraClient";
import { ZephyrApiError, ZephyrScaleClient, type ZephyrFolder, type ZephyrTestCase } from "../services/zephyrScaleClient";

dotenvConfig({ override: true });

const EnvSchema = z.object({
  JIRA_BASE_URL: z.string().url().transform((v) => v.replace(/\/+$/, "")),
  JIRA_EMAIL: z.string().email(),
  JIRA_API_TOKEN: z.string().min(1),
  ZEPHYR_SCALE_BASE_URL: z.string().url().default("https://api.zephyrscale.smartbear.com/v2"),
  ZEPHYR_SCALE_API_TOKEN: z.string().min(1),
  ZEPHYR_SCALE_PROJECT_KEY: z.string().min(1).optional(),
  ZEPHYR_SCALE_ROOT_FOLDER_NAME: z.string().min(1).default("Ordering _ Integrated UI")
});

type CleanupMode = "identify" | "archive" | "unlink" | "delete";
type CleanupScope = "linked" | "folder";

interface CleanupCandidate {
  testCaseKey: string;
  name: string;
  fingerprint: string;
  score: number;
  confidence: number;
  confidenceBasis: "sequence_tag" | "steps_exact" | "name_fallback_exact";
}

interface CleanupPlan {
  fingerprint: string;
  confidence: number;
  confidenceBasis: "sequence_tag" | "steps_exact" | "name_fallback_exact";
  keep: CleanupCandidate;
  remove: CleanupCandidate[];
}

interface CleanupActionRecord {
  action: "identify" | "archive" | "unlink" | "delete";
  issueKey: string;
  testCaseKey: string;
  name: string;
  result: "planned" | "executed" | "skipped" | "failed";
  detail: string;
  timestamp: string;
}

interface CleanupReport {
  generatedAt: string;
  issueKey: string;
  projectKey: string;
  scope: CleanupScope;
  mode: CleanupMode;
  execute: boolean;
  minConfidence: number;
  archiveStatusName: string;
  sourceFolderPath?: string;
  sourceFolderId?: number;
  totalCandidates: number;
  totalLinkedCases: number;
  actionableGroups: number;
  skippedByConfidenceGroups: number;
  duplicateGroups: Array<{
    fingerprint: string;
    confidence: number;
    confidenceBasis: "sequence_tag" | "steps_exact" | "name_fallback_exact";
    keep: CleanupCandidate;
    remove: CleanupCandidate[];
  }>;
  actions: CleanupActionRecord[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const issueKey = getArgValue(args, "--issue");
  if (!issueKey) {
    fail(
      "Usage: npm run cleanup:zephyr -- --issue GEM-37158 [--scope linked|folder] [--folder-path \"Ordering _ Integrated UI/GEM-37158\"] [--mode identify|archive|unlink|delete] [--min-confidence 0.80] [--execute] [--archive-status Archived] [--project-key GEM]"
    );
  }

  const mode = (getArgValue(args, "--mode") ?? "identify") as CleanupMode;
  if (!["identify", "archive", "unlink", "delete"].includes(mode)) {
    fail("Invalid --mode. Use one of: identify, archive, unlink, delete");
  }
  const scope = parseScope(getArgValue(args, "--scope"));
  const folderPathArg = getArgValue(args, "--folder-path");

  const execute = args.includes("--execute");
  const minConfidence = parseMinConfidence(getArgValue(args, "--min-confidence"));
  const archiveStatusName = getArgValue(args, "--archive-status") ?? "Archived";
  const outputPathArg = getArgValue(args, "--output");
  const env = EnvSchema.parse(process.env);

  const jira = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN
  });
  const zephyr = new ZephyrScaleClient({
    baseUrl: env.ZEPHYR_SCALE_BASE_URL,
    apiToken: env.ZEPHYR_SCALE_API_TOKEN
  });

  const issue = await jira.getJiraIssue(issueKey);
  const issueId = Number(issue.id);
  if (!Number.isInteger(issueId) || issueId <= 0) {
    fail(`Jira issue id "${issue.id}" is invalid for link cleanup.`);
  }

  const projectKey = (getArgValue(args, "--project-key") ?? env.ZEPHYR_SCALE_PROJECT_KEY ?? issueKey.split("-")[0] ?? "")
    .toUpperCase()
    .trim();
  if (!projectKey) {
    fail("Could not resolve project key. Pass --project-key or set ZEPHYR_SCALE_PROJECT_KEY.");
  }

  const linked = await zephyr.listIssueLinkedTestCases(issueKey);
  const linkedKeys = Array.from(new Set(linked.map((x) => x.testCaseKey))).filter(Boolean);
  const folderPath = folderPathArg ?? `${env.ZEPHYR_SCALE_ROOT_FOLDER_NAME}/${issueKey}`;
  const folderSource =
    scope === "folder" ? await resolveFolderSource(zephyr, projectKey, folderPath) : undefined;
  const keys =
    scope === "folder"
      ? Array.from(new Set(folderSource?.testCases.map((testCase) => testCase.key) ?? [])).filter(Boolean)
      : linkedKeys;
  const outputPath =
    outputPathArg ?? path.join(getIssueReportsDir(issueKey), `${sanitizeIssueKey(issueKey)}.cleanup.json`);
  const actions: CleanupActionRecord[] = [];
  if (keys.length === 0) {
    if (scope === "folder") {
      console.log(`No Zephyr test cases found in folder ${folderSource?.path ?? folderPath}.`);
    } else {
      console.log(`No Zephyr test cases linked to ${issueKey}.`);
    }
    const report: CleanupReport = {
      generatedAt: new Date().toISOString(),
      issueKey,
      projectKey,
      scope,
      mode,
      execute,
      minConfidence,
      archiveStatusName,
      ...(folderSource ? { sourceFolderPath: folderSource.path, sourceFolderId: folderSource.id } : {}),
      totalCandidates: 0,
      totalLinkedCases: 0,
      actionableGroups: 0,
      skippedByConfidenceGroups: 0,
      duplicateGroups: [],
      actions
    };
    await writeCleanupReport(outputPath, report);
    console.log(`Cleanup report: ${outputPath}`);
    return;
  }

  const candidates: CleanupCandidate[] = [];
  for (const key of keys) {
    const testCase = await zephyr.getTestCase(key);
    const steps = await safeGetSteps(zephyr, key);
    const fingerprint = buildFingerprint(issueKey, testCase.name, steps);
    candidates.push({
      testCaseKey: key,
      name: testCase.name,
      fingerprint: fingerprint.key,
      confidence: fingerprint.confidence,
      confidenceBasis: fingerprint.basis,
      score: scoreForKeep(issueKey, testCase.name, testCase.key)
    });
  }

  const plans = buildCleanupPlans(candidates);
  const actionablePlans = plans.filter((plan) => plan.confidence >= minConfidence);
  const skippedByConfidencePlans = plans.filter((plan) => plan.confidence < minConfidence);
  if (plans.length === 0) {
    console.log(`No duplicate groups detected for ${issueKey}.`);
    const report: CleanupReport = {
      generatedAt: new Date().toISOString(),
      issueKey,
      projectKey,
      scope,
      mode,
      execute,
      minConfidence,
      archiveStatusName,
      ...(folderSource ? { sourceFolderPath: folderSource.path, sourceFolderId: folderSource.id } : {}),
      totalCandidates: keys.length,
      totalLinkedCases: linkedKeys.length,
      actionableGroups: 0,
      skippedByConfidenceGroups: 0,
      duplicateGroups: [],
      actions
    };
    await writeCleanupReport(outputPath, report);
    console.log(`Cleanup report: ${outputPath}`);
    return;
  }

  printPlans(issueKey, plans, minConfidence);
  recordPlannedActions(actions, issueKey, mode, plans, minConfidence);

  if (mode === "identify") {
    console.log("Mode=identify, no changes made.");
    const report: CleanupReport = {
      generatedAt: new Date().toISOString(),
      issueKey,
      projectKey,
      scope,
      mode,
      execute,
      minConfidence,
      archiveStatusName,
      ...(folderSource ? { sourceFolderPath: folderSource.path, sourceFolderId: folderSource.id } : {}),
      totalCandidates: keys.length,
      totalLinkedCases: linkedKeys.length,
      actionableGroups: actionablePlans.length,
      skippedByConfidenceGroups: skippedByConfidencePlans.length,
      duplicateGroups: plans,
      actions
    };
    await writeCleanupReport(outputPath, report);
    console.log(`Cleanup report: ${outputPath}`);
    return;
  }

  if (!execute) {
    console.log(`Mode=${mode}, but --execute was not provided. No changes made.`);
    const report: CleanupReport = {
      generatedAt: new Date().toISOString(),
      issueKey,
      projectKey,
      scope,
      mode,
      execute,
      minConfidence,
      archiveStatusName,
      ...(folderSource ? { sourceFolderPath: folderSource.path, sourceFolderId: folderSource.id } : {}),
      totalCandidates: keys.length,
      totalLinkedCases: linkedKeys.length,
      actionableGroups: actionablePlans.length,
      skippedByConfidenceGroups: skippedByConfidencePlans.length,
      duplicateGroups: plans,
      actions
    };
    await writeCleanupReport(outputPath, report);
    console.log(`Cleanup report: ${outputPath}`);
    return;
  }

  if (mode === "archive") {
    await applyArchive(zephyr, actionablePlans, projectKey, archiveStatusName, actions, issueKey);
    console.log("Archive action completed.");
  } else if (mode === "unlink" || mode === "delete") {
    if (mode === "delete") {
      console.log("Mode=delete performs safe unlink of duplicate issue-links (hard delete endpoint for test cases is not available).");
    }
    await applyUnlink(zephyr, actionablePlans, issueId, mode, actions, issueKey);
    console.log("Unlink action completed.");
  }

  const report: CleanupReport = {
    generatedAt: new Date().toISOString(),
    issueKey,
    projectKey,
    scope,
    mode,
    execute,
    minConfidence,
    archiveStatusName,
    ...(folderSource ? { sourceFolderPath: folderSource.path, sourceFolderId: folderSource.id } : {}),
    totalCandidates: keys.length,
    totalLinkedCases: linkedKeys.length,
    actionableGroups: actionablePlans.length,
    skippedByConfidenceGroups: skippedByConfidencePlans.length,
    duplicateGroups: plans,
    actions
  };
  await writeCleanupReport(outputPath, report);
  console.log(`Cleanup report: ${outputPath}`);
}

async function applyArchive(
  zephyr: ZephyrScaleClient,
  plans: CleanupPlan[],
  projectKey: string,
  archiveStatusName: string,
  actions: CleanupActionRecord[],
  issueKey: string
): Promise<void> {
  const statuses = await zephyr.listTestCaseStatuses(projectKey);
  const status = statuses.find((s) => s.name.toLowerCase() === archiveStatusName.toLowerCase());
  if (!status) {
    const names = statuses.map((s) => s.name).sort().join(", ");
    fail(`Archive status "${archiveStatusName}" was not found in project ${projectKey}. Available statuses: ${names}`);
  }

  for (const plan of plans) {
    for (const duplicate of plan.remove) {
      const testCase = await zephyr.getTestCase(duplicate.testCaseKey);
      if (testCase.status?.id === status.id) {
        actions.push(actionRecord("archive", issueKey, duplicate.testCaseKey, duplicate.name, "skipped", "Already archived."));
        continue;
      }

      const payload = buildUpdatePayload(testCase, status.id);
      try {
        await zephyr.updateTestCase(testCase.key, payload);
        actions.push(actionRecord("archive", issueKey, testCase.key, testCase.name, "executed", `Status set to ${archiveStatusName}.`));
        console.log(`Archived ${testCase.key} (${testCase.name})`);
      } catch (error) {
        actions.push(
          actionRecord(
            "archive",
            issueKey,
            testCase.key,
            testCase.name,
            "failed",
            error instanceof Error ? error.message : "Unknown archive error."
          )
        );
        throw error;
      }
    }
  }
}

async function applyUnlink(
  zephyr: ZephyrScaleClient,
  plans: CleanupPlan[],
  issueId: number,
  mode: "unlink" | "delete",
  actions: CleanupActionRecord[],
  issueKey: string
): Promise<void> {
  for (const plan of plans) {
    for (const duplicate of plan.remove) {
      const links = await zephyr.getTestCaseLinks(duplicate.testCaseKey);
      const issueLinks = links.filter((l) => l.issueId === issueId);
      if (issueLinks.length === 0) {
        actions.push(actionRecord(mode, issueKey, duplicate.testCaseKey, duplicate.name, "skipped", "No matching issue link."));
        continue;
      }
      for (const link of issueLinks) {
        try {
          await zephyr.deleteLink(link.id);
          actions.push(actionRecord(mode, issueKey, duplicate.testCaseKey, duplicate.name, "executed", `Removed link ${link.id}.`));
          console.log(`Removed link ${link.id} from ${duplicate.testCaseKey}`);
        } catch (error) {
          actions.push(
            actionRecord(
              mode,
              issueKey,
              duplicate.testCaseKey,
              duplicate.name,
              "failed",
              error instanceof Error ? error.message : "Unknown unlink error."
            )
          );
          throw error;
        }
      }
    }
  }
}

function buildUpdatePayload(testCase: ZephyrTestCase, statusId: number): Record<string, unknown> {
  if (!testCase.project?.id) {
    fail(`Test case ${testCase.key} has no project id, cannot update safely.`);
  }
  if (!testCase.priority?.id) {
    fail(`Test case ${testCase.key} has no priority id, cannot update safely.`);
  }

  return {
    id: testCase.id,
    key: testCase.key,
    name: testCase.name,
    project: { id: testCase.project.id },
    priority: { id: testCase.priority.id },
    status: { id: statusId },
    ...(testCase.objective !== undefined ? { objective: testCase.objective } : {}),
    ...(testCase.precondition !== undefined ? { precondition: testCase.precondition } : {}),
    ...(testCase.estimatedTime !== undefined ? { estimatedTime: testCase.estimatedTime } : {}),
    ...(testCase.labels ? { labels: testCase.labels } : {}),
    ...(testCase.component?.id ? { component: { id: testCase.component.id } } : {}),
    ...(testCase.folder?.id ? { folder: { id: testCase.folder.id } } : {}),
    ...(testCase.owner?.accountId ? { owner: { accountId: testCase.owner.accountId } } : {}),
    ...(testCase.customFields ? { customFields: testCase.customFields } : {})
  };
}

function buildCleanupPlans(candidates: CleanupCandidate[]): CleanupPlan[] {
  const groups = new Map<string, CleanupCandidate[]>();
  for (const candidate of candidates) {
    const list = groups.get(candidate.fingerprint) ?? [];
    list.push(candidate);
    groups.set(candidate.fingerprint, list);
  }

  const plans: CleanupPlan[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }
    const sorted = [...group].sort(compareCandidates);
    const keep = sorted[0];
    if (!keep) {
      continue;
    }
    plans.push({
      fingerprint: keep.fingerprint,
      confidence: keep.confidence,
      confidenceBasis: keep.confidenceBasis,
      keep,
      remove: sorted.slice(1)
    });
  }

  return plans;
}

function compareCandidates(a: CleanupCandidate, b: CleanupCandidate): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  const aNum = parseTestCaseNumericId(a.testCaseKey);
  const bNum = parseTestCaseNumericId(b.testCaseKey);
  if (aNum !== bNum) {
    return aNum - bNum;
  }

  return a.testCaseKey.localeCompare(b.testCaseKey);
}

function scoreForKeep(issueKey: string, name: string, testCaseKey: string): number {
  const norm = name.trim();
  const bracketPrefixWithHeadline = new RegExp(`^\\[${escapeRegex(issueKey)}\\]\\[TC\\d{3}\\]\\s+\\S`, "i");
  const bracketPrefixOnly = new RegExp(`^\\[${escapeRegex(issueKey)}\\]\\[TC\\d{3}\\]$`, "i");
  const dashedPrefixWithHeadline = new RegExp(`^${escapeRegex(issueKey)}-TC\\d{3}\\s+\\S`, "i");
  const dashedPrefixOnly = new RegExp(`^${escapeRegex(issueKey)}-TC\\d{3}$`, "i");

  if (bracketPrefixWithHeadline.test(norm)) return 320;
  if (dashedPrefixWithHeadline.test(norm)) return 300;
  if (bracketPrefixOnly.test(norm)) return 120;
  if (dashedPrefixOnly.test(norm)) return 100;
  if (norm.length > 0) return 200;
  if (testCaseKey.length > 0) return 50;
  return 0;
}

function buildFingerprint(
  issueKey: string,
  name: string,
  steps: Array<{ description: string; expectedResult: string }>
): { key: string; confidence: number; basis: "sequence_tag" | "steps_exact" | "name_fallback_exact" } {
  const sequenceTag = extractSequenceTag(issueKey, name);
  if (sequenceTag) {
    return {
      key: `sequence:${sequenceTag}`,
      confidence: 0.98,
      basis: "sequence_tag"
    };
  }

  if (steps.length > 0) {
    return {
      key: `steps:${steps.map((s) => `${normalizeText(s.description)}=>${normalizeText(s.expectedResult)}`).join("|")}`,
      confidence: 1,
      basis: "steps_exact"
    };
  }

  const normalizedName = normalizeTitleForFallback(issueKey, name);
  const confidence = normalizedName.length >= 25 ? 0.85 : 0.72;
  return {
    key: `name:${normalizedName}`,
    confidence,
    basis: "name_fallback_exact"
  };
}

function extractSequenceTag(issueKey: string, name: string): string | undefined {
  const bracketed = new RegExp(`\\[${escapeRegex(issueKey)}\\]\\[TC-?(\\d{1,3})\\]`, "i").exec(name);
  if (bracketed && bracketed[1]) {
    return `${issueKey.toUpperCase()}-${toCanonicalSequenceTag(bracketed[1])}`;
  }

  const dashed = new RegExp(`${escapeRegex(issueKey)}-TC-?(\\d{1,3})\\b`, "i").exec(name);
  if (dashed && dashed[1]) {
    return `${issueKey.toUpperCase()}-${toCanonicalSequenceTag(dashed[1])}`;
  }

  return undefined;
}

function normalizeTitleForFallback(issueKey: string, name: string): string {
  const bracketPrefix = new RegExp(`^\\[${escapeRegex(issueKey)}\\]\\[TC-?\\d{1,3}\\]\\s*`, "i");
  const dashedPrefix = new RegExp(`^${escapeRegex(issueKey)}-TC-?\\d{1,3}\\s*`, "i");
  return normalizeText(name.replace(bracketPrefix, "").replace(dashedPrefix, ""));
}

function toCanonicalSequenceTag(rawDigits: string): string {
  const parsed = Number(rawDigits);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return `TC${rawDigits}`;
  }
  return `TC${String(parsed).padStart(3, "0")}`;
}

function parseTestCaseNumericId(key: string): number {
  const match = key.match(/-T(\d+)$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getArgValue(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index === -1) return undefined;
  return args[index + 1];
}

function printPlans(issueKey: string, plans: CleanupPlan[], minConfidence: number): void {
  console.log(`Duplicate groups for ${issueKey}: ${plans.length}`);
  plans.forEach((plan, idx) => {
    const actionable = plan.confidence >= minConfidence;
    console.log(`\nGroup ${idx + 1}`);
    console.log(
      `  Confidence: ${plan.confidence.toFixed(2)} (${plan.confidenceBasis}) | Actionable: ${actionable ? "Yes" : "No"}`
    );
    console.log(`  Keep:   ${plan.keep.testCaseKey} | ${plan.keep.name}`);
    plan.remove.forEach((d) => {
      console.log(`  Remove: ${d.testCaseKey} | ${d.name}`);
    });
  });
}

function recordPlannedActions(
  actions: CleanupActionRecord[],
  issueKey: string,
  mode: CleanupMode,
  plans: CleanupPlan[],
  minConfidence: number
): void {
  plans.forEach((plan) => {
    plan.remove.forEach((item) => {
      const actionable = plan.confidence >= minConfidence;
      actions.push(
        actionRecord(
          mode,
          issueKey,
          item.testCaseKey,
          item.name,
          actionable ? "planned" : "skipped",
          actionable
            ? `Duplicate candidate above threshold (${plan.confidence.toFixed(2)} >= ${minConfidence.toFixed(2)}).`
            : `Below min-confidence threshold (${plan.confidence.toFixed(2)} < ${minConfidence.toFixed(2)}).`
        )
      );
    });
  });
}

async function safeGetSteps(
  zephyr: ZephyrScaleClient,
  testCaseKey: string
): Promise<Array<{ description: string; expectedResult: string }>> {
  try {
    return await zephyr.getTestCaseTestSteps(testCaseKey);
  } catch (error) {
    if (error instanceof ZephyrApiError && error.status === 422) {
      return [];
    }
    throw error;
  }
}

interface FolderSource {
  id: number;
  path: string;
  testCases: ZephyrTestCase[];
}

async function resolveFolderSource(
  zephyr: ZephyrScaleClient,
  projectKey: string,
  folderPath: string
): Promise<FolderSource> {
  const folders = await zephyr.listFolders(projectKey, "TEST_CASE");
  const resolved = findFolderByPath(folders, folderPath);
  if (!resolved) {
    fail(
      `Folder path "${folderPath}" was not found in project ${projectKey}. Pass --folder-path or verify folder naming in Zephyr.`
    );
  }

  const testCases = await zephyr.listTestCases({ projectKey, folderId: resolved.id });
  return {
    id: resolved.id,
    path: resolved.path,
    testCases
  };
}

function findFolderByPath(
  folders: ZephyrFolder[],
  folderPath: string
): { id: number; path: string } | undefined {
  const parts = folderPath
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }

  let parentId: number | null = null;
  let current: ZephyrFolder | undefined;
  const resolvedNames: string[] = [];
  for (const part of parts) {
    current = folders.find((folder) => {
      const sameParent = normalizeParentId(folder.parentId) === parentId;
      return sameParent && folder.name.trim().toLowerCase() === part.toLowerCase();
    });
    if (!current) {
      return undefined;
    }
    resolvedNames.push(current.name);
    parentId = current.id;
  }

  if (!current) {
    return undefined;
  }
  return { id: current.id, path: resolvedNames.join("/") };
}

function normalizeParentId(parentId: number | null | undefined): number | null {
  return typeof parentId === "number" ? parentId : null;
}

function fail(message: string): never {
  throw new Error(message);
}

async function writeCleanupReport(outputPath: string, report: CleanupReport): Promise<void> {
  const dir = path.dirname(outputPath);
  await mkdir(dir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
}

function actionRecord(
  action: "identify" | "archive" | "unlink" | "delete",
  issueKey: string,
  testCaseKey: string,
  name: string,
  result: "planned" | "executed" | "skipped" | "failed",
  detail: string
): CleanupActionRecord {
  return {
    action,
    issueKey,
    testCaseKey,
    name,
    result,
    detail,
    timestamp: new Date().toISOString()
  };
}

function parseMinConfidence(value: string | undefined): number {
  if (!value) {
    return 0.8;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    fail("Invalid --min-confidence. Use a number between 0 and 1, for example 0.85.");
  }
  return parsed;
}

function parseScope(value: string | undefined): CleanupScope {
  if (!value) {
    return "linked";
  }
  if (value === "linked" || value === "folder") {
    return value;
  }
  fail("Invalid --scope. Use one of: linked, folder");
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error("Unknown error.");
  }
  process.exit(1);
});

