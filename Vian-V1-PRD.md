# Vian V1 — Product Requirements Document

**Status:** Ready for implementation  
**Date:** 2026-09-22  
**Target:** V1  
**Primary runtime:** Linux first-class; architecture portable to macOS/Windows  
**Language/runtime:** TypeScript on Bun  
**License target:** MIT  

---

## 1. Product summary

Vian is a **micro-agent runtime** for creating and operating many small, persistent, specialized conversational agents with almost no operational ceremony.

Each Vian bot is intentionally narrow:

- it has one set of explicit tools;
- it has one model configuration;
- it has one messaging Gate in V1;
- it has persistent, auditable conversation history;
- it has no terminal, shell, arbitrary filesystem, browser, coding-agent, subagent, heartbeat, autonomous planning, or self-modification capability unless a developer explicitly creates such a tool;
- it can live in **any existing directory**, alongside arbitrary application code and files;
- it is registered globally so `vian list` can find it regardless of where it lives;
- many bots share one lightweight Vian daemon rather than requiring one large process per bot.

The simplest mental model is:

```text
specific software/API
        ↑
   explicit tools
        ↑
      Vian
        ↑
 messaging Gate
        ↑
      human
```

Vian is not OpenClaw, Hermes, DeepSeek Harness, Claude Code, Codex, or an “agent OS”.

It is a small language interface runtime placed in front of software with a deliberately constrained capability surface.

---

# 2. Product thesis

The common agent stacks of 2026 are excellent at giving one agent many capabilities. Vian is optimized for the inverse problem:

> Create many tiny agents, each with only the capabilities required to administer one specific service.

Examples:

- a family member talks to a household-management agent;
- a Count agent creates transactions, generates reports, and answers accounting questions;
- an Airbnb agent checks reservations and produces guest information;
- a school administration agent looks up records and performs a handful of approved actions;
- an internal SaaS agent exposes several API operations conversationally.

The LLM does not administer the host computer.

It administers the **software represented by its tool set**.

---

# 3. Core philosophy

Every V1 design choice must be evaluated against these rules.

## 3.1 Small external surface

A user should understand the product from a handful of commands:

```bash
vian init .
vian list
vian start count
vian stop count
vian logs count
vian sessions count
vian history count
vian doctor count
```

Advanced internals must not make basic operation more complicated.

## 3.2 Explicit capabilities

A bot can call only:

1. tools exported explicitly by its tool entrypoint;
2. built-in safe Vian tools intentionally exposed by the runtime;
3. explicitly configured MCP tools;
4. Gate-specific tools exposed only while that Gate is active.

No general-purpose shell or filesystem tool exists in V1.

## 3.3 One shared runtime, many logical bots

Vian should not create a Node/Bun/Python process per bot by default.

One daemon multiplexes all registered bots:

```text
                     viand
                       │
       ┌───────────────┼────────────────┐
       │               │                │
     Count           Airbnb          Family
       │               │                │
   Telegram        Telegram         Telegram
```

A bot that is idle should consume almost no incremental resources beyond its configuration, connection state, and small runtime structures.

## 3.4 Local ownership

A bot owns its own durable state.

Its history and runtime files live under its root directory rather than in a centralized global conversation database.

Moving a bot directory should move its history with it.

The global Vian registry stores **where bots are**, not their conversation data.

## 3.5 Gate independence

Telegram is a transport, not the identity or memory model.

No core session, history, principal, conversation, attachment, or tool-call record may depend on a Telegram-specific identifier as its canonical primary identity.

A future WhatsApp Gate must be able to bind a new external identity to the same internal principal/conversation and continue the same history.

## 3.6 Complexity belongs inside Vian

The user-facing contract stays small even if correct handling of concurrency, retries, session routing, streaming, attachments, identities, OAuth, and audit logs requires non-trivial internals.

## 3.7 No framework theater

V1 deliberately does **not** create:

- a plugin marketplace;
- arbitrary runtime plugin discovery;
- an “everything is a plugin” core;
- a skill system;
- agent-to-agent messaging;
- subagents;
- planning engines;
- vector memory;
- browser automation;
- terminal execution;
- filesystem exploration;
- arbitrary code execution requested by the model.

TypeScript modules are sufficient extensibility for tools.

Internal interfaces are sufficient extensibility for Gates and providers.

---

# 4. V1 goals

V1 is successful when all of the following are true.

1. A developer can initialize a Vian bot in any directory, including a non-empty existing project.
2. The CLI interactively creates/updates:
   - `vian.json`;
   - `VIAN.md`;
   - `.env`;
   - a minimal tool entrypoint if one does not exist;
   - `.gitignore` entries without overwriting unrelated content;
   - `.vian/` runtime state.
3. The bot is registered globally and visible in `vian list` with its absolute path.
4. A single Vian daemon can operate many registered Telegram bots.
5. Multiple authorized people can use the same bot concurrently without sessions contaminating each other.
6. Messages from the same canonical conversation are serialized deterministically.
7. The full history remains locally auditable across restarts.
8. Tool calls, results, failures, model information, timing, and delivery status can be audited.
9. Telegram supports:
   - text;
   - formatting;
   - streaming drafts;
   - stopping generation;
   - attachments;
   - inline buttons/callbacks;
   - replies;
   - private chats;
   - optional explicitly enabled groups/topics.
10. V1 supports these model authentication paths:
    - ChatGPT/Codex subscription OAuth;
    - Google Gemini API key;
    - Vercel AI Gateway API key.
11. The model/runtime layer uses a provider-neutral core.
12. The Gate layer uses a transport-neutral core.
13. Custom tools are simple to author and require no Vian plugin framework.
14. A future Gate can be added without changing session/history semantics.
15. `vian list`, `vian doctor --offline`, registry operations, and other local CLI operations feel effectively instantaneous.

---

# 5. Explicit non-goals for V1

V1 does not include:

- WhatsApp;
- Discord;
- Slack;
- email;
- web UI;
- mobile app;
- coding agents;
- shell;
- terminal;
- arbitrary filesystem tools;
- browser automation;
- subagents;
- cron;
- heartbeats;
- autonomous background goals;
- semantic/vector memory;
- RAG;
- tool marketplace;
- remote Vian control plane;
- cloud-managed Vian service;
- multi-machine agent federation;
- untrusted tool sandboxing;
- Docker isolation;
- voice transcription;
- image generation as a built-in capability;
- automatic MCP server discovery;
- multiple simultaneous Gates per bot.

The architecture must not block these, but V1 must not pay their complexity cost.

---

# 6. Chosen stack

## 6.1 TypeScript + Bun

V1 should use **TypeScript on Bun** for both CLI and daemon.

Reasons:

- Vercel AI SDK is TypeScript-native and provides provider-neutral model/tool/streaming primitives.
- grammY is a mature Telegram framework in the same ecosystem.
- Bun natively executes TypeScript.
- Bun includes SQLite support.
- Bun can compile TypeScript into a standalone executable.
- Bun has a very fast startup model suitable for CLI usage.
- the same language can load user-defined tool files directly.
- no Python interpreter, Go sidecar, Rust FFI layer, or Node worker fleet is required.
- custom tools can import the application code that already exists in the directory.

The CLI must use lazy/dynamic imports so simple commands do not load AI SDK, grammY, or model providers.

## 6.2 Core dependencies

Prefer a short, pinned dependency list:

- `ai` — Vercel AI SDK core;
- `@ai-sdk/gateway` — Vercel AI Gateway;
- `@ai-sdk/google` — direct Gemini provider;
- a small dedicated OpenAI ChatGPT/Codex OAuth provider module maintained inside Vian;
- `grammy` — Telegram adapter;
- `bun:sqlite` — storage;
- `zod` or equivalent small schema validator for Vian-owned configuration;
- `@ai-sdk/mcp` only if needed for the V1 MCP adapter.

Use exact versions in the lockfile.

Avoid ORMs, dependency injection frameworks, general plugin frameworks, web frameworks, and heavyweight logging stacks in V1.

---

# 7. Distribution

The target UX is one executable:

```bash
vian
```

Build using Bun standalone compilation.

The same binary can run:

```bash
vian <cli command>
vian daemon
```

The runtime must lazy-load daemon-only modules.

Linux is the first-class V1 operational target.

Development and core functionality should remain portable to macOS and Windows.

---

# 8. High-level architecture

```text
                         ┌─────────────────────┐
                         │      vian CLI       │
                         └──────────┬──────────┘
                                    │
                      registry / local control socket
                                    │
                         ┌──────────▼──────────┐
                         │     Vian daemon     │
                         │  one shared process│
                         └──────────┬──────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
     Bot Runtime A             Bot Runtime B             Bot Runtime C
          │                         │                         │
    ┌─────┼─────┐             ┌─────┼─────┐             ┌─────┼─────┐
    │     │     │             │     │     │             │     │     │
  Gate Provider Tools       Gate Provider Tools       Gate Provider Tools
    │                         │                         │
 Telegram                  Telegram                  Telegram
```

Each `BotRuntime` has:

- immutable bot identity;
- loaded config;
- instructions;
- tool registry;
- model/provider adapter;
- Gate instance;
- local SQLite state;
- session coordinator;
- attachment manager;
- delivery manager.

---

# 9. Core domain objects

Vian must use these concepts consistently.

## 9.1 Bot

A configured logical agent.

Has a stable UUID independent from its name and path.

## 9.2 Gate

A messaging transport adapter.

V1 ships only `telegram`.

Future examples:

- `whatsapp`;
- `discord`;
- `slack`;
- `web`.

A Gate is explicitly **not** the source of truth for conversations.

## 9.3 Principal

A canonical Vian identity representing one trusted human or service actor.

Examples:

```text
juan
mom
dad
accountant
```

A principal can have multiple external Gate identities over time.

## 9.4 Gate binding

Maps an external identity to a canonical Vian identity.

Example:

```text
Telegram user 123456789
        ↓
principal "mom"
```

Future:

```text
WhatsApp +57...
        ↓
principal "mom"
```

Both point to the same principal.

## 9.5 Conversation

A canonical interaction channel inside one bot.

A conversation is Gate-independent.

Private DM default:

```text
bot + principal -> one canonical conversation
```

Group/topic support maps an external group/thread binding to a canonical conversation.

## 9.6 Session

The model-context lifecycle for a canonical conversation.

V1 normally maintains one active session per conversation, with explicit reset/new-session operations available later through CLI or Gate command.

## 9.7 Run

One agent execution caused by one inbound event.

A run may contain:

- model streaming;
- zero or more tool calls;
- tool results;
- final assistant output;
- attachment deliveries.

## 9.8 Tool

An explicitly registered model-callable capability.

## 9.9 Attachment

A file known to Vian through an opaque ID.

The model never needs a host filesystem path.

## 9.10 Provider

A model transport/auth adapter.

V1 providers:

- `openai-chatgpt`;
- `google`;
- `vercel-ai-gateway`.

---

# 10. Bot directory contract

A Vian bot may live anywhere.

Example:

```text
~/Projects/count/
├── src/
├── package.json
├── ...
├── vian.json
├── VIAN.md
├── .env
├── vian.tools.ts
└── .vian/
    ├── state.sqlite
    ├── attachments/
    ├── cache/
    └── logs/
```

Vian must never assume the directory exists only for Vian.

It may be:

- an application repository;
- a monorepo package;
- a service folder;
- a plain directory;
- a directory that already contains `.env`, `package.json`, `.gitignore`, and other files.

## 10.1 Files

### `vian.json`

Versioned declarative bot configuration.

Safe to commit except for values that incorrectly contain secrets; the CLI must strongly discourage inline secrets.

### `VIAN.md`

Human-editable system instructions.

This is the bot’s product/domain instruction document.

It should be treated similarly to a local operational constitution for the agent.

### `.env`

Local secret values such as:

```dotenv
TELEGRAM_BOT_TOKEN=...
GEMINI_API_KEY=...
AI_GATEWAY_API_KEY=...
```

The CLI creates the file if absent.

If `.env` already exists:

- preserve all existing lines;
- never overwrite an existing value silently;
- append only missing Vian variables;
- explain conflicts;
- keep comments and unrelated entries intact.

On POSIX, enforce `0600` where practical.

### `vian.tools.ts`

Default tool entrypoint.

It may be renamed; the path is configured in `vian.json`.

### `.vian/`

Bot-local Vian state.

Must be gitignored by default.

Contains history, attachment files, cache, and runtime logs.

---

# 11. Global Vian state

Vian needs a small machine-local home.

Linux/XDG example:

```text
~/.config/vian/
    config.json

~/.local/share/vian/
    registry.sqlite
    credentials/
    vian.sock
```

Responsibilities:

## Global registry

Stores:

- bot UUID;
- alias/name;
- absolute root path;
- registration timestamp;
- enabled/autostart state;
- last observed config metadata.

It does **not** store conversation history.

## Credential profiles

OAuth credentials that should not be copied into each bot directory live globally.

Example:

```text
openai-chatgpt:default
```

A bot references the credential profile.

## Control socket

The daemon exposes a local-only Unix domain socket on Linux.

No TCP port is required.

CLI commands such as `start`, `stop`, `restart`, and live `status` talk to the daemon through this socket.

Socket permissions must restrict access to the current OS user.

---

# 12. Global registry behavior

## 12.1 Explicit registration

Vian does not scan the whole filesystem.

A bot becomes known globally through:

```bash
vian init .
vian create ...
vian register /path/to/bot
```

## 12.2 Moving a bot

Because the bot UUID is stored in `vian.json`, moving the directory does not change its identity.

The developer can run:

```bash
vian register /new/path
```

If the UUID already exists at an unavailable old path, update the registry path.

## 12.3 Duplicate UUID

If the same bot UUID appears simultaneously at two valid paths, fail safely and require one of:

```bash
vian register . --move
vian register . --clone
```

`--clone` generates a new bot UUID.

## 12.4 Unregistering

```bash
vian unregister count
```

removes only the global registry entry.

It must not delete the bot directory, history, or attachments.

V1 should intentionally omit a destructive `delete --files` command.

---

# 13. `vian.json`

Example:

```json
{
  "$schema": "https://vian.dev/schema/v1.json",
  "schemaVersion": 1,
  "id": "019c8b60-7a2b-7f20-a8d6-4c7f584a30cb",
  "name": "count",

  "instructions": "./VIAN.md",
  "tools": "./vian.tools.ts",

  "model": {
    "provider": "vercel-ai-gateway",
    "id": "openai/gpt-6-astra",
    "credential": "env:AI_GATEWAY_API_KEY"
  },

  "gate": {
    "type": "telegram",
    "credential": "env:TELEGRAM_BOT_TOKEN",

    "access": {
      "mode": "pairing",
      "groups": false
    },

    "telegram": {
      "streaming": true,
      "format": "markdown-v2",
      "buttons": true,
      "stopGeneration": true
    }
  },

  "runtime": {
    "maxSteps": 12,
    "runTimeoutSeconds": 180,
    "perBotConcurrency": 4,
    "sameSessionPolicy": "queue"
  },

  "context": {
    "strategy": "summary-tail",
    "maxRecentMessages": 80
  },

  "attachments": {
    "defaultTtlHours": 24,
    "maxFileBytes": 52428800
  },

  "mcp": []
}
```

## 13.1 Configuration principles

- `schemaVersion` is mandatory.
- `id` is stable and generated once.
- all paths are relative to the bot root unless absolute.
- secret values should be references, never inline strings.
- Gate-specific configuration is nested under the Gate.
- provider-specific configuration is nested under the provider only when required.
- unknown fields should produce a clear warning or validation error depending on schema rules.
- changes are validated atomically before a running bot reloads.

---

# 14. `VIAN.md`

`VIAN.md` contains custom instructions, domain policy, terminology, and tool-use rules.

Example:

```md
# Count Agent

You administer the family's Count workspace.

## Responsibilities

- Answer questions about accounts and transactions.
- Create transactions only when the user clearly asks you to.
- Prefer asking for missing accounting data rather than inventing it.
- Use generated reports when a user requests a file.

## Domain rules

- Amounts are COP unless the user explicitly specifies another currency.
- Never create a transaction from an ambiguous message.
```

Vian prepends a small runtime-owned system preamble that explains:

- current canonical principal;
- available tools;
- Gate capabilities for this run;
- attachment semantics;
- runtime constraints.

The runtime preamble must stay short.

Gate-specific instructions must be generated at runtime and **must not be persisted into conversation history**.

---

# 15. Tool authoring

Vian does not need a plugin system.

A tool entrypoint is a normal TypeScript module.

To avoid forcing every bot to install a Vian SDK package, the minimum V1 contract should be dependency-free and JSON-Schema based.

Example:

```ts
export const tools = {
  getBalance: {
    description: "Get the current balance of an account.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "string" }
      },
      required: ["accountId"],
      additionalProperties: false
    },

    async execute(input, ctx) {
      return await ctx.services.count.getBalance(input.accountId);
    }
  },

  generateReport: {
    description: "Generate a PDF report for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" }
      },
      required: ["from", "to"],
      additionalProperties: false
    },

    async execute(input, ctx) {
      const path = await buildReport(input);

      const attachment = await ctx.attachments.register({
        path,
        name: "report.pdf",
        mimeType: "application/pdf"
      });

      return {
        message: "Report generated.",
        attachment
      };
    }
  }
};
```

Vian converts the tool declarations into AI SDK tools internally.

## 15.1 Tool context

Every tool receives a server-side context:

```ts
interface VianToolContext {
  botId: string;
  principalId: string;
  conversationId: string;
  sessionId: string;
  runId: string;
  abortSignal: AbortSignal;

  attachments: AttachmentAPI;
  logger: ScopedLogger;

  services: Record<string, unknown>;
}
```

`ctx.services` is optional convenience wiring supplied by the tool module/runtime integration.

V1 must not serialize this context into the model prompt.

## 15.2 Tool trust boundary

Tool code is trusted application code.

It runs in the Vian daemon process in V1.

A tool may import local modules and perform whatever that developer-written code does.

The LLM cannot invoke code that was not exposed as a tool.

Future container isolation can move tool execution across a boundary without changing the model-facing tool contract.

---

# 16. MCP support

V1 supports manually configured MCP servers, but avoids automatic expansion of capabilities.

Example:

```json
{
  "mcp": [
    {
      "name": "siigo",
      "transport": "stdio",
      "command": "siigo-mcp",
      "args": [],
      "tools": [
        "get_invoice",
        "list_customers"
      ]
    }
  ]
}
```

Rules:

- the MCP server itself must be explicitly configured;
- Vian may call MCP `listTools` to obtain schemas;
- only tool names explicitly allowlisted in `tools` become model-visible;
- `tools: "*"` may exist as an explicit opt-in;
- tools newly added by an MCP server must not silently become available under an explicit allowlist;
- MCP tool calls use the same auditing model as native tools.

V1 should start with `stdio` transport unless HTTP support is essentially free in the chosen library.

---

# 17. Attachment model

Attachments are a core Vian concept, not a Telegram concept.

## 17.1 Storage

Bot-local:

```text
.vian/attachments/
```

Each attachment receives:

- internal opaque ID;
- original/display name;
- MIME type;
- size;
- SHA-256;
- origin;
- creation time;
- expiry time;
- local path known only to the runtime.

## 17.2 Model-facing representation

The model sees:

```json
{
  "id": "att_01K...",
  "name": "report.pdf",
  "mimeType": "application/pdf",
  "size": 184992
}
```

It does not see:

```text
/home/user/projects/count/.vian/attachments/...
```

## 17.3 Built-in attachment tools

Vian may expose safe core tools:

```text
list_attachments
send_attachment
```

`send_attachment` accepts an attachment ID, never a path.

These tools remain Gate-neutral.

The Gate translates the attachment into its native delivery API.

## 17.4 Incoming attachments

Telegram media is normalized into Vian attachments.

The canonical inbound message contains attachment references.

If the selected model provider supports the file/image type natively, the provider adapter may include it as model input.

Otherwise the agent still receives metadata and can pass the attachment to its application-specific tools.

## 17.5 Cleanup

Expired attachments are deleted by lightweight daemon maintenance.

Rows remain in audit history with status `expired/deleted`, but paths become null/unavailable.

---

# 18. Gate abstraction

V1 ships Telegram but the core must know only the `Gate` contract.

Illustrative interface:

```ts
interface GateAdapter<TConfig = unknown> {
  readonly type: string;

  capabilities(config: TConfig): GateCapabilities;

  validate(
    config: TConfig,
    secrets: SecretResolver
  ): Promise<ValidationResult>;

  start(ctx: GateRuntimeContext<TConfig>): Promise<GateHandle>;

  render(
    message: CanonicalAssistantMessage,
    ctx: RenderContext
  ): Promise<RenderedDelivery[]>;

  deliver(
    delivery: RenderedDelivery,
    destination: GateDestination,
    ctx: DeliveryContext
  ): Promise<DeliveryReceipt>;

  modelContext?(
    ctx: GateModelContext
  ): GatePromptExtension | undefined;

  modelTools?(
    ctx: GateModelContext
  ): VianToolSet;
}
```

A Gate owns:

- connecting to its external platform;
- receiving events;
- normalizing them;
- external user/chat metadata;
- rendering canonical output;
- delivery;
- retries specific to the platform;
- platform-specific model context/tools.

A Gate does not own:

- canonical session IDs;
- history;
- model selection;
- tool execution;
- provider authentication;
- bot instructions;
- canonical principals.

---

# 19. Gate capabilities

```ts
interface GateCapabilities {
  text: boolean;
  formatting: string[];
  streaming: boolean;
  stopGeneration: boolean;
  buttons: boolean;
  attachments: boolean;
  replies: boolean;
  groups: boolean;
  threads: boolean;
}
```

This allows the runtime to construct a tiny dynamic prompt extension such as:

```text
Current Gate: Telegram.

Available presentation capabilities:
- formatted text;
- inline buttons;
- file delivery;
- live response streaming is handled automatically by Vian.

Write normal Markdown. Vian renders it for Telegram.
Use the Telegram button tool only when an explicit interactive choice is useful.
```

This extension exists only for the current run.

It is not written into history.

A future WhatsApp Gate can supply a different capability block without affecting stored messages.

---

# 20. Telegram Gate — V1

## 20.1 Transport

Default: long polling.

Reasons:

- ideal for a mini PC behind NAT;
- no public HTTP endpoint;
- no TLS/domain setup;
- simple failure model;
- easy local installation.

The Gate abstraction must allow a future webhook implementation.

## 20.2 Library

Use grammY for stable Bot API functionality.

For very new Bot API methods not yet represented in grammY’s types/runtime, the Telegram Gate may use a tiny direct Bot API request helper rather than blocking on framework support.

## 20.3 V1 inbound support

Required:

- private text messages;
- replies;
- photos;
- documents/files;
- captions;
- callback queries from inline buttons;
- generation-stop updates;
- groups/supergroups only when explicitly enabled;
- Telegram forum topic IDs when groups are enabled.

Optional but cheap:

- audio/voice/video received as generic attachments without automatic transcription.

## 20.4 V1 outbound support

Required:

- formatted text;
- automatic long-message chunking;
- document/photo/file delivery through attachment handles;
- inline buttons;
- reply-to behavior when useful;
- live streaming drafts;
- final persisted message.

## 20.5 Formatting

Canonical Vian assistant content should be ordinary Markdown.

The Telegram renderer converts it to Telegram-safe output.

V1 supports `MarkdownV2`.

The renderer must:

- escape Telegram-reserved characters correctly;
- preserve code blocks;
- preserve inline code;
- preserve links;
- split messages without breaking formatting entities where practical;
- fall back to plain text if Telegram rejects a formatted payload rather than dropping the response.

Do **not** force every model to perfectly escape raw MarkdownV2 itself.

This keeps history portable to future Gates.

## 20.6 Rich Messages

Telegram Bot API now supports Rich Messages.

V1 may expose this behind:

```json
{
  "telegram": {
    "format": "markdown-v2"
  }
}
```

with future/experimental option:

```json
{
  "telegram": {
    "format": "rich-markdown"
  }
}
```

Rich Messages must not become a core Vian dependency.

## 20.7 Live streaming

Use Telegram’s native draft streaming.

Algorithm:

1. start the model stream;
2. accumulate canonical text;
3. throttle draft updates;
4. call Telegram draft-streaming method with the current rendered partial;
5. refresh often enough that the ephemeral draft does not disappear;
6. when generation completes:
   - stop/update draft;
   - deliver the final persistent message;
7. if generation is stopped:
   - abort the model request;
   - persist a `run_cancelled` event;
   - optionally persist/send the partial answer according to policy.

Default Telegram config:

```json
{
  "streaming": true,
  "stopGeneration": true
}
```

The runtime should avoid excessive draft API calls by using a small adaptive throttle.

## 20.8 Tool-call phase

Vian must never expose hidden chain-of-thought.

When a tool call temporarily interrupts text streaming, Telegram may display a generic platform-safe state such as:

```text
Working…
```

or a native thinking/draft indicator.

No private reasoning is shown.

## 20.9 Inline buttons

Buttons are exposed through a Telegram-only model tool.

Illustrative tool:

```text
telegram_present_buttons
```

Input:

```json
{
  "text": "Which account should I use?",
  "rows": [
    [
      { "label": "Personal", "value": "personal" },
      { "label": "Business", "value": "business" }
    ]
  ]
}
```

Implementation:

- Vian creates an opaque callback action ID;
- only the opaque ID is placed in Telegram `callback_data`;
- the full model-defined value is stored server-side;
- callback IDs have TTLs;
- callback user authorization is checked again;
- `answerCallbackQuery` is called quickly;
- the callback is normalized into an inbound Vian event for the same canonical conversation.

The callback must never trust a client-supplied principal/session mapping.

---

# 21. Authorization

Secure default:

```text
deny unless paired/allowlisted
```

## 21.1 Pairing

Default V1 experience should be pairing-based.

When an unknown Telegram user sends a private message:

1. do not send the message to the model;
2. create a short-lived pairing request;
3. return a one-time code;
4. administrator runs:

```bash
vian access approve count ABCD-1234 --as mom
```

5. Vian creates or updates the canonical principal and Telegram binding.

Useful commands:

```bash
vian access list count
vian access pending count
vian access approve count <code> --as <principal>
vian access revoke count <principal>
```

## 21.2 Direct allowlist

The config may alternatively contain explicitly provisioned identities.

Never use Telegram usernames as security identity.

Use stable Telegram numeric user IDs.

## 21.3 Groups

Groups are disabled by default.

When enabled, V1 supports explicit policy:

- approved users;
- approved chats;
- mention/reply gating.

No open group behavior by default.

---

# 22. Canonical identity and Gate migration

This is essential to future WhatsApp support.

External identities are bindings:

```text
gate              external identity       principal
----------------------------------------------------
telegram          123456789               mom
whatsapp          +573001234567           mom
```

Canonical conversation:

```text
conv_f2ad...
```

may be bound to:

```text
telegram DM 123456789
```

and later:

```text
whatsapp chat +573001234567
```

The stored session remains:

```text
conv_f2ad...
```

No message rewrite occurs.

## 22.1 Important limitation

Vian cannot magically know that a future WhatsApp number and a Telegram user are the same human.

The data model enables continuity, but the administrator must explicitly bind the new external identity to the existing principal/conversation.

Future UX:

```bash
vian access link count mom --gate whatsapp --identity +573...
```

---

# 23. Session routing

Vian must never construct sessions directly from opaque Gate IDs throughout the codebase.

Routing pipeline:

```text
raw Gate event
      ↓
Gate normalization
      ↓
authorization
      ↓
external identity/chat binding lookup
      ↓
canonical principal
      ↓
canonical conversation
      ↓
session coordinator
```

For a private Telegram DM:

```text
telegram user -> principal -> conversation -> session
```

For a group/topic:

```text
telegram chat + topic -> canonical conversation
telegram sender       -> canonical principal
```

---

# 24. Concurrency model

This is one of Vian’s most important hidden responsibilities.

## 24.1 Different sessions

Runs from different sessions may execute concurrently.

Example:

```text
Mom -> Count ───── run A
Dad -> Count ───── run B
```

No blocking relationship is required unless global/per-bot concurrency limits are reached.

## 24.2 Same session

Only one run may mutate one session at a time.

Default policy:

```json
{
  "sameSessionPolicy": "queue"
}
```

If the same person sends:

```text
message 1
message 2
message 3
```

while message 1 is still running:

- 2 and 3 are durably queued;
- order is preserved;
- they are not merged into another user’s session;
- they are processed after the active run finishes.

V1 should not default to interruption because transactional tools may be executing.

## 24.3 Durable inbox

Inbound events are inserted into SQLite before agent execution.

Each Gate event has an idempotency key.

Telegram uses its update/message identity to prevent duplicate ingestion after polling/reconnect.

## 24.4 Session lease

The session coordinator acquires an exclusive logical lease for one session.

Lease state is durable enough to detect abnormal daemon termination.

## 24.5 Crash during a tool call

Vian must prioritize avoiding duplicate side effects.

Tool-call states:

```text
pending
started
succeeded
failed
interrupted
```

If the daemon dies after marking a tool call `started` but before recording success, Vian must **not automatically replay the tool call** on restart.

The run becomes `interrupted`.

The next interaction can explain that the previous operation may have partially executed.

Tool authors may optionally consume a Vian-generated idempotency key:

```text
run_id + tool_call_id
```

to make external mutations safely retryable.

---

# 25. Persistent history and auditing

History belongs to the bot:

```text
<bot>/.vian/state.sqlite
```

SQLite runs in WAL mode.

Use transactions and a reasonable busy timeout.

## 25.1 Event log

The append-only event log is the audit source of truth.

Illustrative event types:

```text
conversation_created
principal_bound
inbound_message
attachment_received
run_started
model_started
assistant_partial_not_persisted
tool_call_requested
tool_call_started
tool_call_succeeded
tool_call_failed
assistant_message
delivery_queued
delivery_succeeded
delivery_failed
run_completed
run_failed
run_cancelled
context_summary_created
session_reset
authorization_changed
```

Do not persist every streamed token.

Persist meaningful durable boundaries.

## 25.2 Suggested tables

```text
meta
principals
gate_bindings
conversations
conversation_bindings
sessions
events
runs
tool_calls
attachments
inbox
deliveries
pairing_requests
context_summaries
```

## 25.3 Gate metadata

Telegram-specific metadata may be stored as audit metadata, but never as the canonical session identity.

Example:

```json
{
  "gate": "telegram",
  "externalMessageId": "8127",
  "externalChatId": "123456789"
}
```

## 25.4 Auditable tool calls

Store:

- tool name;
- validated arguments;
- start/end timestamps;
- duration;
- state;
- result or error;
- run ID;
- session ID.

Allow future tool-level audit redaction.

V1 may include:

```ts
audit: "full" | "metadata-only"
```

with `full` default for trusted local deployments.

## 25.5 Provider metadata

Store:

- provider;
- model;
- usage if supplied;
- finish reason;
- latency;
- request/run correlation IDs when available.

Never store provider access tokens.

---

# 26. History CLI

## List sessions

```bash
vian sessions count
```

Example:

```text
SESSION        PRINCIPAL   LAST ACTIVE          MESSAGES   STATE
ses_01K...     mom         2026-09-22 21:41    84         active
ses_01J...     dad         2026-09-22 20:12    19         active
```

## Inspect transcript

```bash
vian history count --session ses_01K...
```

Readable transcript with collapsed tool-call sections.

## Machine-readable export

```bash
vian history count --session ses_01K... --jsonl
```

## Filter

```bash
vian history count --principal mom
vian history count --since 7d
vian history count --tools
```

History commands read bot-local SQLite directly and do not need the daemon.

---

# 27. Context construction

Persistent audit history and model context are separate concepts.

Vian keeps all history but does not need to resend all history forever.

Default:

```json
{
  "strategy": "summary-tail",
  "maxRecentMessages": 80
}
```

Context builder:

```text
small Vian runtime preamble
+ VIAN.md
+ current principal context
+ current Gate capability context
+ latest durable conversation summary, if any
+ recent canonical messages/tool outcomes
```

## 27.1 Summaries

When the session grows beyond the configured context policy:

- generate/update a concise conversation summary;
- store it separately;
- never delete the original audit events;
- append an audit event recording that summary generation occurred.

If summary generation fails, continue with a recent-tail strategy.

No vector database or semantic memory in V1.

---

# 28. Provider abstraction

Provider selection must not leak into bot logic.

Core asks for an AI SDK-compatible language model.

Conceptually:

```ts
interface VianProvider {
  id: string;

  resolveModel(
    modelId: string,
    credential: CredentialReference
  ): Promise<LanguageModel>;

  validate?(): Promise<ValidationResult>;
}
```

V1 providers are statically registered internal modules.

No external provider plugin loader.

---

# 29. Vercel AI Gateway provider

Config:

```json
{
  "model": {
    "provider": "vercel-ai-gateway",
    "id": "openai/gpt-6-astra",
    "credential": "env:AI_GATEWAY_API_KEY"
  }
}
```

Use the official AI SDK Gateway provider.

Expected features:

- streaming;
- tools;
- multi-provider model IDs;
- provider routing handled by Vercel.

The CLI setup wizard asks for:

```text
AI_GATEWAY_API_KEY
model ID
```

The key is written to `.env`.

---

# 30. Google Gemini provider

Config:

```json
{
  "model": {
    "provider": "google",
    "id": "gemini-3.8-flash",
    "credential": "env:GEMINI_API_KEY"
  }
}
```

Use the official AI SDK Google provider.

The setup wizard asks for:

```text
GEMINI_API_KEY
model ID
```

The key is written to `.env`.

Provider model IDs must remain user-configurable rather than baked into core assumptions.

---

# 31. ChatGPT/Codex OAuth provider

This feature must be named carefully.

Vian V1 supports:

> **ChatGPT/Codex subscription OAuth for model access**

This is not the generic “Sign in with ChatGPT” identity button.

Generic Sign in with ChatGPT only authenticates identity for supported apps and does not by itself grant arbitrary ChatGPT conversations, files, billing data, or general model tokens.

The Vian provider is specifically the Codex/ChatGPT subscription authentication path used by current Codex-compatible clients.

Suggested provider ID:

```text
openai-chatgpt
```

Config:

```json
{
  "model": {
    "provider": "openai-chatgpt",
    "id": "gpt-6-astra",
    "credential": "oauth:openai-chatgpt:default"
  }
}
```

## 31.1 CLI

```bash
vian auth login openai-chatgpt
vian auth list
vian auth status openai-chatgpt
vian auth logout openai-chatgpt
```

`vian init` may invoke the login flow automatically when this provider is selected.

## 31.2 OAuth flow

Follow the proven Codex/OpenClaw/Hermes pattern:

- authorization code + PKCE browser flow;
- loopback callback on the currently supported Codex redirect;
- strong random `state`;
- strict state validation;
- token exchange;
- access token expiry tracking;
- refresh-token rotation;
- atomic credential writes;
- typed re-authentication state after terminal refresh failures.

Headless support should use the currently supported device/manual flow where available.

## 31.3 Credential ownership

OAuth credentials belong to Vian’s global credential store, not each bot `.env`.

Reason:

- one ChatGPT account may power multiple local bots;
- refresh-token rotation should have one canonical writer;
- copying refresh tokens into many project directories creates race conditions and unnecessary secret duplication.

Bots reference a credential profile.

## 31.4 Token sink

Within Vian, one credential profile is the canonical source for its refresh token.

After Vian owns the credential:

- refresh it centrally;
- persist rotated refresh tokens immediately and atomically;
- do not silently bounce between multiple external credential files;
- if refresh receives a terminal OAuth error, mark the credential as requiring re-authentication rather than retrying forever.

## 31.5 Transport isolation

OpenAI subscription transport details must live entirely under:

```text
providers/openai-chatgpt/
```

The rest of Vian must not know:

- endpoint peculiarities;
- account headers;
- OAuth token shape;
- Codex transport internals.

This adapter needs contract tests because it is the provider most likely to change independently of Vian.

---

# 32. Secret resolution

Configuration uses references:

```text
env:TELEGRAM_BOT_TOKEN
env:GEMINI_API_KEY
env:AI_GATEWAY_API_KEY
oauth:openai-chatgpt:default
```

Secret resolver interface:

```ts
resolve(reference: string): Promise<string | Credential>
```

Rules:

- secrets never appear in `vian list`;
- logs redact known secret values;
- `vian inspect` shows references, not values;
- `.env` is loaded relative to bot root;
- OAuth store files use restrictive permissions;
- config validation rejects obvious inline bot/API tokens unless explicitly overridden.

---

# 33. Model execution loop

Core algorithm:

```text
1. dequeue inbound canonical event
2. acquire session lease
3. build context
4. resolve provider/model
5. build native + MCP + Gate-specific tool set
6. start streamed model run
7. stream canonical text to Gate draft renderer
8. execute validated tool calls
9. append audit events transactionally
10. produce final canonical assistant message
11. persist it
12. enqueue Gate delivery
13. deliver
14. mark run complete
15. release session
16. process next queued event
```

Use AI SDK’s model/tool loop rather than building a custom ReAct engine.

Vian owns orchestration and persistence around the model loop.

---

# 34. Delivery outbox

External delivery is not the same transaction as local persistence.

Use a durable delivery outbox.

Example lifecycle:

```text
delivery_queued
delivery_sending
delivery_succeeded
delivery_failed_retryable
delivery_failed_terminal
```

Benefits:

- daemon restart does not lose final responses;
- Telegram temporary failures can be retried;
- chunked messages can preserve order;
- auditing can distinguish “agent answered” from “Telegram delivered”.

## 34.1 Per-destination serialization

Outbound Telegram deliveries to one destination are serialized so chunks/files from separate runs cannot interleave incorrectly.

Different destinations may deliver concurrently.

## 34.2 Flood control

Honor Telegram retry/flood-control responses.

Do not continually retry while inside a known penalty window.

---

# 35. Message length handling

Telegram has platform-specific message limits.

The renderer owns splitting.

Canonical stored assistant content remains one message.

Telegram delivery may become:

```text
canonical assistant message
        ↓
delivery part 1
delivery part 2
delivery part 3
```

All parts link to one canonical event.

Chunking must avoid splitting:

- UTF-8/code points incorrectly;
- code fences where practical;
- formatting syntax into invalid fragments.

If formatting-safe chunking becomes ambiguous, fall back to plain text for that chunk.

---

# 36. CLI design

The CLI is a major product surface.

It must be fast, quiet, predictable, and scriptable.

## 36.1 `vian init [path]`

Initialize Vian inside an existing directory.

Default:

```bash
vian init .
```

Wizard:

```text
Bot name: count
Instructions file: ./VIAN.md
Tools file: ./vian.tools.ts

Model provider:
  1. ChatGPT / Codex OAuth
  2. Google Gemini API key
  3. Vercel AI Gateway

Model: ...

Gate:
  Telegram

Telegram bot token: ********

Access:
  Pair users on first contact

Register globally? yes
Enable on daemon startup? yes
```

Requirements:

- non-destructive;
- detects existing files;
- never wipes `.env`;
- writes atomically;
- appends gitignore entries;
- registers absolute path;
- validates config at end;
- if daemon is running, asks it to load the bot immediately.

## 36.2 `vian create`

Convenience form:

```bash
vian create count ~/Agents/count
```

If directory does not exist, create it.

If it exists, behave like `vian init`.

No special global `bots/` folder exists.

## 36.3 `vian register`

Register an already configured bot:

```bash
vian register .
vian register ~/Projects/count
```

## 36.4 `vian list`

Required output:

```text
NAME      STATUS     GATE       MODEL                     SESSIONS   PATH
count     running    telegram   openai/gpt-6-astra       3          /home/jc/Projects/count
airbnb    running    telegram   gemini-3.8-flash         2          /srv/airbnb-agent
family    stopped    telegram   openai/gpt-6-astra       6          /home/jc/Agents/family
```

If a path no longer exists:

```text
count     missing
```

`vian list` must work even when daemon is offline.

Optional:

```bash
vian list --json
```

## 36.5 Runtime control

```bash
vian start count
vian stop count
vian restart count

vian enable count
vian disable count
```

`enable/disable` controls daemon autostart behavior.

## 36.6 Diagnostics

```bash
vian status count
vian inspect count
vian doctor count
vian doctor count --online
```

`doctor` checks:

- bot path;
- config schema;
- instruction file;
- tool entrypoint import;
- duplicate tool names;
- `.env`;
- required secrets;
- DB migration state;
- attachment directory permissions;
- Gate configuration;
- provider configuration.

`--online` additionally probes:

- Telegram `getMe`;
- provider authentication/model availability where a cheap probe exists;
- configured MCP connectivity.

## 36.7 Logs

```bash
vian logs count
vian logs count --follow
```

Runtime diagnostics only.

Conversation history is separate.

## 36.8 History

```bash
vian sessions count
vian history count
vian history count --principal mom
vian history count --session ses_...
vian history count --jsonl
```

## 36.9 Access

```bash
vian access list count
vian access pending count
vian access approve count <code> --as mom
vian access revoke count mom
```

## 36.10 Authentication

```bash
vian auth login openai-chatgpt
vian auth list
vian auth status openai-chatgpt
vian auth logout openai-chatgpt
```

## 36.11 Local test

Useful developer command:

```bash
vian test count "What is the current balance?"
```

Default behavior:

- run locally without Telegram;
- use the real bot instructions/tools/provider;
- use an ephemeral test conversation unless `--session` is supplied;
- print tool activity compactly.

This dramatically improves tool development without adding a terminal-chat product.

---

# 37. CLI performance requirements

Local CLI commands must not boot the agent runtime.

Engineering targets:

| Operation | Target |
|---|---:|
| `vian --help` | <100 ms |
| `vian list` with warm filesystem cache | <75 ms |
| `vian inspect <bot>` | <100 ms |
| `vian doctor --offline` simple bot | <250 ms excluding user tool import |
| daemon control round trip | <100 ms on local machine |

These are V1 performance budgets to benchmark in CI/dev, not external guarantees.

Implementation guidance:

- standalone Bun executable;
- lazy-load command modules;
- registry access directly through SQLite;
- avoid network checks unless explicitly requested;
- no dependency graph/model provider import for `list`;
- no daemon startup for read-only local operations.

---

# 38. Daemon

Foreground:

```bash
vian daemon
```

Responsibilities:

- read global registry;
- start enabled bots;
- maintain Gate connections;
- coordinate sessions;
- execute models/tools;
- maintain delivery outboxes;
- clean expired attachments;
- expose local control socket;
- respond to register/start/stop/reload commands.

## 38.1 No process per bot

A `BotRuntime` is an object/lifecycle, not an OS process.

## 38.2 Failure isolation

All bot event handlers and tool executions must be wrapped.

An ordinary tool exception must fail that tool/run, not crash the daemon.

Unhandled runtime bugs should be logged with bot/run IDs.

CPU-blocking or malicious trusted tool code can still block the shared process in V1; container/worker isolation is a post-V1 option.

## 38.3 Concurrency limits

Defaults:

```text
global runs: bounded
per bot: 4
per session: 1
```

Use queues rather than spawning unlimited work.

---

# 39. Linux service integration

For 24/7 use, V1 should provide:

```bash
vian service install
vian service start
vian service stop
vian service restart
vian service status
```

Linux implementation:

- systemd user service;
- `Restart=on-failure`;
- no exposed TCP port;
- starts `vian daemon`.

The CLI may detect whether user lingering is required for operation after logout and print the exact command/configuration needed.

The service layer is operational glue, not part of the agent model.

---

# 40. Hot reload

Configuration changes should not require restarting all bots.

Minimum V1:

```bash
vian restart count
```

reloads:

- `vian.json`;
- `VIAN.md`;
- `.env`;
- tool entrypoint;
- MCP configuration;
- provider config;
- Gate config.

Optional file watching can be added if low complexity.

Prefer explicit restart over fragile magic in V1.

---

# 41. Tool reload

Bun can import TypeScript directly.

Vian loads the configured absolute tool module.

Requirements:

- validate exported contract before replacing the active tool set;
- if reload fails, keep the previous valid bot runtime running when possible;
- log the validation/import error;
- never half-apply a tool set.

Local imports inside the bot directory should work normally.

Vian must not require the bot to use a special framework package merely to define a tool.

---

# 42. Telegram-specific model tools

Gate-specific tools exist only for a run originating from that Gate.

V1 Telegram tool set may include only:

```text
telegram_present_buttons
```

Potential future additions should be resisted unless they add clear value.

Streaming is runtime behavior, not a model tool.

Formatting is renderer behavior, not a model tool.

Attachment sending is a Gate-neutral Vian tool.

This keeps the Telegram prompt/tool surface tiny.

---

# 43. Canonical message representation

Core messages must support multiple content parts without depending on provider or Gate formats.

Illustrative type:

```ts
type ContentPart =
  | { type: "text"; text: string }
  | { type: "attachment"; attachmentId: string }
  | {
      type: "interaction";
      actionId: string;
      label: string;
      value: unknown;
    };

interface CanonicalMessage {
  id: string;
  conversationId: string;
  principalId?: string;
  role: "user" | "assistant" | "system-event";
  parts: ContentPart[];
  createdAt: string;
}
```

Gate metadata is stored separately.

Provider adapters convert canonical messages into provider-native request shapes.

---

# 44. Telegram reply semantics

When a Telegram message replies to an earlier bot/user message:

- record the external reply target as Gate metadata;
- if the target maps to a known canonical message, add `replyToMessageId`;
- do not create a new session merely because it is a reply.

Forum topics, when enabled, map to separate canonical conversations by default.

---

# 45. Commands inside Telegram

Keep slash commands minimal.

V1 built-ins:

```text
/start
/help
/status
/new
/stop
```

Behavior:

- `/new` starts a fresh canonical session for that conversation but preserves audit history;
- `/stop` aborts current generation where possible;
- `/status` reports bot/model identity without secrets;
- `/help` reports available user-facing operations, not internal tool schemas.

Application-specific commands are unnecessary because natural language + tools is the product.

---

# 46. Session reset

`/new` or future CLI reset must:

- create a new session ID;
- preserve conversation identity;
- preserve all old history;
- record a `session_reset` event;
- keep principal/Gate bindings unchanged.

No destructive clear-by-default behavior.

---

# 47. Error behavior

## Provider failure

User receives a concise failure message.

Audit contains typed provider error.

Do not expose credentials, raw authorization headers, or internal stack traces.

## Tool failure

Model may receive a safe structured tool error if continuation is useful.

Audit stores full local diagnostic subject to redaction policy.

## Gate delivery failure

Keep the assistant message persisted.

Retry according to platform policy.

Audit delivery separately.

## Invalid Telegram formatting

Retry as escaped/plain text.

Never lose an otherwise valid assistant answer because formatting failed.

## Invalid tool module after restart

Bot stays `error` or retains last valid runtime according to restart mode.

`vian status` explains exactly what failed.

---

# 48. Observability

No heavyweight observability platform in V1.

Use structured local logs:

```json
{
  "level": "info",
  "botId": "...",
  "sessionId": "...",
  "runId": "...",
  "event": "tool_call_succeeded",
  "tool": "generateReport",
  "durationMs": 812
}
```

CLI renders human-readable output by default.

Optional:

```bash
vian logs count --json
```

Log rotation should prevent unbounded disk use.

Conversation audit remains in SQLite, not log files.

---

# 49. Security model

V1 is designed for:

- owner-controlled machines;
- trusted bot developers;
- trusted or explicitly authorized users;
- carefully designed application tools.

It is not a hardened multi-tenant execution sandbox.

## 49.1 Default-deny user access

No user reaches the agent without pairing/allowlisting.

## 49.2 Capability security

Model power is the union of explicitly exposed tools.

There is no built-in shell, terminal, generic SQL, arbitrary URL fetch, or filesystem explorer.

## 49.3 Secret handling

- `.env` restrictive permissions;
- global OAuth credentials restrictive permissions;
- no secrets in config output;
- log redaction;
- never send secrets to model prompt unless an application-specific tool deliberately does so.

## 49.4 Tool schemas

Validate model arguments before calling tool code.

Reject additional fields where the tool schema says so.

## 49.5 MCP

Explicit servers and explicit tools.

## 49.6 Gate callback security

Never trust callback payloads as authorization.

Re-resolve sender -> binding -> principal on every interaction.

## 49.7 Supply chain

Pin dependencies and lockfile.

Keep dependency count low.

Maintain `THIRD_PARTY_NOTICES.md` if code is substantially adapted from MIT projects.

## 49.8 Future isolation seam

The tool executor should be internally abstracted enough that a later configuration can support:

```text
execution: in-process
execution: worker
execution: docker
```

V1 implements only `in-process`.

Do not expose an unfinished Docker option in user config yet.

---

# 50. Database durability

Per-bot SQLite:

```text
.vian/state.sqlite
```

Requirements:

- WAL;
- foreign keys enabled;
- migrations are monotonic and versioned;
- all event insertion associated with a state transition uses transactions;
- DB backups can be made while daemon operates using SQLite-safe mechanisms;
- migration creates a pre-migration backup for destructive schema changes.

V1 may offer:

```bash
vian backup count
```

if implementation cost is small.

---

# 51. Audit retention

V1 default:

- conversation/audit history: indefinite;
- expired attachment bytes: deleted after configured TTL;
- attachment metadata: retained;
- rotated runtime logs: bounded.

Future configurable retention can be added later.

---

# 52. Model context vs audit redaction

Audit is local and trusted by default, but some tools may handle secrets.

Tool declaration may support:

```ts
audit: {
  arguments: "full" | "redacted" | "none",
  result: "full" | "redacted" | "none"
}
```

V1 may initially implement `full` and `metadata-only`.

Do not let audit requirements force credentials into persisted tool results.

---

# 53. Configuration migrations

Each manifest contains:

```json
{
  "schemaVersion": 1
}
```

Future CLI:

```bash
vian migrate count
vian migrate --all
```

Vian daemon must refuse to silently reinterpret an unknown future schema.

Clear error:

```text
count uses vian.json schemaVersion 3.
This Vian binary supports up to 2.
Upgrade Vian before starting this bot.
```

---

# 54. Runtime upgrades

Global Vian upgrade must not mutate bot files until an explicit migration is required.

The daemon should:

1. open registry;
2. inspect bot schema versions;
3. migrate bot-local SQLite using backward-compatible migrations;
4. fail one bot independently if its config is invalid;
5. continue running other valid bots.

One broken bot must not prevent all bots from starting.

---

# 55. Performance budgets

V1 engineering goals on an ordinary modern x86-64 Linux mini PC:

- one daemon process;
- base idle daemon RSS target: `< 80 MB`;
- incremental idle bot state should be small enough that dozens of bots are practical;
- 25 idle registered/connected bots target: `< 120 MB` total daemon RSS;
- no model/provider process per bot;
- no database server;
- no Docker by default;
- no vector database;
- no background model polling;
- no heartbeat traffic;
- no LLM calls while idle.

These are budgets to measure and optimize against, not guaranteed public numbers until benchmarked.

---

# 56. Resource behavior while idle

An idle bot should perform only:

- Telegram long-poll connection management;
- minimal timers;
- lightweight Gate liveness;
- no model calls;
- no context rebuilding;
- no tool module work;
- no database polling loops.

Maintenance such as attachment cleanup should be shared and infrequent.

---

# 57. Recommended repository architecture

```text
vian/
├── packages/
│   ├── cli/
│   ├── core/
│   ├── runtime/
│   ├── storage/
│   ├── gate-telegram/
│   ├── provider-vercel/
│   ├── provider-google/
│   ├── provider-openai-chatgpt/
│   ├── mcp/
│   └── testing/
│
├── docs/
│   ├── architecture.md
│   ├── tool-authoring.md
│   ├── gates.md
│   └── security.md
│
├── examples/
│   ├── hello/
│   └── attachments/
│
├── THIRD_PARTY_NOTICES.md
├── LICENSE
├── bun.lock
├── package.json
└── tsconfig.json
```

Keep packages aligned to real seams, not theoretical abstractions.

If two packages constantly depend on each other, merge them.

---

# 58. Internal dependency direction

Desired:

```text
cli ──────────────► registry/control
daemon ───────────► runtime
runtime ──────────► core contracts
runtime ──────────► storage
runtime ──────────► gate adapter
runtime ──────────► provider adapter
gate-telegram ────► core contracts
providers ────────► core contracts
storage ──────────► core contracts
```

Core must not import Telegram.

Core must not import a concrete provider.

---

# 59. Testing strategy

## 59.1 Unit tests

- config parsing;
- secret references;
- canonical identity mapping;
- session key logic;
- queue ordering;
- context builder;
- attachment registry;
- MarkdownV2 renderer;
- message chunking;
- callback action resolution;
- OAuth state/PKCE functions;
- refresh-token rotation;
- DB migrations.

## 59.2 Concurrency tests

Mandatory.

Scenarios:

1. two principals message same bot simultaneously;
2. one principal sends five messages during a long run;
3. callback arrives during an active run;
4. daemon restarts with queued messages;
5. duplicate Telegram update arrives;
6. two tool calls mutate audit state;
7. outbound multipart delivery overlaps another run;
8. provider stream fails after partial output;
9. user stops generation;
10. daemon dies with tool state `started`.

## 59.3 Integration tests

Use fake Gate and fake Provider first.

This allows deterministic testing of core without Telegram/OpenAI.

Then:

- Telegram sandbox/test bot;
- Vercel AI Gateway;
- Gemini;
- ChatGPT/Codex OAuth.

## 59.4 Golden transcript tests

Input event sequence -> expected canonical audit event sequence.

This is especially useful for preventing session-routing regressions.

---

# 60. Fake Gate

Before Telegram is integrated, implement a tiny in-memory fake Gate.

It should support:

- emit inbound event;
- capture outbound delivery;
- fake principal binding;
- fake buttons/callbacks;
- fake attachments.

Core tests should not depend on grammY.

This makes future WhatsApp implementation much safer.

---

# 61. Fake Provider

Implement deterministic provider responses and tool calls.

Example scripted model:

```text
turn 1 -> request getBalance
turn 2 -> respond "Balance is ..."
```

Use this to test:

- run loop;
- tools;
- persistence;
- delivery;
- interruption;
- queues.

---

# 62. Implementation phases

## Phase 0 — skeleton

Deliver:

- monorepo;
- core types;
- Bun standalone CLI;
- XDG/platform paths;
- registry SQLite;
- `vian --help`;
- `vian list`;
- config schema.

No model, no Telegram.

## Phase 1 — bot initialization

Deliver:

- `vian init`;
- `vian create`;
- `vian register`;
- `vian unregister`;
- `vian.json`;
- `VIAN.md`;
- `.env` merge;
- `.gitignore` merge;
- `.vian/state.sqlite`;
- `vian inspect`;
- `vian doctor --offline`.

## Phase 2 — runtime/storage

Deliver:

- daemon;
- local control socket;
- BotRuntime lifecycle;
- canonical principals/conversations/sessions;
- event log;
- queues;
- concurrency;
- fake Gate;
- fake Provider;
- history CLI.

At the end of Phase 2, session correctness should be heavily tested.

## Phase 3 — tools

Deliver:

- `vian.tools.ts` loading;
- JSON Schema validation;
- execution context;
- tool auditing;
- attachment registry;
- fake attachment delivery.

## Phase 4 — providers

Deliver:

- Vercel AI Gateway;
- Google Gemini;
- OpenAI ChatGPT/Codex OAuth;
- credential store;
- auth CLI;
- refresh behavior;
- provider streaming;
- provider error normalization.

## Phase 5 — Telegram Gate

Deliver:

- long polling;
- auth/pairing;
- DMs;
- attachments;
- replies;
- MarkdownV2 renderer;
- message chunking;
- native live streaming;
- stop generation;
- inline buttons;
- callback routing;
- delivery outbox;
- Telegram retry/flood behavior.

## Phase 6 — operational polish

Deliver:

- systemd user service;
- `vian logs`;
- `vian status`;
- `vian restart`;
- `vian enable/disable`;
- graceful shutdown;
- attachment cleanup;
- crash recovery;
- documentation.

## Phase 7 — V1 hardening

Deliver:

- stress/concurrency suite;
- OAuth refresh tests;
- SQLite recovery tests;
- duplicate update tests;
- dependency/license audit;
- performance benchmarks;
- clean install test on a fresh Linux system.

---

# 63. V1 Definition of Done

V1 is complete only when all are true.

## Creation

- [ ] `vian init .` works in a non-empty existing directory.
- [ ] no unrelated file is overwritten.
- [ ] existing `.env` is preserved.
- [ ] bot receives stable UUID.
- [ ] bot is globally registered.
- [ ] `vian list` shows its absolute path.

## Runtime

- [ ] one daemon can operate at least 25 idle bots in the performance budget.
- [ ] one bot failure does not stop other bots.
- [ ] daemon restart preserves queues/history.
- [ ] same-session runs never execute concurrently.
- [ ] different sessions can execute concurrently.

## Identity

- [ ] users are represented by canonical principals.
- [ ] Telegram IDs are bindings, not canonical session IDs.
- [ ] unauthorized messages never reach the model.
- [ ] pairing works and survives restart.

## History

- [ ] every inbound user message is auditable.
- [ ] every final assistant message is auditable.
- [ ] every tool call is auditable.
- [ ] provider/model/run metadata is auditable.
- [ ] Telegram delivery success/failure is auditable.
- [ ] `vian history` works without daemon.

## Telegram

- [ ] private text chat works.
- [ ] MarkdownV2 output is safe.
- [ ] long messages are delivered correctly.
- [ ] live native draft streaming works.
- [ ] user can stop generation.
- [ ] inbound/outbound attachments work.
- [ ] inline buttons work.
- [ ] callback events return to correct canonical session.
- [ ] two people using the same agent simultaneously never cross sessions.
- [ ] repeated Telegram updates are idempotent.
- [ ] Telegram rate/flood errors do not create duplicate output.

## Tools

- [ ] developer can add a native tool in one TypeScript file.
- [ ] model sees only explicit tools.
- [ ] tool arguments are validated.
- [ ] tool failures do not crash daemon.
- [ ] generated files can be registered as opaque attachments.
- [ ] model never needs filesystem paths for attachment delivery.

## Providers

- [ ] Vercel AI Gateway works.
- [ ] Gemini API key works.
- [ ] ChatGPT/Codex OAuth works.
- [ ] OAuth refresh-token rotation is persisted safely.
- [ ] revoked/invalid OAuth stops retry storms and asks for re-auth.
- [ ] no provider secret appears in logs/history.

## CLI

- [ ] `list`, `inspect`, `history`, `sessions` work while daemon is offline.
- [ ] local CLI performance meets budget.
- [ ] JSON output exists for commands useful in automation.
- [ ] errors identify the bot/path/config field involved.

## Operations

- [ ] graceful daemon shutdown drains safe local state.
- [ ] Linux service install/start/stop/status works.
- [ ] attachment TTL cleanup works.
- [ ] database migrations are tested.

---

# 64. Post-V1 candidates

Not commitments.

## Gates

- WhatsApp;
- Discord;
- Slack;
- web chat.

## Isolation

- Worker-based tool executor;
- Docker per bot;
- Docker per tool-run.

## Runtime

- multiple Gates per bot;
- web admin UI;
- remote daemon management;
- cron;
- scheduled notifications.

## Context

- optional semantic memory;
- application-provided memory tool.

## Attachments

- provider-native file upload caching;
- optional transcription adapters.

---

# 65. Features Vian should probably never add to core

Unless the product thesis changes:

- general shell;
- general terminal;
- unrestricted filesystem;
- coding-agent behavior;
- autonomous skill generation;
- subagent society;
- browser computer-use;
- huge plugin marketplace;
- “do everything” personal assistant behavior.

Those belong in Hermes/OpenClaw/DeepSeek-class systems.

Vian should remain the thing you use when that complexity is the wrong answer.

---

# 66. Important design decisions summarized

## Use one daemon, not one process per bot

This is the main scalability choice.

## Store state per bot

This makes bots portable and locally owned.

## Keep registry global

This gives instant discovery from anywhere:

```bash
vian list
```

## Use canonical principals and conversations

This prevents Telegram from becoming the permanent identity model and makes future Gate migration possible.

## Serialize runs per session

This prevents history/tool-call races.

## Queue, do not interrupt, by default

This is safer for transactional tools.

## Treat audit as an event log

This provides deterministic history and debugging.

## Keep model history canonical

Do not persist Telegram formatting as the source representation.

## Render MarkdownV2 at the Gate

The model writes normal Markdown; Telegram gets correct MarkdownV2.

## Native Telegram streaming belongs in the Gate

The model/runtime produces text; Telegram decides how to present streaming.

## Gate-specific features are ephemeral capabilities

Buttons and Telegram-only context exist only while Telegram is active.

## OAuth is global, API keys may be local

OAuth refresh credentials need one canonical owner.

## Native tools are normal TypeScript modules

No Vian plugin framework.

## MCP is explicit and allowlisted

No capability surprise.

## Docker comes later

V1 assumes trusted tool code and gains simplicity/resource efficiency from in-process execution.

---

# 67. Recommended first implementation slice

The first coding milestone should not start with Telegram.

Build this vertical slice first:

```text
vian init
   ↓
registry
   ↓
bot-local SQLite
   ↓
fake Gate
   ↓
canonical identity
   ↓
session queue
   ↓
fake Provider
   ↓
native tool
   ↓
audit event log
   ↓
fake delivery
   ↓
vian history
```

Once that is correct, Telegram becomes an adapter rather than the architecture.

That ordering prevents the most dangerous design failure: accidentally making Telegram IDs, Telegram messages, or Telegram callbacks the core session model.

---

# 68. Architecture invariants

These should be written as tests and code-review rules.

1. `core/` cannot import `gate-telegram`.
2. `core/` cannot import a concrete model provider.
3. canonical session lookup never accepts a raw Telegram ID directly.
4. tool execution never receives authorization from model output.
5. every external inbound event gets an idempotency key.
6. every same-session run is serialized.
7. every side-effecting tool call has a Vian call ID/idempotency key available.
8. final canonical assistant content is persisted before external delivery.
9. Telegram formatting failure cannot erase canonical assistant output.
10. OAuth refresh token updates are atomic.
11. unknown users never reach the model.
12. bot-local history does not live in the global registry.
13. a bot can be moved without changing its UUID/history.
14. Gate-specific prompt context is not persisted as conversation history.
15. no Gate can create a canonical principal implicitly after authorization failure.

---

# 69. Inspiration from existing projects

Vian should study and selectively adapt patterns, not inherit entire harnesses.

## Hermes Agent

Useful patterns:

- messaging allowlists and pairing;
- session routing;
- per-destination delivery serialization;
- Telegram flood-control behavior;
- separation between messaging gateway and agent;
- exact dependency pinning/security mindset;
- ChatGPT/Codex OAuth lifecycle.

Do not copy:

- terminal/tool ecosystem;
- skills;
- multi-agent/Bot Mode complexity;
- broad gateway/plugin architecture.

## OpenClaw

Useful patterns:

- provider auth profiles;
- ChatGPT/Codex OAuth PKCE flow;
- canonical OAuth credential ownership/token sink;
- model/provider separation;
- operational `doctor`-style diagnostics.

Do not copy:

- broad agent OS;
- ACP orchestration;
- coding-agent runtime;
- large plugin/control-plane scope.

## DeepSeek Harness

Useful patterns:

- clean subsystem boundaries;
- durable session/event thinking;
- storage/provider seams;
- “replaceable implementation behind stable contracts”.

Do not copy:

- everything-is-a-plugin architecture;
- generic plugin tree;
- broad harness composability.

Vian needs perhaps 10% of these systems’ concepts and 1% of their product surface.

---

# 70. Current platform facts relevant to V1

As of September 2026:

- Telegram Bot API provides native live response drafts, including methods for streaming partial text/rich messages and receiving stop-generation events.
- Telegram supports MarkdownV2, inline keyboards/callback queries, and newer Rich Message formats.
- OpenAI officially supports signing into Codex using a ChatGPT account; current OpenClaw/Hermes implementations expose the corresponding Codex/ChatGPT subscription OAuth path.
- generic “Sign in with ChatGPT” identity login is a different product and does not itself grant general ChatGPT data/model access.
- Vercel AI SDK provides provider-neutral streaming/tool primitives and official integration with AI Gateway.
- Vercel AI Gateway supports a unified model interface and streaming/tool calling.
- DeepSeek Harness uses append/event-oriented session persistence and replaceable storage/session seams, a useful architectural reference for Vian’s much smaller persistence layer.
- OpenClaw, Hermes Agent, and DeepSeek Harness are MIT-licensed at the time of this PRD; adapted code must preserve required notices.

---

# 71. Reference sources reviewed for this PRD

Telegram Bot API:
- https://core.telegram.org/bots/api
- https://core.telegram.org/api/bots/ai
- https://core.telegram.org/bots/features

OpenAI:
- https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt

OpenClaw:
- https://github.com/openclaw/openclaw
- https://github.com/openclaw/openclaw/blob/main/docs/concepts/oauth.md
- https://github.com/openclaw/openclaw/blob/main/docs/gateway/authentication.md

Hermes:
- https://github.com/NousResearch/hermes-agent
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/architecture.md
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/gateway-internals.md
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/telegram.md
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/integrations/providers.md

DeepSeek Harness:
- https://github.com/deepseek-ai/deepseek-harness
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-06-14-session-persistence.md

Vercel:
- https://ai-sdk.dev/
- https://vercel.com/ai-gateway

Bun:
- https://bun.sh/docs/bundler/executables

---

# 72. Final V1 product statement

> **Vian turns a small, explicit set of software capabilities into a persistent conversational service.**

A bot can live anywhere.

It can be discovered globally.

It can serve several trusted people safely without mixing their sessions.

Its full behavior can be audited.

Its files and history remain local to the bot.

Its messaging transport can change without redefining its identity or memory.

Its model provider can change without changing its tools.

And while Vian may have sophisticated internals, creating and operating a bot should continue to feel like:

```bash
vian init .
vian start
```

That simplicity is the product.
