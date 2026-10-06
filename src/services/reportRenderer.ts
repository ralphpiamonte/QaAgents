import type { QaOutput } from "../schemas/qaOutput";
import type { JiraIssue } from "../types/jira";

export function renderMilestone1Report(issue: JiraIssue, issueType: "Story" | "Bug", analysis: QaOutput): string {
  const lines: string[] = [];

  lines.push(`Issue: ${issue.key} (${issueType})`);
  lines.push("");

  lines.push("1. Jira issue summary");
  lines.push(analysis.jiraIssueSummary);
  lines.push("");

  lines.push("2. Requirement/bug analysis");
  lines.push(...formatList(analysis.requirementOrBugAnalysis));
  lines.push("");

  lines.push("3. Missing information");
  lines.push(...formatListOrNone(analysis.missingInformation));
  lines.push("");

  lines.push("4. Ambiguities");
  lines.push(...formatListOrNone(analysis.ambiguities));
  lines.push("");

  lines.push("5. Risks");
  lines.push(...formatListOrNone(analysis.risks));
  lines.push("");

  lines.push("6. Dependencies");
  lines.push(...formatListOrNone(analysis.dependencies));
  lines.push("");

  lines.push("7. Clarification questions");
  lines.push(...formatListOrNone(analysis.clarificationQuestions));
  lines.push("");

  lines.push("8. Recommended test scenarios");
  lines.push(...formatList(analysis.recommendedTestScenarios));
  lines.push("");

  lines.push("9. Detailed test cases");
  analysis.detailedTestCases.forEach((tc, index) => {
    lines.push(`${index + 1}) ${tc.title} [${tc.priority} | ${tc.type}]`);
    if (tc.preconditions.length > 0) {
      lines.push("   Preconditions:");
      lines.push(...tc.preconditions.map((p) => `   - ${p}`));
    }
    lines.push("   Steps:");
    tc.steps.forEach((step, stepIndex) => {
      lines.push(`   ${stepIndex + 1}. Action: ${step.action}`);
      lines.push(`      Expected: ${step.expected}`);
    });
  });
  lines.push("");

  lines.push("10. Regression considerations");
  lines.push(...formatListOrNone(analysis.regressionConsiderations));
  lines.push("");

  return lines.join("\n");
}

function formatList(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function formatListOrNone(items: string[]): string[] {
  if (items.length === 0) {
    return ["- None identified"];
  }
  return formatList(items);
}

