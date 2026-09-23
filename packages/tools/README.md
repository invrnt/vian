# Tool schemas

Native and allowlisted MCP tool inputs use a deliberately limited JSON Schema vocabulary: `type`, `properties`, `required`, `additionalProperties` (boolean), `items`, `enum`, `const`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `description`, `title`, and `default`. The validator rejects other keywords when the tool is loaded, before any call. Input roots must be objects. Tool definitions should use `additionalProperties: false` to reject unlisted fields.

Tool modules are trusted code. `loadNativeTools` bundles the module and local imports into a fresh temporary artifact for each reload. A failed build or invalid definition leaves an existing `NativeToolRuntime` instance on its last valid tool set. Call `close()` at shutdown.

`AttachmentRegistry` copies generated or incoming bytes into `.vian/attachments`, checks streamed size, and returns only opaque public metadata. Register bot IDs with `trackBot` so scheduled `expire(now)` maintenance can enumerate expired bytes. A Gate delivery must call `release()` on its opened reader; cleanup waits for active readers and retries failed deletion on the next maintenance pass.
