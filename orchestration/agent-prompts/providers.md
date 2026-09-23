# Providers and credential ownership

## Mission

Deliver all three provider adapters and safe global subscription credentials.

## First read

- `AGENTS.md`, explicitly, plus applicable repository/ancestor instructions.
- `orchestration/execution-plan.md`, Work table row P, Dependency DAG and readiness, Ownership transfers and extensions, Isolation and integration procedure, and assigned Requirement traceability rows.
- `orchestration/architecture.md`, Dependency direction; Data ownership and transactions; Boundaries and reuse.
- `orchestration/contracts.md`, C01,C05,C06.
- `orchestration/product/providers.md`, all requirements and External dependency status.
- `orchestration/product/platform.md`, V003,V007.
- `orchestration/testing.md`, T05.
- `Vian-V1-PRD.md`, §§17.4,25.5,28–32,36.10,47,49.3,69–71.

## Retrieve first

Retrieve exact pinned AI SDK Google/Gateway docs from https://ai-sdk.dev/docs and provider official docs. For subscription auth use official OpenAI Codex documentation and applicable openai-docs skill; verify a supported client/redirect/transport arrangement. If consulting PRD §71 OpenClaw/Hermes references, pin source commit and inspect license before adaptation. Do not infer general API access from identity sign-in.

## Starting conditions

F integrated and C01/C05/C06 stable. Resolve external OAuth contract blocker before implementing real transport; implement deterministic profile/refresh fixtures and Google/Gateway independently. Live secrets are not supplied by this plan.

## Owned paths

Three provider packages, shared credentials package and CLI auth module, excluding manifests.

The authoritative ownership is execution-plan.md row P and its transfer rules. Edit only that assignment, including colocated tests; manifests/lockfile and other shared paths follow their named owner. Report ownership or contract discrepancies before editing affected files; continue unaffected work.

## Deliver

Implement static Google/Gateway adapters and isolated subscription transport. Add per-bot secret resolution, global profile owner with cross-process refresh coordination, atomic token sink, terminal re-auth state and redaction. Implement auth command module and safe metadata. Normalize streams/tools/media/errors; supply online doctor probe exports where a cheap supported probe exists. Requirements and primary/supporting accountability are the P rows of the traceability table; source-linked acceptance criteria remain authoritative.

## Constraints

Keep generic environment/profile file handling in packages/credentials/, without subscription payload interpretation. No reuse of personal external credential stores or unsupported OAuth clients. Do not leak subscription headers/shapes to runtime/core. Request manifest changes through F. No arbitrary model-ID hardcoding or retry of started side effects.

## Required validation

T05 offline contract fixtures plus authorized live smoke when available. Record model/API/package versions and distinguish mocked success from live access. Scan captured outputs with canary secrets. Use commands established in testing.md and report exact results rather than assumed success.

## Handoff and definition of done

Report supported external auth contract/provenance, profile persistence behavior, live versus blocked evidence and auth module exports. O is not ready until all required provider implementations are integrated; unresolved required OAuth stays release-blocking. Include changed paths/interfaces, tests and validation output summary, remaining assumptions/blockers, and the revision needed by downstream owners.
