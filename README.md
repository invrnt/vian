# Vian

Vian runs small, explicit-tool conversational bots from local directories. One daemon hosts the registered bots; each bot keeps its configuration, SQLite history and attachments in its own directory.

Coding agents working with Vian should follow the short [usage skill](skill.md).

## Build and first bot

Requires Bun 1.4.2. On Linux:

```sh
bun install --frozen-lockfile
bun run check
bun run build
./dist/vian init ./my-bot --provider openai-chatgpt --model gpt-5.5
./dist/vian auth login openai-chatgpt
```

`init` keeps existing files and creates `vian.json`, `VIAN.md`, `vian.tools.ts`, `.env` and `.vian/` when needed. Each bot selects a provider and model. ChatGPT OAuth and Google/Gateway API-key profiles are global; Telegram credentials belong to each bot. The model ID shown above was validated against a ChatGPT subscription on 2026-09-23; availability can change.

For Google or Gateway, run `vian auth set google` or `vian auth set vercel-ai-gateway` once, then select that provider and a verified model during `init`. These commands take keys through hidden prompts. Existing bot-local `env:` references still work.

```sh
./dist/vian doctor my-bot
./dist/vian test my-bot 'Say hello'
./dist/vian daemon
```

With the daemon running, the owner runs `./dist/vian telegram connect my-bot` in an interactive terminal. It validates and saves that bot's token without echoing it, then reloads the bot. Check with `./dist/vian doctor my-bot --online` and approve the first private user's pairing code with `vian access approve`.

Run `daemon` in a terminal, or use `vian service install` and `vian service start` for a systemd user service. `test` invokes the real instructions, tools and provider without connecting to Telegram; it uses a separate temporary conversation by default.

## Operations

`vian list`, `inspect`, `sessions`, `history` and offline `doctor` read local files without starting the daemon. `start`, `stop`, `restart` and `status` use a same-user Unix socket. `enable` and `disable` change startup state. `logs <bot> [--follow]` shows runtime diagnostics; `history <bot> --jsonl` exports the canonical audit.

See [operations](docs/operations.md), [tool authoring](docs/tool-authoring.md), [Telegram Gate](docs/gates.md) and [security](docs/security.md). Sample tools are in `examples/hello` and `examples/attachments`.
