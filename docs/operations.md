# Operating Vian

The daemon loads enabled registered bots. One bot's invalid configuration does not prevent another bot from starting. `vian status` reports each bot's current state and startup error; `vian restart <bot>` reloads that bot's manifest, instructions, `.env`, tools, MCP servers, provider and Telegram Gate. The existing bot is checked before it is stopped. A fatal reload after shutdown may leave that bot stopped, with its error visible in status.

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

```sh
vian test my-bot 'Use the hello tool to greet Ada'
```

The local test uses a temporary conversation and database. `--session <id>` opts into an existing session and requires exclusive ownership of that bot, so stop it in the daemon first. Trusted tools may perform real side effects even in an ephemeral test.

On Linux, `vian service install` writes a systemd user unit; then use `vian service start|stop|restart|status`. The unit runs `vian daemon` with `Restart=on-failure`. The service command reports the `loginctl enable-linger` action needed if the daemon must continue after logout. Do not run two daemons against the same registry; the control socket and bot owner locks prevent this.

Bot diagnostic logs rotate under `.vian/runtime.log` and never replace the SQLite audit. A delivery with an unknown Telegram outcome is held for local inspection rather than resent automatically. `vian history <bot> --jsonl` and `vian doctor <bot>` work while the daemon is stopped. SQLite and attachment backups should include the whole `.vian/` directory, with filesystem permissions preserved.
