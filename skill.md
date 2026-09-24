# Use Vian

Vian runs registered Telegram bots in one local daemon. Each bot has a `vian.json` manifest, `VIAN.md` instructions, trusted tools in `vian.tools.ts`, and its own Telegram token and history. A bot can use a provider credential shared with other bots on the same machine.

## Install and choose a bot

On Linux, install the newest published release with the checksum-verifying [installer](README.md#install):

```sh
curl -fsSL https://raw.githubusercontent.com/invrnt/vian/main/install.sh | sh
vian --help
```

The installer uses Bun when available; that installation still needs Bun to run. Pass `--runtime standalone` to the installer for a self-contained executable. Ensure `~/.local/bin` is on `PATH`.

Run `vian update` from an installed Vian command to get the newest published release, including previews. It keeps the current Bun or standalone format. Use `vian update --version <tag>` to pin a release or `vian update --runtime bun|standalone` to change formats; Bun is required for the `bun` format. Restart a running daemon after updating, with `vian service restart` for the user service or by restarting `vian daemon` in its terminal.

For a new bot beside an existing app, choose a provider and a model ID available to that account:

```sh
vian init ./my-bot --provider google --model <verified-model-id>
```

`init` creates missing files without replacing existing ones and registers the bot. Edit `VIAN.md` for its job and `vian.tools.ts` for the exact app operations it may call. Keep app business logic in the app; the tools should call that logic with validated inputs. Native tools export a default object with a description, JSON object `inputSchema`, and `execute(input, context)`. See [tool authoring](docs/tool-authoring.md) and the [hello example](examples/hello/vian.tools.ts). For local imports beside the tool, use the documented `__VIAN_BOT_ROOT__` constant instead of the daemon's working directory. Allowlist individual MCP tools in `vian.json` only when needed.

For a downloaded bot directory that already has `vian.json`, use `vian init <directory>` to create missing local files and register it. If all files exist, `vian register <directory>` registers its existing identity without filling files. Inspect it with `vian inspect <bot>` and check its model, credential references, tools, and access settings before running it. If a copy of the same bot is already registered and this is meant to be a separate bot, use `vian register <directory> --clone` on a copy with no `.vian/state.sqlite`; this gives it a new identity.

## Credentials and checks

New bots use a global provider profile by default. Configure the selected provider once per machine through the CLI:

```sh
vian auth login openai-chatgpt
# or: vian auth set google
# or: vian auth set vercel-ai-gateway
vian auth status <provider>
```

The API-key commands and Telegram connection use hidden prompts. Never place keys or tokens in command arguments, chat, or source control. A downloaded bot may instead reference a bot-local `env:` provider key in `vian.json`; set that variable in its mode-0600 `.env`. Each bot's Telegram credential is separate. If its gate credential is `env:TELEGRAM_BOT_TOKEN`, the owner connects it in an interactive terminal with `vian telegram connect <bot>`, which validates the token and saves it to that bot's `.env`.

```sh
vian list
vian doctor <bot>
vian test <bot> 'Use the hello tool to greet Ada'
vian daemon
```

Run `doctor` and `test` before exposing the bot on Telegram. `test` calls the real provider and tools in a temporary conversation; tools can make real changes. `doctor --online` probes Telegram and configured MCP servers without a model call. With the daemon running, connect Telegram, then run `vian doctor <bot> --online` and `vian status`. To invite a user, run `vian access verify <bot> [--as <principal>] [--minutes N]` and ask them to send the displayed one-use code in a private message to the bot. The command waits, binds that Telegram sender, and reports their numeric ID. It expires after 10 minutes by default; `N` can be 1–30. Without `--as`, Vian creates and displays a principal ID. Requester-initiated pairing also works through `vian access pending <bot>` and `vian access approve <bot> <code> --as <principal>`.

For background operation on Linux, use `vian service install` followed by `vian service start`. Use `vian restart <bot>` after changing its instructions, tools, manifest, or local environment. Check `vian logs <bot> --follow` for diagnostics and `vian history <bot> --jsonl` for the audit. `vian enable <bot>` and `vian disable <bot>` control startup. See [operations](docs/operations.md) and [Telegram Gate](docs/gates.md).

## Quick recipes

- **Read-only app helper:** expose an app function such as `getBalance` as one native tool, with a narrow schema and an application-level authorization check. Give `VIAN.md` the bot's purpose, then run `doctor` and a `test` request that calls the tool.
- **Write action:** expose only the intended operation, validate its arguments, and use `context.idempotencyKey` when calling an external system. Test with disposable app data because `vian test` runs the tool. Use `audit: 'metadata-only'` for sensitive tool input or output.
- **Move a bot to another machine:** download its directory, run `vian init <directory>`, configure the provider profile or local `env:` key on that machine, and connect that bot's Telegram token. Check `doctor`, `test`, and `status` there. Never copy a global provider profile into the repo.
- **Invite a friend:** run `vian access verify <bot> --as friend`, share its code with that person, and leave the command running while they send the code privately to the bot. Note the Telegram ID reported on success.
