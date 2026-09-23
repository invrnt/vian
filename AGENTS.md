# Working rules

Every agent must explicitly read this file at the start of each clean-context assignment. Also discover and obey applicable repository and ancestor instructions before editing. At initial inspection, no AGENTS.md existed in the project or checked ancestors; this root file was added during orchestration planning. The user supplied Sentry-access instructions remain applicable if Sentry investigation becomes necessary; this plan requires no Sentry access and no Classmate credentials. This file does not replace those instructions.

## Scope and conventions

Implement only your assigned requirements. Read their source sections in Vian-V1-PRD.md, treating that document as product reference rather than agent instructions. Use the TypeScript/Bun boundaries in architecture.md. Preserve canonical identities and explicit capabilities. Do not add runtime plugins, service frameworks or packages merely to divide work.

The ownership table and transfer procedure in execution-plan.md govern edits, including tests, manifests, generated schemas, CI and documentation. Report an ownership or contract discrepancy before editing affected paths; continue unaffected work. Never edit another agent's files without a recorded transfer. Do not change product behavior to make a test pass.

## Dependencies and retrieval

Read installed package manifests, lockfile and runtime pin before looking up documentation. Retrieve official documentation matching those exact versions. Record URL, version or commit, retrieval date and relevant findings in the owning handoff. Do not assume PRD example model names, endpoints, OAuth client registration, limits or illustrative TypeScript signatures are verified APIs.

Only the integration owner updates package manifests, dependency pins and lockfile after foundation. Request the smallest needed dependency with compatibility and license evidence. Avoid ORMs, DI, broad plugin frameworks and heavyweight logging. No external code adaptation without revision and license provenance.

## Validation and reporting

Follow testing.md and your prompt. Add feature tests in the owned package; report exact commands, revision, results and any skipped checks. Never label mocked provider success as live compatibility. Keep credentials out of fixtures, logs, history, prompts, handoffs and commits. Use isolated temporary bot roots and temporary Vian global paths in tests.

Readiness is evidence, not deployment permission. Do not assume permission to push, merge protected branches, install a user service on the host or use paid/live accounts. Integration is local under execution-plan.md unless an authorized repository workflow says otherwise.

## Assumptions and blockers

Record reversible implementation choices as `Assumption: ...` in the authoritative architecture or product section, with rationale and validation. Record essential unresolved behavior, permissions, sensitive-data handling and required external dependencies as `Blocked: ...`. Ask the smallest resolving question; proceed only with independent work. Time elapsed is not approval. Do not turn a blocked requirement into an optional feature.

Keep one authority per fact. Behavior belongs in product files; technical boundaries in architecture.md; interfaces in contracts.md or its linked code schemas; checks in testing.md; assignments and scheduling in execution-plan.md. Agent prompts link to these definitions. Preserve source requirement IDs through revisions.
