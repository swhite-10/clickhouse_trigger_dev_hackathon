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

// One seed question per chart family the renderer speaks.
const suggestions = [
  'What can you tell me about ClickHouse/ClickHouse?',
  'What are the hottest repos in the last 24 hours?',
  'Monthly stars for vuejs/core vs facebook/react since 2022',
  'When during the week is ClickHouse/ClickHouse most active?',
  'Issues opened vs PRs merged for the top 20 repos in H1 2025',
  'Show a contribution calendar for ClickHouse/ClickHouse in 2025',
  "Treemap of the ClickHouse org's activity by repo in H1 2025",
]
function ask(question: string) {
  chat.sendMessage({ text: question })
}

const scroller = ref<HTMLElement>()
const inputEl = ref<HTMLInputElement>()
onMounted(() => inputEl.value?.focus())
watch(
  () => chat.messages,
  async () => {
    await nextTick()
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
  },
  { deep: true },
)
</script>

<template>
  <div class="chat">
    <div ref="scroller" class="messages">
      <div v-for="m in chat.messages" :key="m.id" class="msg" :class="m.role">
        <template v-for="(part, i) in m.parts" :key="i">
          <div v-if="part.type === 'text'" class="text" v-html="renderMarkdown(part.text)" />
          <div v-else-if="part.type === 'tool-run_dashboard'" class="tool">
            <p v-if="part.state !== 'output-available'" class="meta">
              {{ part.state === 'output-error' ? `dashboard failed: ${part.errorText}` : 'building dashboard…' }}
            </p>
            <template v-else>
              <h3 class="dash-title">{{ part.output.title }}</h3>
              <div class="dash-stats">
                <template v-for="(panel, j) in part.output.panels" :key="`s${j}`">
                  <ToolChart v-if="!panel.error && panel.chart.type === 'stat'" :output="panel" />
                </template>
              </div>
              <div class="dash-grid">
                <template v-for="(panel, j) in part.output.panels" :key="`p${j}`">
                  <p v-if="panel.error" class="meta error">panel failed — {{ panel.error }}</p>
                  <ToolChart v-else-if="panel.chart.type !== 'stat'" :output="panel" />
                </template>
              </div>
              <p class="meta">
                {{ part.output.panels.length }} queries in parallel ·
                {{ part.output.totalMs }}ms total in ClickHouse
              </p>
            </template>
          </div>
          <div v-else-if="part.type.startsWith('tool-')" class="tool">
            <p v-if="part.state !== 'output-available'" class="meta">
              {{ part.state === 'output-error' ? `query failed: ${part.errorText}` : 'running query…' }}
            </p>
            <p v-else-if="part.output?.error" class="meta error">
              query failed, agent is retrying — {{ part.output.error }}
            </p>
            <template v-else>
              <ToolChart :output="part.output" />
              <details v-if="part.output?.sql" class="sql">
                <summary>SQL</summary>
                <pre>{{ part.output.sql }}</pre>
              </details>
            </template>
          </div>
        </template>
      </div>
      <div v-if="chat.messages.length === 0" class="empty">
        <p class="hint">Ask about GitHub activity and get a chart back. Try one of these:</p>
        <div class="chips">
          <button v-for="q in suggestions" :key="q" class="chip" type="button" @click="ask(q)">
            {{ q }}
          </button>
        </div>
      </div>
    </div>

    <form class="ask" @submit.prevent="send">
      <input ref="inputEl" v-model="input" placeholder="Ask about GitHub activity…" spellcheck="false" />
      <button type="submit" :disabled="chat.status === 'streaming' || chat.status === 'submitted'">
        {{ chat.status === 'streaming' || chat.status === 'submitted' ? '…' : 'Ask' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.messages {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  flex: 1 1 auto;
  min-height: 300px;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding: 1.5rem 0.25rem 1rem 0;
}
.empty {
  margin: auto;
  text-align: center;
  max-width: 720px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
  margin-top: 1.1rem;
}
.chip {
  border: 1px solid #3c4043;
  background: #2d3035;
  color: #b8f7e4;
  border-radius: 999px;
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  cursor: pointer;
  transition: border-color 0.15s;
}
.chip:hover {
  border-color: #b8f7e4;
}
.msg.user {
  align-self: flex-end;
  background: #b8f7e4;
  color: #25272c;
  border-radius: 999px;
  padding: 0.55rem 1.15rem;
  max-width: 70%;
  font-weight: 500;
}
.msg.user .text :deep(p) {
  margin: 0;
}
.msg.assistant {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.tool {
  background: #2d3035;
  border: 1px solid #383b41;
  border-radius: 14px;
  padding: 1.1rem 1.3rem 0.9rem;
}
.text {
  margin: 0;
  line-height: 1.55;
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
.text :deep(table) {
  border-collapse: collapse;
  margin: 0.5rem 0;
}
.text :deep(th),
.text :deep(td) {
  border-bottom: 1px solid #3c4043;
  padding: 0.3rem 0.6rem;
  text-align: left;
}
.meta {
  color: #9aa0a6;
  font-size: 0.85rem;
}
.hint {
  color: #9aa0a6;
  font-size: 1.05rem;
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
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 1.5rem 2rem;
  align-items: start;
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
  padding: 0.7rem 1.6rem;
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
</style>
