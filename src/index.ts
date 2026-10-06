import { runMilestone1, type Milestone1Options } from "./workflows/milestone1";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const issueKey = args.find((arg) => !arg.startsWith("--"))?.trim();

  const hasApprove = args.includes("--approve");
  const hasDryRun = args.includes("--dry-run");
  const hasPublishZephyr = args.includes("--publish-zephyr");

  if (!issueKey) {
    console.error("Usage: npm run dev -- <JIRA_ISSUE_KEY> [--dry-run | --approve] [--publish-zephyr]");
    process.exit(1);
  }

  if (hasApprove && hasDryRun) {
    console.error("Use only one mode flag: --dry-run or --approve.");
    process.exit(1);
  }

  if (hasPublishZephyr && !hasApprove) {
    console.error("Zephyr publishing requires --approve.");
    process.exit(1);
  }

  const options: Milestone1Options = {
    mode: hasApprove ? "approve" : "dry-run",
    publishToZephyr: hasPublishZephyr
  };

  await runMilestone1(issueKey, options);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error("Unknown error occurred.");
  }
  process.exit(1);
});

