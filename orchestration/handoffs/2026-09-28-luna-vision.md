# Debian Vian default model and inbound vision handoff

Source revision: `7014bf4` after `git pull` reported already up to date. This handoff accompanies the next preview release; its checks apply to the implementation before publication.

Changed behavior: newly initialized bots use `openai-chatgpt` / `gpt-6-luna` and its existing global OAuth reference unless the operator chooses another provider/model. Existing manifests are preserved. The runtime reads supported image attachments through bot-scoped IDs, supplies image bytes and adjacent text to the AI SDK model, and reopens recent retained images for follow-up turns. Unsupported or unavailable media stays visible as metadata.

Dependency baseline inspected before retrieval: `.tool-versions` pins Bun 1.4.2; root `package.json` and `bun.lock` pin `ai` 7.0.111, `@ai-sdk/gateway` 4.0.89, `@ai-sdk/google` 4.0.77, `@ai-sdk/provider` 4.0.17 and `grammy` 1.46.0. Frozen install left the lockfile unchanged.

Sources retrieved 2026-09-28:

- [OpenAI GPT-6 Luna model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna), current model ID `gpt-6-luna`; text and image input; Responses API and function tools are documented. This documents the public API, not Vian's subscription backend.
- [OpenAI image and vision guide](https://developers.openai.com/api/docs/guides/images-vision), current guide; Responses image content uses `input_image` with an image URL or data URL.
- [AI SDK 7 ModelMessage reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/model-message), version 7 selector; user content accepts image `file` parts with `Uint8Array` data and an image media type. Installed `ai` 7.0.111 types and runtime tests confirmed the exact local shape.
- Existing subscription transport provenance remains OpenClaw commit `0e79899fedc26ae9a90a196a8bc41b97fd39d7e5`, MIT, recorded in `THIRD_PARTY_NOTICES.md`; no new external code was adapted.

Checks: `/home/cami/.bun/bin/bun install --frozen-lockfile` passed; `/home/cami/.bun/bin/bun run check` passed (126 tests, 0 failures, TypeScript); `/home/cami/.bun/bin/bun run build` passed; `PATH=/home/cami/.bun/bin:$PATH /home/cami/.bun/bin/bun run smoke:foundation` passed. A compiled binary initialized an isolated temporary bot and produced `openai-chatgpt/gpt-6-luna`. Runtime fixtures verified caption plus image bytes on initial and follow-up turns. Subscription transport fixture verified `input_image` encoding. These are offline fixtures, not a live vision or model availability check.

Blocked: authorized ChatGPT subscription and Telegram test bot access are needed to verify GPT-6 Luna through Vian's subscription endpoint and visual understanding of a real Telegram photo. No live account or host service was used.

Telegram menu follow-up (2026-09-28): the user reported that `/new` worked when typed but was absent from Telegram's slash menu. The Gate now uses pinned grammY 1.46.0 `getMyCommands` and `setMyCommands` on startup for private chats and an existing Spanish localized list, preserving other entries. [Telegram Bot API command scopes and `setMyCommands`](https://core.telegram.org/bots/api#setmycommands) and [grammY command menu guide](https://v1.grammy.dev/guide/commands#suggest-commands-to-users) were retrieved on 2026-09-28; installed grammY 1.46.0 types confirmed both signatures. `/home/cami/.bun/bin/bun test packages/gate-telegram/src/telegram.test.ts` passed 15 tests; `/home/cami/.bun/bin/bun run check` passed 129 tests and TypeScript; `/home/cami/.bun/bin/bun run build` passed. Live Telegram client visibility still needs an authorized bot session and a restarted daemon with this code.
