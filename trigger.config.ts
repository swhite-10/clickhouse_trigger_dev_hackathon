import { defineConfig } from '@trigger.dev/sdk'

export default defineConfig({
  // Set TRIGGER_PROJECT_REF in .env — never commit the real ref.
  project: process.env.TRIGGER_PROJECT_REF ?? '<your-project-ref>',
  dirs: ['./trigger'],
  maxDuration: 300,
})
