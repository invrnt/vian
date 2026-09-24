# Operating Vian

The daemon loads enabled registered bots. One bot's invalid configuration does not prevent another bot from starting. `vian status` reports each bot's current state and startup error; `vian restart <bot>` reloads that bot's manifest, instructions, `.env`, tools, MCP servers, provider and Telegram Gate. The existing bot is checked before it is stopped. A fatal reload after shutdown may leave that bot stopped, with its error visible in status.

`vian daemon` starts a background process and returns after startup. Repeating it reports that the daemon is already running. `vian daemon stop|restart` controls the whole process; `vian daemon --foreground` keeps it attached to the terminal. Use `vian status` and `vian logs <bot>` to inspect a bot. `vian restart <bot>` reloads only that bot.

```sh
vian list
vian status
vian status my-bot --json
vian start my-bot
vian stop my-bot
vian restart my-bot
vian enable my-bot
vian disable my-bot
vian doctor my-bot --online
vian logs my-bot --follow
```

`doctor --online` calls Telegram `getMe`, resolves the provider credential locally and connects to configured MCP servers. It does not make a billable model call. A local test is the appropriate model-path check:

`vian auth login openai-chatgpt` saves a global OAuth profile. `vian auth set google` and `vian auth set vercel-ai-gateway` save global API-key profiles with hidden prompts. New bots select those profiles by default; an explicit bot-local `env:` model key is still supported. `vian telegram connect <bot>` validates and saves that bot's Telegram token with a hidden prompt, then reloads it if the daemon is running.

```sh
vian test my-bot 'Use the hello tool to greet Ada'
```

The local test uses a temporary conversation and database. `--session <id>` opts into an existing session and requires exclusive ownership of that bot, so stop it in the daemon first. Trusted tools may perform real side effects even in an ephemeral test.

On Linux, `vian service install` writes a systemd user unit; then use `vian service start|stop|restart|status`. The unit runs `vian daemon --foreground` with `Restart=on-failure`. After updating from a version whose unit runs plain `vian daemon`, run `vian service install` again to replace the unit before restarting the service. Use `vian service uninstall` to stop and disable the service, remove its unit and reload systemd. The service command reports the `loginctl enable-linger` action needed if the daemon must continue after logout. Use `vian service restart` for a service-managed daemon. The control socket and bot owner locks prevent two daemons from owning the same registry.

To remove a default installation after stopping the daemon or uninstalling the service, run `rm -- "$HOME/.local/bin/vian"`. For a custom `install.sh --dir`, remove `vian` from that directory. Vian keeps global registry data under `${XDG_DATA_HOME:-$HOME/.local/share}/vian` and credential profiles under `${VIAN_HOME:-$HOME/.local/share/vian}/credentials`. Bot configuration, `.env`, history and attachments remain in each bot directory. Remove these separately only when you no longer need them; uninstalling the command or service preserves them.

Bot diagnostic logs rotate under `.vian/runtime.log` and never replace the SQLite audit. A delivery with an unknown Telegram outcome is held for local inspection rather than resent automatically. `vian history <bot> --jsonl` and `vian doctor <bot>` work while the daemon is stopped. SQLite and attachment backups should include the whole `.vian/` directory, with filesystem permissions preserved.
