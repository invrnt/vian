# Platform requirements

Source: [Vian V1 PRD](../../Vian-V1-PRD.md). Section references below include all subordinate clauses. Each ID covers its full stated scope, not only the acceptance examples. Required behavior remains required when its external dependency is blocked.

## V001: Product boundary

Source: PRD §§1–5, 49.2, 64–66, 72.

Implement a narrow explicit-tool conversational runtime. V1 excludes all listed future/non-goal capabilities, including arbitrary shell/filesystem/SQL/URL-fetch tools, agents, schedulers, other Gates and multi-Gate bots.

Acceptance: Inspect configuration, tool discovery and CLI help: only requested V1 capabilities exist; model cannot discover an unexposed tool. Developer-authored trusted tools remain permitted.

## V002: Runtime and distribution

Source: PRD §§6–8, 57–58.

TypeScript on Bun; one standalone executable for CLI and daemon; small pinned dependency set; Linux first-class and portable core; MIT license target.

Acceptance: Compile and run help and a dynamic local TypeScript tool with local imports. Audit exact pins and license notices; verify dependency direction and no heavy imports for local commands.

## V003: Non-destructive initialization

Source: PRD §§4.1–4.3, 10, 36.1–36.2.

Init any existing directory and create new ones through create. Wizard covers names, paths, provider/model/auth, Telegram, pairing, registration and autostart. Preserve existing content, append missing env/gitignore entries, explain secret conflicts, write atomically and validate. Notify a running daemon to load the bot.

Acceptance: Exercise absent and non-empty directories with existing .env, comments, instructions, tool files, package.json and gitignore. Check unchanged unrelated bytes, no silently replaced values, missing entries appended once, POSIX permissions, absolute registration and load notification.

## V004: Global registry and moves

Source: PRD §§9.1, 11–12, 36.3–36.4.

Store UUID, alias, absolute path, registration time, enabled state and observed metadata globally, without history. Explicit registration only. Move unavailable old path by UUID; require --move/--clone for simultaneous valid paths. Unregister removes only registry entry.

Acceptance: Move a bot and retain UUID/history; duplicate registration fails safely; explicit move chooses new location and clone obtains new UUID. Unregister retains every bot file. Offline list includes requested columns and missing-path state; no filesystem-wide scan.

## V005: Manifest and migrations

Source: PRD §§13, 32, 53–54.

Require schemaVersion and stable ID; resolve paths from root; use secret references and nested Gate/provider configuration; validate unknown fields consistently; reject unknown future versions and apply reload atomically. Upgrades do not mutate bot files without required explicit migration.

Acceptance: Validate the source example structure and invalid fields with field/path errors; test unknown future version refusal and one invalid bot alongside valid bots. Atomic reload cannot expose a partial manifest.

## V006: Instructions and context preamble

Source: PRD §§14, 19, 27.

Combine a short runtime preamble with VIAN.md, principal, current capabilities, attachment semantics and constraints. Gate context is ephemeral.

Acceptance: Capture provider input and persisted history: correct principal/tools/capabilities appear only in current context, no Gate instruction pollution or tool execution context serialization.

## V007: Local CLI and diagnostics

Source: PRD §§26, 36.4, 36.6–36.8, 37, 63 CLI.

Provide offline list/inspect/sessions/history/doctor; readable transcripts and tool sections; history filters by session/principal/since/tools and JSONL export. Doctor checks every item in §36.6, network probes only with --online. Useful automation commands expose JSON. Errors name bot/path/field.

Acceptance: Run local commands with daemon stopped and network forbidden. Assert filters/export, list missing state, reference-only inspect, each doctor failure and cheap explicit online probes. Command forms follow the PRD.

## V008: Local development test command

Source: PRD §§36.11.

vian test uses real bot instructions/tools/provider without Telegram, an ephemeral conversation by default, explicit --session opt-in and compact tool output.

Acceptance: Verify ephemeral tests do not mutate an existing conversation and explicit session use goes through its lease; no Telegram connection is made.

## V009: CLI latency

Source: PRD §§37.

Benchmark help <100 ms, warm list <75 ms, inspect <100 ms, offline doctor <250 ms excluding user import, local control round trip <100 ms. These are engineering budgets, not public guarantees.

Acceptance: Record compiled-binary measurements with hardware/runtime, cold/warm distinctions and repeated samples; demonstrate no daemon boot/network/provider import for read-only local commands.

## Scope interpretation

Assumption: unknown manifest fields fail with a field-specific validation error. The source permits warning or error. JSON output covers list, inspect, sessions, status, doctor, access list/pending and auth list/status; history uses source-defined JSONL and logs support JSON.

Assumption: Human-readable `list` keeps the compact status fields in aligned columns and prints each full bot path beneath its row. This keeps paths readable without widening every column; `--json` retains the complete record for scripts. Terminal-width review and a long-name fixture validate the layout.

The apparent session-reset timing conflict in §9.6, which mentions operations later, is resolved by the explicit V1 /new requirements in §§45–46; CLI reset remains future. Performance budgets are required engineering/release measurements, even though §§37 and 55 forbid advertising them as guarantees before measurement. V1 readiness reports failures honestly rather than waiving them.

Optional items omitted: file watching, MCP HTTP/wildcard convenience, rich messages, backup CLI, future migration CLI, extra transports and post-V1 candidates. Required safe database backups and future-schema refusal remain in scope. Security/audit design implements the source-permitted full/metadata-only modes; separate redacted/none controls are future extensions.

User amendment: V044 in identity-history.md supersedes the source queue default. All other scope decisions below retain PRD authority.

Source coverage map: §§1–14 → V001–V006; §§15–17 → V020–V025; §§18–24 → V010–V013 and V031–V035; §§25–27 → V007 and V014–V016; §§28–32 → V026–V030; §§33–35 → V017–V018 and V032/V036; §§36–41 → V003–V009, V021, V037–V040; §§42–46 → V010/V019/V024/V034/V035; §§47–54 → V005/V014/V015/V021/V025/V028–V030/V038/V040; §§55–58 → V002/V041/V042; §§59–63 → V043 and their feature IDs; §§64–66 → V001 and scope interpretation; §§67–68 → V043 plus invariant-specific IDs; §§69–71 → V027/V033/V042 and retrieval instructions; §72 → V001. Source phases in §62 are recommendations; execution-plan.md is the scheduling authority.
