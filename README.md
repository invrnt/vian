# Vian

Vian runs small, explicit-tool conversational bots from local directories. One daemon hosts the registered bots; each bot keeps its configuration, SQLite history and attachments in its own directory.

Coding agents working with Vian should follow the short [usage skill](skill.md).

## Install

Prebuilt Linux x64 and arm64 binaries need no Bun or source build. The installer verifies the release checksum and places `vian` in `~/.local/bin` (or the directory given by `--dir`). This repository is currently private, so authorized users need GitHub CLI access:

```sh
gh api -H 'Accept: application/vnd.github.raw' repos/invrnt/vian/contents/install.sh > install-vian.sh
sh install-vian.sh --version v0.1.0-preview.1
```

The preview release has not passed every live release gate; see the [release report](orchestration/release-report.md). Once the repository is public, `install.sh` can be fetched without `gh`. A stable release can be installed without `--version`.

## First bot

Choose a provider and model available to your account:

```sh
vian init ./my-bot --provider openai-chatgpt --model gpt-5.5
vian auth login openai-chatgpt
```

`init` keeps existing files and creates `vian.json`, `VIAN.md`, `vian.tools.ts`, `.env` and `.vian/` when needed. Each bot selects a provider and model. ChatGPT OAuth and Google/Gateway API-key profiles are global; Telegram credentials belong to each bot. The model ID shown above was validated against a ChatGPT subscription on 2026-09-23; availability can change.

For Google or Gateway, run `vian auth set google` or `vian auth set vercel-ai-gateway` once, then select that provider and a verified model during `init`. These commands take keys through hidden prompts. Existing bot-local `env:` references still work.

```sh
vian doctor my-bot
vian test my-bot 'Say hello'
vian daemon
```

With the daemon running, the owner runs `vian telegram connect my-bot` in an interactive terminal. It validates and saves that bot's token without echoing it, then reloads the bot. Check with `vian doctor my-bot --online` and approve the first private user's pairing code with `vian access approve`.

Run `daemon` in a terminal, or use `vian service install` and `vian service start` for a systemd user service. `test` invokes the real instructions, tools and provider without connecting to Telegram; it uses a separate temporary conversation by default.

To build from source instead, install Bun 1.4.2, then run `bun install --frozen-lockfile && bun run check && bun run build`. The binary is `./dist/vian`.

## Operations

`vian list`, `inspect`, `sessions`, `history` and offline `doctor` read local files without starting the daemon. `start`, `stop`, `restart` and `status` use a same-user Unix socket. `enable` and `disable` change startup state. `logs <bot> [--follow]` shows runtime diagnostics; `history <bot> --jsonl` exports the canonical audit.

See [operations](docs/operations.md), [tool authoring](docs/tool-authoring.md), [Telegram Gate](docs/gates.md) and [security](docs/security.md). Sample tools are in `examples/hello` and `examples/attachments`.
