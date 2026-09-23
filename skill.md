# Use Vian

Vian runs multiple Telegram bots. Each bot selects a provider and model in `vian.json`, keeps instructions in `VIAN.md`, exposes explicit tools from `vian.tools.ts`, and owns its Telegram token. Provider credentials can be shared globally.

- Inspect with `vian list` and `vian inspect <bot>`. Create a bot with `vian init <dir> --provider <provider> --model <model-id>`.
- To connect an app, wrap only the needed operations from its existing API as native TypeScript tools or allowlisted MCP tools. Keep app logic, including a Go backend, in the app. See [tool authoring](docs/tool-authoring.md).
- Configure the provider with `vian auth login openai-chatgpt`, `vian auth set google`, or `vian auth set vercel-ai-gateway`. Check the bot with `vian test <bot> '<request>'`.
- Start the daemon or user service. Have the owner run `vian telegram connect <bot>`; it hides and validates the token, saves it for that bot, and reloads it. Check `vian doctor <bot> --online` and `vian status`, then approve the first user's pairing code with `vian access approve <bot> <code> --as <principal>`.

Use `vian restart`, `logs`, and `history` for operations. Never put credentials in chat or source control.
