<script setup lang="ts">
// Empty-state launcher: teaches the data contract (which repos have full
// history, what everything else covers) and organises the prompt library by
// intent so every chart type has an obvious way in.
const emit = defineEmits<{ ask: [question: string] }>()

const curated = [
  { label: 'ClickHouse (org)', ask: 'Give me an overview of the ClickHouse org' },
  { label: 'DuckDB (org)', ask: 'Give me an overview of the duckdb org' },
  { label: 'Vue.js (org)', ask: 'Give me an overview of the vuejs org' },
  { label: 'facebook/react', ask: 'Tell me about facebook/react' },
  { label: 'microsoft/vscode', ask: 'Tell me about microsoft/vscode' },
  { label: 'anthropics/claude-code', ask: 'Tell me about anthropics/claude-code' },
  { label: 'triggerdotdev/trigger.dev', ask: 'Tell me about triggerdotdev/trigger.dev' },
]

const groups = [
  {
    name: 'Discover',
    blurb: 'what is moving across GitHub right now',
    questions: [
      "What's trending on GitHub right now?",
      'Which repos are rising this week vs last week?',
      'Issues opened vs PRs merged across the hottest repos this quarter',
    ],
  },
  {
    name: 'Deep-dive',
    blurb: 'one project, every angle',
    questions: [
      'Tell me about anthropics/claude-code',
      'When during the week is ClickHouse/ClickHouse most active?',
      'Show a 2025 contribution calendar for microsoft/vscode',
      "Map the ClickHouse org's activity by repo this year",
    ],
  },
  {
    name: 'Compare',
    blurb: 'head to head',
    questions: [
      'vuejs/core vs facebook/react: monthly stars since 2022',
      'Compare ClickHouse, DuckDB and VS Code as projects',
    ],
  },
  {
    name: 'Community',
    blurb: 'the people behind the commits',
    questions: [
      "Who are trigger.dev's top human contributors this year?",
      'New contributors per month for duckdb/duckdb since 2023',
      'Who opens vuejs/core PRs — core team or outside contributors?',
      'Which ClickHouse org repos share contributors?',
    ],
  },
  {
    name: 'Health',
    blurb: 'velocity and backlog',
    questions: [
      'How long do PRs take to merge in facebook/react?',
      'Issues opened vs closed in microsoft/vscode this year',
      'What are the hottest issues in vuejs/core right now?',
    ],
  },
]
</script>

<template>
  <div class="home">
    <div class="hero">
      <h2>Ask about GitHub activity — get charts, not paragraphs.</h2>
      <p class="coverage-label">Full history since 2019 for:</p>
      <div class="repos">
        <button v-for="r in curated" :key="r.label" class="repo" type="button" @click="emit('ask', r.ask)">
          {{ r.label }}
        </button>
      </div>
      <p class="coverage-note">
        Any other repo: stars, forks, issues, PRs and releases for the last 90 days.
      </p>
    </div>
    <div class="groups">
      <section v-for="g in groups" :key="g.name" class="group">
        <h3>{{ g.name }}<span class="blurb"> — {{ g.blurb }}</span></h3>
        <button
          v-for="q in g.questions"
          :key="q"
          class="q"
          type="button"
          @click="emit('ask', q)"
        >
          {{ q }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home {
  margin: auto;
  width: 100%;
  max-width: 1080px;
  padding: 1.5rem 0 1rem;
}
.hero {
  text-align: center;
  margin-bottom: 2rem;
}
.hero h2 {
  color: #e8eaed;
  font-size: 1.3rem;
  font-weight: 600;
  margin: 0 0 1.4rem;
}
.coverage-label {
  color: #9aa0a6;
  font-size: 0.85rem;
  margin: 0 0 0.6rem;
}
.repos {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}
.repo {
  border: 1px solid #57b899;
  background: rgba(184, 247, 228, 0.06);
  color: #b8f7e4;
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.repo:hover {
  background: rgba(184, 247, 228, 0.14);
}
.coverage-note {
  color: #9aa0a6;
  font-size: 0.8rem;
  margin: 0.8rem 0 0;
}
.groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.1rem;
}
.group {
  background: #2d3035;
  border: 1px solid #383b41;
  border-radius: 14px;
  padding: 1rem 1.1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.group h3 {
  color: #b8f7e4;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 0.35rem;
}
.blurb {
  color: #9aa0a6;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
}
.q {
  text-align: left;
  border: 1px solid #3c4043;
  background: #25272c;
  color: #e8eaed;
  border-radius: 10px;
  padding: 0.55rem 0.8rem;
  font-size: 0.87rem;
  line-height: 1.35;
  cursor: pointer;
  transition: border-color 0.15s;
}
.q:hover {
  border-color: #b8f7e4;
}
</style>
