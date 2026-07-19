# gh-pulse

Ask questions about GitHub activity in natural language — get charts, not
paragraphs. A chat agent that writes ClickHouse SQL against 11B+ GitHub
events and answers with interactive visualisations.

Built for the ClickHouse + Trigger.dev Virtual Summer Hackathon
("Beyond the Wall of Text", July 2026).

## Stack

- **Nuxt 4 + vue-echarts** — the visual layer is the product
- **ClickHouse Cloud** — `github_events` (OLAP, primary database)
- **Trigger.dev `chat.agent()`** — the conversational agent runtime
- **Postgres** — OLTP for the app itself: sessions, messages, rendered charts
- **Langfuse** — agent observability (itself powered by ClickHouse)

## Running locally

Secrets never touch disk — the [1Password CLI](https://developer.1password.com/docs/cli/)
resolves `op://` references from `infra/env/.env.template` at runtime.

```bash
make install            # npm install
make secrets-bootstrap  # one-time: creates the gh-pulse vault + placeholder items
# paste real values (Trigger.dev keys, Anthropic key) — see the template header
make secrets-check      # verify every reference resolves

make trigger-dev        # terminal 1: the chat agent
make dev                # terminal 2: Nuxt on localhost:3000
```

*Work in progress — build window 17–23 July 2026.*
