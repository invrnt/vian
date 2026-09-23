# Runtime and canonical sessions

## Mission

Implement the canonical execution engine and durable recovery against fake adapters.

## First read

- `AGENTS.md`, explicitly, plus applicable repository/ancestor instructions.
- `orchestration/execution-plan.md`, Work table row R, Dependency DAG and readiness, Ownership transfers and extensions, Isolation and integration procedure, and assigned Requirement traceability rows.
- `orchestration/architecture.md`, Proposed structure; Dependency direction; Data ownership and transactions; Boundaries and reuse.
- `orchestration/contracts.md`, C02–C09.
- `orchestration/product/identity-history.md`, all requirements and Product decisions.
- `orchestration/product/platform.md`, V006,V008.
- `orchestration/product/operations.md`, V037,V038.
- `orchestration/testing.md`, T03 and runtime parts of T04–T06.
- `Vian-V1-PRD.md`, §§14,18–19,21–28,33–34,38,40,43–47,59–61,67–68.

## Retrieve first

Read exact pinned AI SDK stream/tool-loop, cancellation, tool-result and context conversion docs at https://ai-sdk.dev/docs. Read established storage/ports/fakes first. No Telegram or OAuth implementation documentation is needed to execute canonical behavior.

## Starting conditions

S integrated; C02–C09 stable; F transfers packages/testing/. T/P/G implementations are not required; use conformance fakes. The user-approved V044 steering default and /new ordering are authoritative; verify C09 SDK support before implementation.

## Owned paths

Runtime, integration tests and transferred testing fakes, excluding manifests; transfer runtime/integration tests to O when finished.

The authoritative ownership is execution-plan.md row R and its transfer rules. Edit only that assignment, including colocated tests; manifests/lockfile and other shared paths follow their named owner. Report ownership or contract discrepancies before editing affected files; continue unaffected work.

## Deliver

Implement V044 safe steering and reset barriers, with explicit queue compatibility. Implement authorization/pairing/control permissions, canonical routing, leases/inbox scheduling, context summaries, AI SDK loop, safe tool handling and transactional audit. Implement outbox/recovery, ambiguous holds, lifecycle/control and shutdown ports. Extend fake Gate/provider and golden transcript suite. Provide access command service exports for O and ephemeral test support. Demonstrate core vertical path with fixtures, then O combines actual C/T modules. Requirements and primary/supporting accountability are the R rows of the traceability table; source-linked acceptance criteria remain authoritative.

## Constraints

Never bypass storage transactions or derive canonical identities from raw Gate IDs. Do not auto-replay started tools or ambiguous deliveries. No concrete adapter internals or new product reset/steering semantics. Never expose hidden reasoning.

## Required validation

T03 all ten mandatory concurrency cases, golden transcripts and invariant checks. Fault-inject process death, duplicate events, partial streams, cancellation, authorization changes and held sends. Test unrelated bots continue. Use commands established in testing.md and report exact results rather than assumed success.

## Handoff and definition of done

Report state-machine transitions, first-slice evidence, known integration hooks and all blockers. Unlock O, then explicitly transfer runtime/testing integration paths as the plan specifies; retain no concurrent edit ownership after transfer. Include changed paths/interfaces, tests and validation output summary, remaining assumptions/blockers, and the revision needed by downstream owners.
