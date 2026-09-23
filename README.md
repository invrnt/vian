# Vian

Vian runs small, explicit-tool conversational bots from local directories. One daemon hosts the registered bots; each bot keeps its configuration, SQLite history and attachments in its own directory.

## Build and first bot

Requires Bun 1.4.2. On Linux:

```sh
bun install --frozen-lockfile
bun run check
bun run build
./dist/vian init ./my-bot --provider openai-chatgpt --model gpt-5.5
./dist/vian auth login openai-chatgpt
```

`init` keeps existing files and creates `vian.json`, `VIAN.md`, `vian.tools.ts`, `.env` and `.vian/` when needed. Put a Telegram bot token in the new `.env` entry before starting the daemon. The model ID shown above was validated against a ChatGPT subscription on 2026-09-23; availability can change.

```sh
./dist/vian doctor my-bot
./dist/vian doctor my-bot --online
./dist/vian test my-bot 'Say hello'
./dist/vian daemon
```

Run `daemon` in a terminal, or use `vian service install` and `vian service start` for a systemd user service. `test` invokes the real instructions, tools and provider without connecting to Telegram; it uses a separate temporary conversation by default.

## Operations

`vian list`, `inspect`, `sessions`, `history` and offline `doctor` read local files without starting the daemon. `start`, `stop`, `restart` and `status` use a same-user Unix socket. `enable` and `disable` change startup state. `logs <bot> [--follow]` shows runtime diagnostics; `history <bot> --jsonl` exports the canonical audit.

See [operations](docs/operations.md), [tool authoring](docs/tool-authoring.md), [Telegram Gate](docs/gates.md) and [security](docs/security.md). Sample tools are in `examples/hello` and `examples/attachments`.
