import { MessageId, type OrchestrationMessage, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  compactConversationPreviewText,
  deriveLatestCompanionConversationPreview,
} from "./conversationPreview.ts";

function message(
  id: string,
  role: OrchestrationMessage["role"],
  text: string,
  streaming = false,
): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId: TurnId.make("turn-1"),
    streaming,
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
  };
}

describe("companion conversation preview", () => {
  it("follows the newest user turn and its latest assistant commentary", () => {
    const preview = deriveLatestCompanionConversationPreview([
      message("user-1", "user", "Older prompt"),
      message("assistant-1", "assistant", "Older answer"),
      message("user-2", "user", "  New\n prompt  "),
      message("assistant-2", "assistant", "First update"),
      message("assistant-3", "assistant", " Latest\tupdate ", true),
    ]);

    expect(preview).toMatchObject({
      userMessageId: "user-2",
      userText: "New prompt",
      assistantMessageId: "assistant-3",
      assistantText: "Latest update",
      assistantStreaming: true,
    });
  });

  it("does not reuse an answer from the preceding user turn", () => {
    const preview = deriveLatestCompanionConversationPreview([
      message("user-1", "user", "Older prompt"),
      message("assistant-1", "assistant", "Older answer"),
      message("user-2", "user", "Waiting for an answer"),
    ]);

    expect(preview).toMatchObject({
      userMessageId: "user-2",
      assistantMessageId: null,
      assistantText: null,
      assistantStreaming: false,
    });
  });

  it("normalizes whitespace and truncates at a Unicode code-point boundary", () => {
    expect(compactConversationPreviewText("  hello\n world  ", 20)).toBe("hello world");
    expect(compactConversationPreviewText("😀😀😀😀", 3)).toBe("😀…");
    expect(compactConversationPreviewText("   ", 20)).toBeNull();
  });
});
