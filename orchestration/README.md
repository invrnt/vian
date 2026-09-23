# Vian implementation orchestration

This directory instructs future clean-context agents to implement Vian V1 from [the supplied PRD](../Vian-V1-PRD.md). It contains no application implementation. The repository baseline is recorded in [architecture.md](architecture.md#verified-baseline).

## Reading order

1. Read this README.
2. Explicitly load the root [AGENTS.md](../AGENTS.md).
3. Read your assigned file in [agent-prompts/](agent-prompts/).
4. Load only the documents and sections listed in that prompt. Follow source references for the assigned requirements, including examples and subordinate clauses.

## Document map

- Root [AGENTS.md](../AGENTS.md): global working rules.
- [architecture.md](architecture.md): baseline, proposed structure, dependency boundaries and technical decisions.
- [product/platform.md](product/platform.md), [product/identity-history.md](product/identity-history.md), [product/tools-attachments.md](product/tools-attachments.md), [product/providers.md](product/providers.md), [product/telegram.md](product/telegram.md), [product/operations.md](product/operations.md): requirement IDs, source clauses, acceptance criteria and product decisions.
- [contracts.md](contracts.md): shared interface boundaries and the procedure for replacing provisional definitions with code authorities.
- [testing.md](testing.md): verification requirements and evidence.
- [execution-plan.md](execution-plan.md): the sole authority for assignments, ownership, dependencies, capacity, integration and traceability.

The PRD is immutable source material. Product files normalize its requirements and reference all applicable source clauses without copying the PRD. Examples remain examples unless a source rule makes them normative. An acceptance checklist does not waive subordinate source requirements. Conflicts and open behavior choices are recorded in the relevant product file.

## Non-goals

This planning task does not implement application code, start implementation agents, create or merge implementation branches, install services, push, publish or deploy. Future implementation scope excludes the PRD's V1 non-goals. There is no GUI design system because V1 is a CLI and messaging runtime; presentation behavior is in the product requirements.

No existing application behavior can be certified or preserved by tests yet. All PRD requirements still require implementation or explicit exclusion as optional/post-V1. Planning checks are distinguished from future product validation in testing.md.
