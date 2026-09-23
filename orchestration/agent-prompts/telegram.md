# Telegram Gate

## Mission

Implement Telegram as an adapter to canonical runtime contracts.

## First read

- `AGENTS.md`, explicitly, plus applicable repository/ancestor instructions.
- `orchestration/execution-plan.md`, Work table row G, Dependency DAG and readiness, Ownership transfers and extensions, Isolation and integration procedure, and assigned Requirement traceability rows.
- `orchestration/architecture.md`, Dependency direction; Boundaries and reuse.
- `orchestration/contracts.md`, C02,C04,C06.
- `orchestration/product/telegram.md`, all requirements and External evidence and policy.
- `orchestration/product/identity-history.md`, V010,V011,V018,V019 and Product decisions.
- `orchestration/product/tools-attachments.md`, V024.
- `orchestration/testing.md`, T06.
- `Vian-V1-PRD.md`, §§18–24,34–35,42–46,49.6,70–71.

## Retrieve first

Retrieve exact pinned grammY docs at https://grammy.dev and current official https://core.telegram.org/bots/api plus https://core.telegram.org/api/bots/ai. Verify draft/stop update fields, sender identity, lifetime/chat eligibility, file/message/callback limits and retry signals. Record API version/date. Use a tiny direct helper only for confirmed gaps in pinned grammY.

## Starting conditions

F integrated and C02/C04/C06 frozen. Runtime/storage implementations are not needed; use contract fixtures. Read user-approved group/ambiguous-send rules before transport controls.

## Owned paths

Telegram package and its tests/fixtures, excluding its manifest.

The authoritative ownership is execution-plan.md row G and its transfer rules. Edit only that assignment, including colocated tests; manifests/lockfile and other shared paths follow their named owner. Report ownership or contract discrepancies before editing affected files; continue unaffected work.

## Deliver

Implement long polling and durable-ingestion acknowledgment handoff, normalized inbound events, MarkdownV2 renderer/chunking/plain fallback, media, replies/topics, native drafts/stop and slash command normalization. Expose Telegram-only button tool with durable opaque action storage via ports and prompt ACK. Implement delivery receipts/classification and flood-window behavior. Requirements and primary/supporting accountability are the G rows of the traceability table; source-linked acceptance criteria remain authoritative.

## Constraints

No canonical session or authorization ownership in Gate. Never trust usernames/client callback mapping, expose reasoning or auto-retry an ambiguous send. Do not invent API methods or claim a stop event is authorized without reliable actor/correlation. No rich-message scope expansion.

## Required validation

T06 deterministic HTTP boundary fixtures and golden renderer cases, then authorized live sandbox. Coordinate T03 duplicate/callback/overlapping delivery cases through shared fixtures without editing runtime paths. Use commands established in testing.md and report exact results rather than assumed success.

## Handoff and definition of done

Report verified API shapes/limits, renderer/draft/stop/callback evidence, live versus blocked results and known platform restrictions. Unlock O; retain adapter ownership until H. Include changed paths/interfaces, tests and validation output summary, remaining assumptions/blockers, and the revision needed by downstream owners.
