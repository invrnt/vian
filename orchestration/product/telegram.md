# Telegram requirements

Source: [Vian V1 PRD](../../Vian-V1-PRD.md). Section references below include all subordinate clauses. Each ID covers its full stated scope, not only the acceptance examples. Required behavior remains required when its external dependency is blocked.

## V031: Gate seam and Telegram transport

Source: PRD §§18–20.4, 60.

Use neutral Gate contract; Telegram uses long polling and grammY, with narrowly verified direct methods if needed. Gate owns external normalization/render/delivery/platform errors, never sessions/auth profiles/model execution.

Acceptance: Fake Gate exercises every seam without grammY; Telegram connects without public endpoint. Receive private text/reply/photo/document/caption/callback/stop and opt-in groups/topics; normalize to core events.

## V032: Markdown and chunking

Source: PRD §§20.5–20.6, 35, 43, 47.

Store ordinary Markdown once. Gate renders safe MarkdownV2, preserves code/links, chunks without corrupting Unicode/format entities and falls back to plain text for rejected/ambiguous formatting. Rich Messages remain optional.

Acceptance: Golden corpus includes reserved chars, Unicode, long code blocks/links and boundaries at current platform limits; rejection sends safe fallback without deleting canonical answer or duplicating accepted parts.

## V033: Native drafts and stop

Source: PRD §§20.7–20.8, 45.

Throttle and refresh native streaming drafts, finish with persisted final delivery, abort on authorized native stop or /stop and audit cancellation. Tool phases show generic state only, no chain-of-thought.

Acceptance: Test native draft lifecycle, adaptive throttle, expiry refresh, stream failure, authorization and abort during tool phase. Verify pinned API method support live. Partial-answer handling follows the decision below.

### V033 extension: localized activity feedback (2026-09-29)

User requirement: show a temporary animated working message throughout authorized inference, remove it when an answer reaches Telegram, and provide automatic feedback for empty output. Preserve visible generation errors and translate the UI into Spanish and English, configurable per bot with Spanish as default.

Assumption: `gate.telegram.language` selects `es` (default) or `en` for bot interface copy, independently of the model's response language. Animate `Trabajando.` / `Working.` by cycling one to three dots every 1.5 seconds on one silent message per run, including tool execution. On completion, stop animating and use `Hecho` / `Done` until confirmed answer delivery removes the indicator. A successful run without non-whitespace text, buttons or attachments emits a durable `Sin Respuesta` / `No Response` answer. Files and buttons count as responses. Existing safe generation failures remain durable, localized error answers; cancellation displays a localized stopped notice. Delivery failures and uncertain outcomes remain visibly distinct from empty successful inference.

Acceptance: T03/T06 fixtures cover both locales, empty answers, tool phase/cancellation, provider errors, topic/run isolation, text/file delivery, animation/cleanup races and Telegram UI failures. Activity is best-effort transport UI: if deletion is rejected, replace it with the localized completion label; do not discard or retry a canonical answer because UI cleanup failed.

## V034: Inline callbacks

Source: PRD §§20.9, 42, 49.6.

Expose telegram_present_buttons only to Telegram-origin runs. Store full values server-side; send opaque TTL action ID; acknowledge callback promptly, reauthorize and route to original canonical conversation. Never accept client-supplied principal/session mapping.

Acceptance: Forged, expired, reused and wrong-user callbacks fail safely; active-run callback joins correct queue; no full payload in callback_data; callback ACK does not wait for model; Gate tool absent on local test/fake non-Telegram runs.

## V035: Replies, groups and commands

Source: PRD §§20.3, 21.3, 44–46.

Disabled-by-default groups require explicit user/chat/mention/reply checks; topics separate. Support /start, /help, /status, /new, /stop with safe user-facing information; replies preserve canonical mapping.

Acceptance: Exercise DM and topic paths, disabled/unapproved group, reply to known/unknown message and all slash commands; no schema/secret disclosure. Enforce V019 shared-group actor restrictions for slash/native controls.

Assumption: On Gate startup, publish `/new` in the Telegram private-chat command menu through `setMyCommands`, preserving existing private or inherited default commands. Update an existing Spanish private menu separately because Telegram prefers language-specific entries over the unlocalized list. This makes the already-supported reset discoverable without changing group command visibility. Offline HTTP fixtures verify menu publication and preservation; a live Telegram client remains to be checked.

## V036: Telegram delivery evidence

Source: PRD §§34–35, 63 Telegram; user clarification 2026-09-22.

Return receipts linking canonical message and each external part; respect flood windows and preserve per-destination order, with V018 ambiguous-outcome policy.

Acceptance: Inject accepted response, explicit rejection, 429 and response-lost-after-send; assert receipt/audit mappings and no automatic ambiguous resend. Live file/button/text journey confirms adapter compatibility.

## External evidence and policy

On 2026-09-22 the official [Telegram Bot API](https://core.telegram.org/bots/api) page listed Bot API 10.3, `sendMessageDraft`, `can_stop`, `keep_on_stop` and `stopped_message_generation`. This supports feasibility, not a live validation of Vian or pinned grammY support. Retrieve exact method/update fields, limits and chat eligibility when implementing. No copied third-party API schema belongs here.

Assumption: cancellation records run_cancelled and sends a concise cancellation notice; do not persist/send unfinished assistant draft as a final answer. Never promise rollback of a tool already started. This selects the PRD's optional partial-answer policy.

Optional source items excluded initially: generic audio/voice/video handling, rich-markdown output and extra Gate tools. Required photos/documents/captions, MarkdownV2, native drafts, stop and buttons remain release requirements.

## V031/V036 extension: local uploads and delivery isolation (2026-09-29)

The Presentation Maker user requires PPTX uploads through 250 MiB. `gate.telegram.apiRoot`
selects a custom Bot API server and `localApi: true` enables a 250 MiB document cap;
cloud document uploads remain capped at 50 MiB and photo uploads at 10 MiB. The bot's
attachment registry limit applies independently. `uploadTimeoutSeconds` defaults to
1800 for the local API. Requests honor cancellation. `localFileRoot` explicitly confines
absolute incoming paths returned by a local server; symlinks are resolved before reading.
HTTPS or loopback HTTP is required for configured endpoints. Migration to the local API
requires owner-provided Telegram API ID/hash and cloud `logOut` before switching.

Assumption: ambiguous output remains held, including the remaining parts of the same
message, without automatic resend. Later independent messages to that destination may
proceed. Runtime scheduling and the SQLite transition guard enforce the same policy.
This replaces destination-wide blocking while preserving multipart ordering and the
no-duplicate-send contract. Offline acceptance: stream 250 MiB over a real loopback HTTP
connection, reject larger/cloud uploads, and resume a new message after an ambiguous one.
