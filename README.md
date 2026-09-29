# Vian

Vian runs Telegram bots that answer in plain language and call only the tools you expose. Each bot has its own directory for configuration, SQLite history and attachments, while one daemon runs the registered bots.

If a coding agent is setting up a bot for you, give it the [Vian usage skill](skill.md).

## Share a personal app through Telegram

Say you host a small expense-sharing app and want a friend to use it. They could message your Telegram bot, "What do I owe for dinner?" or "Add my half of the taxi fare." You expose only the app operations those requests need, such as `get_balance` and `add_expense`, and approve your friend's Telegram account. Your friend uses the app through chat without a server login or a terminal. You keep hosting the app and its data.

The model sees only the tools you give that bot. Vian does not provide a general shell, unrestricted file access or arbitrary SQL by default. The tools you write run with your local privileges, so they still need input validation and application-level access checks. See [security](docs/security.md) and [tool authoring](docs/tool-authoring.md).

You can give other apps their own bots, each with separate instructions, tools and history. Registering 100 bots does not start 100 Vian processes: one daemon keeps enabled bots available and does no model work for them while they are idle. The 100-bot example describes the process layout, not a measured capacity limit; the current [benchmark](benchmarks/results.md) covers 25 idle bots with fake adapters. Explicitly configured MCP servers may run additional processes.

## Install

The Linux installer uses Bun. It reuses an existing Bun installation (including `~/.bun/bin/bun` when it is absent from `PATH`), or installs Bun 1.4.2 with Bun's official installer. It downloads a small, checksum-verified Vian source archive and runs `bun install --frozen-lockfile --production` for its packages. Bun caches packages for future updates. The `vian` command is a small wrapper in `~/.local/bin` (or the directory given by `--dir`):

```sh
curl -fsSL https://raw.githubusercontent.com/invrnt/vian/main/install.sh | sh
```

Bun must remain installed for Vian to run, including as a user service. The installer selects the newest published release with a source asset, including previews. It needs Python 3 to find that release. Use `--runtime standalone` only if you explicitly want a self-contained x64 or arm64 executable of roughly 88 MB. Use `--version TAG` to pin a release.

The preview has not passed every live release gate; see the [release report](orchestration/release-report.md). Keep using an explicit preview tag until a stable release is published.

To update a Bun installation, run `vian update`. It selects the newest published source release, verifies `SHA256SUMS`, runs a frozen Bun dependency install, checks the new command and switches the active source tree. Use `vian update --version TAG` to pin a release. `--runtime standalone` opts into the large binary. A running daemon keeps using its old code until you restart it with `vian daemon restart` or `vian service restart` if using the service.

To remove Vian, run `vian daemon stop`, then `vian service uninstall` if you installed the user service. Remove `~/.local/bin/vian` and `~/.local/bin/.vian-app` afterward. This leaves registered bots, their directories and credentials intact. See [operations](docs/operations.md) for data locations.

## First bot

New bots use ChatGPT OAuth and `gpt-6-luna` by default:

```sh
vian init ./my-bot
vian auth login openai-chatgpt
```

`init` keeps existing files and creates `vian.json`, `VIAN.md`, `vian.tools.ts`, `.env` and `.vian/` when needed. Each bot selects a provider and model. ChatGPT OAuth and Google/Gateway API-key profiles are global; Telegram credentials belong to each bot. OpenAI documents `gpt-6-luna` for its API, including image input; Vian's ChatGPT subscription route still needs a live compatibility check for this model. Existing bots keep the provider and model already written in `vian.json`. To change one, edit its `model` fields and restart that bot.

Telegram photos and supported image documents are passed to the model with their caption or nearby text. Images in recent conversation context remain available for follow-up questions while their bot-local attachment bytes are retained. Other file types remain available by attachment metadata and explicit tools.

For a bot already present in a downloaded project, run `vian init <bot-directory>` to fill missing local files and register it in the user's global index. If it is already initialized, `vian register <bot-directory>` just registers its existing identity. Set that bot's Telegram token locally; provider profiles already stored on this device are shared.

For Google or Gateway, run `vian auth set google` or `vian auth set vercel-ai-gateway` once, then select that provider and a verified model during `init`. These commands take keys through hidden prompts. Existing bot-local `env:` references still work.

```sh
vian doctor my-bot
vian test my-bot 'Say hello'
vian daemon
```

With the daemon running, the owner runs `vian telegram connect my-bot` in an interactive terminal. It validates and saves that bot's token without echoing it, then reloads the bot. Check with `vian doctor my-bot --online` and approve the first private user's pairing code with `vian access approve`.

`vian daemon` starts in the background and reports when it is ready or already running. Use `vian daemon stop|restart` to control it. For startup after login, use `vian service install` and `vian service start` for a systemd user service. `test` invokes the real instructions, tools and provider without connecting to Telegram; it uses a separate temporary conversation by default.

To build from source instead, install Bun 1.4.2, then run `bun install --frozen-lockfile && bun run check && bun run build`. The binary is `./dist/vian`.

## Operations

`vian list`, `inspect`, `sessions`, `history` and offline `doctor` read local files without starting the daemon. `start`, `stop`, `restart` and `status` use a same-user Unix socket. `enable` and `disable` change startup state. `logs <bot> [--follow]` shows runtime diagnostics; `history <bot> --jsonl` exports the canonical audit.

See [operations](docs/operations.md), [tool authoring](docs/tool-authoring.md), [Telegram Gate](docs/gates.md) and [security](docs/security.md). Sample tools are in `examples/hello` and `examples/attachments`.
