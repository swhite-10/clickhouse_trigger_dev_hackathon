import { chat } from '@trigger.dev/sdk/ai'
import { streamText, stepCountIs, tool } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@clickhouse/client'

// Defaults to the public playground so the loop works before Cloud creds land.
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'https://play.clickhouse.com',
  username: process.env.CLICKHOUSE_USER ?? 'play',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
})

export const tools = {
  trending_repos: tool({
    description:
      'Top GitHub repositories by stars gained in a recent time window, from the 11B-row github_events dataset. Use for questions like "what is trending" or "hottest repos today".',
    inputSchema: z.object({
      hours: z.number().int().min(1).max(168).describe('Look-back window in hours'),
      limit: z.number().int().min(1).max(50).describe('How many repos to return'),
    }),
    execute: async ({ hours, limit }) => {
      const started = Date.now()
      const result = await clickhouse.query({
        query: `
          SELECT repo_name, count() AS stars
          FROM github_events
          WHERE event_type = 'WatchEvent'
            AND created_at > now() - INTERVAL {hours:UInt32} HOUR
          GROUP BY repo_name
          ORDER BY stars DESC
          LIMIT {limit:UInt32}
        `,
        query_params: { hours, limit },
        format: 'JSONEachRow',
        // No per-query settings: the playground's readonly user rejects them
        // (READONLY 164). On Cloud, limits move to the readonly role instead.
      })
      const rows = await result.json<{ repo_name: string; stars: string }>()
      return {
        rows: rows.map((r) => ({ repo: r.repo_name, stars: Number(r.stars) })),
        durationMs: Date.now() - started,
        chart: { type: 'bar', x: 'repo', y: 'stars', title: `Stars gained, last ${hours}h` },
      }
    },
  }),
}

export const ghPulseChat = chat.agent({
  id: 'gh-pulse-chat',
  tools,
  run: async ({ messages, tools, signal }) =>
    streamText({
      ...chat.toStreamTextOptions({ tools }),
      model: anthropic('claude-opus-4-8'),
      system: [
        'You are gh-pulse, an analyst for GitHub activity backed by ClickHouse.',
        'Answer with data, not prose: prefer calling a tool and letting its chart',
        'speak; keep any accompanying text to one or two sentences.',
      ].join(' '),
      messages,
      abortSignal: signal,
      stopWhen: stepCountIs(10),
    }),
})
