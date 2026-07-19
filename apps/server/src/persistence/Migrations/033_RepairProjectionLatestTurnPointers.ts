import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Older projection code cleared `latest_turn_id` whenever a provider session
 * returned to ready. Rebuild only missing or dangling pointers, preserving an
 * intentional valid pointer (for example after reverting a thread).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_threads
    SET latest_turn_id = (
      SELECT candidate.turn_id
      FROM projection_turns AS candidate
      WHERE candidate.thread_id = projection_threads.thread_id
        AND candidate.turn_id IS NOT NULL
      ORDER BY candidate.requested_at DESC, candidate.row_id DESC
      LIMIT 1
    )
    WHERE (
      projection_threads.latest_turn_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM projection_turns AS current_turn
        WHERE current_turn.thread_id = projection_threads.thread_id
          AND current_turn.turn_id = projection_threads.latest_turn_id
      )
    )
      AND EXISTS (
        SELECT 1
        FROM projection_turns AS candidate
        WHERE candidate.thread_id = projection_threads.thread_id
          AND candidate.turn_id IS NOT NULL
      )
  `;
});
