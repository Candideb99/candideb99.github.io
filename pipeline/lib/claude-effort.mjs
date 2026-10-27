/**
 * How hard Claude thinks before it answers: the Claude CLI's --effort (low, medium, high, xhigh, max; the Claude app's menu
 * names the same five Low, Medium, High, Extra, Max, so «xhigh» is its Extra). Until 2026-10-27 the newsroom passed none and
 * the subscription's default applied; on a test prompt it thought no more than «high» did. The owner's choice that day:
 * "increase the opus 5.5 effort from high to extra", and "do not use max". KHAZENDAR_CLAUDE_EFFORT overrides it, set from
 * the control room's Settings (.env and the repository variable the workflows pass). Its own module, without side effects,
 * so the control room can read it without loading the newsroom's keys (llm.mjs loads .env on import).
 */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const CLAUDE_EFFORT = "xhigh";
export const claudeEffort = (env = process.env) => (CLAUDE_EFFORTS.includes(env.KHAZENDAR_CLAUDE_EFFORT) ? env.KHAZENDAR_CLAUDE_EFFORT : CLAUDE_EFFORT);
