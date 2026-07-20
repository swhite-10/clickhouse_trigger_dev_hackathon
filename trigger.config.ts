import { defineConfig } from '@trigger.dev/sdk'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

// Ship the worker's OTel trace (task spans + the AI SDK spans the Trigger
// runtime auto-registers) to the self-hosted Langfuse appliance
// (make langfuse-up). Fail-open like the Postgres capture: without keys no
// exporter is registered and runs behave exactly as before — deployed cloud
// workers have no keys and no route to localhost, so they're unaffected.
function langfuseExporters() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  if (!publicKey || !secretKey) return []
  const host = process.env.LANGFUSE_HOST ?? 'http://localhost:3005'
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64')
  return [
    new OTLPTraceExporter({
      url: `${host}/api/public/otel/v1/traces`,
      headers: {
        Authorization: `Basic ${auth}`,
        'x-langfuse-ingestion-version': '4',
      },
    }),
  ]
}

export default defineConfig({
  // Set TRIGGER_PROJECT_REF in .env — never commit the real ref.
  project: process.env.TRIGGER_PROJECT_REF ?? '<your-project-ref>',
  dirs: ['./trigger'],
  maxDuration: 300,
  telemetry: {
    exporters: langfuseExporters(),
  },
})
