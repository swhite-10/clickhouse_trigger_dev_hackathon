<template>
  <main class="wrap">
    <header class="top">
      <h1>gh-pulse</h1>
      <p class="sub">Ask about GitHub activity — get charts, not paragraphs.</p>
    </header>
    <ClientOnly>
      <ChatPanel />
      <template #fallback>
        <p class="loading">Loading chat…</p>
      </template>
    </ClientOnly>
  </main>
</template>

<style>
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
  max-width: 1240px;
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
.loading {
  padding: 2rem 0;
}
</style>
