import type { JiraIssue, JiraUser } from "../types/jira";

const ALLOWED_ISSUE_TYPES = new Set(["story", "user story", "bug"]);

export interface EligibilityResult {
  normalizedIssueType: "Story" | "Bug";
}

export function enforceIssueEligibility(issue: JiraIssue, currentUser: JiraUser): EligibilityResult {
  const rawType = issue.fields.issuetype?.name?.trim().toLowerCase() ?? "";
  if (!ALLOWED_ISSUE_TYPES.has(rawType)) {
    throw new Error(
      `Issue ${issue.key} is type "${issue.fields.issuetype?.name ?? "Unknown"}". Only Story/User Story/Bug are allowed.`
    );
  }

  const assignee = issue.fields.assignee;
  if (!assignee) {
    throw new Error(`Issue ${issue.key} has no assignee. Processing stopped.`);
  }

  const matchesByAccountId =
    typeof currentUser.accountId === "string" &&
    typeof assignee.accountId === "string" &&
    currentUser.accountId === assignee.accountId;

  const matchesByEmail =
    typeof currentUser.emailAddress === "string" &&
    typeof assignee.emailAddress === "string" &&
    currentUser.emailAddress.toLowerCase() === assignee.emailAddress.toLowerCase();

  if (!matchesByAccountId && !matchesByEmail) {
    throw new Error(
      `Issue ${issue.key} is assigned to "${assignee.displayName ?? assignee.accountId ?? "another user"}", not the authenticated user.`
    );
  }

  return { normalizedIssueType: rawType === "bug" ? "Bug" : "Story" };
}

