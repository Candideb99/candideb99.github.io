/**
 * Which way the control room's "Change the site" chat runs (scripts/control-room.mjs startChat()), kept apart from the
 * server so scripts/pipeline-selftest.mjs can test it. Only Claude Code can read and change the site's files, so the chat
 * runs it whenever it is installed and holds a Claude token or key, whatever provider writes the news. Until 2026-11-01
 * any other newsroom provider made the chat a plain text model that was told to change the site and to end by saying what
 * it changed, which it could only describe (a review of that day). Without Claude Code the chat still answers, through
 * the newsroom's provider, under rules that say it changes nothing (ANSWER_ONLY_RULES in control-room.mjs).
 */
export function chatRoute(provider, { cli = null, keys = {} } = {}) {
  if (String(provider ?? "").toLowerCase() === "claude") return "claude";
  return cli && (keys.CLAUDE_CODE_OAUTH_TOKEN || keys.ANTHROPIC_API_KEY) ? "claude" : "answer-only";
}
