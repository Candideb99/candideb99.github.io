/**
 * How hard Claude thinks before it chooses a photograph: the Claude CLI's --effort (low, medium, high, xhigh, max; the
 * Claude app's menu names the same five Low, Medium, High, Extra, Max, so «xhigh» is its Extra). The owner, 2026-10-27:
 * "increase the opus 5.5 effort from high to extra in the control room, maybe it helps", on five weak or missing photos,
 * and "do not use max".
 *
 * The picture desk's calls only (lib/images.mjs). Applied to every call that morning, the first run at Extra published
 * nothing: the writer thought past its four-minute timeout on all nine tries (three stories, three tries each) and the desk
 * notes took three minutes a call with 13,000 to 18,000 thinking tokens. Every other call runs at the subscription's default,
 * as all did until then; the picture desk's calls took about 11 seconds at Extra against 5 before.
 *
 * KHAZENDAR_CLAUDE_EFFORT overrides it, set from the control room's Settings (.env and the repository variable the
 * workflows pass). Its own module, without side effects, so the control room can read it without loading the newsroom's
 * keys (llm.mjs loads .env on import).
 */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const CLAUDE_EFFORT = "xhigh";
export const claudeEffort = (env = process.env) => (CLAUDE_EFFORTS.includes(env.KHAZENDAR_CLAUDE_EFFORT) ? env.KHAZENDAR_CLAUDE_EFFORT : CLAUDE_EFFORT);
