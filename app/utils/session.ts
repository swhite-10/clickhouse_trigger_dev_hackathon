// Single source of truth for the persisted chat session (ChatPanel writes it
// on every transport state change; the header brand link and the New chat
// button clear it so navigation to "/" lands on the launcher, not a restore).
export const CHAT_SESSION_KEY = 'gh-pulse-session'

export function clearChatSession() {
  sessionStorage.removeItem(CHAT_SESSION_KEY)
}
