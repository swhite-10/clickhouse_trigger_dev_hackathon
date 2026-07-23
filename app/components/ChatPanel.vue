<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { TriggerChatTransport, type ChatSessionPersistedState } from '@trigger.dev/sdk/chat'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Agent text is model-generated markdown; sanitize after parsing since it
// goes in via v-html. Safe here: ChatPanel is client-only (DOMPurify needs DOM).
function renderMarkdown(text: string) {
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
}

// The conversation survives a page refresh: the transport's session state
// (scoped token + stream resume cursor) persists to sessionStorage, completed
// turns rehydrate from the Postgres capture, and an in-flight stream resumes
// via the transport's reconnect path. sessionStorage keeps it per-tab — a new
// tab is a new conversation.
type PersistedSession = { chatId: string; session: ChatSessionPersistedState }

const restored: PersistedSession | null = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(CHAT_SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
})()

const chatId = restored?.chatId ?? crypto.randomUUID()

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
  sessions: restored ? { [chatId]: restored.session } : undefined,
  onSessionChange: (id, session) => {
    if (session) sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify({ chatId: id, session }))
    else clearChatSession()
  },
})

const chat = new Chat({ id: chatId, transport })

function newChat() {
  clearChatSession()
  location.assign(location.pathname)
}

const input = ref('')
function send() {
  const text = input.value.trim()
  if (!text) return
  ask(text)
  input.value = ''
}
function ask(question: string) {
  sessionStorage.setItem(PENDING_TURN_KEY, '1')
  chat.sendMessage({ text: question })
}

const hasMessages = computed(() => chat.messages.length > 0)
const busy = computed(() => chat.status === 'streaming' || chat.status === 'submitted')
// Turn finished (normally or with an error) — no reply is owed anymore.
watch(busy, (b) => {
  if (!b) sessionStorage.removeItem(PENDING_TURN_KEY)
})

// True for the gap between hitting send and the first part actually landing
// (Opus deciding what to do costs several silent seconds before any tool
// call or text shows up) — without this the UI looks stalled right after
// the question is asked, which is the part users actually notice.
const awaitingResponse = computed(() => {
  if (!busy.value) return false
  const last = chat.messages[chat.messages.length - 1]
  if (!last || last.role === 'user') return true
  return (last.parts as AnyPart[]).length === 0
})
const lastUserQuestion = computed(() => {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]
    if (m.role === 'user') {
      return (m.parts as AnyPart[])
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(' ')
    }
  }
  return ''
})

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
// it, in conversation order — both panes read top-to-bottom and auto-scroll
// to the newest entry, so the eye moves the same way on each side.
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
  return out
})

const railScroller = ref<HTMLElement>()
const canvasEl = ref<HTMLElement>()
const inputEl = ref<HTMLInputElement>()
// True while a restored session is fetching its history — gates the
// template so a refresh doesn't flash the landing page before the
// conversation reappears.
const restoring = ref(!!restored)

onMounted(async () => {
  inputEl.value?.focus()
  if (!restored) return
  // Completed turns come back from Postgres (no ClickHouse re-queries);
  // an interrupted turn then resumes its live stream from the session.
  let hist: { messages: { role?: string }[] } = { messages: [] }
  try {
    hist = await $fetch<{ messages: { role?: string }[] }>('/api/chat/history', {
      query: { chatId },
    })
    if (hist.messages.length) chat.messages = hist.messages as never
  } catch {
    // best-effort: a failed history fetch shouldn't block new messages
  }
  // Resume only when a reply is actually owed. The persisted isStreaming
  // flag alone can be stale — its final "done" update doesn't always flush
  // before the refresh — and resuming an idle session parks the chat in
  // 'streaming' until the SSE times out, hiding the follow-up chips. A
  // reply is owed when the pending-turn marker is set (send fired, turn
  // never finished) or when the capture itself says the last word was the
  // user's. The marker matters mid-conversation: capture only flushes at
  // turn END, so during turn N the last captured message is turn N-1's
  // answer and the history check alone would skip the resume.
  const pendingTurn = !!sessionStorage.getItem(PENDING_TURN_KEY)
  const shouldResume =
    !!restored.session.isStreaming && (pendingTurn || hist.messages.at(-1)?.role !== 'assistant')
  if (shouldResume) chat.resumeStream()
  if (hist.messages.length || !shouldResume) {
    restoring.value = false
  } else {
    // History was empty but a turn is being replayed (refresh mid-first-turn,
    // before capture flushed): the launcher would flash if restoring dropped
    // now. Hold it until the replayed chunks land — or give up after 8s so a
    // dead resume can't strand the loading state.
    const stop = watch(
      () => chat.messages.length,
      (n) => {
        if (n > 0) {
          restoring.value = false
          stop()
        }
      },
    )
    setTimeout(() => {
      restoring.value = false
      stop()
    }, 8000)
  }
  await nextTick()
  inputEl.value?.focus()
})
// One deep watcher keeps both panes following the stream. The rail pins
// to its bottom; the canvas instead anchors to the TOP of its newest
// block — a dashboard is taller than the viewport, so pinning the bottom
// would scroll its opening stat cards out of view as panels land.
// Smoothing comes from the panes' scroll-behavior CSS.
watch(
  () => chat.messages,
  async () => {
    await nextTick()
    railScroller.value?.scrollTo({ top: railScroller.value.scrollHeight })
    canvasEl.value?.querySelector('.block:last-child')?.scrollIntoView({ block: 'start' })
  },
  { deep: true },
)
// Follow-up chips appear on the status flip back to idle — not a message
// mutation — so the watcher above never fires for them; scroll the rail
// again once they render so they're in view.
watch(followups, async (chips) => {
  if (!chips.length) return
  await nextTick()
  railScroller.value?.scrollTo({ top: railScroller.value.scrollHeight })
})
</script>

<template>
  <div class="chat" :class="{ split: hasMessages }">
    <p v-if="restoring && !hasMessages" class="restoring">Restoring conversation…</p>

    <template v-else-if="!hasMessages">
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
        <div class="rail-top">
          <button class="newchat" type="button" @click="newChat">+ New chat</button>
        </div>
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
          <p v-if="awaitingResponse" class="toolstatus running">thinking…</p>
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

        <div v-if="awaitingResponse" class="block">
          <p class="block-q">{{ lastUserQuestion }}</p>
          <div class="card pending">
            <p class="meta running">thinking…</p>
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
.restoring {
  color: #9aa0a6;
  font-size: 0.9rem;
  padding: 2rem 0;
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
.rail-top {
  display: flex;
  justify-content: flex-end;
  padding: 0.75rem 0.25rem 0 0;
}
.newchat {
  border: 1px solid #3c4043;
  background: none;
  color: #9aa0a6;
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
  font-size: 0.8rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.newchat:hover {
  color: #b8f7e4;
  border-color: #57b899;
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
