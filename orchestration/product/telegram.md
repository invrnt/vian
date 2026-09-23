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

## V034: Inline callbacks

Source: PRD §§20.9, 42, 49.6.

Expose telegram_present_buttons only to Telegram-origin runs. Store full values server-side; send opaque TTL action ID; acknowledge callback promptly, reauthorize and route to original canonical conversation. Never accept client-supplied principal/session mapping.

Acceptance: Forged, expired, reused and wrong-user callbacks fail safely; active-run callback joins correct queue; no full payload in callback_data; callback ACK does not wait for model; Gate tool absent on local test/fake non-Telegram runs.

## V035: Replies, groups and commands

Source: PRD §§20.3, 21.3, 44–46.

Disabled-by-default groups require explicit user/chat/mention/reply checks; topics separate. Support /start, /help, /status, /new, /stop with safe user-facing information; replies preserve canonical mapping.

Acceptance: Exercise DM and topic paths, disabled/unapproved group, reply to known/unknown message and all slash commands; no schema/secret disclosure. Enforce V019 shared-group actor restrictions for slash/native controls.

## V036: Telegram delivery evidence

Source: PRD §§34–35, 63 Telegram; user clarification 2026-09-22.

Return receipts linking canonical message and each external part; respect flood windows and preserve per-destination order, with V018 ambiguous-outcome policy.

Acceptance: Inject accepted response, explicit rejection, 429 and response-lost-after-send; assert receipt/audit mappings and no automatic ambiguous resend. Live file/button/text journey confirms adapter compatibility.

## External evidence and policy

On 2026-09-22 the official [Telegram Bot API](https://core.telegram.org/bots/api) page listed Bot API 10.3, `sendMessageDraft`, `can_stop`, `keep_on_stop` and `stopped_message_generation`. This supports feasibility, not a live validation of Vian or pinned grammY support. Retrieve exact method/update fields, limits and chat eligibility when implementing. No copied third-party API schema belongs here.

Assumption: cancellation records run_cancelled and sends a concise cancellation notice; do not persist/send unfinished assistant draft as a final answer. Never promise rollback of a tool already started. This selects the PRD's optional partial-answer policy.

Optional source items excluded initially: generic audio/voice/video handling, rich-markdown output and extra Gate tools. Required photos/documents/captions, MarkdownV2, native drafts, stop and buttons remain release requirements.
