import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";
import {
  MainWindowPresentationMode,
  type MainWindowPresentationMode as PresentationMode,
} from "@t3tools/contracts";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export const COMPACT_WINDOW_MIN_WIDTH = 640;
export const COMPACT_WINDOW_DEFAULT_MAX_WIDTH = 760;
export const COMPACT_WINDOW_MAX_WIDTH = 900;

export interface WindowRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CompactWindowPosition {
  readonly displayId: string;
  readonly normalizedX: number;
  readonly width: number;
}

const CompactWindowPositionSchema = Schema.Struct({
  displayId: Schema.String,
  normalizedX: Schema.Number,
  width: Schema.Number,
});

const DesktopWindowPresentationDocument = Schema.Struct({
  version: Schema.Literal(1),
  mode: MainWindowPresentationMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("workspace" as const)),
  ),
  compact: Schema.NullOr(CompactWindowPositionSchema),
});

const DesktopWindowPresentationJson = fromLenientJson(DesktopWindowPresentationDocument);
const decodePresentationJson = Schema.decodeEffect(DesktopWindowPresentationJson);
const encodePresentationJson = Schema.encodeEffect(DesktopWindowPresentationJson);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

export function compactWindowWidth(workArea: WindowRectangle): number {
  return Math.min(
    workArea.width,
    clamp(
      Math.round(workArea.width * 0.42),
      Math.min(COMPACT_WINDOW_MIN_WIDTH, workArea.width),
      Math.min(COMPACT_WINDOW_DEFAULT_MAX_WIDTH, workArea.width),
    ),
  );
}

export function constrainCompactWindowWidth(width: number, workAreaWidth: number): number {
  const maximum = Math.min(COMPACT_WINDOW_MAX_WIDTH, workAreaWidth);
  const minimum = Math.min(COMPACT_WINDOW_MIN_WIDTH, maximum);
  if (!Number.isFinite(width)) return minimum;
  return Math.round(clamp(width, minimum, maximum));
}

export function defaultCompactWindowBounds(input: {
  readonly workArea: WindowRectangle;
  readonly companionBounds: WindowRectangle;
}): WindowRectangle {
  const width = compactWindowWidth(input.workArea);
  const companionCenterX = input.companionBounds.x + input.companionBounds.width / 2;
  const displayCenterX = input.workArea.x + input.workArea.width / 2;
  return {
    x:
      companionCenterX >= displayCenterX
        ? input.workArea.x
        : input.workArea.x + input.workArea.width - width,
    y: input.workArea.y,
    width,
    height: input.workArea.height,
  };
}

export function compactWindowPositionFromBounds(input: {
  readonly displayId: string;
  readonly bounds: WindowRectangle;
  readonly workArea: WindowRectangle;
}): CompactWindowPosition {
  const width = constrainCompactWindowWidth(input.bounds.width, input.workArea.width);
  const maxX = Math.max(0, input.workArea.width - width);
  return {
    displayId: input.displayId,
    normalizedX: maxX === 0 ? 0 : clamp01((input.bounds.x - input.workArea.x) / maxX),
    width,
  };
}

export function compactWindowBoundsFromPosition(input: {
  readonly position: CompactWindowPosition;
  readonly workArea: WindowRectangle;
}): WindowRectangle {
  const width = constrainCompactWindowWidth(input.position.width, input.workArea.width);
  const maxX = Math.max(0, input.workArea.width - width);
  return {
    x: Math.round(input.workArea.x + maxX * clamp01(input.position.normalizedX)),
    y: input.workArea.y,
    width,
    height: input.workArea.height,
  };
}

function normalizePosition(position: CompactWindowPosition): CompactWindowPosition | null {
  if (position.displayId.trim().length === 0) return null;
  if (!Number.isFinite(position.width) || position.width <= 0) return null;
  return {
    displayId: position.displayId,
    normalizedX: clamp01(position.normalizedX),
    width: Math.round(position.width),
  };
}

interface DesktopWindowPresentationState {
  readonly mode: PresentationMode;
  readonly compact: CompactWindowPosition | null;
}

export class DesktopWindowPresentationStore extends Context.Service<
  DesktopWindowPresentationStore,
  {
    readonly getPresentationMode: Effect.Effect<PresentationMode>;
    readonly setPresentationMode: (mode: PresentationMode) => Effect.Effect<void>;
    readonly getCompactPosition: Effect.Effect<CompactWindowPosition | null>;
    readonly setCompactPosition: (position: CompactWindowPosition) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopWindowPresentationStore") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const initialState = yield* fileSystem.readFileString(environment.windowPresentationPath).pipe(
    Effect.map(Option.some),
    Effect.catchTags({
      PlatformError: (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(Option.none<string>())
          : Effect.logWarning("Could not read desktop window presentation.", cause).pipe(
              Effect.as(Option.none<string>()),
            ),
    }),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.succeed<DesktopWindowPresentationState>({ mode: "workspace", compact: null }),
        onSome: (raw) =>
          decodePresentationJson(raw).pipe(
            Effect.map(
              (document): DesktopWindowPresentationState => ({
                mode: document.mode,
                compact: document.compact === null ? null : normalizePosition(document.compact),
              }),
            ),
            Effect.catch((cause) =>
              Effect.logWarning(
                "Could not decode desktop window presentation; using defaults.",
                cause,
              ).pipe(
                Effect.as<DesktopWindowPresentationState>({
                  mode: "workspace",
                  compact: null,
                }),
              ),
            ),
          ),
      }),
    ),
  );
  const stateRef = yield* SynchronizedRef.make<DesktopWindowPresentationState>(initialState);

  const persist = (state: DesktopWindowPresentationState) =>
    Effect.gen(function* () {
      const encoded = yield* encodePresentationJson({ version: 1, ...state });
      const suffix = (yield* crypto.randomUUIDv4).replaceAll("-", "");
      const directory = path.dirname(environment.windowPresentationPath);
      const temporaryPath = `${environment.windowPresentationPath}.${process.pid}.${suffix}.tmp`;
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      yield* fileSystem.writeFileString(temporaryPath, `${encoded}\n`);
      yield* fileSystem.rename(temporaryPath, environment.windowPresentationPath);
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not persist desktop window presentation.", cause).pipe(
          Effect.annotateLogs({ path: environment.windowPresentationPath }),
        ),
      ),
    );

  return DesktopWindowPresentationStore.of({
    getPresentationMode: SynchronizedRef.get(stateRef).pipe(Effect.map((state) => state.mode)),
    setPresentationMode: (mode) =>
      SynchronizedRef.modifyEffect(stateRef, (state) => {
        if (state.mode === mode) return Effect.succeed([undefined, state] as const);
        const next = { ...state, mode };
        return persist(next).pipe(Effect.as([undefined, next] as const));
      }),
    getCompactPosition: SynchronizedRef.get(stateRef).pipe(Effect.map((state) => state.compact)),
    setCompactPosition: (position) => {
      const normalized = normalizePosition(position);
      if (normalized === null) return Effect.void;
      return SynchronizedRef.modifyEffect(stateRef, (state) => {
        const next = { ...state, compact: normalized };
        return persist(next).pipe(Effect.as([undefined, next] as const));
      });
    },
  });
});

export const layer = Layer.effect(DesktopWindowPresentationStore, make);
