// Module-wide constants: defaults, tuning knobs, best-effort regexes, API
// endpoints/headers, model/browser catalogues and ANSI palettes.

const DEFAULT_SETTINGS = {
  command: "claude",
  args: "",
  skill: "",
  startupCommands: "",
  model: "opus",
  cols: 100,
  rows: 30,
  fontSize: 14,
  notifyOnBell: true,
  defaultBrowser: "chrome",
  browserMap: [],
  autoSwitch: false,
  autoSwitchMode: "threshold",
  autoSwitchThreshold: 90,
  autoSwitchDelta: 10,
  autoSwitchUsageRegex: "",
  autoSwitchExcluded: [],
  accountSchedules: [],
  usageProbe: true,
  usageProbeModel: "",
  pythonPath: "",
  closedSessions: [],
  openSessions: {},
};

const MIN_FONT = 8;
const MAX_FONT = 40;
// Cap on the persisted reopen stack. Higher than the old in-memory 10 because the
// stack now also absorbs every tab that was open when Obsidian quit.
const MAX_CLOSED_SESSIONS = 25;

// Default pattern to scrape the 5h usage % from Claude's status line
// ("5h:[▓▓░] 23% (3 31m)"). Overridable via settings.autoSwitchUsageRegex.
const DEFAULT_USAGE_RE = "5h:[^\\n]{0,40}?(\\d{1,3})\\s*%";
// Hard ceiling: the active account must never go past this 5h usage % while there
// is somewhere with room to go. At ≥90% the plugin always tries to switch to the
// least-used eligible account that is still BELOW 90% (keeping a 10% margin),
// OVERRIDING the configured mode/threshold. The single exception is when every
// other account is already ≥90% (or none is eligible): then it stays on the
// current account and runs it to the limit, since switching would buy no margin.
const SWITCH_CEILING_PCT = 90;
// Weekly (7d) ceiling for the DESTINATION of an auto-switch: never jump TO an
// account whose 7d usage is already ≥ this %, so we don't land on a cuenta that
// is about to hit its weekly limit mid-response. Applies to candidate selection
// only (it filters destinations); it does not force the active account to move.
const WEEKLY_CEILING_PCT = 95;
// Best-effort patterns (the exact text Claude prints may change — tune if needed).
// AUTH_FAIL_RE: an auth problem after a swap (e.g. a saved token is dead).
const AUTH_FAIL_RE =
  /please (run )?\/login|invalid (oauth )?(token|credentials)|token (has )?expired|authentication (failed|error)|unauthorized|\b401\b/i;
// LIMIT_STOP_RE: Claude stopped because the usage/token limit was hit → paints
// the tab RED and is also the auto-switch fallback trigger. Deliberately strict:
// no bare "resets at", which shows in the status bar normally and would fire
// falsely (as a switch trigger it caused an account ping-pong every cooldown).
// Best-effort: Claude's exact wording can change; tune here if the red never
// lights up or lights up wrongly.
const LIMIT_STOP_RE =
  /(usage|5-?hour|weekly|rate)[- ]?limit (reached|exceeded)|limit reached\b|you'?ve (reached|hit) your[^.]{0,30}\blimit|reached your[^.]{0,20}\blimit|out of (credits|usage)|claude usage limit/i;
// Detecting "Claude is BLOCKED waiting for the user to answer" — a permission prompt
// ("Do you want to proceed?"), a plan-approval prompt, or an AskUserQuestion form.
// While waiting Claude emits no tokens, so the heartbeat would mark the tab idle
// (green, "done") and you couldn't tell "finished" from "needs your answer";
// matching this paints the tab RED instead. Best-effort, like LIMIT_STOP_RE.
//
// FALSE-POSITIVE GUARD: the individual footer words ("Esc to cancel", etc.) can also
// appear in Claude's PROSE (e.g. it explains a keybinding), so a single fragment is
// NOT enough. looksLikePrompt() requires either (a) a specific permission/plan
// SENTENCE — full phrases unlikely in passing — or (b) BOTH a navigation hint AND an
// action hint together, which is the multi-part footer real menus print
// ("Enter to select · Tab/Arrow keys to navigate · Esc to cancel") and which prose
// almost never combines. Language-independent (the footer is English even when the
// question is in Spanish — verified against a Spanish AskUserQuestion form). The exact
// wording can change between CLI versions — tune these three regexes if needed.
const PROMPT_SENTENCE_RE =
  /No,?\s+and tell Claude what to do|Do you want to (proceed|make|create|run|allow|apply|continue|edit)\b|Would you like to proceed/i;
// The footer stays ENGLISH on the CLIs seen so far even when the question is in
// Spanish/French (the TUI chrome isn't localised — only the question text Claude
// writes is), so the nav+act path is language-independent. Also matches arrow
// GLYPHS ("↑/↓ to navigate") — some CLI versions print ↑↓←→ instead of the words
// "arrow"/"keys", which slipped past before. As cheap insurance we ALSO accept the
// FRENCH footer verbs ("naviguer", "Entrée/Échap pour …") in case a future or
// localised CLI ever translates the footer. Best-effort — tune with real text.
const PROMPT_NAV_HINT_RE =
  /\bkeys? to navigate\b|\b(arrow|tab)\b[^\n]{0,24}\bnavigate\b|[↑↓←→][^\n]{0,24}\b(navigate|naviguer)\b|\b(fl[èe]ches?|tab)\b[^\n]{0,24}\bnaviguer\b|\bpour naviguer\b/i;
const PROMPT_ACT_HINT_RE =
  /\benter to (select|submit|confirm)\b|\besc to cancel\b|\bentr[ée]e pour (s[ée]lectionner|valider|confirmer|soumettre)\b|\b[ée]chap\w* pour annuler\b/i;
function looksLikePrompt(text) {
  if (PROMPT_SENTENCE_RE.test(text)) return true;
  return PROMPT_NAV_HINT_RE.test(text) && PROMPT_ACT_HINT_RE.test(text);
}
// Generic email matcher (filtered against known accounts before use).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// --- Live usage probe (authoritative %, read from Anthropic's rate-limit
// response headers). Verified working with the OAuth token Claude Code stores.
// A minimal /v1/messages call (max_tokens:1) returns the 5h/7d utilisation in
// response headers; we read each account's token to probe it WITHOUT switching.
// Best-effort: the beta header value and model id may change over time.
const USAGE_API_URL = "https://api.anthropic.com/v1/messages";
const USAGE_PROBE_MODEL = "claude-haiku-4-5-20251001"; // cheapest; full id required
const OAUTH_BETA = "oauth-2025-04-20";
const ANTHROPIC_VERSION = "2023-06-01";
// OAuth refresh-token grant (the same flow Claude Code uses internally to keep
// accounts alive). Endpoint + client_id were verified by extracting the strings
// from the Claude Code binary; both may change with future CLI versions.
const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
// Opened in an account's mapped browser from the 👤 menu so the user can quickly
// re-login that account where its SSO/cookie lives. claude.ai redirects to the
// login screen when the session is expired.
const CLAUDE_LOGIN_URL = "https://claude.ai/";
// Only refresh a token when it's expired or within this window of expiring. The
// token endpoint rate-limits hard (observed 429), and refreshing a still-valid
// token would rotate the refresh token needlessly, so we keep each account's
// refresh rate near claude's own (~once per token lifetime) while still checking
// every account on each keep-alive tick.
const REFRESH_SKEW_MS = 30 * 60 * 1000;
// Response header names carrying the unified rate-limit utilisation (0..1).
const H_5H_UTIL = "anthropic-ratelimit-unified-5h-utilization";
const H_5H_RESET = "anthropic-ratelimit-unified-5h-reset";
const H_7D_UTIL = "anthropic-ratelimit-unified-7d-utilization";
// The 7d reset epoch. Expected name by symmetry with the 5h header, but not
// verified live (unlike H_5H_RESET); probeUsage also scans for any "7d…reset"
// header as a fallback so a renamed/variant header still works.
const H_7D_RESET = "anthropic-ratelimit-unified-7d-reset";
const H_5H_STATUS = "anthropic-ratelimit-unified-5h-status";
const USAGE_FRESH_MS = 6 * 60 * 1000; // a reading older than this is "stale"
// TTL for the cached currentAccountEmail()/listSavedAccounts() reads. Both are
// called (several times) from maybeAutoSwitch on EVERY pty data chunk; without a
// cache that meant re-reading ~/.claude.json (often huge) plus every account
// snapshot dozens of times per second during streaming — real renderer jank.
// Writes through the plugin invalidate the cache; external changes (/login in
// the terminal) are picked up within this TTL.
const ACCOUNT_CACHE_MS = 5000;

// Models offered in the header menu. `id` is the /model argument.
const MODELS = [
  { id: "haiku", label: "Haiku 4.5" },
  { id: "sonnet", label: "Sonnet 4.6" },
  { id: "opus", label: "Opus 4.8" },
  { id: "fable", label: "Fable 5" },
];

// Known browsers for the remote-control "browser per account" mapping. `exes`
// are the usual install paths (PROGRAMFILES placeholders filled at runtime);
// `alias` is what Windows `start` resolves via its App Paths registry entry;
// `proc` is the process name (no .exe) used to focus + fullscreen the window.
const BROWSERS = {
  chrome: {
    label: "Chrome",
    exes: [
      "%PROGRAMFILES%\\Google\\Chrome\\Application\\chrome.exe",
      "%PROGRAMFILES(X86)%\\Google\\Chrome\\Application\\chrome.exe",
      "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
    ],
    alias: "chrome",
    proc: "chrome",
  },
  firefox: {
    label: "Firefox",
    exes: [
      "%PROGRAMFILES%\\Mozilla Firefox\\firefox.exe",
      "%PROGRAMFILES(X86)%\\Mozilla Firefox\\firefox.exe",
    ],
    alias: "firefox",
    proc: "firefox",
  },
  edge: {
    label: "Edge",
    exes: [
      "%PROGRAMFILES(X86)%\\Microsoft\\Edge\\Application\\msedge.exe",
      "%PROGRAMFILES%\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
    alias: "msedge",
    proc: "msedge",
  },
  brave: {
    label: "Brave",
    exes: [
      "%PROGRAMFILES%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "%PROGRAMFILES(X86)%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ],
    alias: "brave",
    proc: "brave",
  },
  // Opera and Opera GX both ship an opera.exe; the folder is what distinguishes
  // them, so the per-user install path is the authoritative selector.
  opera: {
    label: "Opera",
    exes: [
      "%LOCALAPPDATA%\\Programs\\Opera\\opera.exe",
      "%PROGRAMFILES%\\Opera\\opera.exe",
    ],
    alias: "opera",
    proc: "opera",
  },
  operagx: {
    label: "Opera GX",
    exes: [
      "%LOCALAPPDATA%\\Programs\\Opera GX\\opera.exe",
      "%PROGRAMFILES%\\Opera GX\\opera.exe",
    ],
    alias: "opera",
    proc: "opera",
  },
  zen: {
    label: "Zen",
    exes: [
      "%PROGRAMFILES%\\Zen Browser\\zen.exe",
      "%LOCALAPPDATA%\\Programs\\Zen Browser\\zen.exe",
      "%LOCALAPPDATA%\\zen\\zen.exe",
    ],
    alias: "zen",
    proc: "zen",
  },
  // Helium (by imput) is Chromium-based: its launcher keeps the chrome.exe name,
  // living in Application\ (the versioned subfolder only holds helper exes). The
  // running process is therefore chrome.exe, so proc collides with Chrome's.
  helium: {
    label: "Helium",
    exes: [
      "%LOCALAPPDATA%\\imput\\Helium\\Application\\chrome.exe",
      "%PROGRAMFILES%\\imput\\Helium\\Application\\chrome.exe",
    ],
    alias: "helium",
    proc: "chrome",
  },
  vivaldi: {
    label: "Vivaldi",
    exes: [
      "%LOCALAPPDATA%\\Vivaldi\\Application\\vivaldi.exe",
      "%PROGRAMFILES%\\Vivaldi\\Application\\vivaldi.exe",
    ],
    alias: "vivaldi",
    proc: "vivaldi",
  },
  waterfox: {
    label: "Waterfox",
    exes: [
      "%PROGRAMFILES%\\Waterfox\\waterfox.exe",
      "%PROGRAMFILES(X86)%\\Waterfox\\waterfox.exe",
    ],
    alias: "waterfox",
    proc: "waterfox",
  },
  floorp: {
    label: "Floorp",
    exes: [
      "%PROGRAMFILES%\\Ablaze Floorp\\floorp.exe",
      "%PROGRAMFILES%\\Floorp\\floorp.exe",
    ],
    alias: "floorp",
    proc: "floorp",
  },
  // Mullvad Browser is Tor-Browser-based (Firefox/Gecko). Per-user install puts the
  // launcher in %LOCALAPPDATA%\Mullvad\MullvadBrowser\Release\mullvadbrowser.exe.
  mullvad: {
    label: "Mullvad Browser",
    exes: [
      "%LOCALAPPDATA%\\Mullvad\\MullvadBrowser\\Release\\mullvadbrowser.exe",
      "%PROGRAMFILES%\\Mullvad Browser\\mullvadbrowser.exe",
    ],
    alias: "mullvadbrowser",
    proc: "mullvadbrowser",
  },
};

// 16 ANSI colours for dark vs light surfaces (from the reference harness).
const ANSI_DARK = {
  black: "#241B2C", red: "#FF6B6B", green: "#6BCF7F", yellow: "#FFD93D",
  blue: "#4ECDC4", magenta: "#B197FC", cyan: "#4ECDC4", white: "#F3ECF7",
  brightBlack: "#857693", brightRed: "#FFB4B4", brightGreen: "#B4E5BD",
  brightYellow: "#FFEC99", brightBlue: "#A8E6E0", brightMagenta: "#D6C5FF",
  brightCyan: "#A8E6E0", brightWhite: "#FFFDF5",
};
const ANSI_LIGHT = {
  black: "#1A1320", red: "#D1453B", green: "#20904B", yellow: "#9C6B00",
  blue: "#2B6CB0", magenta: "#8A5CF0", cyan: "#1F9C94", white: "#3A2F44",
  brightBlack: "#6B5878", brightRed: "#E0584E", brightGreen: "#2E9E54",
  brightYellow: "#B8860B", brightBlue: "#3B7DC4", brightMagenta: "#9B72F2",
  brightCyan: "#2BA89F", brightWhite: "#1A1320",
};

module.exports = {
  DEFAULT_SETTINGS,
  MIN_FONT,
  MAX_FONT,
  MAX_CLOSED_SESSIONS,
  DEFAULT_USAGE_RE,
  SWITCH_CEILING_PCT,
  WEEKLY_CEILING_PCT,
  AUTH_FAIL_RE,
  LIMIT_STOP_RE,
  PROMPT_SENTENCE_RE,
  PROMPT_NAV_HINT_RE,
  PROMPT_ACT_HINT_RE,
  looksLikePrompt,
  EMAIL_RE,
  USAGE_API_URL,
  USAGE_PROBE_MODEL,
  OAUTH_BETA,
  ANTHROPIC_VERSION,
  OAUTH_TOKEN_URL,
  OAUTH_CLIENT_ID,
  CLAUDE_LOGIN_URL,
  REFRESH_SKEW_MS,
  H_5H_UTIL,
  H_5H_RESET,
  H_7D_UTIL,
  H_7D_RESET,
  H_5H_STATUS,
  USAGE_FRESH_MS,
  ACCOUNT_CACHE_MS,
  MODELS,
  BROWSERS,
  ANSI_DARK,
  ANSI_LIGHT,
};
