# Milestone 3 Execution Onboarding Template

Use this one-page template to provide the minimum context needed for real test execution (not just test design).

## 1) Scope

- Jira issue key:
- Feature/module:
- In scope:
- Out of scope:
- Release target (date/version):
- Definition of done for this issue:

## 2) Environments

| Environment | URL | Build/Version | Notes |
| --- | --- | --- | --- |
| QA |  |  |  |
| UAT |  |  |  |
| Staging |  |  |  |

- Required VPN/network setup:
- Allowed test window:

## 3) Access And Roles

| Role | Username | Auth Type | Permissions Needed |
| --- | --- | --- | --- |
| Admin |  |  |  |
| Standard User |  |  |  |
| Restricted User |  |  |  |

- MFA/SSO constraints:
- Secrets owner/contact:

## 4) Test Data Contract

- Required seed data:
- Data reset method:
- Data refresh frequency:
- Known data limitations:

| Data Scenario | Input Data | Expected Output |
| --- | --- | --- |
| Happy path |  |  |
| Negative path |  |  |
| Boundary path |  |  |

## 5) Oracle (How We Decide Pass/Fail)

- Source of truth for expected behavior (PRD/AC/Confluence/Jira comments):
- Exact toast/message texts to validate:
- API/DB fields that must match UI:
- Tolerance rules (timing/retry/eventual consistency):
- Non-functional thresholds (if any):

## 6) Priority Execution Pack

List the first cases that must run before broad regression.

| Priority | Test Case ID/Title | Why Critical | Owner |
| --- | --- | --- | --- |
| P0 |  |  |  |
| P0 |  |  |  |
| P1 |  |  |  |

## 7) Evidence Requirements

- Required screenshots:
- Required logs/network traces:
- Required API payload captures:
- Where evidence is stored:
- Zephyr result status mapping (`Pass/Fail/Blocked`):

## 8) Defect Workflow

- Defect project/key prefix:
- Severity rules:
- What blocks release:
- Re-test SLA:
- Escalation contacts:

## 9) Execution Sign-off

| Item | Owner | Status |
| --- | --- | --- |
| Environment validated |  |  |
| Test data ready |  |  |
| Access verified |  |  |
| Oracle approved by BA/PO |  |  |
| Ready for Milestone 3 execution |  |  |

## 10) Quick Start Checklist

- [ ] Jira AC and scope are final.
- [ ] Environment URL and build are confirmed.
- [ ] At least one valid account per required role exists.
- [ ] Seed data and reset process are available.
- [ ] Pass/fail oracle is explicit and testable.
- [ ] Evidence requirements are agreed.
- [ ] Critical P0 test pack is approved.
