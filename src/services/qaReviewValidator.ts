import type { QaOutput } from "../schemas/qaOutput";

export type ReviewSeverity = "high" | "medium" | "low";

export interface ReviewIssue {
  severity: ReviewSeverity;
  category:
    | "duplicate_title"
    | "duplicate_steps"
    | "missing_preconditions"
    | "missing_expected_result"
    | "vague_expected_result"
    | "vague_action";
  testCaseTitle: string;
  stepNumber?: number;
  message: string;
}

export interface QaReviewResult {
  issues: ReviewIssue[];
  totalTestCases: number;
  totalSteps: number;
  issueCounts: Record<ReviewSeverity, number>;
  hasBlockingIssues: boolean;
}

const VAGUE_PATTERNS = [
  /\b(as expected|works?|working|properly|correctly|successful(ly)?|appropriate)\b/i,
  /\b(ok|okay|fine|good)\b/i,
  /\betc\.?\b/i
];

export function validateGeneratedTestCases(output: QaOutput): QaReviewResult {
  const issues: ReviewIssue[] = [];

  const titleMap = new Map<string, string[]>();
  const stepSignatureMap = new Map<string, string[]>();
  let totalSteps = 0;

  output.detailedTestCases.forEach((testCase) => {
    const normalizedTitle = normalizeForMatch(testCase.title);
    const titleList = titleMap.get(normalizedTitle) ?? [];
    titleList.push(testCase.title);
    titleMap.set(normalizedTitle, titleList);

    if (testCase.preconditions.length === 0) {
      issues.push({
        severity: "low",
        category: "missing_preconditions",
        testCaseTitle: testCase.title,
        message: "Test case has no preconditions. Confirm if this is intentional."
      });
    }

    const signatureParts: string[] = [];
    testCase.steps.forEach((step, index) => {
      totalSteps += 1;

      const action = step.action.trim();
      const expected = step.expected.trim();
      signatureParts.push(`${normalizeForMatch(action)}=>${normalizeForMatch(expected)}`);

      if (expected.length < 5) {
        issues.push({
          severity: "high",
          category: "missing_expected_result",
          testCaseTitle: testCase.title,
          stepNumber: index + 1,
          message: "Expected result is too short to be verifiable."
        });
      }

      if (isVague(expected)) {
        issues.push({
          severity: "medium",
          category: "vague_expected_result",
          testCaseTitle: testCase.title,
          stepNumber: index + 1,
          message: "Expected result wording is vague; make it measurable."
        });
      }

      if (isVague(action)) {
        issues.push({
          severity: "low",
          category: "vague_action",
          testCaseTitle: testCase.title,
          stepNumber: index + 1,
          message: "Action wording is vague; add concrete user/system action."
        });
      }
    });

    const signature = signatureParts.join("|");
    const casesWithSameSignature = stepSignatureMap.get(signature) ?? [];
    casesWithSameSignature.push(testCase.title);
    stepSignatureMap.set(signature, casesWithSameSignature);
  });

  for (const [_, titles] of titleMap.entries()) {
    if (titles.length > 1) {
      titles.forEach((title) => {
        issues.push({
          severity: "high",
          category: "duplicate_title",
          testCaseTitle: title,
          message: `Duplicate test title detected (${titles.length} matches).`
        });
      });
    }
  }

  for (const [_, titles] of stepSignatureMap.entries()) {
    if (titles.length > 1) {
      titles.forEach((title) => {
        issues.push({
          severity: "medium",
          category: "duplicate_steps",
          testCaseTitle: title,
          message: `Another test case has identical step/action flow (${titles.length} matches).`
        });
      });
    }
  }

  const issueCounts = issues.reduce<Record<ReviewSeverity, number>>(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );

  return {
    issues,
    totalTestCases: output.detailedTestCases.length,
    totalSteps,
    issueCounts,
    hasBlockingIssues: issueCounts.high > 0
  };
}

export function renderQaReviewSummary(review: QaReviewResult): string {
  const lines: string[] = [];
  lines.push("QA Review Summary");
  lines.push(`- Total test cases: ${review.totalTestCases}`);
  lines.push(`- Total steps: ${review.totalSteps}`);
  lines.push(`- High findings: ${review.issueCounts.high}`);
  lines.push(`- Medium findings: ${review.issueCounts.medium}`);
  lines.push(`- Low findings: ${review.issueCounts.low}`);
  lines.push(`- Blocking findings present: ${review.hasBlockingIssues ? "Yes" : "No"}`);

  if (review.issues.length === 0) {
    lines.push("- No deterministic quality issues found.");
    return lines.join("\n");
  }

  lines.push("- Findings:");
  review.issues.forEach((issue, idx) => {
    const stepPart = issue.stepNumber ? ` step ${issue.stepNumber}` : "";
    lines.push(
      `  ${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.category} | ${issue.testCaseTitle}${stepPart} | ${issue.message}`
    );
  });

  return lines.join("\n");
}

function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isVague(input: string): boolean {
  const normalized = input.trim();
  if (normalized.length === 0) return true;
  if (normalized.length <= 4) return true;
  return VAGUE_PATTERNS.some((pattern) => pattern.test(normalized));
}

