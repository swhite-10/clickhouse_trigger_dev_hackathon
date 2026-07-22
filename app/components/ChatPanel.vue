<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { TriggerChatTransport } from '@trigger.dev/sdk/chat'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Agent text is model-generated markdown; sanitize after parsing since it
// goes in via v-html. Safe here: ChatPanel is client-only (DOMPurify needs DOM).
function renderMarkdown(text: string) {
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
}

const chatId = crypto.randomUUID()

const transport = new TriggerChatTransport({
  task: 'gh-pulse-chat',
  accessToken: async ({ chatId }) => {
    const res = await $fetch<{ token: string }>('/api/chat/token', {
      method: 'POST',
      body: { chatId },
    })
    return res.token
  },
  startSession: ({ chatId, clientData }) =>
    $fetch('/api/chat/session', { method: 'POST', body: { chatId, clientData } }),
})

const chat = new Chat({ id: chatId, transport })

const input = ref('')
function send() {
  const text = input.value.trim()
  if (!text) return
  chat.sendMessage({ text })
  input.value = ''
}
function ask(question: string) {
  chat.sendMessage({ text: question })
}

const hasMessages = computed(() => chat.messages.length > 0)
const busy = computed(() => chat.status === 'streaming' || chat.status === 'submitted')

// Loose part shape: tool parts carry state/output/errorText, text parts text.
// The AI SDK's UIMessagePart union is generic over the tool set, which this
// untyped Chat doesn't know — narrow by hand like the rest of the template.
type AnyPart = {
  type: string
  state?: string
  text?: string
  errorText?: string
  output?: {
    title?: string
    error?: string
    followups?: string[]
    chart?: { title?: string }
    panels?: unknown[]
  }
}

const isTool = (p: AnyPart) => p.type.startsWith('tool-')
const isRunning = (p: AnyPart) => p.state !== 'output-available' && p.state !== 'output-error'
const isFailed = (p: AnyPart) => p.state === 'output-error' || !!p.output?.error

function statusLine(p: AnyPart): string {
  if (p.state === 'output-error') return `failed — ${p.errorText}`
  if (isRunning(p)) return p.type === 'tool-run_dashboard' ? 'building dashboard…' : 'running query…'
  if (p.output?.error) return 'query failed — agent is retrying'
  return `→ ${p.output?.title ?? p.output?.chart?.title ?? 'chart'}`
}

// Follow-up chips: only for the latest assistant message — stale suggestions
// under old turns are clutter, and the newest ones match what's on screen.
const followups = computed<string[]>(() => {
  const last = chat.messages[chat.messages.length - 1]
  if (!last || last.role !== 'assistant' || busy.value) return []
  const out: string[] = []
  for (const part of last.parts as AnyPart[]) {
    for (const q of part.output?.followups ?? []) {
      if (!out.includes(q)) out.push(q)
    }
  }
  return out.slice(0, 3)
})

// Canvas blocks: every tool part, tagged with the user question that caused
// it, newest first — the freshest chart always renders at the top.
const blocks = computed(() => {
  const out: { key: string; question: string; part: AnyPart }[] = []
  let question = ''
  for (const m of chat.messages) {
    if (m.role === 'user') {
      question = (m.parts as AnyPart[])
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(' ')
      continue
    }
    ;(m.parts as AnyPart[]).forEach((part, i) => {
      if (isTool(part)) out.push({ key: `${m.id}:${i}`, question, part })
    })
  }
  return out.reverse()
})

const railScroller = ref<HTMLElement>()
const canvasEl = ref<HTMLElement>()
const inputEl = ref<HTMLInputElement>()
onMounted(() => inputEl.value?.focus())
watch(
  () => chat.messages,
  async () => {
    await nextTick()
    railScroller.value?.scrollTo({ top: railScroller.value.scrollHeight })
  },
  { deep: true },
)
watch(
  () => blocks.value[0]?.key,
  async () => {
    await nextTick()
    canvasEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
  },
)
</script>

<template>
  <div class="chat" :class="{ split: hasMessages }">
    <template v-if="!hasMessages">
      <div class="home-scroll">
        <HomeLauncher @ask="ask" />
      </div>
      <form class="ask" @submit.prevent="send">
        <input ref="inputEl" v-model="input" placeholder="Ask about GitHub activity…" spellcheck="false" />
        <button type="submit" :disabled="busy">{{ busy ? '…' : 'Ask' }}</button>
      </form>
    </template>

    <template v-else>
      <aside class="rail">
        <div ref="railScroller" class="rail-messages">
          <div v-for="m in chat.messages" :key="m.id" class="msg" :class="m.role">
            <template v-for="(part, i) in m.parts" :key="i">
              <div v-if="part.type === 'text'" class="text" v-html="renderMarkdown(part.text)" />
              <p
                v-else-if="isTool(part)"
                class="toolstatus"
                :class="{ error: isFailed(part), running: isRunning(part) }"
              >
                {{ statusLine(part) }}
              </p>
            </template>
          </div>
          <div v-if="followups.length" class="followups">
            <button v-for="q in followups" :key="q" class="chip" type="button" @click="ask(q)">
              {{ q }}
            </button>
          </div>
        </div>
        <form class="ask" @submit.prevent="send">
          <input ref="inputEl" v-model="input" placeholder="Ask a follow-up…" spellcheck="false" />
          <button type="submit" :disabled="busy">{{ busy ? '…' : 'Ask' }}</button>
        </form>
      </aside>

      <section ref="canvasEl" class="canvas">
        <div v-for="b in blocks" :key="b.key" class="block">
          <p class="block-q">{{ b.question }}</p>

          <div v-if="b.part.state === 'output-error'" class="card">
            <p class="meta error">{{ b.part.type === 'tool-run_dashboard' ? 'dashboard' : 'query' }} failed — {{ b.part.errorText }}</p>
          </div>

          <div v-else-if="isRunning(b.part)" class="card pending">
            <p class="meta running">
              {{ b.part.type === 'tool-run_dashboard' ? 'building dashboard…' : 'running query…' }}
            </p>
          </div>

          <div v-else-if="b.part.type === 'tool-run_dashboard'" class="card">
            <h3 class="dash-title">{{ b.part.output.title }}</h3>
            <div class="dash-stats">
              <template v-for="(panel, j) in b.part.output.panels" :key="`s${j}`">
                <ToolChart v-if="!panel.error && panel.chart.type === 'stat'" :output="panel" />
              </template>
            </div>
            <div class="dash-grid">
              <template v-for="(panel, j) in b.part.output.panels" :key="`p${j}`">
                <p v-if="panel.error" class="meta error">panel failed — {{ panel.error }}</p>
                <div v-else-if="panel.chart.type !== 'stat'" class="dash-cell">
                  <ToolChart :output="panel" />
                  <details v-if="panel.sql" class="sql">
                    <summary>SQL</summary>
                    <pre>{{ panel.sql }}</pre>
                  </details>
                </div>
              </template>
            </div>
            <p class="meta">
              {{ b.part.output.panels.length }} queries in parallel ·
              {{ b.part.output.totalMs }}ms total in ClickHouse
            </p>
          </div>

          <div v-else-if="b.part.output?.error" class="card">
            <p class="meta error">query failed, agent is retrying — {{ b.part.output.error }}</p>
          </div>

          <div v-else class="card">
            <ToolChart :output="b.part.output" />
            <details v-if="b.part.output?.sql" class="sql">
              <summary>SQL</summary>
              <pre>{{ b.part.output.sql }}</pre>
            </details>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.home-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
}
.chat.split {
  display: grid;
  grid-template-columns: minmax(290px, 350px) 1fr;
  gap: 0 1.5rem;
}
.rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid #33363b;
  padding-right: 1.75rem;
}
.rail-messages {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 1.25rem 0.25rem 0.75rem 0;
}
.msg.user {
  align-self: flex-end;
  background: #b8f7e4;
  color: #25272c;
  border-radius: 14px;
  padding: 0.5rem 0.95rem;
  max-width: 85%;
  font-weight: 500;
  font-size: 0.9rem;
}
.msg.user .text :deep(p) {
  margin: 0;
}
.msg.assistant {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  font-size: 0.92rem;
}
.toolstatus {
  color: #9aa0a6;
  font-size: 0.82rem;
  margin: 0;
  padding: 0.35rem 0.6rem;
  background: #2d3035;
  border: 1px solid #383b41;
  border-radius: 8px;
}
.toolstatus.running {
  animation: pulse 1.2s ease-in-out infinite;
}
.toolstatus.error {
  color: #f7a8a8;
}
@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}
.followups {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.45rem;
  margin-top: 0.25rem;
}
.chip {
  border: 1px solid #3c4043;
  background: #2d3035;
  color: #b8f7e4;
  border-radius: 999px;
  padding: 0.45rem 0.9rem;
  font-size: 0.82rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s;
}
.chip:hover {
  border-color: #b8f7e4;
}
.text {
  margin: 0;
  line-height: 1.5;
}
.text :deep(p) {
  margin: 0.25rem 0;
}
.text :deep(strong) {
  color: #b8f7e4;
  font-weight: 600;
}
.text :deep(a) {
  color: #b8f7e4;
}
.text :deep(code) {
  background: #25272c;
  border-radius: 4px;
  padding: 0.1rem 0.35rem;
  font-size: 0.85em;
}
.text :deep(pre) {
  background: #25272c;
  border: 1px solid #3c4043;
  border-radius: 8px;
  padding: 0.6rem 0.9rem;
  overflow-x: auto;
}
.text :deep(ul),
.text :deep(ol) {
  margin: 0.25rem 0;
  padding-left: 1.25rem;
}
.canvas {
  min-height: 0;
  overflow-y: auto;
  scroll-behavior: smooth;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.25rem 0.25rem 1.25rem 0;
}
.block-q {
  color: #9aa0a6;
  font-size: 0.82rem;
  margin: 0 0 0.4rem 0.25rem;
}
.card {
  background: #2d3035;
  border: 1px solid #383b41;
  border-radius: 14px;
  padding: 1.1rem 1.3rem 0.9rem;
}
.card.pending {
  border-style: dashed;
}
.meta {
  color: #9aa0a6;
  font-size: 0.85rem;
  margin: 0.25rem 0;
}
.meta.running {
  animation: pulse 1.2s ease-in-out infinite;
}
.meta.error {
  color: #f7a8a8;
}
.dash-title {
  color: #e8eaed;
  font-size: 1.05rem;
  margin: 0.25rem 0 0.75rem;
}
.dash-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.dash-stats:empty {
  display: none;
}
.dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 1.5rem 2rem;
  align-items: start;
}
.dash-cell {
  min-width: 0;
}
.sql {
  margin-top: 0.5rem;
}
.sql summary {
  color: #9aa0a6;
  font-size: 0.8rem;
  cursor: pointer;
}
.sql pre {
  background: #25272c;
  border: 1px solid #3c4043;
  border-radius: 8px;
  padding: 0.6rem 0.9rem;
  font-size: 0.8rem;
  color: #b8f7e4;
  overflow-x: auto;
  white-space: pre-wrap;
}
.ask {
  display: flex;
  gap: 0.6rem;
  padding: 0.9rem 0 1.1rem;
  border-top: 1px solid #33363b;
  flex: 0 0 auto;
}
.ask input {
  flex: 1;
  min-width: 0;
  padding: 0.7rem 1.2rem;
  border-radius: 999px;
  border: 1px solid #3c4043;
  background: #2d3035;
  color: #e8eaed;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.15s;
}
.ask input:focus {
  border-color: #b8f7e4;
}
.ask button {
  padding: 0.7rem 1.4rem;
  border-radius: 999px;
  border: none;
  background: #b8f7e4;
  color: #25272c;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
}
.ask button:disabled {
  opacity: 0.6;
}
@media (max-width: 900px) {
  .chat.split {
    display: flex;
    flex-direction: column-reverse;
  }
  .rail {
    border-right: none;
    padding-right: 0;
    border-top: 1px solid #33363b;
    max-height: 45%;
  }
  .canvas {
    flex: 1 1 auto;
  }
}
</style>
