# Storage

## Mission

Implement durable global registry and bot-local state APIs without transport-owned identity.

## First read

- `AGENTS.md`, explicitly, plus applicable repository/ancestor instructions.
- `orchestration/execution-plan.md`, Work table row S, Dependency DAG and readiness, Ownership transfers and extensions, Isolation and integration procedure, and assigned Requirement traceability rows.
- `orchestration/architecture.md`, Proposed structure; Dependency direction; Data ownership and transactions.
- `orchestration/contracts.md`, C01–C03,C06.
- `orchestration/product/platform.md`, V004,V005.
- `orchestration/product/identity-history.md`, V010–V015,V018–V019,V044 and Product decisions.
- `orchestration/product/tools-attachments.md`, V023–V025.
- `orchestration/testing.md`, T02,T03.
- `Vian-V1-PRD.md`, §§9–13,21–26,34,43,46,50–54.

## Retrieve first

Read Bun bun:sqlite documentation matching the pinned runtime and official SQLite documentation at https://www.sqlite.org/docs.html for WAL, transactions, backup and migration behavior. Read core code authorities established by F; no ORM documentation is needed.

## Starting conditions

F integrated; C01–C03/C06 available. Verify event/state/lease APIs cover consumers, including held ambiguous sends and persisted initiator/admin data.

## Owned paths

Storage implementation, SQL migrations and colocated tests, excluding its package manifest.

The authoritative ownership is execution-plan.md row S and its transfer rules. Edit only that assignment, including colocated tests; manifests/lockfile and other shared paths follow their named owner. Report ownership or contract discrepancies before editing affected files; continue unaffected work.

## Deliver

Implement registry operations and physical schemas/migrations behind C03. Implement transactional identity, inbox/lease/run/tool/event/outbox/summary/attachment APIs and bounded history reads. Preserve append-only audit and redaction metadata. Provide safe migration backup/restore and real SQLite fixtures. Requirements and primary/supporting accountability are the S rows of the traceability table; source-linked acceptance criteria remain authoritative.

## Constraints

No Telegram/provider dependencies or conversation data in global registry. Do not add consumer-specific SQL outside storage. Coordinate schema changes with F and consuming owners.

## Required validation

T02 storage cases and storage portions of T03: transaction rollback, duplicate ingestion, crash boundaries, migration/backup, ordering and concurrent writers. Tests use real temporary databases. Use commands established in testing.md and report exact results rather than assumed success.

## Handoff and definition of done

Report migration versions, transaction boundaries, recovery evidence and unresolved consumers. Verified S unlocks C/T/R; keep storage/migrations ownership until H. Include changed paths/interfaces, tests and validation output summary, remaining assumptions/blockers, and the revision needed by downstream owners.
