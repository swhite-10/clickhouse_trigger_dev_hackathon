-- gh-pulse OLTP schema (Postgres) — chat capture.
-- Idempotent; apply with: make pg-schema
--
-- Postgres is the app's operational database: what was asked, what SQL the
-- agent ran against ClickHouse, what chart rendered, and how fast. ClickHouse
-- stays the analytical store; this is the OLTP side of the OLTP+OLAP pairing.

-- One row per conversation, with turn/token rollups maintained on every turn.
CREATE TABLE IF NOT EXISTS chat_sessions (
  chat_id       text PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  last_turn_at  timestamptz NOT NULL DEFAULT now(),
  turns         integer     NOT NULL DEFAULT 0,
  input_tokens  bigint      NOT NULL DEFAULT 0,
  output_tokens bigint      NOT NULL DEFAULT 0
);

-- Full UIMessage records. `parts` holds everything the frontend needs to
-- re-render a past answer — including tool outputs with chart descriptors and
-- row data — so history replays without re-querying ClickHouse.
CREATE TABLE IF NOT EXISTS chat_messages (
  id            text PRIMARY KEY,
  chat_id       text        NOT NULL REFERENCES chat_sessions (chat_id) ON DELETE CASCADE,
  turn          integer     NOT NULL,
  role          text        NOT NULL,
  parts         jsonb       NOT NULL,
  usage         jsonb,
  finish_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_chat_idx ON chat_messages (chat_id, turn);

-- One row per executed ClickHouse query (dashboards contribute one row per
-- panel). This is the queryable telemetry of the app itself:
--   which chart types the agent picks, ClickHouse latency percentiles,
--   how often generated SQL errors and gets retried.
CREATE TABLE IF NOT EXISTS chat_queries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id     text        NOT NULL,
  message_id  text        NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  turn        integer     NOT NULL,
  tool        text        NOT NULL,
  panel_index integer,
  sql         text,
  chart       jsonb,
  chart_type  text GENERATED ALWAYS AS (chart ->> 'type') STORED,
  row_count   integer,
  duration_ms integer,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_queries_chat_idx ON chat_queries (chat_id, turn);

-- Example telemetry queries:
--   SELECT chart_type, count(*), round(avg(duration_ms)) AS avg_ms
--   FROM chat_queries WHERE error IS NULL GROUP BY 1 ORDER BY 2 DESC;
--
--   SELECT count(*) FILTER (WHERE error IS NOT NULL)::float / count(*)
--   AS sql_error_rate FROM chat_queries;
