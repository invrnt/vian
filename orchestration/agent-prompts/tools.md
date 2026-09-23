# Tools and attachments

## Mission

Implement trusted native/MCP capabilities and opaque attachment lifecycle.

## First read

- `AGENTS.md`, explicitly, plus applicable repository/ancestor instructions.
- `orchestration/execution-plan.md`, Work table row T, Dependency DAG and readiness, Ownership transfers and extensions, Isolation and integration procedure, and assigned Requirement traceability rows.
- `orchestration/architecture.md`, Dependency direction; Data ownership and transactions; Boundaries and reuse.
- `orchestration/contracts.md`, C03,C06.
- `orchestration/product/tools-attachments.md`, all requirements.
- `orchestration/product/identity-history.md`, V013,V014.
- `orchestration/product/providers.md`, V029.
- `orchestration/testing.md`, T04.
- `Vian-V1-PRD.md`, §§15–17,24.5,25.4,40–42,49.2–49.5,49.8,51–52.

## Retrieve first

Read pinned Bun dynamic-import/module cache behavior, pinned JSON Schema validator documentation and official MCP transport/tool docs at https://modelcontextprotocol.io/docs. If @ai-sdk/mcp is selected, use its exact-version official docs at https://ai-sdk.dev/docs. Request new dependencies through F.

## Starting conditions

S integrated and C03/C06 frozen. Verify compiled arbitrary-root tool probe from F and execution/attachment port contracts. Runtime may still be under construction.

## Owned paths

Tool/MCP packages and hello/attachment examples, excluding package manifests.

The authoritative ownership is execution-plan.md row T and its transfer rules. Edit only that assignment, including colocated tests; manifests/lockfile and other shared paths follow their named owner. Report ownership or contract discrepancies before editing affected files; continue unaffected work.

## Deliver

Load and validate explicit native tools, schemas, context, audit policy and duplicate names. Implement safe executor/error/abort boundary and atomic reload including local imports. Implement explicit stdio MCP allowlisting and child lifecycle. Implement attachment storage/hash/size/expiry, model-safe handles and ID-based list/send ports. Supply hello and attachment examples. Requirements and primary/supporting accountability are the T rows of the traceability table; source-linked acceptance criteria remain authoritative.

## Constraints

No plugin framework or sandbox. Do not expose host paths or unauthorized attachment handles to model. SQL/migrations stay S-owned; daemon maintenance invocation stays R/O-owned. Do not add unrequested HTTP MCP or transcription.

## Required validation

T04 with real temporary files and fake MCP server; tool import/reload in compiled binary. Coordinate generated report round trip with R/G using fixtures. Use commands established in testing.md and report exact results rather than assumed success.

## Handoff and definition of done

Report public tool/attachment compatibility, cleanup hooks, process shutdown behavior, examples and checks. Unlock real-tool fake slice and O; identify provider/Gate boundary checks still pending. Include changed paths/interfaces, tests and validation output summary, remaining assumptions/blockers, and the revision needed by downstream owners.
