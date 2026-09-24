# Operations requirements

Source: [Vian V1 PRD](../../Vian-V1-PRD.md). Section references below include all subordinate clauses. Each ID covers its full stated scope, not only the acceptance examples. Required behavior remains required when its external dependency is blocked.

## V037: Daemon and control

Source: PRD §§7–8, 11, 38.

One shared daemon multiplexes enabled bots, with same-user local Unix control socket, bounded runs, start/stop/restart and enabled/autostart state. No model/provider process per bot.

Assumption: `vian daemon` starts in the background and reports successful or repeated activation. `vian daemon stop|restart` controls that process; `--foreground` is reserved for terminal debugging and the systemd unit. This keeps interactive startup short while retaining systemd's process supervision. Validate startup, duplicate invocation, shutdown and restart with isolated global paths.

Acceptance: Start multiple bots, stop/restart one, toggle enable/disable and restart daemon; verify socket permissions and reject invalid control requests. A second daemon cannot independently own the same bot stores or polling stream.

## V038: Fault isolation and restart

Source: PRD §§38.2, 40–41, 47, 54.

Ordinary bot/config/tool/provider failures stay local. Restart revalidates manifest/instructions/env/tools/MCP/provider/Gate together; no half-applied state. Trusted CPU-blocking code remains a documented limitation.

Acceptance: Inject each error in one bot while another completes a run; invalid reload preserves valid runtime where possible and reports exact failure. Shutdown flushes safe local state and leaves interrupted external work unreplayed.

## V039: Linux service

Source: PRD §§39.

Provide install/start/stop/restart/status for systemd user service, Restart=on-failure, daemon command and no exposed TCP. Detect lingering needs and explain exact user action.

Acceptance: Test rendered unit and CLI behavior with mocked service runner, then fresh Linux user environment verifies service lifecycle and logout prerequisites without requiring root by default.

## V040: Observability

Source: PRD §§36.5–36.7, 47–48.

Local structured scoped logs separate from conversation audit, human default and JSON automation; logs --follow; safe status/doctor explains errors including held deliveries. Bounded log rotation.

Acceptance: Trigger runtime/provider/tool/delivery errors and confirm safe bot/session/run correlation, readable output, follow termination and bounded rotation; history remains in SQLite.

## V041: Idle resource budgets

Source: PRD §§3.3, 55–56, 63 Runtime.

One daemon, base idle RSS <80 MB and 25 registered/connected idle bots <120 MB target; idle only Gate liveness/minimal timers, no LLM/context/tool work, DB polling, heartbeat or model polling. Shared cleanup infrequent.

Acceptance: Measure process count/RSS and idle traffic on documented x86-64 Linux hardware. Use 25 real connections for live claim; fake fixture alone is insufficient. Record budget deviations for optimization or explicit product decision.

## V042: Distribution, docs and supply chain

Source: PRD §§6–7, 49.7, 57, 62–63, 69.

Ship reproducible standalone build, MIT license and adapted-code notices; concise tool/Gate/security/operations docs and hello/attachment examples. Pin dependencies and retain provenance, use inspiration without importing full harness scope.

Acceptance: Clean install from artifact on fresh Linux, execute documented setup and example flows, audit dependency licenses and notices; source/lock/build agree and no secrets ship.

Assumption: `vian update` selects the newest published release with the required asset and checksum, including prereleases, because previews are currently the only available releases. It preserves the installed runtime format by default; explicit tag and runtime flags allow a deliberate choice. Validate selection and replacement with offline release fixtures and confirm against a published release before claiming live update compatibility.

## V043: Release verification

Source: PRD §§59–63, 67–68.

Verify all source definition-of-done items, mandatory concurrency scenarios, fakes/golden transcripts, architecture invariants and first fake vertical slice before live integration. Readiness requires coverage and genuine evidence.

Acceptance: Testing.md release gates pass or are explicitly blocked. Every requirement has one primary owner and evidence; all 15 §68 invariants are asserted by tests/review; no deployment is implied.
