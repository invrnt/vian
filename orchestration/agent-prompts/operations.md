# Operations and product assembly

## Mission

Assemble the verified components into the complete CLI/daemon product and operating documentation.

## First read

- `AGENTS.md`, explicitly, plus applicable repository/ancestor instructions.
- `orchestration/execution-plan.md`, Work table row O, Dependency DAG and readiness, Ownership transfers and extensions, Isolation and integration procedure, and assigned Requirement traceability rows.
- `orchestration/architecture.md`, all sections.
- `orchestration/contracts.md`, C01,C07 and authority links for C02–C06.
- `orchestration/product/operations.md`, V037–V042.
- `orchestration/product/platform.md`, V003,V007–V009.
- `orchestration/product/identity-history.md`, V011,V018,V019 and Product decisions.
- `orchestration/testing.md`, T03,T07.
- `Vian-V1-PRD.md`, §§7–8,11,26,36–41,47–58,63,67.

## Retrieve first

Read established command/lifecycle exports first. Retrieve systemd user unit documentation matching the test host at https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html and pinned Bun standalone/platform documentation. Use supported provider probe exports; do not invent cheap auth endpoints.

## Starting conditions

C/T/R/P/G integrated, required product decisions resolved, and F/R path transfers recorded. All required adapters must exist. Live checks may be blocked on environments and must be reported as such.

## Owned paths

Transferred CLI dispatcher/runtime/integration tests, operational command modules, docs/root README, end-to-end tests and benchmarks.

The authoritative ownership is execution-plan.md row O and its transfer rules. Edit only that assignment, including colocated tests; manifests/lockfile and other shared paths follow their named owner. Report ownership or contract discrepancies before editing affected files; continue unaffected work.

## Deliver

First combine init → real storage → fake Gate/provider → real native tool → audit/delivery → history. Then wire live adapters and daemon entrypoint. Implement runtime/access/service commands, local test, status/logs/follow/enable/disable, full doctor online hooks and init load notification. Add graceful shutdown/reload, maintenance invocation and safe diagnostics for ambiguous deliveries. Write user/tool/Gate/security docs and validate examples. Measure budgets and install artifact. Requirements and primary/supporting accountability are the O rows of the traceability table; source-linked acceptance criteria remain authoritative.

## Constraints

Do not modify concrete adapters, storage schemas or tools without ownership transfer. Request shared manifests/CI changes through F. Never silently bypass missing OAuth or turn readiness into deployment. Service tests use disposable environment, not the user host without authorization.

## Required validation

T03 full fake vertical slice; T07 combined control/restart/service/resource/CLI checks; exact source command matrix and docs examples. Record live environment blocks explicitly. Use commands established in testing.md and report exact results rather than assumed success.

## Handoff and definition of done

Report combined verified revision, command matrix, measured budgets, docs and release blockers. After O integration and all prior owners finish, transfer implementation ownership to H. Include changed paths/interfaces, tests and validation output summary, remaining assumptions/blockers, and the revision needed by downstream owners.
