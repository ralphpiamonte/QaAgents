import { access } from "node:fs/promises";
import { loadEnv } from "../config/env";
import { AuditLogger } from "../services/auditLogger";
import { enforceIssueEligibility } from "../services/eligibility";
import { getIssueManifestPath, getLegacyIssueManifestPath } from "../services/issueArtifactPaths";
import { JiraClient } from "../services/jiraClient";
import { writeReportArtifacts } from "../services/reportArtifacts";
import { renderQaReviewSummary, validateGeneratedTestCases } from "../services/qaReviewValidator";
import { renderMilestone1Report } from "../services/reportRenderer";
import { SeniorQaAnalyzer } from "../services/seniorQaAnalyzer";
import { normalizeQaOutputTitles } from "../services/testCaseTitleNormalizer";
import { publishToZephyrScaleCloud } from "../services/zephyrPublisher";
import {
  getIssueManifestEntries,
  readZephyrPublishManifest,
  upsertIssueManifestEntries,
  writeZephyrPublishManifest
} from "../services/zephyrPublishManifest";
import { ZephyrScaleClient } from "../services/zephyrScaleClient";

export interface Milestone1Options {
  mode: "dry-run" | "approve";
  publishToZephyr: boolean;
}

export async function runMilestone1(issueKey: string, options: Milestone1Options): Promise<void> {
  const env = loadEnv();
  const zephyrApiToken = env.ZEPHYR_SCALE_API_TOKEN;
  if (options.publishToZephyr) {
    if (options.mode !== "approve") {
      throw new Error("Zephyr publish requires --approve mode.");
    }
    if (!zephyrApiToken) {
      throw new Error("ZEPHYR_SCALE_API_TOKEN is required when --publish-zephyr is enabled.");
    }
  }

  const logger = new AuditLogger(env.AUDIT_LOG_PATH);
  const jira = new JiraClient({
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN
  });
  const analyzer = (() => {
    if (env.AI_PROVIDER === "azure") {
      return new SeniorQaAnalyzer({
        provider: "azure",
        endpoint: env.AZURE_OPENAI_ENDPOINT,
        apiKey: env.AZURE_OPENAI_API_KEY,
        apiVersion: env.OPENAI_API_VERSION,
        deployment: env.AZURE_OPENAI_DEPLOYMENT
      });
    }

    if (env.AI_PROVIDER === "azure_apim") {
      return new SeniorQaAnalyzer({
        provider: "azure_apim",
        baseUrl: env.AZURE_APIM_BASE_URL,
        subscriptionKey: env.AZURE_APIM_SUBSCRIPTION_KEY,
        bearerToken: env.AZURE_APIM_BEARER_TOKEN,
        model: env.OPENAI_MODEL,
        ...(env.AZURE_APIM_SUPPLIER ? { supplierHeader: env.AZURE_APIM_SUPPLIER } : {})
      });
    }

    return new SeniorQaAnalyzer({
      provider: "openai",
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL
    });
  })();

  await logger.log({
    event: "milestone1_started",
    issueKey,
    details: {
      mode: options.mode,
      publishToZephyr: options.publishToZephyr
    }
  });

  const currentUser = await jira.getCurrentUser();
  const issue = await jira.getJiraIssue(issueKey);
  const eligibility = enforceIssueEligibility(issue, currentUser);

  await logger.log({
    event: "eligibility_passed",
    issueKey,
    details: {
      issueType: eligibility.normalizedIssueType,
      assignee: issue.fields.assignee?.displayName ?? issue.fields.assignee?.accountId
    }
  });

  const comments = await jira.getJiraComments(issueKey);
  const attachments = await jira.getJiraAttachments(issueKey);
  const linkedIssues = await jira.getLinkedIssues(issueKey);

  const generatedAnalysis = await analyzer.analyze({
    issue,
    issueType: eligibility.normalizedIssueType,
    comments,
    attachments,
    linkedIssues
  });
  const analysis = normalizeQaOutputTitles(generatedAnalysis);

  await logger.log({
    event: "analysis_generated",
    issueKey,
    details: {
      scenarios: analysis.recommendedTestScenarios.length,
      testCases: analysis.detailedTestCases.length
    }
  });

  const review = validateGeneratedTestCases(analysis);
  const reviewSummary = renderQaReviewSummary(review);

  await logger.log({
    event: "qa_review_completed",
    issueKey,
    details: {
      highFindings: review.issueCounts.high,
      mediumFindings: review.issueCounts.medium,
      lowFindings: review.issueCounts.low,
      hasBlockingIssues: review.hasBlockingIssues
    }
  });

  const reportBody = renderMilestone1Report(issue, eligibility.normalizedIssueType, analysis);
  let zephyrSummaryLine = "- Zephyr write requested: No";

  if (options.publishToZephyr) {
    if (review.hasBlockingIssues) {
      throw new Error("Cannot publish to Zephyr because deterministic QA review has blocking findings.");
    }

    const projectKey = (env.ZEPHYR_SCALE_PROJECT_KEY ?? issueKey.split("-")[0] ?? "").toUpperCase();
    if (!projectKey) {
      throw new Error("Unable to resolve Zephyr project key. Set ZEPHYR_SCALE_PROJECT_KEY.");
    }

    const issueManifestPath = getIssueManifestPath(issueKey);
    const legacyManifestPath = getLegacyIssueManifestPath(issueKey);
    const manifestReadPath =
      (await pathExists(issueManifestPath)) || !(await pathExists(legacyManifestPath))
        ? issueManifestPath
        : legacyManifestPath;
    const manifest = await readZephyrPublishManifest(manifestReadPath);
    const previousManifestItems = getIssueManifestEntries(manifest, issueKey);

    const zephyr = new ZephyrScaleClient({
      baseUrl: env.ZEPHYR_SCALE_BASE_URL,
      apiToken: zephyrApiToken ?? ""
    });

    const publishResult = await publishToZephyrScaleCloud(zephyr, {
      issue,
      analysis,
      projectKey,
      rootFolderName: env.ZEPHYR_SCALE_ROOT_FOLDER_NAME,
      previousManifestItems,
      preWriteRevalidation: async () => {
        const latestUser = await jira.getCurrentUser();
        const latestIssue = await jira.getJiraIssue(issueKey);
        enforceIssueEligibility(latestIssue, latestUser);
      }
    });

    const nextManifest = upsertIssueManifestEntries(
      manifest,
      issueKey,
      projectKey,
      publishResult.publishedItems.map((item) => ({
        title: item.zephyrName,
        testCaseKey: item.testCaseKey,
        action: item.action
      }))
    );
    const manifestPath = await writeZephyrPublishManifest(nextManifest, issueManifestPath);

    await logger.log({
      event: "zephyr_publish_completed",
      issueKey,
      details: {
        zephyrProjectKey: projectKey,
        created: publishResult.createdCount,
        reused: publishResult.reusedCount,
        skippedUnmapped: publishResult.skippedUnmappedCount,
        folderId: publishResult.targetFolderId,
        folderPath: publishResult.targetFolderPath,
        preexistingLinks: publishResult.existingLinkedTestCases.length,
        manifestPath
      }
    });

    zephyrSummaryLine = `- Zephyr write requested: Yes (created ${publishResult.createdCount}, reused ${publishResult.reusedCount}, skipped-unmapped ${publishResult.skippedUnmappedCount} in ${projectKey}; folder ${publishResult.targetFolderPath})`;
  }

  const runtimeSummaryLines = [
    "Runtime Mode",
    `- Mode: ${options.mode}`,
    `- Human approved: ${options.mode === "approve" ? "Yes" : "No"}`,
    zephyrSummaryLine
  ];

  if (options.mode === "approve") {
    const recheckUser = await jira.getCurrentUser();
    const recheckIssue = await jira.getJiraIssue(issueKey);
    enforceIssueEligibility(recheckIssue, recheckUser);

    await logger.log({
      event: "approval_revalidated",
      issueKey,
      details: {
        assignee: recheckIssue.fields.assignee?.displayName ?? recheckIssue.fields.assignee?.accountId
      }
    });
  }

  const fullReport = [reportBody, reviewSummary, "", ...runtimeSummaryLines, ""].join("\n");
  console.log(fullReport);

  const artifacts = await writeReportArtifacts({
    issueKey,
    issueType: eligibility.normalizedIssueType,
    mode: options.mode,
    approved: options.mode === "approve",
    reportText: fullReport,
    qaOutput: analysis,
    review
  });

  console.log(`Saved JSON report: ${artifacts.jsonPath}`);
  console.log(`Saved Markdown report: ${artifacts.markdownPath}`);

  await logger.log({
    event: "report_artifacts_saved",
    issueKey,
    details: {
      jsonPath: artifacts.jsonPath,
      markdownPath: artifacts.markdownPath
    }
  });

  await logger.log({ event: "milestone1_completed", issueKey });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

