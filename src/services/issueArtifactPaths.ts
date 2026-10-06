import path from "node:path";

export function sanitizeIssueKey(issueKey: string): string {
  return issueKey.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function getIssueReportsDir(issueKey: string): string {
  return path.join("reports", sanitizeIssueKey(issueKey));
}

export function getIssueManifestPath(issueKey: string): string {
  return path.join(getIssueReportsDir(issueKey), `${sanitizeIssueKey(issueKey)}.manifest.json`);
}

export function getLegacyIssueManifestPath(issueKey: string): string {
  return path.join(getIssueReportsDir(issueKey), "zephyr-publish-manifest.json");
}
