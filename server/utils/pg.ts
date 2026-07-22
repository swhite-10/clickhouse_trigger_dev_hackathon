import { Pool } from 'pg'

// Nuxt-server twin of the pool in trigger/capture.ts — same libpq-compat
// dance (see the comment there): Cloud Postgres URLs carry sslmode=require,
// whose node-postgres semantics (verify-full) reject the issued cert chain;
// uselibpqcompat restores libpq's require-without-verify posture.
let pool: Pool | undefined

export function pgPool(): Pool | undefined {
  const url = process.env.DATABASE_URL
  if (!url) return undefined
  if (!pool) {
    const conn = new URL(url)
    if (conn.searchParams.has('sslmode')) conn.searchParams.set('uselibpqcompat', 'true')
    pool = new Pool({ connectionString: conn.toString(), max: 2 })
  }
  return pool
}
