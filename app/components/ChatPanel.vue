<script setup lang="ts">
import { Chat } from '@ai-sdk/vue'
import { TriggerChatTransport } from '@trigger.dev/sdk/chat'

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
</script>

<template>
  <div class="chat">
    <div class="messages">
      <div v-for="m in chat.messages" :key="m.id" class="msg" :class="m.role">
        <template v-for="(part, i) in m.parts" :key="i">
          <p v-if="part.type === 'text'" class="text">{{ part.text }}</p>
          <div v-else-if="part.type === 'tool-trending_repos'" class="tool">
            <p v-if="part.state !== 'output-available'" class="meta">running query…</p>
            <ToolChart v-else :output="part.output" />
          </div>
        </template>
      </div>
      <p v-if="chat.messages.length === 0" class="hint">
        Try: “What are the hottest repos in the last 24 hours?”
      </p>
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
}
.messages {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 300px;
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
  white-space: pre-wrap;
}
.meta,
.hint {
  color: #9aa0a6;
  font-size: 0.85rem;
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
