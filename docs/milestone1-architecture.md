# Milestone 1 + Milestone 2 Scaffold Architecture

## Goal

Given a Jira issue key (for example `ABC-123`), generate a Senior QA analysis report only if:

- issue type is Story/User Story/Bug
- issue is assigned to the authenticated Jira user

By default, no Zephyr write operations are performed.
Zephyr writes are enabled only with explicit `--approve --publish-zephyr`.

## Components

1. `src/index.ts`
   - CLI entrypoint
   - receives issue key argument
2. `src/config/env.ts`
   - validates required configuration using Zod
   - supports `AI_PROVIDER=openai|azure|azure_apim`
3. `src/services/jiraClient.ts`
   - Jira integration layer
   - fetches current user + issue + comments + links
4. `src/services/eligibility.ts`
   - hard guardrails:
     - issue type whitelist
     - assignee must match authenticated user
5. `src/services/seniorQaAnalyzer.ts`
   - calls OpenAI, Azure OpenAI, or Azure APIM proxy model
   - requests strict JSON output
   - validates structure with Zod schema
6. `src/schemas/qaOutput.ts`
   - strict output schema for analysis + test cases
7. `src/services/reportRenderer.ts`
   - prints required 10-section report
8. `src/services/qaReviewValidator.ts`
   - deterministic QA checks:
     - duplicate titles
     - duplicate step flows
     - missing/weak expected results
     - missing preconditions
     - vague step wording
9. `src/services/reportArtifacts.ts`
   - saves `reports/<issue>.analysis.json` and `.md`
10. `src/services/auditLogger.ts`
   - writes structured audit events to local log file
11. `src/services/zephyrScaleClient.ts`
   - Zephyr Scale Cloud API integration (`/testcases`, `/teststeps`, `/links/issues`)
12. `src/services/zephyrPublisher.ts`
   - maps validated test cases into Zephyr entities
   - revalidation callback invoked before each write call
13. `src/services/zephyrPublishManifest.ts`
   - tracks created/reused Zephyr test case keys per Jira issue
   - supports idempotent reruns
14. `src/workflows/milestone1.ts`
   - orchestrates full end-to-end flow
15. `src/tools/cleanupZephyrDuplicates.ts`
   - safe duplicate identification utility
   - optional archive/unlink actions behind explicit `--execute`

## Runtime Flow

1. Load and validate environment.
2. Authenticate to Jira (`/myself`).
3. Retrieve issue by key.
4. Enforce assignee + issue type checks.
5. Collect supporting context (comments, attachments, links).
6. Run Senior QA analysis.
7. Validate output schema.
8. Run deterministic QA review checks.
9. Save JSON + Markdown report artifacts.
10. If `--approve` is set, revalidate assignee.
11. If `--approve --publish-zephyr` is set:
    - revalidate assignee before each Zephyr write
    - create test cases in Zephyr Scale Cloud
    - apply naming convention `<JIRA_ISSUE_KEY>-TC### <headline>`
    - overwrite test steps
    - link each test case back to Jira issue
    - update publish manifest for idempotent reruns
12. Print analysis report.
13. Write audit log events.

## Guardrail behavior

- If issue type is not Story/User Story/Bug: stop.
- If issue assignee is not authenticated Jira user: stop.
- If any schema validation fails: stop.
- If Jira/OpenAI call fails: stop.
- If Zephyr publish is requested without explicit approval: stop.
- If assignee changes during Zephyr publish flow: stop before next Zephyr write call.
- If deterministic QA review has blocking findings: stop before publish.

