// Single source of truth for the persisted chat session (ChatPanel writes it
// on every transport state change; the header brand link and the New chat
// button clear it so navigation to "/" lands on the launcher, not a restore).
export const CHAT_SESSION_KEY = 'gh-pulse-session'

// Set when a message is sent, cleared when the turn finishes: a refresh
// while it's present means a reply is genuinely owed, which the Postgres
// capture can't tell us (it only flushes at turn end, so mid-turn the
// last captured message is the PREVIOUS turn's answer).
export const PENDING_TURN_KEY = 'gh-pulse-pending-turn'

export function clearChatSession() {
  sessionStorage.removeItem(CHAT_SESSION_KEY)
  sessionStorage.removeItem(PENDING_TURN_KEY)
}
