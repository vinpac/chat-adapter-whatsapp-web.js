import type { ChatInstance } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createWhatsAppAdapter, WhatsAppAdapter } from "./index";

function createMockClient() {
  return {
    on: vi.fn(),
    sendMessage: vi.fn(),
    getMessageById: vi.fn(),
    getChatById: vi.fn(),
  };
}

function createMockChat() {
  return {
    processMessage: vi.fn(),
  } as unknown as ChatInstance;
}

describe("createWhatsAppAdapter", () => {
  it("creates an adapter instance", () => {
    const client = createMockClient();
    const adapter = createWhatsAppAdapter(client as never, "mybot");

    expect(adapter).toBeInstanceOf(WhatsAppAdapter);
    expect(adapter.name).toBe("whatsapp");
    expect(adapter.userName).toBe("mybot");
  });

  it("exposes underlying client", () => {
    const client = createMockClient();
    const adapter = createWhatsAppAdapter(client as never, "mybot");
    expect(adapter.getClient()).toBe(client);
  });
});

describe("WhatsAppAdapter", () => {
  it("encodes and decodes thread IDs", () => {
    const adapter = new WhatsAppAdapter(createMockClient() as never);
    const threadId = adapter.encodeThreadId({ chatId: "12345@c.us" });

    expect(threadId).toBe("whatsapp:MTIzNDVAYy51cw");
    expect(adapter.decodeThreadId(threadId)).toEqual({ chatId: "12345@c.us" });
    expect(adapter.channelIdFromThreadId(threadId)).toBe("12345@c.us");
  });

  it("throws for invalid thread IDs", () => {
    const adapter = new WhatsAppAdapter(createMockClient() as never);
    expect(() => adapter.decodeThreadId("telegram:abc")).toThrow(
      "Invalid WhatsApp thread id"
    );
  });

  it("registers incoming message handler on initialize", async () => {
    const client = createMockClient();
    const adapter = new WhatsAppAdapter(client as never);

    await adapter.initialize(createMockChat());
    expect(client.on).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("ignores self messages on initialize handler", async () => {
    const client = createMockClient();
    const chat = createMockChat();
    const adapter = new WhatsAppAdapter(client as never);

    await adapter.initialize(chat);
    const onMessage = client.on.mock.calls[0][1];
    await onMessage({
      fromMe: true,
      from: "12345@c.us",
      hasMedia: false,
    });

    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("downloads media in initialize handler and maps file attachment", async () => {
    const client = createMockClient();
    const chat = createMockChat();
    const adapter = new WhatsAppAdapter(client as never);
    const downloadMedia = vi.fn().mockResolvedValue({
      mimetype: "application/pdf",
      data: Buffer.from("doc").toString("base64"),
      filename: "doc.pdf",
      filesize: 3,
    });

    await adapter.initialize(chat);
    const onMessage = client.on.mock.calls[0][1];
    await onMessage({
      id: { _serialized: "wamid-file" },
      fromMe: false,
      from: "12345@c.us",
      timestamp: 1_735_689_600,
      body: "document",
      hasMedia: true,
      downloadMedia,
    });

    expect(downloadMedia).toHaveBeenCalledTimes(1);
    const processMessageMock = chat.processMessage as ReturnType<typeof vi.fn>;
    expect(processMessageMock).toHaveBeenCalledTimes(1);
    const parseFactory = processMessageMock.mock.calls[0][2];
    const parsed = await parseFactory();
    expect(parsed.attachments[0]).toMatchObject({
      type: "file",
      mimeType: "application/pdf",
      name: "doc.pdf",
      size: 3,
    });
  });

  it("parses incoming message and maps media attachment", () => {
    const adapter = new WhatsAppAdapter(createMockClient() as never);
    const parsed = adapter.parseMessage({
      id: { _serialized: "wamid-1" },
      from: "12345@c.us",
      fromMe: false,
      timestamp: 1_735_689_600,
      body: "hello",
      author: "user@c.us",
      hasMedia: true,
      media: {
        mimetype: "image/png",
        data: Buffer.from("img").toString("base64"),
        filename: "photo.png",
        filesize: 3,
      },
    } as never);

    expect(parsed.id).toBe("wamid-1");
    expect(parsed.threadId).toBe("whatsapp:MTIzNDVAYy51cw");
    expect(parsed.text).toBe("hello");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      name: "photo.png",
      size: 3,
    });
  });

  it("parses media attachment types for video and audio", () => {
    const adapter = new WhatsAppAdapter(createMockClient() as never);
    const baseMessage = {
      id: { _serialized: "wamid-kind" },
      from: "12345@c.us",
      fromMe: false,
      timestamp: 1_735_689_600,
      body: "clip",
      hasMedia: true,
    };

    const video = adapter.parseMessage({
      ...baseMessage,
      media: {
        mimetype: "video/mp4",
        data: Buffer.from("v").toString("base64"),
      },
    } as never);
    const audio = adapter.parseMessage({
      ...baseMessage,
      media: {
        mimetype: "audio/mpeg",
        data: Buffer.from("a").toString("base64"),
      },
    } as never);

    expect(video.attachments[0].type).toBe("video");
    expect(audio.attachments[0].type).toBe("audio");
  });

  it("posts messages", async () => {
    const client = createMockClient();
    client.sendMessage.mockResolvedValue({
      id: { _serialized: "wamid-2" },
    });
    const adapter = new WhatsAppAdapter(client as never);

    const result = await adapter.postMessage("whatsapp:MTIzNDVAYy51cw", {
      markdown: "hello",
    });

    expect(client.sendMessage).toHaveBeenCalledWith("12345@c.us", "hello");
    expect(result).toEqual({
      id: "wamid-2",
      threadId: "whatsapp:MTIzNDVAYy51cw",
      raw: { id: { _serialized: "wamid-2" } },
    });
  });

  it("posts text and fallback-json messages", async () => {
    const client = createMockClient();
    client.sendMessage.mockResolvedValue({
      id: { _serialized: "wamid-3" },
    });
    const adapter = new WhatsAppAdapter(client as never);

    await adapter.postMessage("whatsapp:MTIzNDVAYy51cw", "plain text");
    await adapter.postMessage("whatsapp:MTIzNDVAYy51cw", {
      foo: "bar",
    } as never);

    expect(client.sendMessage).toHaveBeenNthCalledWith(
      1,
      "12345@c.us",
      "plain text"
    );
    expect(client.sendMessage).toHaveBeenNthCalledWith(
      2,
      "12345@c.us",
      '{"foo":"bar"}'
    );
  });

  it("posts object messages using text field", async () => {
    const client = createMockClient();
    client.sendMessage.mockResolvedValue({
      id: { _serialized: "wamid-3b" },
    });
    const adapter = new WhatsAppAdapter(client as never);

    await adapter.postMessage(
      "whatsapp:MTIzNDVAYy51cw",
      { text: "hello text" } as never
    );

    expect(client.sendMessage).toHaveBeenCalledWith("12345@c.us", "hello text");
  });

  it("edits, deletes, and reacts to messages", async () => {
    const client = createMockClient();
    const edit = vi.fn().mockResolvedValue({
      id: { _serialized: "wamid-edited" },
      body: "updated",
    });
    const remove = vi.fn().mockResolvedValue(undefined);
    const react = vi.fn().mockResolvedValue(undefined);

    client.getMessageById.mockResolvedValue({
      body: "hello",
      edit,
      delete: remove,
      react,
      id: { _serialized: "wamid-2" },
    });

    const adapter = new WhatsAppAdapter(client as never);

    const edited = await adapter.editMessage(
      "whatsapp:MTIzNDVAYy51cw",
      "wamid-2",
      { markdown: "updated" }
    );
    await adapter.deleteMessage("whatsapp:MTIzNDVAYy51cw", "wamid-2");
    await adapter.addReaction("whatsapp:MTIzNDVAYy51cw", "wamid-2", "👍");
    await adapter.removeReaction("whatsapp:MTIzNDVAYy51cw", "wamid-2", "👍");

    expect(edited.id).toBe("wamid-edited");
    expect(edit).toHaveBeenCalledWith("updated\n");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(react).toHaveBeenNthCalledWith(1, "👍");
    expect(react).toHaveBeenNthCalledWith(2, "");
  });

  it("returns existing message when edit text is unchanged", async () => {
    const client = createMockClient();
    const edit = vi.fn();
    const rawMessage = {
      body: "same\n",
      edit,
      id: { _serialized: "wamid-unchanged" },
    };
    client.getMessageById.mockResolvedValue(rawMessage);
    const adapter = new WhatsAppAdapter(client as never);

    const edited = await adapter.editMessage(
      "whatsapp:MTIzNDVAYy51cw",
      "wamid-unchanged",
      { markdown: "same" }
    );

    expect(edit).not.toHaveBeenCalled();
    expect(edited).toEqual({
      id: "wamid-unchanged",
      threadId: "whatsapp:MTIzNDVAYy51cw",
      raw: rawMessage,
    });
  });

  it("throws when edit response is null", async () => {
    const client = createMockClient();
    client.getMessageById.mockResolvedValue({
      body: "hello",
      id: { _serialized: "wamid-4" },
      edit: vi.fn().mockResolvedValue(null),
    });
    const adapter = new WhatsAppAdapter(client as never);

    await expect(
      adapter.editMessage("whatsapp:MTIzNDVAYy51cw", "wamid-4", {
        markdown: "updated",
      })
    ).rejects.toThrow("WhatsApp message wamid-4 not found");
  });

  it("throws when delete/reaction targets are missing", async () => {
    const client = createMockClient();
    client.getMessageById.mockResolvedValue(null);
    const adapter = new WhatsAppAdapter(client as never);

    const emojiValue = {
      name: "🔥",
      toJSON: () => ({ name: "🔥" }),
    } as never;

    await expect(
      adapter.deleteMessage("whatsapp:MTIzNDVAYy51cw", "missing")
    ).rejects.toThrow("WhatsApp message missing not found");
    await expect(
      adapter.addReaction("whatsapp:MTIzNDVAYy51cw", "missing", emojiValue)
    ).rejects.toThrow("WhatsApp message missing not found");
    await expect(
      adapter.removeReaction("whatsapp:MTIzNDVAYy51cw", "missing", "🔥")
    ).rejects.toThrow("WhatsApp message missing not found");
  });

  it("fetches messages and starts typing", async () => {
    const client = createMockClient();
    const fetchMessages = vi.fn().mockResolvedValue([
      {
        id: { _serialized: "1" },
        from: "12345@c.us",
        fromMe: false,
        timestamp: 1,
        body: "first",
        hasMedia: false,
      },
      {
        id: { _serialized: "2" },
        from: "12345@c.us",
        fromMe: false,
        timestamp: 2,
        body: "second",
        hasMedia: false,
      },
    ]);
    const sendStateTyping = vi.fn().mockResolvedValue(undefined);

    client.getChatById.mockResolvedValue({
      fetchMessages,
      sendStateTyping,
    });

    const adapter = new WhatsAppAdapter(client as never);

    const result = await adapter.fetchMessages("whatsapp:MTIzNDVAYy51cw", {
      limit: 2,
    });
    await adapter.startTyping("whatsapp:MTIzNDVAYy51cw");

    expect(fetchMessages).toHaveBeenCalledWith({ limit: 2 });
    expect(result.messages.map((message) => message.text)).toEqual([
      "first",
      "second",
    ]);
    expect(sendStateTyping).toHaveBeenCalledTimes(1);
  });

  it("fetches with default limit and returns thread info", async () => {
    const client = createMockClient();
    const fetchMessages = vi.fn().mockResolvedValue([]);
    client.getChatById.mockResolvedValue({ fetchMessages });
    const adapter = new WhatsAppAdapter(client as never);

    const result = await adapter.fetchMessages("whatsapp:MTIzNDVAYy51cw");
    const thread = await adapter.fetchThread("whatsapp:MTIzNDVAYy51cw");

    expect(fetchMessages).toHaveBeenCalledWith({ limit: 30 });
    expect(result.nextCursor).toBeUndefined();
    expect(thread).toEqual({
      channelId: "12345@c.us",
      id: "whatsapp:MTIzNDVAYy51cw",
      metadata: {},
    });
  });

  it("returns 501 for webhook and renders formatted content", async () => {
    const adapter = new WhatsAppAdapter(createMockClient() as never);

    const response = await adapter.handleWebhook(new Request("http://localhost"));
    const rendered = adapter.renderFormatted({
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "ok" }] }],
    } as never);

    expect(response.status).toBe(501);
    expect(await response.text()).toContain("Not implemented");
    expect(rendered).toContain("ok");
  });
});
