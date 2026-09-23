# Local CLI

## Mission

Deliver non-destructive bot initialization and fast offline local commands.

## First read

- `AGENTS.md`, explicitly, plus applicable repository/ancestor instructions.
- `orchestration/execution-plan.md`, Work table row C, Dependency DAG and readiness, Ownership transfers and extensions, Isolation and integration procedure, and assigned Requirement traceability rows.
- `orchestration/architecture.md`, Verified baseline; Proposed structure; Dependency direction.
- `orchestration/contracts.md`, C01,C03,C06,C07.
- `orchestration/product/platform.md`, V003,V004,V007,V009 and Scope interpretation.
- `orchestration/product/providers.md`, V029.
- `orchestration/product/identity-history.md`, V044 and Product decisions, for init defaults.
- `orchestration/testing.md`, T02,T07.
- `Vian-V1-PRD.md`, §§10–13,26,32,36.1–36.4,36.6–36.8,37.

## Retrieve first

Read pinned Bun filesystem/SQLite documentation and established CLI module/config/storage APIs. Use no network documentation for ordinary local operations. Tool import validation calls the established tool port; retrieve pinned validator docs only if needed.

## Starting conditions

S integrated; stable command, storage, tool-validation and load-notification contracts. Real tool/provider/control implementations are not prerequisites; use contract fixtures for these boundaries.

## Owned paths

Local command modules, initialization templates and their tests; dispatcher wiring stays with F.

The authoritative ownership is execution-plan.md row C and its transfer rules. Edit only that assignment, including colocated tests; manifests/lockfile and other shared paths follow their named owner. Report ownership or contract discrepancies before editing affected files; continue unaffected work.

## Deliver

Implement init/create/register/unregister/list/inspect/sessions/history/offline doctor in local modules and templates. Preserve user files, env comments/values and gitignore, register absolute path, handle move/clone and show missing bots. Export scripted output and all source history filters. Init queues safe daemon load request when available; O validates combined path. Requirements and primary/supporting accountability are the C rows of the traceability table; source-linked acceptance criteria remain authoritative.

## Constraints

Do not edit dispatcher, auth/operations commands, storage SQL, manifests or lockfile. Ask F to wire command exports. Keep local reads offline and avoid SDK/provider imports. No destructive deletion command.

## Required validation

T02 byte preservation, repeated init, interrupted writes, offline behavior and all filters/diagnostics. Give O measurable command fixtures for T07 latency and online doctor completion. Use commands established in testing.md and report exact results rather than assumed success.

## Handoff and definition of done

Report exact CLI forms, module exports, tested fixtures, commands/results and remaining integration hooks. Unlock O and the fake vertical slice; do not claim online doctor verification from fakes. Include changed paths/interfaces, tests and validation output summary, remaining assumptions/blockers, and the revision needed by downstream owners.
