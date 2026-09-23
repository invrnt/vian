# Execution state

| Agent | Status | Branch/worktree | Commit | Validation evidence | Integrated revision | Blocker |
|---|---|---|---|---|---|---|
| F | integrated | codex/vian-foundation `/home/jc/dev/personal/vian-f` | ada616e | frozen install, typecheck, 39 combined tests, build, smoke | d343ad4 | — |
| S | integrated | codex/vian-storage `/home/jc/dev/personal/vian-storage` | e18552d | typecheck; 10 SQLite tests, 78 assertions; 39 combined tests | d343ad4 | — |
| C | running | codex/vian-local-cli `/home/jc/dev/personal/vian-local-cli` | — | — | — | — |
| T | running | codex/vian-tools `/home/jc/dev/personal/vian-tools` | — | — | — | — |
| R | running | codex/vian-runtime `/home/jc/dev/personal/vian-runtime` | — | — | — | — |
| P | partial integrated; blocked | codex/vian-providers `/home/jc/dev/personal/vian-providers` | 411560b | frozen install, typecheck, 17 offline tests; combined pass | 91e9263 | V027 supported OAuth client/transport and live validation unavailable |
| G | integrated | codex/vian-telegram `/home/jc/dev/personal/vian-telegram` | 39a2016 | typecheck, 12 HTTP fixture tests, 43 assertions; combined typecheck pass | 75e8226 | live Telegram checks unavailable |
| O | pending C,T,R,P,G | — | — | — | — | — |
| H | pending O | — | — | — | — | — |
