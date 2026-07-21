import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  CompanionPointerEvent,
  CompanionProjectionSnapshot,
  DesktopCompanionOverlayPresentation,
  DesktopCompanionPortalMetricsInput,
  DesktopCompanionPortalRequest,
  CompanionConversationNavigation,
  MainWindowPresentationAcknowledgement,
  MainWindowPresentationSnapshot,
} from "./companions.ts";

describe("companion IPC contracts", () => {
  const decodeSnapshot = Schema.decodeUnknownSync(CompanionProjectionSnapshot);
  const decodePointerEvent = Schema.decodeUnknownSync(CompanionPointerEvent);
  const decodeOverlayPresentation = Schema.decodeUnknownSync(DesktopCompanionOverlayPresentation);
  const decodePortalRequest = Schema.decodeUnknownSync(DesktopCompanionPortalRequest);
  const decodePortalMetrics = Schema.decodeUnknownSync(DesktopCompanionPortalMetricsInput);
  const decodePresentation = Schema.decodeUnknownSync(MainWindowPresentationSnapshot);
  const decodePresentationAcknowledgement = Schema.decodeUnknownSync(
    MainWindowPresentationAcknowledgement,
  );
  const decodeNavigation = Schema.decodeUnknownSync(CompanionConversationNavigation);

  it("validates revisioned main-window presentation transitions", () => {
    expect(decodePresentation({ mode: "conversation-focus", transitionId: 4 })).toEqual({
      mode: "conversation-focus",
      transitionId: 4,
    });
    expect(() =>
      decodePresentationAcknowledgement({ mode: "workspace", transitionId: -1 }),
    ).toThrow();
  });

  it("pins companion navigation to conversation focus", () => {
    expect(
      decodeNavigation({
        threadRef: { environmentId: "environment-test", threadId: "thread-test" },
        presentation: "conversation-focus",
      }).presentation,
    ).toBe("conversation-focus");
    expect(() =>
      decodeNavigation({
        threadRef: { environmentId: "environment-test", threadId: "thread-test" },
        presentation: "workspace",
      }),
    ).toThrow();
  });

  it("limits a desktop snapshot to the nine global companion identities", () => {
    const projection = {
      companionId: "blue",
      threadRef: { environmentId: "environment-test", threadId: "thread-test" },
      threadTitle: "Test thread",
      signal: "idle",
      baseAnimation: "idle",
      accessibleLabel: "Test thread: Idle",
      showOnDesktop: true,
      preview: null,
    };

    expect(() =>
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        desktopScalePercent: 100,
        companions: Array.from({ length: 10 }, () => projection),
      }),
    ).toThrow();
  });

  it("defaults legacy desktop snapshots to the original companion size", () => {
    expect(
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        companions: [],
      }).desktopScalePercent,
    ).toBe(100);
    expect(
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        companions: [],
      }).desktopPreviewsEnabled,
    ).toBe(true);
    expect(
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        companions: [],
      }).desktopExpandedView,
    ).toBe("response-and-composer");
  });

  it("rejects desktop scales outside the supported range", () => {
    expect(() =>
      decodeSnapshot({
        sourceEpoch: "epoch-test",
        revision: 0,
        desktopScalePercent: 201,
        companions: [],
      }),
    ).toThrow();
  });

  it("rejects non-finite pointer coordinates", () => {
    expect(() =>
      decodePointerEvent({
        phase: "move",
        target: "companion",
        presentationIndex: 0,
        screenX: Number.NaN,
        screenY: 20,
      }),
    ).toThrow();
  });

  it("requires the isolated renderer to identify its pointer surface", () => {
    expect(() =>
      decodePointerEvent({
        phase: "up",
        presentationIndex: 0,
        screenX: 20,
        screenY: 20,
      }),
    ).toThrow();
  });

  it("accepts the global desktop visibility control as a pointer surface", () => {
    expect(
      decodePointerEvent({
        phase: "up",
        target: "visibility-control",
        presentationIndex: 0,
        screenX: 20,
        screenY: 20,
      }).target,
    ).toBe("visibility-control");
  });

  it("carries global visibility state without exposing a conversation identity", () => {
    expect(
      decodeOverlayPresentation({
        displayId: "display-test",
        companionsVisible: false,
        visibilityControl: { x: 18, y: 742, size: 40 },
        companions: [],
      }),
    ).toEqual({
      displayId: "display-test",
      companionsVisible: false,
      visibilityControl: { x: 18, y: 742, size: 40 },
      companions: [],
    });
  });

  it("accepts only bounded, revisioned desktop composer portal requests", () => {
    expect(
      decodePortalRequest({
        token: "portal-token",
        frameName: "gaiwork-companion-blue-portal-token",
        url: "gaiwork://app/companion-portal.html?token=portal-token",
        companionId: "blue",
        threadRef: { environmentId: "environment-test", threadId: "thread-test" },
        surface: "response-and-composer",
        layout: {
          token: "portal-token",
          revision: 0,
          displayId: "display-test",
          placement: "top",
          cardX: 120,
          cardY: 80,
          cardWidth: 420,
          cardHeight: 176,
          compactCardX: 120,
          compactCardY: 80,
          compactCardWidth: 420,
          compactCardHeight: 176,
          workAreaWidth: 1_440,
          workAreaHeight: 900,
        },
      }).surface,
    ).toBe("response-and-composer");
    expect(
      decodePortalRequest({
        token: "portal-token",
        frameName: "gaiwork-companion-blue-portal-token",
        url: "gaiwork://app/companion-portal.html?token=portal-token",
        companionId: "blue",
        threadRef: { environmentId: "environment-test", threadId: "thread-test" },
        surface: "composer-only",
        layout: {
          token: "portal-token",
          revision: 0,
          displayId: "display-test",
          placement: "top",
          cardX: 120,
          cardY: 80,
          cardWidth: 420,
          cardHeight: 176,
          compactCardX: 120,
          compactCardY: 80,
          compactCardWidth: 420,
          compactCardHeight: 176,
          workAreaWidth: 1_440,
          workAreaHeight: 900,
        },
      }).layout.revision,
    ).toBe(0);
  });

  it("rejects hostile or impossible desktop composer measurements", () => {
    expect(() =>
      decodePortalMetrics({ token: "portal-token", width: 20_000, height: 220 }),
    ).toThrow();
  });
});
