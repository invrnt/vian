import type { InboundEvent } from '@vian/core';

type TelegramUser = { id: number; first_name?: string; username?: string; is_bot?: boolean };
type TelegramChat = { id: number; type: string };
type TelegramMessage = {
  message_id: number; chat: TelegramChat; from?: TelegramUser; text?: string; caption?: string;
  message_thread_id?: number; reply_to_message?: { message_id: number; from?: TelegramUser };
  photo?: { file_id: string; file_size?: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
};
export type TelegramUpdate = {
  update_id: number; message?: TelegramMessage;
  callback_query?: { id: string; from: TelegramUser; data?: string; message?: TelegramMessage };
  stopped_message_generation?: { chat: TelegramChat; message_thread_id?: number; draft_id: number };
};

export interface NormalizePolicy {
  groupsEnabled: boolean;
  approvedChatIds: ReadonlySet<string>;
  approvedUserIds: ReadonlySet<string>;
  botId?: number;
  botUsername?: string;
}

function permitted(message: TelegramMessage, policy: NormalizePolicy): boolean {
  if (message.chat.type === 'private') return true;
  if (!policy.groupsEnabled || !['group', 'supergroup'].includes(message.chat.type)) return false;
  if (!message.from || !policy.approvedChatIds.has(String(message.chat.id)) || !policy.approvedUserIds.has(String(message.from.id))) return false;
  const text = message.text ?? message.caption ?? '';
  const mentioned = !!policy.botUsername && new RegExp(`(?:^|\\s)@${policy.botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|$)`, 'i').test(text);
  const addressedCommand = !!policy.botUsername && new RegExp(`^/(?:start|help|status|new|stop)@${policy.botUsername}(?:\\s|$)`, 'i').test(text);
  const replied = !!message.reply_to_message && message.reply_to_message.from?.id === policy.botId;
  return mentioned || addressedCommand || replied;
}

export function normalizeMessage(update: TelegramUpdate, policy: NormalizePolicy, now = new Date()): InboundEvent | undefined {
  const message = update.message;
  if (!message?.from || message.from.is_bot || !permitted(message, policy)) return;
  const text = message.text ?? message.caption ?? '';
  const commandMatch = text.match(/^\/(start|help|status|new|stop)(?:@([A-Za-z0-9_]+))?(?:\s|$)/i);
  if (commandMatch?.[2] && commandMatch[2].toLowerCase() !== policy.botUsername?.toLowerCase()) return;
  const command = commandMatch?.[1]?.toLowerCase() as InboundEvent['control'] | undefined;
  const parts: NonNullable<InboundEvent['parts']> = [];
  if (text && !command) parts.push({ type: 'text', text });
  const event: InboundEvent = {
    gate: 'telegram', externalEventId: String(update.update_id),
    actor: { gate: 'telegram', externalId: String(message.from.id), displayName: message.from.first_name },
    destination: { gate: 'telegram', externalId: String(message.chat.id), ...(message.message_thread_id ? { threadId: String(message.message_thread_id) } : {}) },
    receivedAt: now.toISOString(), kind: command ? 'control' : 'message',
    ...(command ? { control: command } : { parts }),
    ...(message.reply_to_message ? { replyToExternalId: String(message.reply_to_message.message_id) } : {}),
    metadata: { externalMessageId: String(message.message_id), chatType: message.chat.type,
      ...(message.photo ? { photo: message.photo.at(-1) } : {}),
      ...(message.document ? { document: message.document } : {}) },
  };
  return event;
}
