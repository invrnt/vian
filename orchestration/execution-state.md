# Execution state

| Agent | Status | Branch/worktree | Commit | Validation evidence | Integrated revision | Blocker |
|---|---|---|---|---|---|---|
| F | integrated | codex/vian-foundation `/home/jc/dev/personal/vian-f` | 6dbf7cf | manifests/notices, optimized build script, ownership transfers; integrated checks pass | 3942f52 | — |
| S | integrated | codex/vian-storage `/home/jc/dev/personal/vian-storage` | 73dda46 | typecheck; 16 SQLite tests, 139 assertions; combined typecheck pass | 808d60e | — |
| C | integrated | codex/vian-local-cli `/home/jc/dev/personal/vian-local-cli` | 562d033 | 11 local tests, 65 assertions; compiled list smoke; 105 combined tests | 6e2bb35 | — |
| T | integrated | codex/vian-tools `/home/jc/dev/personal/vian-tools` | d45731c | typecheck, 5 package tests, build, compiled probe; combined typecheck pass | 828609a | — |
| R | integrated | codex/vian-runtime `/home/jc/dev/personal/vian-runtime` | 6477315 | frozen install, typecheck, 24 runtime tests; 86 combined tests | 9d0639f | — |
| P | integrated; live provider checked | codex/vian-subscription `/home/jc/dev/personal/vian-subscription` | 36e40e5 | 97 offline tests; live gpt-5.5 SSE, tool, abort, error, refresh, two roots; combined typecheck | 98c20a0 | full runtime/Gate journey belongs to O/H |
| G | integrated | codex/vian-telegram `/home/jc/dev/personal/vian-telegram` | 39a2016 | typecheck, 12 HTTP fixture tests, 43 assertions; combined typecheck pass | 75e8226 | live Telegram checks unavailable |
| O | integrated | codex/vian-operations `/home/jc/dev/personal/vian-operations` | 1ac8410 | 105 combined tests; build/smoke; §67; live gpt-5.5 tool/steering/stop/shared bots; V009 medians | 6e2bb35 | Telegram, installed service, 25 live bots unverified |
| H | integrated; release blocked | codex/vian-hardening `/home/jc/dev/personal/vian-hardening` | 4fca0e7 | frozen install, schema/build/smoke, 106 tests and 648 assertions; T08 report | 92e1152 | live Telegram, Gateway, Gemini, fresh Linux install, 25 connected bots unavailable |
