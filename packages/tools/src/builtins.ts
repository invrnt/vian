import type { AttachmentId, AttachmentPort, BotId, NativeToolSet, PublicAttachment } from '@vian/core';

export function attachmentTools(attachments: AttachmentPort, botId: BotId, availableIds: () => Promise<AttachmentId[]>, send: (id: AttachmentId) => Promise<void>): NativeToolSet {
  return {
    list_attachments: {
      description: 'List available attachments',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => attachments.list(botId, await availableIds()),
    },
    send_attachment: {
      description: 'Send an attachment by its ID',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      execute: async (input) => {
        const id = (input as { id: AttachmentId }).id;
        if (!(await attachments.list(botId, [id])).length) throw new Error('Attachment unavailable');
        await send(id);
        return { sent: true };
      },
    },
  };
}
