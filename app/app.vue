<template>
  <main class="wrap">
    <h1>gh-pulse</h1>
    <p class="sub">Ask about GitHub activity — get charts, not paragraphs.</p>
    <ClientOnly>
      <ChatPanel />
      <template #fallback>
        <p class="sub">Loading chat…</p>
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
.wrap {
  max-width: 860px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
h1 {
  color: #b8f7e4;
  margin-bottom: 0.25rem;
}
.sub {
  color: #9aa0a6;
  margin-top: 0;
}
</style>
