import type { QaOutput } from "../schemas/qaOutput";
import type { JiraIssue } from "../types/jira";
import { ZephyrApiError, ZephyrScaleClient, type ZephyrFolder, type ZephyrTestCase } from "./zephyrScaleClient";

interface PublishContext {
  issue: JiraIssue;
  analysis: QaOutput;
  projectKey: string;
  rootFolderName: string;
  preWriteRevalidation: () => Promise<void>;
  previousManifestItems?: Array<{ title: string; testCaseKey: string }>;
}

export interface ZephyrPublishItem {
  sourceTitle: string;
  zephyrName: string;
  testCaseKey: string;
  action: "created" | "reused";
}

export interface ZephyrPublishResult {
  existingLinkedTestCases: string[];
  publishedItems: ZephyrPublishItem[];
  createdCount: number;
  reusedCount: number;
  skippedUnmappedCount: number;
  targetFolderId: number;
  targetFolderPath: string;
}

const TEST_CASE_FOLDER_TYPE = "TEST_CASE";

export async function publishToZephyrScaleCloud(
  client: ZephyrScaleClient,
  context: PublishContext
): Promise<ZephyrPublishResult> {
  const issueId = parseIssueId(context.issue.id);
  const targetFolder = await ensureIssueFolder(client, {
    projectKey: context.projectKey,
    rootFolderName: context.rootFolderName,
    issueKey: context.issue.key,
    preWriteRevalidation: context.preWriteRevalidation
  });

  const existingLinked = await client.listIssueLinkedTestCases(context.issue.key);
  const existingLinkedTestCases = existingLinked.map((item) => item.testCaseKey);
  const existingLinkedSet = new Set(existingLinkedTestCases);
  const linkedLookup = await buildLinkedLookup(client, context.issue.key, existingLinkedTestCases);
  const linkedByNormalizedTitle = linkedLookup.byNormalizedTitle;
  const linkedBySequenceTag = linkedLookup.bySequenceTag;
  const manifestByNormalizedTitle = new Map<string, string>();
  const manifestBySequenceTag = new Map<string, string>();
  (context.previousManifestItems ?? []).forEach((item) => {
    const normalizedTitle = normalizeTitle(item.title);
    if (!normalizedTitle || !item.testCaseKey) return;
    if (!manifestByNormalizedTitle.has(normalizedTitle)) {
      manifestByNormalizedTitle.set(normalizedTitle, item.testCaseKey);
    }
    const sequenceTag = extractSequenceTag(context.issue.key, item.title);
    if (sequenceTag && !manifestBySequenceTag.has(sequenceTag)) {
      manifestBySequenceTag.set(sequenceTag, item.testCaseKey);
    }
  });
  const isExistingIssuePublication =
    existingLinkedTestCases.length > 0 || (context.previousManifestItems?.length ?? 0) > 0;

  const publishedItems: ZephyrPublishItem[] = [];
  let createdCount = 0;
  let reusedCount = 0;
  let skippedUnmappedCount = 0;

  for (const [index, testCase] of context.analysis.detailedTestCases.entries()) {
    const sequence = index + 1;
    const sequenceTag = buildSequenceTag(sequence);
    if (isExistingIssuePublication && !linkedBySequenceTag.has(sequenceTag) && !manifestBySequenceTag.has(sequenceTag)) {
      skippedUnmappedCount += 1;
      continue;
    }
    const zephyrName = buildZephyrTestCaseName(context.issue.key, sequence, testCase.title);
    const nameAliases = buildNameAliases(context.issue.key, sequence);
    const candidateTitles = buildCandidateTitles(context.issue.key, sequence, testCase.title, zephyrName);
    const stepsPayload = testCase.steps.map((step) => ({
      description: step.action,
      expectedResult: step.expected
    }));

    let testCaseKey = linkedBySequenceTag.get(sequenceTag) ?? findByCandidateTitles(linkedByNormalizedTitle, candidateTitles);
    let action: "created" | "reused" = "reused";

    if (!testCaseKey) {
      const manifestCandidateBySequence = manifestBySequenceTag.get(sequenceTag);
      if (manifestCandidateBySequence) {
        const exists = await testCaseExists(client, manifestCandidateBySequence);
        if (exists) {
          testCaseKey = manifestCandidateBySequence;
        }
      }
    }

    if (!testCaseKey) {
      for (const candidateTitle of candidateTitles) {
        const manifestCandidate = manifestByNormalizedTitle.get(normalizeTitle(candidateTitle));
        if (!manifestCandidate) {
          continue;
        }
        const exists = await testCaseExists(client, manifestCandidate);
        if (exists) {
          testCaseKey = manifestCandidate;
          break;
        }
      }
    }

    if (!testCaseKey) {
      if (isExistingIssuePublication) {
        throw new Error(
          `Resolved no existing Zephyr test case for ${context.issue.key} ${sequenceTag}. ` +
            "Refusing to create a new test case in update mode to prevent duplicates."
        );
      }
      await context.preWriteRevalidation();
      const created = await createZephyrTestCase(client, {
        projectKey: context.projectKey,
        folderId: targetFolder.id,
        name: zephyrName,
        objective: buildObjective(context.issue, testCase.type),
        precondition: testCase.preconditions.join("\n"),
        labels: buildLabels(context.issue.key, testCase.priority)
      });
      testCaseKey = created.key;
      action = "created";
      createdCount += 1;
      for (const alias of [zephyrName, testCase.title, ...nameAliases]) {
        linkedByNormalizedTitle.set(normalizeTitle(alias), testCaseKey);
        manifestByNormalizedTitle.set(normalizeTitle(alias), testCaseKey);
      }
      linkedBySequenceTag.set(sequenceTag, testCaseKey);
      manifestBySequenceTag.set(sequenceTag, testCaseKey);
    } else {
      reusedCount += 1;
      for (const alias of [zephyrName, testCase.title, ...nameAliases]) {
        manifestByNormalizedTitle.set(normalizeTitle(alias), testCaseKey);
      }
      linkedBySequenceTag.set(sequenceTag, testCaseKey);
      manifestBySequenceTag.set(sequenceTag, testCaseKey);

      await context.preWriteRevalidation();
      await synchronizeReusedTestCaseMetadata(client, {
        testCaseKey,
        desiredName: zephyrName,
        objective: buildObjective(context.issue, testCase.type),
        precondition: testCase.preconditions.join("\n"),
        labels: buildLabels(context.issue.key, testCase.priority),
        folderId: targetFolder.id
      });
    }

    await context.preWriteRevalidation();
    try {
      await client.overwriteTestSteps(testCaseKey, stepsPayload);
    } catch (error) {
      if (!isTestCaseNotFoundError(error)) {
        throw error;
      }

      if (isExistingIssuePublication) {
        throw new Error(
          `Resolved Zephyr test case ${testCaseKey} for ${context.issue.key} ${sequenceTag} was not found while updating steps. ` +
            "Refusing to recreate in update mode to prevent duplicates."
        );
      }

      await context.preWriteRevalidation();
      const recreated = await createZephyrTestCase(client, {
        projectKey: context.projectKey,
        folderId: targetFolder.id,
        name: zephyrName,
        objective: buildObjective(context.issue, testCase.type),
        precondition: testCase.preconditions.join("\n"),
        labels: buildLabels(context.issue.key, testCase.priority)
      });

      testCaseKey = recreated.key;
      if (action === "reused") {
        reusedCount -= 1;
      }
      action = "created";
      createdCount += 1;

      for (const alias of [zephyrName, testCase.title, ...nameAliases]) {
        linkedByNormalizedTitle.set(normalizeTitle(alias), testCaseKey);
        manifestByNormalizedTitle.set(normalizeTitle(alias), testCaseKey);
      }
      linkedBySequenceTag.set(sequenceTag, testCaseKey);
      manifestBySequenceTag.set(sequenceTag, testCaseKey);

      await context.preWriteRevalidation();
      await client.overwriteTestSteps(testCaseKey, stepsPayload);
    }

    if (!existingLinkedSet.has(testCaseKey)) {
      await context.preWriteRevalidation();
      try {
        await client.createTestCaseIssueLink(testCaseKey, issueId);
      } catch (error) {
        if (!isAlreadyLinkedIssueError(error)) {
          throw error;
        }
      }
      existingLinkedSet.add(testCaseKey);
    }

    publishedItems.push({
      sourceTitle: testCase.title,
      zephyrName,
      testCaseKey,
      action
    });
  }

  return {
    existingLinkedTestCases,
    publishedItems,
    createdCount,
    reusedCount,
    skippedUnmappedCount,
    targetFolderId: targetFolder.id,
    targetFolderPath: targetFolder.path
  };
}

function buildSequenceTag(sequence: number): string {
  return `TC${String(sequence).padStart(3, "0")}`;
}

interface FolderResolutionContext {
  projectKey: string;
  rootFolderName: string;
  issueKey: string;
  preWriteRevalidation: () => Promise<void>;
}

interface ResolvedFolder {
  id: number;
  path: string;
}

async function ensureIssueFolder(client: ZephyrScaleClient, context: FolderResolutionContext): Promise<ResolvedFolder> {
  const folders = await client.listFolders(context.projectKey, TEST_CASE_FOLDER_TYPE);

  const rootFolder = await ensureFolder(client, folders, {
    projectKey: context.projectKey,
    name: context.rootFolderName,
    parentId: null,
    preWriteRevalidation: context.preWriteRevalidation
  });
  const issueFolder = await ensureFolder(client, folders, {
    projectKey: context.projectKey,
    name: context.issueKey,
    parentId: rootFolder.id,
    preWriteRevalidation: context.preWriteRevalidation
  });

  return {
    id: issueFolder.id,
    path: `${rootFolder.name}/${issueFolder.name}`
  };
}

interface EnsureFolderInput {
  projectKey: string;
  name: string;
  parentId: number | null;
  preWriteRevalidation: () => Promise<void>;
}

async function ensureFolder(
  client: ZephyrScaleClient,
  folders: ZephyrFolder[],
  input: EnsureFolderInput
): Promise<ZephyrFolder> {
  const existing = findFolder(folders, input.name, input.parentId);
  if (existing) {
    return existing;
  }

  await input.preWriteRevalidation();
  try {
    const created = await client.createFolder({
      projectKey: input.projectKey,
      folderType: TEST_CASE_FOLDER_TYPE,
      name: input.name,
      ...(input.parentId !== null ? { parentId: input.parentId } : {})
    });

    if (typeof created.id === "number") {
      const createdFolder: ZephyrFolder = {
        id: created.id,
        name: input.name,
        parentId: input.parentId,
        projectKey: input.projectKey,
        folderType: TEST_CASE_FOLDER_TYPE
      };
      folders.push(createdFolder);
      return createdFolder;
    }

    const refreshed = await client.listFolders(input.projectKey, TEST_CASE_FOLDER_TYPE);
    const byName = findFolder(refreshed, input.name, input.parentId);
    if (byName) {
      folders.splice(0, folders.length, ...refreshed);
      return byName;
    }

    throw new Error(`Zephyr did not return a folder id when creating "${input.name}".`);
  } catch (error) {
    if (error instanceof ZephyrApiError && (error.status === 400 || error.status === 409)) {
      const refreshed = await client.listFolders(input.projectKey, TEST_CASE_FOLDER_TYPE);
      const concurrent = findFolder(refreshed, input.name, input.parentId);
      if (concurrent) {
        folders.splice(0, folders.length, ...refreshed);
        return concurrent;
      }
    }
    throw error;
  }
}

function findFolder(folders: ZephyrFolder[], name: string, parentId: number | null): ZephyrFolder | undefined {
  const normalizedName = normalizeFolderName(name);
  return folders.find((folder) => {
    return normalizeFolderName(folder.name) === normalizedName && normalizeParentId(folder.parentId) === parentId;
  });
}

function normalizeFolderName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeParentId(parentId: number | null | undefined): number | null {
  return typeof parentId === "number" ? parentId : null;
}

function parseIssueId(issueId: string): number {
  const parsed = Number(issueId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Jira issue id "${issueId}" is not a valid numeric value for Zephyr issue linking.`);
  }
  return parsed;
}

function buildObjective(issue: JiraIssue, testType: string): string {
  const summary = issue.fields.summary ?? issue.key;
  return `Generated from ${issue.key}: ${summary} | Test Type: ${testType}`;
}

function buildLabels(issueKey: string, priority: string): string[] {
  const base = [
    "ai_generated",
    "milestone2",
    `jira_${sanitizeLabel(issueKey.toLowerCase())}`,
    `priority_${sanitizeLabel(priority.toLowerCase())}`
  ];

  return Array.from(new Set(base)).filter((label) => label.length > 0).slice(0, 50);
}

function sanitizeLabel(input: string): string {
  return input.replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildCandidateTitles(
  issueKey: string,
  sequence: number,
  sourceTitle: string,
  zephyrName: string
): string[] {
  return [sourceTitle, zephyrName, ...buildNameAliases(issueKey, sequence)];
}

function findByCandidateTitles(lookup: Map<string, string>, titles: string[]): string | undefined {
  for (const title of titles) {
    const matched = lookup.get(normalizeTitle(title));
    if (matched) {
      return matched;
    }
  }
  return undefined;
}

function buildZephyrTestCaseName(issueKey: string, sequence: number, sourceTitle: string): string {
  const prefix = buildLegacyName(issueKey, sequence);
  const compactTitle = sourceTitle.replace(/\s+/g, " ").trim();
  const composite = compactTitle.length > 0 ? `${prefix} ${compactTitle}` : prefix;
  return composite.slice(0, 255);
}

function buildLegacyName(issueKey: string, sequence: number): string {
  return `[${issueKey}][TC${String(sequence).padStart(3, "0")}]`;
}

function buildDashedLegacyName(issueKey: string, sequence: number): string {
  return `${issueKey}-TC${String(sequence).padStart(3, "0")}`;
}

function buildNameAliases(issueKey: string, sequence: number): string[] {
  return [buildLegacyName(issueKey, sequence), buildDashedLegacyName(issueKey, sequence)];
}

interface LinkedLookup {
  byNormalizedTitle: Map<string, string>;
  bySequenceTag: Map<string, string>;
}

async function buildLinkedLookup(
  client: ZephyrScaleClient,
  issueKey: string,
  testCaseKeys: string[]
): Promise<LinkedLookup> {
  const byNormalizedTitle = new Map<string, string>();
  const bySequenceTag = new Map<string, string>();
  for (const key of testCaseKeys) {
    try {
      const testCase = await client.getTestCase(key);
      const normalizedTitle = normalizeTitle(testCase.name);
      if (!normalizedTitle) continue;
      if (!byNormalizedTitle.has(normalizedTitle)) {
        byNormalizedTitle.set(normalizedTitle, testCase.key);
      }
      const sequenceTag = extractSequenceTag(issueKey, testCase.name);
      if (sequenceTag && !bySequenceTag.has(sequenceTag)) {
        bySequenceTag.set(sequenceTag, testCase.key);
      }
    } catch {
      // Keep publish resilient when an existing linked key cannot be resolved.
    }
  }
  return {
    byNormalizedTitle,
    bySequenceTag
  };
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeLabels(labels: string[]): string[] {
  return Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let idx = 0; idx < left.length; idx += 1) {
    if (left[idx] !== right[idx]) {
      return false;
    }
  }
  return true;
}

function extractSequenceTag(issueKey: string, title: string): string | undefined {
  const escapedIssue = escapeRegex(issueKey);
  const bracketed = new RegExp(`\\[${escapedIssue}\\]\\[TC-?(\\d{1,3})\\]`, "i").exec(title);
  if (bracketed && bracketed[1]) {
    return toCanonicalSequenceTag(bracketed[1]);
  }

  const dashed = new RegExp(`${escapedIssue}-TC-?(\\d{1,3})\\b`, "i").exec(title);
  if (dashed && dashed[1]) {
    return toCanonicalSequenceTag(dashed[1]);
  }

  return undefined;
}

function toCanonicalSequenceTag(rawDigits: string): string | undefined {
  const parsed = Number(rawDigits);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return `TC${String(parsed).padStart(3, "0")}`;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CreateZephyrTestCaseInput {
  projectKey: string;
  folderId: number;
  name: string;
  objective: string;
  precondition: string;
  labels: string[];
}

interface ReusedTestCaseMetadataInput {
  testCaseKey: string;
  desiredName: string;
  objective: string;
  precondition: string;
  labels: string[];
  folderId: number;
}

async function synchronizeReusedTestCaseMetadata(
  client: ZephyrScaleClient,
  input: ReusedTestCaseMetadataInput
): Promise<void> {
  const current = await client.getTestCase(input.testCaseKey);

  const currentName = collapseWhitespace(current.name);
  const desiredName = collapseWhitespace(input.desiredName);
  const currentObjective = (current.objective ?? "").trim();
  const desiredObjective = input.objective.trim();
  const currentPrecondition = (current.precondition ?? "").trim();
  const desiredPrecondition = input.precondition.trim();
  const currentLabels = normalizeLabels(current.labels ?? []);
  const desiredLabels = normalizeLabels(input.labels);
  const currentFolderId = current.folder?.id;

  const requiresUpdate =
    currentName !== desiredName ||
    currentObjective !== desiredObjective ||
    currentPrecondition !== desiredPrecondition ||
    !areStringArraysEqual(currentLabels, desiredLabels) ||
    currentFolderId !== input.folderId;

  if (!requiresUpdate) {
    return;
  }

  const updatePayload: ZephyrTestCase = {
    ...current,
    name: input.desiredName,
    objective: input.objective,
    precondition: input.precondition,
    labels: input.labels,
    folder: { id: input.folderId }
  };
  await client.updateTestCase(input.testCaseKey, updatePayload);
}

async function createZephyrTestCase(
  client: ZephyrScaleClient,
  input: CreateZephyrTestCaseInput
): Promise<{ key: string }> {
  const created = await client.createTestCase(input);
  const createdKey = created.key?.trim();
  if (!createdKey) {
    throw new Error(`Zephyr returned no test case key for "${input.name}".`);
  }
  return { key: createdKey };
}

async function testCaseExists(client: ZephyrScaleClient, testCaseKey: string): Promise<boolean> {
  try {
    await client.getTestCase(testCaseKey);
    return true;
  } catch (error) {
    if (error instanceof ZephyrApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

function isTestCaseNotFoundError(error: unknown): boolean {
  return error instanceof ZephyrApiError && error.status === 404;
}

function isAlreadyLinkedIssueError(error: unknown): boolean {
  if (!(error instanceof ZephyrApiError)) {
    return false;
  }
  if (error.status !== 400) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("already has a coverage link");
}

