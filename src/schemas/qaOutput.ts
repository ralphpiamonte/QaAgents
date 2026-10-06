import { z } from "zod";

const StepSchema = z.object({
  action: z.string().min(1),
  expected: z.string().min(1)
});

const TestCaseSchema = z.object({
  title: z.string().min(1),
  priority: z.enum(["Critical", "High", "Medium", "Low"]),
  type: z.string().min(1),
  preconditions: z.array(z.string().min(1)).default([]),
  steps: z.array(StepSchema).min(1)
});

export const QaOutputSchema = z.object({
  jiraIssueSummary: z.string().min(1),
  requirementOrBugAnalysis: z.array(z.string().min(1)).min(1),
  missingInformation: z.array(z.string().min(1)),
  ambiguities: z.array(z.string().min(1)),
  risks: z.array(z.string().min(1)),
  dependencies: z.array(z.string().min(1)),
  clarificationQuestions: z.array(z.string().min(1)),
  recommendedTestScenarios: z.array(z.string().min(1)).min(1),
  detailedTestCases: z.array(TestCaseSchema).min(1),
  regressionConsiderations: z.array(z.string().min(1))
});

export type QaOutput = z.infer<typeof QaOutputSchema>;
export type StructuredTestCase = z.infer<typeof TestCaseSchema>;

