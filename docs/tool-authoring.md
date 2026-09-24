# Trusted tools

Export a default object from `vian.tools.ts`. Each tool needs a description, JSON object input schema and `execute(input, context)` function. Only listed tools are presented to the model. See [hello](../examples/hello/vian.tools.ts) and [attachment report](../examples/attachments/vian.tools.ts).

Tools run in the daemon process with the bot owner's privileges. Validate inputs in schemas and application code, use `context.abortSignal` for cancellable work, and use `context.idempotencyKey` when calling an external system. A started tool call is recorded durably and is not replayed after a crash. `audit: 'metadata-only'` can keep sensitive tool arguments and results out of the audit payload.

Use `context.attachments.register` for generated files. The model sees an opaque attachment ID rather than a private file path. MCP servers are configured explicitly in `vian.json`; Vian exposes only the named tools in each server's allowlist.

For files beside your tools, declare `const __VIAN_BOT_ROOT__: string` and use that path. Vian replaces it with the registered bot directory when loading the tool bundle. This keeps cloned or moved bots independent of the daemon's working directory.
