<script setup lang="ts">
// Fixture gallery for eyeballing chart layout without LLM turns: /?gallery=1
const showGallery = computed(() => import.meta.client && location.search.includes('gallery'))

// Chat keeps its in-flight session state across tab switches (v-show); the
// pulse view remounts on every open (v-if) so its telemetry is always fresh.
const view = ref<'chat' | 'pulse'>('chat')
// Deep-link (?pulse=1) resolves after mount: deciding during setup would
// desync hydration from the server-rendered header (stale tab highlight).
onMounted(() => {
  if (location.search.includes('pulse')) view.value = 'pulse'
})
</script>

<template>
  <main class="wrap">
    <header class="top">
      <h1>gh-pulse</h1>
      <p class="sub">Ask about GitHub activity — get charts, not paragraphs.</p>
      <nav v-if="!showGallery" class="tabs">
        <button type="button" :class="{ on: view === 'chat' }" @click="view = 'chat'">Chat</button>
        <button type="button" :class="{ on: view === 'pulse' }" @click="view = 'pulse'">App pulse</button>
      </nav>
    </header>
    <ClientOnly>
      <ChartGallery v-if="showGallery" />
      <template v-else>
        <ChatPanel v-show="view === 'chat'" />
        <PulsePanel v-if="view === 'pulse'" />
      </template>
      <template #fallback>
        <p class="loading">Loading chat…</p>
      </template>
    </ClientOnly>
  </main>
</template>

<style>
/* Everything sizes in rem; 14px root keeps the whole UI comfortable on a
   13.6" laptop (≈1280pt viewport) without per-component tweaks. */
html {
  font-size: 14px;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #25272c;
  color: #e8eaed;
  margin: 0;
}
* {
  scrollbar-width: thin;
  scrollbar-color: #3c4043 transparent;
}
.wrap {
  max-width: 1720px;
  margin: 0 auto;
  padding: 0 2rem;
  height: 100dvh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.top {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  padding: 1.1rem 0 0.9rem;
  border-bottom: 1px solid #33363b;
  flex: 0 0 auto;
}
h1 {
  color: #b8f7e4;
  font-size: 1.35rem;
  margin: 0;
  letter-spacing: -0.01em;
}
.sub,
.loading {
  color: #9aa0a6;
  margin: 0;
  font-size: 0.9rem;
}
.tabs {
  margin-left: auto;
  display: flex;
  gap: 0.4rem;
}
.tabs button {
  border: 1px solid transparent;
  background: none;
  color: #9aa0a6;
  border-radius: 999px;
  padding: 0.3rem 0.85rem;
  font-size: 0.85rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.tabs button:hover {
  color: #e8eaed;
}
.tabs button.on {
  color: #b8f7e4;
  border-color: #57b899;
  background: rgba(184, 247, 228, 0.06);
}
.loading {
  padding: 2rem 0;
}
</style>
