# Agentic AI Senior QA Analyst (Milestone 1 + Milestone 2 Scaffold)

[![Status: Active](https://img.shields.io/badge/status-active-brightgreen)](https://github.com/ralphpiamonte/QaAgents)

Automates Jira story QA analysis, Zephyr test-case publish/update flows, and safe duplicate cleanup with guardrails.

Current implementation provides:

- Input Jira key (for example `ABC-123`)
- Fetch Jira issue and current authenticated Jira user
- Enforce programmatic scope guardrails:
  - issue type must be `Story`/`User Story`/`Bug`
  - issue assignee must be the authenticated Jira user
- Generate Senior QA analysis and test design output
- Print the 10 requested output sections
- Run deterministic QA quality review checks
- Save report artifacts under `reports/<ISSUE_KEY>/`
- Write audit log entries locally
- Optional Zephyr Scale Cloud publishing with explicit approval gate
- Idempotent Zephyr publish behavior with update-only protection for previously published issues
- Deterministic test case title grammar normalization before review/publish

## 1) Project setup

```bash
cp .env.example .env
```

Fill `.env` values with your credentials.

For Azure APIM proxy setups (like enterprise `base_url + subscription-key`), set:

- `AI_PROVIDER=azure_apim`
- `AZURE_APIM_BASE_URL`
- `AZURE_APIM_SUBSCRIPTION_KEY`
- `AZURE_APIM_BEARER_TOKEN` (usually `do-not-change-this-value`)
- `AZURE_APIM_SUPPLIER` (if required by your org gateway)
- `OPENAI_MODEL` (your org model id/alias)

For direct Azure OpenAI setups, set:

- `AI_PROVIDER=azure`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `OPENAI_API_VERSION`
- `AZURE_OPENAI_DEPLOYMENT`

For Zephyr Scale Cloud publishing, set:

- `ZEPHYR_SCALE_BASE_URL` (default: `https://api.zephyrscale.smartbear.com/v2`)
- `ZEPHYR_SCALE_API_TOKEN`
- `ZEPHYR_SCALE_PROJECT_KEY` (optional; defaults to Jira issue key prefix)
- `ZEPHYR_SCALE_ROOT_FOLDER_NAME` (optional; defaults to `Ordering _ Integrated UI`)

## 2) Run in dev mode

```bash
npm run dev -- ABC-123
```

Mode and publish options:

- `--dry-run` (default): analysis + review + report artifact files, no publish action.
- `--approve`: records human approval intent and revalidates assignee.
- `--publish-zephyr`: Zephyr Scale Cloud writes (requires `--approve`).

Examples:

```bash
npm run dev -- ABC-123 --dry-run
npm run dev -- ABC-123 --approve
npm run dev -- ABC-123 --approve --publish-zephyr
npm run publish:zephyr -- ABC-123
npm run qa:dry -- ABC-123
npm run qa:publish -- ABC-123
npm run qa:cleanup -- ABC-123
```

If PowerShell blocks `npm.ps1`, run:

```bash
npm.cmd run dev -- ABC-123
npm.cmd run qa:dry -- ABC-123
npm.cmd run qa:publish -- ABC-123
npm.cmd run qa:cleanup -- ABC-123
```

Expected successful flow:

1. Jira issue is retrieved.
2. Assignee + issue type guardrail checks pass.
3. Analysis report is printed with sections 1-10.
4. Deterministic QA review checks are printed.
5. Report files are saved to `reports/<ISSUE_KEY>/<ISSUE_KEY>.analysis.json` and `.md`.
6. If `--approve --publish-zephyr` is used, test cases are created in Zephyr Scale, placed in `<root folder>/<issue key>`, and linked to the Jira issue.
7. Audit entries are appended to `logs/audit.log`.
8. Publish manifest is updated at `reports/<ISSUE_KEY>/<ISSUE_KEY>.manifest.json`.

If the issue is not assigned to you or is not Story/Bug, the process stops before analysis.

## 3) Build and run compiled output

```bash
npm run build
npm start -- ABC-123
```

## 4) Zephyr Scale Cloud publish behavior

- Publishing is never automatic by default.
- It requires explicit `--approve --publish-zephyr`.
- Assignee eligibility is revalidated before each Zephyr write call.
- If reassigned during processing, publish stops.
- Reruns reuse existing linked test cases (and prior manifest entries) to avoid duplicate creation.
- Publish manifest entries are canonicalized by test sequence (`TC###`) to prevent duplicate manifest rows from headline/title variations.
- For issues that already have linked/manifested test cases, publish runs in update mode and refuses to create new test cases (fails fast instead of creating duplicates).
- For already-published issues, any newly generated sequence without an existing mapping (for example `TC006` when only `TC001..TC005` exist) is skipped rather than created.
- Created Zephyr test case names follow: `[<JIRA_ISSUE_KEY>][TC###] <headline>` (example: `[GEM-37158][TC001] Eligible org can see...`).
- Folder placement is dynamic: ensure/use `<ZEPHYR_SCALE_ROOT_FOLDER_NAME>/<JIRA_ISSUE_KEY>` and assign generated test cases there.

## 5) Safe duplicate cleanup utility

Identify duplicates linked to a Jira issue (dry-run):

```bash
npm run cleanup:zephyr -- --issue GEM-37158
```

If `tsx` is blocked in your environment, use compiled cleanup:

```bash
npm run cleanup:zephyr:dist -- --issue GEM-37158
```

Identify duplicates from the Zephyr issue folder scope (recommended when folder view shows duplicates):

```bash
npm run cleanup:zephyr:dist -- --issue GEM-37158 --scope folder --folder-path "Ordering _ Integrated UI/GEM-37158" --mode identify --min-confidence 0.90
```

Set minimum confidence threshold (0 to 1, default 0.80):

```bash
npm run cleanup:zephyr -- --issue GEM-37158 --min-confidence 0.90
```

Write report to a custom path:

```bash
npm run cleanup:zephyr -- --issue GEM-37158 --output reports/GEM-37158/GEM-37158.cleanup.json
```

Archive duplicate test cases (safe state change, requires explicit execute):

```bash
npm run cleanup:zephyr:dist -- --issue GEM-37158 --scope folder --folder-path "Ordering _ Integrated UI/GEM-37158" --mode archive --archive-status Deprecated --min-confidence 0.90 --execute
```

Unlink duplicate test cases from the Jira issue (keeps test cases in Zephyr):

```bash
npm run cleanup:zephyr -- --issue GEM-37158 --mode unlink --execute
```

`--mode delete` is implemented as safe unlink, because Zephyr Scale Cloud does not provide a direct hard-delete test case endpoint in this integration flow.
Each run writes a JSON audit report (default: `reports/<ISSUE>/<ISSUE>.cleanup.json`).

## 6) Milestone 3 Execution Prep

Use the onboarding template to capture environment, data, oracle, and evidence requirements before running real test execution:

- `docs/milestone3-execution-onboarding-template.md`

## 7) Jira Auth Troubleshooting

Run this command to validate Jira API authentication from your `.env`:

```bash
npm.cmd run jira:auth-check
```

It checks:
- Jira site reachability (`/rest/api/3/serverInfo`)
- Jira API auth (`/rest/api/3/myself` with Basic auth)
- likely failure causes when `401` occurs

## 8) Automated Preflight + Run

Use these one-command flows to auto-check Jira auth first, then continue only when auth passes:

```bash
npm.cmd run qa:auto:dry -- ABC-123
npm.cmd run qa:auto:publish -- ABC-123
```

Behavior:
- Runs compiled build
- Runs Jira auth preflight
- Stops immediately if auth fails
- Runs dry-run or publish workflow only when preflight succeeds

