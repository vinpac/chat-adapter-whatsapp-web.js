import { cardToFallbackText, extractCard } from "@chat-adapter/shared";
import {
  type Adapter,
  type AdapterPostableMessage,
  type ChatInstance,
  type EmojiValue,
  Message as ChatSdkMessage,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type RawMessage,
  type ThreadInfo,
  type WebhookOptions,
  stringifyMarkdown,
  Root,
  BaseFormatConverter,
  parseMarkdown,
  Attachment,
} from "chat";
import type {
  Chat as WhatsAppChat,
  Client,
  Message as WhatsAppMessage,
  MessageMedia,
} from "whatsapp-web.js";

type WhatsAppAdapterMessage = WhatsAppMessage & { media?: MessageMedia };
export class WhatsAppAdapter
  implements Adapter<WhatsAppThreadId, WhatsAppAdapterMessage>
{
  readonly name = "whatsapp";
  readonly userName: string;
  readonly botUserId?: string;

  private readonly client: Client;
  private readonly converter = new WhatsAppFormatConverter();

  constructor(client: Client, userName = "whatsapp-bot") {
    this.client = client;
    this.userName = userName;
  }

  getClient() {
    return this.client;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.client.on("message", async (rawMessage) => {
      if (rawMessage.fromMe) {
        return;
      }

      const threadId = this.encodeThreadId({ chatId: rawMessage.from });
      const media = rawMessage.hasMedia
        ? (await rawMessage.downloadMedia()) ?? undefined
        : undefined;

      await chat.processMessage(this, threadId, async () =>
        this.parseMessage({ ...rawMessage, media })
      );
    });
  }

  channelIdFromThreadId(threadId: string): string {
    return this.decodeThreadId(threadId).chatId;
  }

  encodeThreadId(data: WhatsAppThreadId): string {
    const encodedChatId = Buffer.from(data.chatId).toString("base64url");
    return `whatsapp:${encodedChatId}`;
  }

  decodeThreadId(threadId: string): WhatsAppThreadId {
    const [adapter, encodedChatId] = threadId.split(":");
    if (adapter !== "whatsapp" || !encodedChatId) {
      throw new Error(`Invalid WhatsApp thread id: ${threadId}`);
    }

    return { chatId: Buffer.from(encodedChatId, "base64url").toString("utf8") };
  }

  async handleWebhook(
    _request: Request,
    _options?: WebhookOptions
  ): Promise<Response> {
    return new Response("Not implemented for whatsapp-web.js", { status: 501 });
  }

  parseMessage(
    raw: WhatsAppAdapterMessage
  ): ChatSdkMessage<WhatsAppAdapterMessage> {
    const threadId = this.encodeThreadId({ chatId: raw.from });
    const timestamp = new Date(raw.timestamp * 1000);

    const text = raw.body ?? "";

    return new ChatSdkMessage({
      id: raw.id._serialized,
      threadId,
      text,
      formatted: this.converter.toAst(text),
      raw,
      author: {
        userId: raw.author ?? raw.from,
        userName: raw.author ?? raw.from,
        fullName: raw.author ?? raw.from,
        isBot: raw.fromMe,
        isMe: raw.fromMe,
      },
      metadata: {
        dateSent: timestamp,
        edited: false,
      },
      attachments: raw.media ? [whatsappMediaToChatAttachment(raw.media)] : [],
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppAdapterMessage>> {
    const { chatId } = this.decodeThreadId(threadId);
    const text = getPostableText(message);
    const sent = await this.client.sendMessage(chatId, text);

    return { id: sent.id._serialized, threadId, raw: sent };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    newMessage: AdapterPostableMessage
  ): Promise<RawMessage<WhatsAppAdapterMessage>> {
    const prevMessage = await this.client.getMessageById(messageId);
    const newText = this.converter.renderPostable(newMessage);

    if (prevMessage.body === newText || !newText) {
      return {
        id: messageId,
        threadId,
        raw: prevMessage,
      };
    }

    const raw = await prevMessage.edit(newText);

    if (!raw) {
      throw new Error(`WhatsApp message ${messageId} not found`);
    }

    return {
      id: raw.id._serialized,
      raw,
      threadId,
    };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    const target = await this.client.getMessageById(messageId);
    if (!target) {
      throw new Error(`WhatsApp message ${messageId} not found`);
    }

    await target.delete();
  }

  async addReaction(
    _: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const target = await this.client.getMessageById(messageId);

    if (!target) {
      throw new Error(`WhatsApp message ${messageId} not found`);
    }

    const emojiValue = typeof emoji === "string" ? emoji : emoji.name;
    await target.react(emojiValue);
  }

  async removeReaction(
    _: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    const target = await this.client.getMessageById(messageId);

    if (!target) {
      throw new Error(`WhatsApp message ${messageId} not found`);
    }

    await target.react("");
  }

  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<WhatsAppMessage>> {
    const { chatId } = this.decodeThreadId(threadId);
    const chat = await this.client.getChatById(chatId);
    const limit = options?.limit ?? 30;
    const messages = await chat.fetchMessages({ limit });
    const normalized = [...messages]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((message) => this.parseMessage(message));
    return { messages: normalized, nextCursor: undefined };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatId } = this.decodeThreadId(threadId);
    return {
      channelId: chatId,
      id: threadId,
      metadata: {},
    };
  }

  async startTyping(threadId: string): Promise<void> {
    const { chatId } = this.decodeThreadId(threadId);
    const chat = (await this.client.getChatById(chatId)) as WhatsAppChat;
    await chat.sendStateTyping();
  }
}

function getPostableText(message: AdapterPostableMessage): string {
  if (typeof message === "string") {
    return message;
  }

  const card = extractCard(message);
  if (card) {
    return cardToFallbackText(card);
  }

  if ("markdown" in message && typeof message.markdown === "string") {
    return message.markdown;
  }

  if ("text" in message && typeof message.text === "string") {
    return message.text;
  }

  return JSON.stringify(message);
}

export interface WhatsAppThreadId {
  chatId: string;
}

export class WhatsAppFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }
}

function getAttachmentTypeFromMimeType(mimeType: string): Attachment["type"] {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  return "file";
}
function whatsappMediaToChatAttachment(media: MessageMedia): Attachment {
  return {
    type: getAttachmentTypeFromMimeType(media.mimetype),
    mimeType: media.mimetype,
    data: Buffer.from(media.data, "base64"),
    size: media.filesize ?? undefined,
    name: media.filename ?? undefined,
  };
}
