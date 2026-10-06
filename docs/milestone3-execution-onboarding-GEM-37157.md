# Milestone 3 Execution Onboarding - GEM-37157

Pre-filled from generated QA analysis and Zephyr publish output.

## 1) Scope

- Jira issue key: `GEM-37157`
- Feature/module: FE - Catalog Import - Spectacle Lens
- In scope:
  - Import confirmation flow toast behavior (loading/success/failure)
  - Import interaction lock (checkboxes + Select All disabled during import)
  - Post-import visibility in Settings > Ordering > Catalog > Spectacle Lens
  - Post-import row state in import section (greyed out, non-selectable, selected)
  - Product Category filter/search visibility for imported Spectacle Lens rows
- Out of scope:
  - Backend-only validation beyond UI/API-observable outcomes
  - Undefined marketability/invoice source rules (reference not provided)
- Release target (date/version): `TBD`
- Definition of done for this issue: `TBD (confirm with PO/BA)`

## 2) Environments

| Environment | URL | Build/Version | Notes |
| --- | --- | --- | --- |
| QA | `TBD` | `TBD` | Primary execution target |
| UAT | `TBD` | `TBD` | Optional validation |
| Staging | `TBD` | `TBD` | Optional pre-release check |

- Required VPN/network setup: `TBD`
- Allowed test window: `TBD`

## 3) Access And Roles

| Role | Username | Auth Type | Permissions Needed |
| --- | --- | --- | --- |
| Admin | `TBD` | `TBD` | Access to import + catalog screens |
| Standard User | `TBD` | `TBD` | Import + visibility checks |
| Restricted User | `TBD` | `TBD` | Negative permission checks (if required) |

- MFA/SSO constraints: `TBD`
- Secrets owner/contact: `TBD`

## 4) Test Data Contract

- Required seed data:
  - Selectable Spectacle Lens records for successful import
  - Data set that forces import failure path
  - Data variation for pricing visibility outcomes (all priced / partially priced / none priced), if UI exposes pricing fields
- Data reset method: `TBD`
- Data refresh frequency: `TBD`
- Known data limitations:
  - Partial success behavior not defined
  - Loading toast exact text not defined

| Data Scenario | Input Data | Expected Output |
| --- | --- | --- |
| Happy path | Selectable Spectacle Lens records + success backend response | Success toast + records visible in Catalog + rows greyed/selected |
| Negative path | Import request mapped to failure backend response | Failure toast + controls re-enabled + no false catalog addition |
| Boundary path | Multi-record import selection | Single import execution + lock during processing + correct post-state |

## 5) Oracle (How We Decide Pass/Fail)

- Source of truth for expected behavior:
  - Jira `GEM-37157` story
  - Dependency stories: `GEM-35253` (BE), `GEM-35700` (Catalog table behavior)
- Exact toast/message texts to validate:
  - Success: `Spectacle Lens imported successfully`
  - Failure: `Spectacle Lens catalog import failed.`
  - Loading: `TBD` (exact text not provided)
- API/DB fields that must match UI: `TBD` (confirm whether execution is UI-only or UI+API)
- Tolerance rules (timing/retry/eventual consistency): `TBD`
- Non-functional thresholds (if any): `TBD`

## 6) Priority Execution Pack

| Priority | Test Case ID/Title | Why Critical | Owner |
| --- | --- | --- | --- |
| P0 | `GEM-T63939` - `[GEM-37157][TC001] Successful Spectacle Lens import...` | Primary business success outcome | `TBD` |
| P0 | `GEM-T63940` - `[GEM-37157][TC002] Failed Spectacle Lens import...` | Failure handling + recovery safety | `TBD` |
| P1 | `GEM-T63941` - `[GEM-37157][TC003] Toast dismiss control behavior...` | UX + state consistency | `TBD` |
| P1 | `GEM-T63942` - `[GEM-37157][TC004] Catalog filter/search...` | Discoverability in catalog | `TBD` |
| P1 | `GEM-T63943` - `[GEM-37157][TC005] Import lock boundary...` | Concurrency/state integrity | `TBD` |

## 7) Evidence Requirements

- Required screenshots:
  - Loading toast + disabled controls
  - Success toast + catalog visibility
  - Failure toast + controls re-enabled
  - Import section showing greyed + selected imported rows
- Required logs/network traces: `TBD`
- Required API payload captures: `TBD`
- Where evidence is stored: `reports/GEM-37157/` + Zephyr attachments (`TBD final location policy`)
- Zephyr result status mapping (`Pass/Fail/Blocked`): `TBD`

## 8) Defect Workflow

- Defect project/key prefix: `TBD`
- Severity rules: `TBD`
- What blocks release:
  - Any P0 failure in `GEM-T63939` or `GEM-T63940`
  - Any unresolved import lock defect causing unusable flow
- Re-test SLA: `TBD`
- Escalation contacts: `TBD`

## 9) Execution Sign-off

| Item | Owner | Status |
| --- | --- | --- |
| Environment validated | `TBD` | Not started |
| Test data ready | `TBD` | Not started |
| Access verified | `TBD` | Not started |
| Oracle approved by BA/PO | `TBD` | Not started |
| Ready for Milestone 3 execution | `TBD` | Not started |

## 10) Quick Start Checklist

- [x] Jira scope and candidate test pack identified.
- [x] Zephyr test cases created and linked (`GEM-T63939` to `GEM-T63943`).
- [ ] Environment URL and build are confirmed.
- [ ] At least one valid account per required role exists.
- [ ] Seed data and reset process are available.
- [ ] Loading toast exact text + timing rules are confirmed.
- [ ] Evidence requirements are agreed with stakeholders.
