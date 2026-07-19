import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("033_RepairProjectionLatestTurnPointers", (it) => {
  it.effect("repairs missing and dangling pointers without replacing a valid pointer", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 32 });

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          latest_turn_id,
          created_at,
          updated_at
        )
        VALUES
          (
            'thread-null',
            'project-1',
            'Missing pointer',
            NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z'
          ),
          (
            'thread-dangling',
            'project-1',
            'Dangling pointer',
            'turn-missing',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z'
          ),
          (
            'thread-valid',
            'project-1',
            'Valid intentional pointer',
            'turn-valid-old',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z'
          ),
          (
            'thread-empty',
            'project-1',
            'No turns',
            NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:00.000Z'
          )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          state,
          requested_at,
          completed_at,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-null',
            'turn-null-old',
            'completed',
            '2026-01-01T00:01:00.000Z',
            '2026-01-01T00:01:10.000Z',
            '[]'
          ),
          (
            'thread-null',
            'turn-null-new',
            'completed',
            '2026-01-01T00:02:00.000Z',
            '2026-01-01T00:02:10.000Z',
            '[]'
          ),
          (
            'thread-dangling',
            'turn-dangling-real',
            'completed',
            '2026-01-01T00:03:00.000Z',
            '2026-01-01T00:03:10.000Z',
            '[]'
          ),
          (
            'thread-valid',
            'turn-valid-old',
            'completed',
            '2026-01-01T00:04:00.000Z',
            '2026-01-01T00:04:10.000Z',
            '[]'
          ),
          (
            'thread-valid',
            'turn-valid-new',
            'completed',
            '2026-01-01T00:05:00.000Z',
            '2026-01-01T00:05:10.000Z',
            '[]'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 33 });

      const rows = yield* sql<{
        readonly threadId: string;
        readonly latestTurnId: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          latest_turn_id AS "latestTurnId"
        FROM projection_threads
        ORDER BY thread_id
      `;

      assert.deepStrictEqual(rows, [
        { threadId: "thread-dangling", latestTurnId: "turn-dangling-real" },
        { threadId: "thread-empty", latestTurnId: null },
        { threadId: "thread-null", latestTurnId: "turn-null-new" },
        { threadId: "thread-valid", latestTurnId: "turn-valid-old" },
      ]);
    }),
  );
});
