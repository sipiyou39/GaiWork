import type { CompanionSignal } from "@t3tools/contracts";

export function companionSignalLabel(signal: CompanionSignal): string {
  switch (signal) {
    case "working":
      return "Working";
    case "completed-unseen":
      return "Completed";
    case "awaiting-approval":
      return "Approval needed";
    case "awaiting-user-input":
      return "Waiting for you";
    case "plan-ready":
      return "Plan ready";
    case "failed":
      return "Needs attention";
    case "connecting":
      return "Connecting";
    case "offline":
      return "Offline";
    default:
      return "Ready";
  }
}

export function emptyCompanionAssistantText(signal: CompanionSignal): string {
  switch (signal) {
    case "working":
      return "The agent is working…";
    case "completed-unseen":
      return "The work is complete.";
    case "awaiting-approval":
      return "Your approval is required.";
    case "awaiting-user-input":
      return "The agent is waiting for your response.";
    case "failed":
      return "The agent needs your attention.";
    default:
      return "No agent response yet.";
  }
}
