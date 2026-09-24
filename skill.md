# Use Vian

Vian hosts registered Telegram bots. Each bot chooses its provider and model in `vian.json`, keeps instructions in `VIAN.md`, exposes app actions through `vian.tools.ts`, and owns its Telegram token. Provider credentials can be shared globally.

If `vian` is missing, use the prebuilt installer in the [README](README.md).

- Inspect with `vian list` and `vian inspect <bot>`; create with `vian init <dir> --provider <provider> --model <model-id>`. For a downloaded bot with `vian.json`, run `vian init <dir>` to register it and fill missing local files.
- For an existing app, wrap only the needed backend operations as native tools or allowlisted MCP tools. Keep business logic in the app. See [tool authoring](docs/tool-authoring.md).
- Configure the provider with `vian auth login openai-chatgpt` or `vian auth set google|vercel-ai-gateway`; verify the tools with `vian test <bot> '<request>'`.
- Start the daemon or service, then ask the owner to run `vian telegram connect <bot>`. Check `vian doctor <bot> --online` and `vian status`, and approve the first user's pairing code with `vian access approve <bot> <code> --as <principal>`.

Use `vian restart`, `logs`, and `history` to operate bots. Keep credentials out of chat and source control.
