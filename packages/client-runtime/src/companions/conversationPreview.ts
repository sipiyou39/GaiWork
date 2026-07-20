import {
  COMPANION_PREVIEW_ASSISTANT_MAX_LENGTH,
  COMPANION_PREVIEW_USER_MAX_LENGTH,
  type CompanionConversationPreview,
  type OrchestrationMessage,
} from "@t3tools/contracts";

export function compactConversationPreviewText(
  value: string | null | undefined,
  maximumLength = Number.POSITIVE_INFINITY,
): string | null {
  const compact = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (compact.length === 0) return null;
  if (compact.length <= maximumLength) return compact;

  const contentLength = Math.max(0, Math.floor(maximumLength) - 1);
  let truncated = compact.slice(0, contentLength);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated.trimEnd()}…`;
}

/**
 * Selects the latest user prompt and the latest assistant message that follows
 * it. This intentionally observes in-progress assistant commentary: the
 * desktop preview reflects what the conversation currently shows instead of
 * waiting for the turn to settle.
 */
export function deriveLatestCompanionConversationPreview(
  messages: ReadonlyArray<OrchestrationMessage>,
): CompanionConversationPreview | null {
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return null;

  const userMessage = messages[userIndex];
  if (!userMessage) return null;

  let assistantMessage: OrchestrationMessage | null = null;
  let assistantText: string | null = null;
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role === "user") break;
    if (message.role !== "assistant") continue;
    const compactText = compactConversationPreviewText(
      message.text,
      COMPANION_PREVIEW_ASSISTANT_MAX_LENGTH,
    );
    if (compactText === null) continue;
    assistantMessage = message;
    assistantText = compactText;
  }

  return {
    userMessageId: userMessage.id,
    userText: compactConversationPreviewText(userMessage.text, COMPANION_PREVIEW_USER_MAX_LENGTH),
    assistantMessageId: assistantMessage?.id ?? null,
    assistantText,
    assistantStreaming: assistantMessage?.streaming ?? false,
  };
}
