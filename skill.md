# Add a Vian bot to an existing project

Use this when someone asks for a bot for their app, including an app with a Go backend. Run `vian` from the installed binary, or `./dist/vian` from this repository after `bun install --frozen-lockfile && bun run build`.

1. Inspect the app and agree on the bot's jobs, provider and model ID. Vian does not choose a model automatically. Each bot selects its provider, model and credential in `vian.json`.
2. Give the bot only the app actions it needs. Reuse or add narrow authenticated backend endpoints, then wrap them as explicit TypeScript tools in `vian.tools.ts` (or allowlisted stdio MCP tools). For a Go backend, keep the business logic in Go and call it from those wrappers. Validate tool inputs, pass cancellation, and use `context.idempotencyKey` for writes. See [tool authoring](docs/tool-authoring.md).
3. Initialize and edit the bot without overwriting the app's files:

   ```sh
   vian init ./bots/my-app --provider openai-chatgpt --model gpt-5.5
   ```

   Put the bot's instructions in `VIAN.md`. Replace the generated empty `vian.tools.ts` with the app wrappers. Use a model ID available to the chosen account; `gpt-5.5` is only a verified ChatGPT example.
4. Have the owner configure a **global** model credential once, outside chat: `vian auth login openai-chatgpt`, `vian auth set google`, or `vian auth set vercel-ai-gateway`. The last two prompt for a hidden API key and create `profile:google-default` or `profile:vercel-ai-gateway-default`. Bot-local `env:` keys remain supported. Check with `vian auth status <provider>` and run `vian test my-app 'Use the app tool to ...'` before connecting Telegram.
5. Prepare a running Vian daemon or user service. Then give the owner this final per-bot command, without asking them to paste the token into chat:

   ```sh
   vian telegram connect my-app
   ```

   It prompts without echo, checks Telegram `getMe`, saves the token only in that bot's `.env`, and reloads it if the daemon is running. Run `vian doctor my-app --online` and check `vian status`. The first private user receives a pairing code; approve it locally with `vian access approve my-app <code> --as <principal>` before expecting model replies.

Keep model credentials global, Telegram tokens per bot, and app secrets out of source control. Do not claim the Telegram journey is verified until a real message and tool result return through that bot.
