import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ZephyrManifestItem {
  title: string;
  normalizedTitle: string;
  testCaseKey: string;
  lastAction: "created" | "reused";
  updatedAt: string;
}

interface ZephyrManifestIssue {
  issueKey: string;
  projectKey: string;
  updatedAt: string;
  items: ZephyrManifestItem[];
}

interface ZephyrPublishManifest {
  version: 1;
  updatedAt: string;
  issues: Record<string, ZephyrManifestIssue>;
}

export interface ManifestEntryInput {
  title: string;
  testCaseKey: string;
  action: "created" | "reused";
}

export async function readZephyrPublishManifest(
  manifestPath: string
): Promise<ZephyrPublishManifest> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ZephyrPublishManifest>;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || typeof parsed.issues !== "object") {
      return emptyManifest();
    }
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      issues: parsed.issues ?? {}
    };
  } catch {
    return emptyManifest();
  }
}

export async function writeZephyrPublishManifest(
  manifest: ZephyrPublishManifest,
  manifestPath: string
): Promise<string> {
  const dir = path.dirname(manifestPath);
  await mkdir(dir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

export function getIssueManifestEntries(
  manifest: ZephyrPublishManifest,
  issueKey: string
): Array<{ title: string; testCaseKey: string }> {
  const issue = manifest.issues[issueKey];
  if (!issue) return [];
  const byLookupTitle = new Map<string, { title: string; testCaseKey: string }>();
  issue.items.forEach((item) => {
    buildManifestLookupTitles(issueKey, item.title).forEach((lookupTitle) => {
      const normalizedLookup = normalizeTitle(lookupTitle);
      if (!normalizedLookup || byLookupTitle.has(normalizedLookup)) {
        return;
      }
      byLookupTitle.set(normalizedLookup, {
        title: lookupTitle,
        testCaseKey: item.testCaseKey
      });
    });
  });
  return Array.from(byLookupTitle.values());
}

export function upsertIssueManifestEntries(
  manifest: ZephyrPublishManifest,
  issueKey: string,
  projectKey: string,
  entries: ManifestEntryInput[]
): ZephyrPublishManifest {
  const now = new Date().toISOString();
  const current = manifest.issues[issueKey];
  const byCanonicalKey = new Map<string, ZephyrManifestItem>();
  const incomingByCanonicalKey = new Map<string, ManifestEntryInput>();

  entries.forEach((entry) => {
    const normalizedTitle = normalizeTitle(entry.title);
    if (!normalizedTitle) return;
    incomingByCanonicalKey.set(canonicalManifestKey(issueKey, entry.title), entry);
  });

  const incomingSequenceKeys = new Set(
    Array.from(incomingByCanonicalKey.keys()).filter((key) => key.startsWith("sequence:"))
  );
  const shouldPruneMissingSequenceKeys = entries.length > 0;

  (current?.items ?? []).forEach((item) => {
    const normalizedTitle = normalizeTitle(item.title);
    if (!normalizedTitle) {
      return;
    }
    const normalizedItem: ZephyrManifestItem = {
      ...item,
      normalizedTitle
    };
    const canonicalKey = canonicalManifestKey(issueKey, item.title);
    if (
      shouldPruneMissingSequenceKeys &&
      canonicalKey.startsWith("sequence:") &&
      !incomingSequenceKeys.has(canonicalKey)
    ) {
      return;
    }
    const existing = byCanonicalKey.get(canonicalKey);
    if (!existing || isManifestItemNewer(normalizedItem, existing)) {
      byCanonicalKey.set(canonicalKey, normalizedItem);
    }
  });

  incomingByCanonicalKey.forEach((entry, canonicalKey) => {
    const normalizedTitle = normalizeTitle(entry.title);
    byCanonicalKey.set(canonicalKey, {
      title: entry.title,
      normalizedTitle,
      testCaseKey: entry.testCaseKey,
      lastAction: entry.action,
      updatedAt: now
    });
  });

  const updatedIssue: ZephyrManifestIssue = {
    issueKey,
    projectKey,
    updatedAt: now,
    items: Array.from(byCanonicalKey.values()).sort((a, b) => compareManifestItems(issueKey, a, b))
  };

  return {
    ...manifest,
    version: 1,
    updatedAt: now,
    issues: {
      ...manifest.issues,
      [issueKey]: updatedIssue
    }
  };
}

function emptyManifest(): ZephyrPublishManifest {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    issues: {}
  };
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function canonicalManifestKey(issueKey: string, title: string): string {
  const sequenceTag = extractSequenceTag(issueKey, title);
  if (sequenceTag) {
    return `sequence:${sequenceTag}`;
  }
  return `title:${normalizeTitle(title)}`;
}

function compareManifestItems(issueKey: string, a: ZephyrManifestItem, b: ZephyrManifestItem): number {
  const aSeq = extractSequenceTag(issueKey, a.title);
  const bSeq = extractSequenceTag(issueKey, b.title);
  if (aSeq && bSeq && aSeq !== bSeq) {
    return aSeq.localeCompare(bSeq, undefined, { numeric: true });
  }
  if (aSeq && !bSeq) return -1;
  if (!aSeq && bSeq) return 1;
  return a.title.localeCompare(b.title);
}

function isManifestItemNewer(a: ZephyrManifestItem, b: ZephyrManifestItem): boolean {
  return parseUpdatedAt(a.updatedAt) >= parseUpdatedAt(b.updatedAt);
}

function parseUpdatedAt(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildManifestLookupTitles(issueKey: string, title: string): string[] {
  const titles = [title];
  const sequenceTag = extractSequenceTag(issueKey, title);
  if (sequenceTag) {
    const normalizedIssue = issueKey.toUpperCase();
    titles.push(`[${normalizedIssue}][${sequenceTag}]`);
    titles.push(`${normalizedIssue}-${sequenceTag}`);
  }
  return Array.from(new Set(titles));
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

