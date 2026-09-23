# Execution state

| Agent | Status | Branch/worktree | Commit | Validation evidence | Integrated revision | Blocker |
|---|---|---|---|---|---|---|
| F | integrated | codex/vian-foundation `/home/jc/dev/personal/vian-f` | fef1c3a | compiled CLI smoke; 60 combined tests pass | 3835600 | — |
| S | integrated | codex/vian-storage `/home/jc/dev/personal/vian-storage` | 5f61623 | typecheck; 15 SQLite tests, 135 assertions; 60 combined tests | 3835600 | — |
| C | integrated | codex/vian-local-cli `/home/jc/dev/personal/vian-local-cli` | 562d033 | 11 local tests, 65 assertions; compiled list smoke; 60 combined tests | 3835600 | online doctor probes belong to O |
| T | integrated | codex/vian-tools `/home/jc/dev/personal/vian-tools` | d45731c | typecheck, 5 package tests, build, compiled probe; combined typecheck pass | 828609a | — |
| R | running | codex/vian-runtime `/home/jc/dev/personal/vian-runtime` | — | — | — | — |
| P | partial integrated; blocked | codex/vian-providers `/home/jc/dev/personal/vian-providers` | 411560b | frozen install, typecheck, 17 offline tests; combined pass | 91e9263 | V027 supported OAuth client/transport and live validation unavailable |
| G | integrated | codex/vian-telegram `/home/jc/dev/personal/vian-telegram` | 39a2016 | typecheck, 12 HTTP fixture tests, 43 assertions; combined typecheck pass | 75e8226 | live Telegram checks unavailable |
| O | pending C,T,R,P,G | — | — | — | — | — |
| H | pending O | — | — | — | — | — |
