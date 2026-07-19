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
      <input v-model="input" placeholder="Ask about GitHub activity…" spellcheck="false" />
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
  gap: 1rem;
  flex: 1 1 auto;
  min-height: 0;
}
.messages {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex: 1 1 auto;
  min-height: 300px;
  overflow-y: auto;
  scroll-behavior: smooth;
  padding-right: 0.25rem;
}
.empty {
  margin: auto 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.chip {
  border: 1px solid #3c4043;
  background: #2d3035;
  color: #b8f7e4;
  border-radius: 999px;
  padding: 0.45rem 0.9rem;
  font-size: 0.85rem;
  cursor: pointer;
  text-align: left;
}
.chip:hover {
  border-color: #b8f7e4;
}
.msg {
  border-radius: 12px;
  padding: 0.75rem 1rem;
  max-width: 90%;
}
.msg.user {
  align-self: flex-end;
  background: #b8f7e4;
  color: #25272c;
}
.msg.assistant {
  align-self: flex-start;
  background: #2d3035;
  border: 1px solid #3c4043;
  width: 100%;
}
.text {
  margin: 0.25rem 0;
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
.meta,
.hint {
  color: #9aa0a6;
  font-size: 0.85rem;
}
.meta.error {
  color: #f7a8a8;
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
  gap: 0.5rem;
}
.ask input {
  flex: 1;
  padding: 0.6rem 0.9rem;
  border-radius: 8px;
  border: 1px solid #3c4043;
  background: #2d3035;
  color: #e8eaed;
  font-size: 1rem;
}
.ask button {
  padding: 0.6rem 1.4rem;
  border-radius: 8px;
  border: none;
  background: #b8f7e4;
  color: #25272c;
  font-weight: 600;
  cursor: pointer;
}
.ask button:disabled {
  opacity: 0.6;
}
</style>
