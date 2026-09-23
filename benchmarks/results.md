# Operations measurements (2026-09-23)

Test host: AMD Ryzen 7 5800H, x86-64 Linux 7.2.5-3-omarchy, Bun 1.4.2. Build: `bun run build` with `--compile --minify --bytecode`. Each CLI row is 20 new compiled-binary processes after one discarded warm-up. Temporary global state and bot roots were used. The inspect/doctor bot had no Telegram token, so doctor measured offline checks and reported expected missing-secret/database failures.

| Command | Median | p95 | V009 budget |
|---|---:|---:|---:|
| `--help` | 24.35 ms | 25.89 ms | <100 ms |
| `list` | 50.70 ms | 53.00 ms | <75 ms |
| `inspect bot` | 51.04 ms | 53.39 ms | <100 ms |
| `doctor bot` offline | 60.73 ms | 66.72 ms | <250 ms |

The direct same-user control socket `status` request measured 20 calls in one Bun process: median 1.24 ms, p95 3.22 ms. The complete compiled `vian status` process measured median 100.90 ms, p95 105.34 ms; V009 names the control round trip budget, not full process startup.

An empty compiled daemon measured 54,204 KiB RSS with one Vian process. `bun benchmarks/idle.ts` registered 25 enabled bots with fake adapters and measured 68,292,608 bytes RSS. That fixture does not establish the 25 connected Telegram-bot target or live idle network traffic. Twenty-five real test tokens were unavailable. No provider/model processes were spawned by the fixture.

Commands: `bun run build`, `XDG_DATA_HOME=<temporary> bun benchmarks/cli.ts dist/vian bot`, `XDG_DATA_HOME=<temporary> bun benchmarks/idle.ts`, `/proc/<daemon-pid>/status` via `ps`, and 20 `requestControl('status')` calls in a disposable state directory. The built artifact also ran a real ChatGPT `gpt-5.5` local native-tool journey from a temporary bot root and returned the expected tool result.

The rendered user unit passed `systemd-analyze verify` on systemd 261.2. A fresh user-session install/start/logout lifecycle was not run; that would install a user service on this host.
