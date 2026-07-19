import { COMPANION_IDS, type CompanionId as CompanionIdType } from "@t3tools/contracts";
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

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DesktopCompanionPosition {
  readonly displayId: string;
  readonly normalizedX: number;
  readonly normalizedY: number;
}

const DesktopCompanionPositionSchema = Schema.Struct({
  displayId: Schema.String,
  normalizedX: Schema.Number,
  normalizedY: Schema.Number,
});

const DesktopCompanionPositionsDocument = Schema.Struct({
  positions: Schema.Record(Schema.String, DesktopCompanionPositionSchema),
});

const DesktopCompanionPositionsJson = fromLenientJson(DesktopCompanionPositionsDocument);
const decodePositionsJson = Schema.decodeEffect(DesktopCompanionPositionsJson);
const encodePositionsJson = Schema.encodeEffect(DesktopCompanionPositionsJson);

const knownCompanionIds = new Set<string>(COMPANION_IDS);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function constrainCompanionBounds(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.round(Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height))),
    width,
    height,
  };
}

export function positionFromBounds(input: {
  readonly displayId: string;
  readonly bounds: Rectangle;
  readonly workArea: Rectangle;
}): DesktopCompanionPosition {
  const maxX = Math.max(0, input.workArea.width - input.bounds.width);
  const maxY = Math.max(0, input.workArea.height - input.bounds.height);
  return {
    displayId: input.displayId,
    normalizedX: maxX === 0 ? 0 : clamp01((input.bounds.x - input.workArea.x) / maxX),
    normalizedY: maxY === 0 ? 0 : clamp01((input.bounds.y - input.workArea.y) / maxY),
  };
}

export function boundsFromPosition(input: {
  readonly position: DesktopCompanionPosition;
  readonly workArea: Rectangle;
  readonly width: number;
  readonly height: number;
}): Rectangle {
  const maxX = Math.max(0, input.workArea.width - input.width);
  const maxY = Math.max(0, input.workArea.height - input.height);
  return constrainCompanionBounds(
    {
      x: input.workArea.x + maxX * clamp01(input.position.normalizedX),
      y: input.workArea.y + maxY * clamp01(input.position.normalizedY),
      width: input.width,
      height: input.height,
    },
    input.workArea,
  );
}

export function defaultCompanionBounds(input: {
  readonly index: number;
  readonly workArea: Rectangle;
  readonly width: number;
  readonly height: number;
  readonly margin?: number;
  readonly gap?: number;
}): Rectangle {
  const margin = input.margin ?? 16;
  const gap = input.gap ?? 8;
  const usableWidth = Math.max(input.width, input.workArea.width - margin * 2);
  const columns = Math.max(1, Math.floor((usableWidth + gap) / (input.width + gap)));
  const column = Math.max(0, input.index) % columns;
  const row = Math.floor(Math.max(0, input.index) / columns);
  return constrainCompanionBounds(
    {
      x:
        input.workArea.x +
        input.workArea.width -
        margin -
        input.width -
        column * (input.width + gap),
      y:
        input.workArea.y +
        input.workArea.height -
        margin -
        input.height -
        row * (input.height + gap),
      width: input.width,
      height: input.height,
    },
    input.workArea,
  );
}

function normalizePosition(value: DesktopCompanionPosition): DesktopCompanionPosition {
  return {
    displayId: value.displayId,
    normalizedX: clamp01(value.normalizedX),
    normalizedY: clamp01(value.normalizedY),
  };
}

type PositionMap = Readonly<Record<string, DesktopCompanionPosition>>;

export class DesktopCompanionPositions extends Context.Service<
  DesktopCompanionPositions,
  {
    readonly get: (companionId: CompanionIdType) => Effect.Effect<DesktopCompanionPosition | null>;
    readonly set: (
      companionId: CompanionIdType,
      position: DesktopCompanionPosition,
    ) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
  }
>()("@t3tools/desktop/companions/DesktopCompanionPositions") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const initialPositions = yield* fileSystem
    .readFileString(environment.companionPositionsPath)
    .pipe(
      Effect.map(Option.some),
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : Effect.logWarning("Could not read desktop companion positions.", cause).pipe(
                Effect.as(Option.none<string>()),
              ),
      }),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed({} satisfies PositionMap),
          onSome: (raw) =>
            decodePositionsJson(raw).pipe(
              Effect.map((document) =>
                Object.fromEntries(
                  Object.entries(document.positions).flatMap(([id, position]) =>
                    knownCompanionIds.has(id) ? [[id, normalizePosition(position)] as const] : [],
                  ),
                ),
              ),
              Effect.catch((cause) =>
                Effect.logWarning(
                  "Could not decode desktop companion positions; using defaults.",
                  cause,
                ).pipe(Effect.as({} satisfies PositionMap)),
              ),
            ),
        }),
      ),
    );
  const positionsRef = yield* SynchronizedRef.make<PositionMap>(initialPositions);

  const persist = (positions: PositionMap) =>
    Effect.gen(function* () {
      const encoded = yield* encodePositionsJson({ positions });
      const suffix = (yield* crypto.randomUUIDv4).replaceAll("-", "");
      const directory = path.dirname(environment.companionPositionsPath);
      const temporaryPath = `${environment.companionPositionsPath}.${process.pid}.${suffix}.tmp`;
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      yield* fileSystem.writeFileString(temporaryPath, `${encoded}\n`);
      yield* fileSystem.rename(temporaryPath, environment.companionPositionsPath);
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not persist desktop companion positions.", cause).pipe(
          Effect.annotateLogs({ path: environment.companionPositionsPath }),
        ),
      ),
    );

  return DesktopCompanionPositions.of({
    get: (companionId) =>
      SynchronizedRef.get(positionsRef).pipe(
        Effect.map((positions) => positions[companionId] ?? null),
      ),
    set: (companionId, position) =>
      SynchronizedRef.modifyEffect(positionsRef, (positions) => {
        const next = {
          ...positions,
          [companionId]: normalizePosition(position),
        };
        return persist(next).pipe(Effect.as([undefined, next] as const));
      }),
    reset: SynchronizedRef.modifyEffect(positionsRef, () => {
      const next = {} satisfies PositionMap;
      return persist(next).pipe(Effect.as([undefined, next] as const));
    }),
  });
});

export const layer = Layer.effect(DesktopCompanionPositions, make);
