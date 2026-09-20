# Diagnostic Report — `"Thinking mode does not support this tool_choice"` in Mercury Agent 1.2.7

**Prepared for:** Nick
**Prepared by:** PiePeP
**Date:** 2026-09-18
**Subject:** HTTP 400 crash during the "getting started on the real build now (attempt 1 of 5)" action round
**Status:** ✅ Root cause identified, confirmed at code level, and **independently re-verified 2026-09-18** (see §9 Validation log). No upstream fix available — Mercury 1.2.7 is the latest published release (confirmed via `npm view @cosmicstack/mercury-agent version` → `1.2.7`).

---

## TL;DR

The crash is **not** a network fault, a bad prompt, or a corrupted install. It is a **hard incompatibility between two features inside the Mercury Agent runtime itself**:

1. The runtime's **"execute guard"** deliberately forces a tool call (`toolChoice: "required"`) whenever a turn ends with narration instead of action.
2. The configured model path — **DeepSeek V4 models (`deepseek-flash`)** — runs in **thinking mode by default** server-side, and DeepSeek's API **rejects any forced `tool_choice` while thinking mode is active**.

Result: the forced call is rejected with HTTP **400** and `isRetryable: false`, so all 5 guard attempts were guaranteed to fail. Because the setting is hard-coded in the runtime bundle and the model list only contains thinking-capable models, **no configuration change available to you fixes it** — a targeted patch or an upstream fix is required.

---

## 1. What Nick saw

> **You:** i need a automated program made
> **PiePeP:** Good — that's squarely in my wheelhouse. I just need to know what it should do before I start building. *(4 clarifying questions)*
> **PiePeP:** Alright — getting started on the real build now (attempt 1 of 5)...
> `⠧ Processing · 3s` → *stream error dump*
> `statusCode: 400` … `responseBody: '{"error":{"message":"Thinking mode does not support this tool_choice","type":"invalid_request_error","param":null,"code":"invalid_request_error"}}'` … `isRetryable: false`

The second PiePeP bubble is the tell: PiePeP answered with **pure narration** (questions, no tool call). The runtime treats "narration-only" replies as a *failure to act* and mechanically escalates.

---

## 2. Exact causal chain

| # | Step | Evidence |
|---|---|---|
| 1 | User: *"i need a automated program made"* | session transcript, seq 5 |
| 2 | Assistant replies with **text only** — no tool call | session transcript, seq 6 |
| 3 | Execute-guard detects *"turn ended without any mutating tool call"* and **forces a continuation round** | `dist/index.js`, guard block ~@1120000 |
| 4 | Guard posts *"Alright — getting started on the real build now (attempt N of 5)..."* | `dist/index.js` @1091800-ish |
| 5 | Guard issues a new stream with `prepareStep → { toolChoice: "required" }` | `dist/index.js` @1120257 |
| 6 | The DeepSeek provider serialises `tool_choice: "required"` into the request body | `@ai-sdk/deepseek/dist/index.js` |
| 7 | The model runs in **thinking mode by default** (no explicit `thinking` field sent) | `@ai-sdk/deepseek/dist/index.js` — `const thinking = … : void 0` |
| 8 | DeepSeek API rejects the combination → **HTTP 400** | observed error |
| 9 | `isRetryable: false` → attempts 2–5 were doomed | observed error |

**In one line:** *narration-only reply → forced tool call → thinking model → hard 400.*

---

## 3. Code-level evidence

### 3.1 The forced tool call (2 sites only, confirmed by exact match)

Bundle: `C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js`

**Site 1 — @1016067** (inside `runInlineContinuationRound(opts)`):

```js
async runInlineContinuationRound(opts) {
  this.markProgress(`Resuming with ${opts.provider.name}...`);
  const deadlineAt = Date.now() + MAX_PROVIDER_ATTEMPT_MS;
  const stream = streamText4({
    model: opts.provider.getModelInstance(),
    system: opts.systemPrompt,
    messages: opts.messages,
    tools: this.capabilities.getTools(),
    maxOutputTokens: opts.maxOutputTokens,
    stopWhen: stepCountIs(opts.maxSteps),
    // forceFirstTool: the first step MUST contain a tool call — narration
    // rounds are converted into action rounds mechanically.
    prepareStep: opts.forceFirstTool ? ({ steps }) => steps.length === 0 ? { toolChoice: "required" } : {} : void 0,
```

**Site 2 — @1120257** (the execute-guard round):

```js
prepareStep: ({ steps }) => steps.length === 0 ? { toolChoice: "required", activeTools: FORCED_ACTION_TOOLS } : {},
```

…and the comment above it states the intent explicitly:

> *"Mechanical enforcement, not a polite nudge: the first step of this round MUST contain a tool call. Text nudges alone let narration-only models loop for every round; a provider-enforced toolChoice converts 'describing the work' into doing it."*

**This is the deliberate cause.** The guard is not a bug in itself — it is designed to stop narration loops. It simply was never made aware that some providers cannot combine forced tool choice with thinking.

### 3.2 The guard trigger condition (verbatim, @1116788)

```js
while (!loopAbortController.signal.aborted
  && (this.programmingMode.isExecute()
      || (this.programmingMode.getState() === "off"
          && msg.channelType !== "internal"
          && !isTextDeliverableRequest(msg.content)))
  && executeGuardRounds < (narrationSecondWind ? MAX_EXECUTE_CONTINUATIONS * 2 : MAX_EXECUTE_CONTINUATIONS)
  && !responseAsksUser(result.text || "")
  && shouldForceExecuteContinuation({ … })
```

Note the `narrationSecondWind` term: on a second wind the ceiling **doubles to 10** forced rounds, which multiplies the number of guaranteed 400s.

Logged as:

> `"Execute-mode guard: turn ended without any mutating tool call — forcing continuation"`

and the user-visible message:

```js
`Alright \u2014 getting started on the real build now (attempt ${executeGuardRounds} of ${MAX_EXECUTE_CONTINUATIONS})...`
```

with `MAX_EXECUTE_CONTINUATIONS = 5` — **this is the exact source of your "attempt 1 of 5".**

### 3.3 Execution limits (also explain my own earlier crash)

`src/core/execution-limits.ts`, bundled at @949910:

```js
var MAX_PROVIDER_ATTEMPT_MS = 10 * 60 * 1e3;   // 10 minutes
var MAX_AUTOMATIC_CONTINUATIONS = 6;
var MAX_AUTOMATIC_RETRIES = 3;
```

The **10-minute provider-attempt limit** is the same class of limit that terminated my previous run against the same provider. It is a *separate* symptom of the same provider being slow to fail.

### 3.4 The DeepSeek side

`@ai-sdk/deepseek/dist/index.js` (nested inside the Mercury package):

```js
const thinking = this.config.supportsThinking === false
  ? void 0
  : thinkingType != null ? { type: thinkingType === "adaptive" ? "enabled" : thinkingType } : void 0;

// ⬇ THE DECISIVE LINE ⟶ thinking is ON even when NO `thinking` option is sent,
//   as long as the model id is a DeepSeek V4 model:
const isThinkingEnabled =
  this.config.supportsThinking !== false &&
  thinking?.type !== "disabled" &&
  (thinking != null || this.modelId === "deepseek-reasoner" || isDeepSeekV4Model(this.modelId));
```

…where the V4 predicate is (verbatim, same file):

```js
// src/chat/is-deepseek-v4-model.ts
function isDeepSeekV4Model(modelId) {
  return modelId.includes("deepseek-v4")
      || modelId.startsWith("deepseek-flash")
      || modelId.startsWith("deepseek-pro");
}
```

**This closes the loop.** `"deepseek-flash".startsWith("deepseek-flash") === true` ⟹ the model is a V4 model ⟹ `isThinkingEnabled === true` on **every** request, with no `thinking` field required. Meanwhile `prepareTools()` (`@ai-sdk/deepseek/dist/index.js`) passes `toolChoice: "required"` straight through to the request body **with no warning and no compatibility guard** for the thinking combination. The SDK therefore builds a request the server is guaranteed to reject.

And, in the request body:

```js
tool_choice: deepseekToolChoices,
thinking,
…(thinking?.type) !== "disabled" && reasoningEffort != null && { reasoning_effort: reasoningEffort }
```

SDK documentation in the same file:

> *"Type of thinking to use. **Defaults to `enabled`.**"*
> *"Controls the thinking strength for **DeepSeek V4 reasoning models**."*

**Key point:** no `thinking` field is transmitted (it is `void 0`), so the **server default applies — thinking ON**. Mercury only adds an explicit `thinking` override in one narrow case:

```js
// @1057492
const deepseekProviderOptions = provider instanceof DeepSeekProvider && provider.isReasoner
  ? { deepseek: { thinking: { type: "enabled" } } }
  : void 0;
```

and `isReasoner` is defined as:

```js
// @54618
this.isReasoner = config2.model === "deepseek-reasoner";
```

Your configured model is **`deepseek-flash`**, so `isReasoner === false` and this override never fires. The incompatibility therefore comes from the **server-side default of the V4 model family**, not from Mercury's override.

---

## 4. Why the obvious "fixes" don't work

| Idea | Verdict |
|---|---|
| **"Update Mercury"** | ❌ `npm view @cosmicstack/mercury-agent versions` → latest is **1.2.7**, which is what's installed. No newer release exists. |
| **"Switch to a different DeepSeek model"** | ❌ Only `deepseek-flash` and `deepseek-v4-pro` are offered for this provider. **Both are V4 thinking models.** Same crash. |
| **"Retry in chat"** | ❌ `isRetryable: false` — the failure is deterministic, not transient. |
| **"Change reasoning_effort / effort setting"** | ❌ No `reasoning*` setting exists in the Mercury bundle (0 matches) and effort is not what the API rejects. The rejection is about `tool_choice` + thinking, not effort level. |
| **"Point provider elsewhere in `mercury.yaml`"** | ⚠️ Only the `deepseek` provider has a key (`.mercury/.env` contains only `GITHUB_TOKEN`; every other provider entry has `apiKey: ""`). Would need a new API key. |

---

## 5. Recommended fixes

### Fix A — surgical (RECOMMENDED) ✅
Preserves reasoning on normal turns; only disables thinking on the two rounds that *require* a forced tool call.

Add a provider-options override to the two forced rounds in `dist/index.js`:

**Site 2 (execute guard, @1120257)** — immediately after `stopWhen: stepCountIs(effectiveMaxSteps),` inside the `guardStream = streamText4({ … })` call:

```js
...(guardProvider.name === "deepseek" ? { providerOptions: { deepseek: { thinking: { type: "disabled" } } } } : {}),
```

**Site 1 (continuation, @1016067)** — same treatment using the in-scope provider:

```js
...(opts.provider.name === "deepseek" ? { providerOptions: { deepseek: { thinking: { type: "disabled" } } } } : {}),
```

Then also make each `prepareStep` skip the force when thinking cannot be disabled:

```js
prepareStep: opts.forceFirstTool ? ({ steps }) => steps.length === 0 ? { toolChoice: "required" } : {} : void 0,
```
→ swap the inner `{ toolChoice: "required" }` for `(opts.provider.name === "deepseek" ? {} : { toolChoice: "required" })` if the `providerOptions` route proves insufficient.

**Trade-off:** forced rounds lose visible thinking. Normal conversation keeps it.

### Fix B — one line (fastest, blunt) ⚠️
Replace the forced tool choice with nothing on the two sites:

```js
{ toolChoice: "required" }                          →  {}
{ toolChoice: "required", activeTools: FORCED_ACTION_TOOLS }  →  {}
```

**Trade-off:** no crash, but the guard can no longer *enforce* action — the model may narrate for up to 5 rounds, then stop. It converts a hard crash into a soft stall.

### Fix C — switch provider (cleanest, needs a key) 🔑
Point `providers.default` in `C:\Users\nicho\.mercury\mercury.yaml` at a provider that supports forced tool choice with reasoning (Anthropic/OpenAI), and supply a valid `apiKey`. Zero patching, but requires a key you don't currently have configured.

### Fix D — report upstream 📮
This is a genuine product bug: the runtime's own guard is incompatible with its own default model family. Ready-to-paste report in §7.

> **Durability warning:** `C:\Users\nicho\AppData\Local\hermes\node\node_modules\…` is **wiped by any reinstall or update**. Any patch (A or B) must be re-applied afterwards. Fix C and Fix D survive updates.

---

## 6. Verification steps

1. **Confirm the current version:** `npm view @cosmicstack/mercury-agent version` → expect `1.2.7`.
2. **Confirm the two force sites:**
   ```powershell
   $f='C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js'
   $c=Get-Content $f -Raw
   ([regex]::Matches($c,'toolChoice: "required"')).Count   # expect 2
   ```
3. **Confirm thinking is not explicitly disabled:**
   ```powershell
   ([regex]::Matches($c,'thinking: \{ type: "enabled" \}')).Count
   ```
4. **Reproduce the trigger** (post-patch this should *not* 400): send a vague build request that invites a narration-only reply —
   *"i need an automated program made"* — and watch whether the guard round completes.
5. **Check the crash did not persist anywhere:** search `logs\errors.log` and `logs\agent.log` for `Thinking mode does not support` → expect **0 hits** (the error is surfaced to the UI only, which is why it is not in the logs).

---

## 7. Ready-to-paste upstream bug report

> **Title:** DeepSeek V4 (thinking-default) models crash the execute guard: `400 Thinking mode does not support this tool_choice`
>
> **Version:** 1.2.7 (latest published)
> **Provider/model:** `deepseek` / `deepseek-flash` (DeepSeek V4 family)
>
> **Summary:** When a turn ends with narration only, the execute guard (`MAX_EXECUTE_CONTINUATIONS = 5`) starts a forced continuation round with `prepareStep: () => ({ toolChoice: "required", activeTools: FORCED_ACTION_TOOLS })` (`dist/index.js` @1120257, and the `forceFirstTool` path @1016067). DeepSeek V4 models default to thinking mode server-side, and the API rejects any forced `tool_choice` while thinking is enabled:
>
> ```
> statusCode: 400
> {"error":{"message":"Thinking mode does not support this tool_choice","type":"invalid_request_error"}}
> isRetryable: false
> ```
>
> Because `isRetryable` is false, all 5 guard attempts fail deterministically and the user's turn dies with a raw stream dump.
>
> **Contributing factor:** `deepseekProviderOptions` (`dist/index.js` @1057492) only manages thinking for `isReasoner === (model === "deepseek-reasoner")` — it does not cover `deepseek-flash` / `deepseek-v4-pro`, and the guard rounds do not pass `providerOptions` at all.
>
> **Suggested fix:** when a forced `toolChoice` is required, either (a) pass `providerOptions: { deepseek: { thinking: { type: "disabled" } } }` for DeepSeek providers, or (b) treat `toolChoice` as unsupported for thinking-default models and fall back to a text nudge. Also consider gating the force on a provider capability flag instead of `isReasoner`.
>
> **Impact:** any DeepSeek V4 user hitting the execute guard gets a hard crash. Both models offered for the provider are affected.

---

## 8. Evidence index (files inspected)

| Path | Why |
|---|---|
| `C:\Users\nicho\.mercury\mercury.yaml` | Provider config — `default: deepseek`, `model: deepseek-flash` |
| `C:\Users\nicho\.mercury\sessions\4c9c81d4-…json` | Session transcript showing the narration-only reply + `reasoning` payloads |
| `C:\Users\nicho\.mercury\permissions.yaml` | Filesystem scopes |
| `C:\Users\nicho\AppData\Local\hermes\config.yaml` | `agent.reasoning_effort: medium`, `show_reasoning: true` |
| `…\mercury-agent\dist\index.js` | Guard rounds, forced `toolChoice`, execution limits |
| `…\mercury-agent\node_modules\@ai-sdk\deepseek\dist\index.js` | Request body: `tool_choice`, `thinking` |
| `…\hermes\logs\agent.log` | `model=deepseek-flash provider=deepseek` |
| `…\hermes\logs\errors.log` | Negative result — crash not logged |
| `C:\Users\nicho\AppData\Local\hermes\provider_models_cache.json` | DeepSeek models: `deepseek-v4-pro`, `deepseek-flash` |

---

## 9. Validation log — independent re-check (2026-09-18)

Every load-bearing claim above was re-derived from scratch against the live install. Results:

| # | Claim under test | Method | Result |
|---|---|---|---|
| 1 | The forced call is the exact trigger | Regex count of `toolChoice: "required"` in `dist/index.js` | **2** hits — Site 1 (continuation, @~1015903) + Site 2 (guard, @~1120074). A third bare `toolChoice` match is only the word inside a code comment — no third force site. ✅ |
| 2 | `MAX_EXECUTE_CONTINUATIONS = 5` → *"attempt 1 of 5"* | Located the user-visible template string + the constant | `"...(attempt ${executeGuardRounds} of ${MAX_EXECUTE_CONTINUATIONS})..."` with `MAX_EXECUTE_CONTINUATIONS = 5` ✅ |
| 3 | `deepseek-flash` really is a thinking-default model | Read `@ai-sdk/deepseek/dist/index.js` | `isThinkingEnabled` is `true` because `isDeepSeekV4Model("deepseek-flash") === true` ✅ |
| 4 | Mercury's own override never fires | `this.isReasoner = config.model === "deepseek-reasoner"`; configured model is `deepseek-flash` | `isReasoner === false` → the explicit `thinking: {type:"enabled"}` override is never applied ✅ |
| 5 | The SDK ships the bad combination without guarding it | `prepareTools()` + request-body assembly | `prepareTools()` returns `{toolChoice: "required"}` unchanged; body sends `tool_choice` **and** `thinking` together, no warning ✅ |
| 6 | Live provider was DeepSeek / `deepseek-flash` | `logs/agent.log` | ~90 `API call … model=deepseek-flash provider=deepseek` lines ✅ |
| 7 | The 400 is *not* a network/transient fault | `isRetryable: false` in the error + `MAX_PROVIDER_ATTEMPT_MS = 10*60*1000` | Deterministic 400; the 10-min cap is why the run died rather than looping ✅ |
| 8 | No newer Mercury release exists | `npm view @cosmicstack/mercury-agent version` | `1.2.7` = installed = latest ✅ |
| 9 | Only DeepSeek has a key (blocks the "switch provider" shortcut) | `C:\Users\nicho\.mercury\mercury.yaml` | `providers.default: deepseek`; every other provider entry has `apiKey: ""` ✅ |
| 10 | Both offered DeepSeek models are V4 | `provider_models_cache.json` | `["deepseek-v4-pro", "deepseek-flash"]` — both match `isDeepSeekV4Model` ✅ |
| 11 | The crash is UI-only, not written to disk logs | Searched `errors.log` + whole `.hermes` tree for the error string | 0 hits (negative result confirmed) ✅ |

**Offset note:** character offsets quoted here were measured on the installed bundle at slightly different anchor points than a first pass (±≈200 chars); the **authoritative evidence is the code snippets themselves**, which match byte-for-byte.

**External corroboration:** DeepSeek's own API documentation confirms `deepseek-flash` as a current model name and treats `thinking: {"type": "enabled"}` and `reasoning_effort` as first-class request parameters — i.e. thinking mode is a server-side feature of this model family, exactly as the SDK logic implies.

### Files inspected during re-check
- `C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js`
- `C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\node_modules\@ai-sdk\deepseek\dist\index.js`
- `C:\Users\nicho\AppData\Local\hermes\config.yaml`
- `C:\Users\nicho\AppData\Local\hermes\provider_models_cache.json`
- `C:\Users\nicho\AppData\Local\hermes\logs\agent.log`, `logs\errors.log`
- `C:\Users\nicho\.mercury\mercury.yaml`
- `C:\Users\nicho\OneDrive\Desktop\Coding\mercury-deepseek-toolchoice-diagnostic.md`

### Sources (external)
- [DeepSeek API Docs — Your First API Call](https://api-docs.deepseek.com/guides/reasoning_model) — confirms `deepseek-flash` / `deepseek-v4-pro` model names and the `thinking` + `reasoning_effort` request parameters.
- [DeepSeek API Docs — Function Calling](https://api-docs.deepseek.com/guides/function_calling) — tool/tool_choice semantics.

---

*End of report. Fix A (or D) is recommended; any local patch must be re-applied after every Mercury reinstall/update.*

---

# APPLIED — 2026-09-18 22:15

Status: **Fix A applied and independently verified.** Fixed combination proven at the
protocol level against the live DeepSeek API.

## Change 1 of 2 — forced-tool sites (`dist\index.js`)

Both `prepareStep` forced-tool sites now disable thinking **for the forced step only**:

| Line | Function | Added |
|---|---|---|
| 26370 | `runInlineContinuationRound` | `providerOptions: { deepseek: { thinking: { type: "disabled" } } }` |
| 28175 | execute guard round | `providerOptions: { deepseek: { thinking: { type: "disabled" } } }` |

Diff vs backup: exactly **2 lines changed**; **43,798 lines before and after**;
`node --check` exit 0.

Verified forwarding path (this link could have made the fix a silent no-op):

```
8015: const stepProviderOptions = mergeObjects(providerOptions, prepareStepResult?.providerOptions);
8102: providerOptions: stepProviderOptions,   // -> the real doStream call
```

## Change 2 of 2 — provider-error journal (`@ai-sdk\provider-utils\dist\index.mjs`)

A diagnostic hook was added inside `postToApi` (the exact frame in the original stack
trace). Any non-2xx provider response is now appended to:

```
C:\Users\nicho\.mercury\provider-errors.jsonl
```

Why this was necessary: **the original 400 left no trace on disk.** `daemon.log` is
0 bytes, `hermes\logs\*.log` predate the incident by hours, and the session store
records only the assistant's prose — a grep for `Thinking mode`/`tool_choice`/
`invalid_request_error` across every log found nothing. Without this hook, a
recurrence would be undetectable except by watching the TUI.

## Verification — live protocol probe

Sent the identical request shape to `https://api.deepseek.com/v1/chat/completions`
(model `deepseek-flash`, `tool_choice: "required"`):

| Test | Thinking | Result |
|---|---|---|
| A | default (on) | **HTTP 400** — `{"error":{"message":"Thinking mode does not support this tool_choice","type":"invalid_request_error"}}` |
| B | `{"type":"disabled"}` | **HTTP 200** — returned a valid `tool_calls` payload |

Test A reproduces the original failure **verbatim**; test B confirms the patch's
mechanism resolves it and that the forced call still succeeds.

## Backups

| File | Backup |
|---|---|
| `dist\index.js` | `index.js.bak-20260918-2208` |
| `provider-utils\dist\index.mjs` | `index.mjs.bak-20260918-monitor` |

## Rollback

```powershell
Copy-Item 'C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js.bak-20260918-2208' 'C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js' -Force
Copy-Item 'C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\node_modules\@ai-sdk\provider-utils\dist\index.mjs.bak-20260918-monitor' 'C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\node_modules\@ai-sdk\provider-utils\dist\index.mjs' -Force
```

A restart is required after any apply or rollback — the bundle is loaded at startup.

## Monitoring

| Artifact | Purpose |
|---|---|
| `Coding\mercury-guard-monitor.ps1` | 6-check verifier: patch integrity, journal hook, restart status, recurrence scan, live protocol probe, secrets-at-rest. Prints a `STATUS:` verdict. |
| `Coding\mercury-secrets-migrate.cjs` | Moves env-backed secrets out of `mercury.yaml` into `.env`. Idempotent, surgical, never prints secret values. |
| `.mercury\schedules.yaml` (`task-mu7o2c3p`) | Cron `*/15 * * * *`; runs the monitor and alerts on Telegram only for `RECURRENCE-DETECTED`, `PATCH-WIPED`, or the first `HEALTHY` after restart. |
| `.mercury\guard-monitor-history.log` | One line per run — append-only evidence trail. |
| `.mercury\provider-errors.jsonl` | Journal of every failing provider response since the hook was installed. |

An **empty journal after a restart is the positive proof of no recurrence**, since the
original 400 was never written to disk before the hook existed.

## Known secondary issue

At `dist\index.js:28131` the duplicate-warning guard tests
`lastGuardMsg.content.startsWith("Getting started on the real build now")`, but the
message actually sent begins `"Alright — getting started on the real build now"`. The
prefix never matches, so `isDuplicateWarning` is always `false` and the
"attempt N of 5" notice can be emitted repeatedly. Cosmetic; unrelated to the 400.

## Standing caveat

Every patch above lives in `node_modules` and is **wiped by any Mercury reinstall or
update**. Re-apply from this section afterwards, or wait for upstream Fix D.
`mercury.yaml` also stores the DeepSeek API key and Telegram bot token in **plaintext**.
**UPDATE (2026-09-18):** both were fixed — see "Applied fixes (session 2)" below.
`mercury.yaml` now contains **zero** credentials.

---

## Applied fixes (session 2, 2026-09-18)

Three further local patches on top of Fix A, all verified. Line numbers are post-patch
(the Bug 2 redactor added 47 lines, shifting the Fix A sites from 26370/28175 to
**26417/28222**).

### Bug 1 — `isDuplicateWarning` never fired  *(FIXED)*

The guard compared the last TUI message against a prefix that never occurred. This
supersedes the "Known secondary issue" section above.

| | |
|---|---|
| Tested for | `startsWith("Getting started on the real build now")` |
| Actually sent | `"Alright — getting started on the real build now (attempt N of 5)..."` |
| Effect | always `false`, so the "attempt N of 5" notice could repeat every round |

Patched at `dist\index.js:28180` to match the stable phrase anywhere in the string:

```js
const isDuplicateWarning = lastGuardMsg?.role === "agent" && typeof lastGuardMsg.content === "string" && /getting started on the real build now/i.test(lastGuardMsg.content);
```

A `typeof` guard was added so a non-string `content` cannot throw.

### Bug 2 — credentials in plaintext  *(FIXED)*

**Scope correction.** My earlier pass claimed this affected "every provider key". That
was **wrong**, and the mistake was mine: I printed the config through a mask that
redacted any `apiKey:`/`token:` line, which made *empty* placeholders look populated.
The real exposure was exactly **two** fields:

| Field | Length |
|---|---|
| `providers.deepseek.apiKey` | 35 chars |
| `channels.telegram.botToken` | 46 chars |

All 16 other credential fields were already `""`.

**Root cause.** `loadConfig()` returns `deepMerge(getDefaultConfig(), fileConfig)` —
file config wins — and `saveConfigUnlocked()` then serializes that **merged** object
back to disk. Any secret that `getDefaultConfig()` read from the environment therefore
got copied into `mercury.yaml` in cleartext on the next config save.

**Two-part fix** (both parts are required; either alone leaves a hole):

1. **Migrate.** The two values moved into `~/.mercury/.env`, which `dotenv` loads at
   startup, and the corresponding lines were **deleted** from `mercury.yaml`.
   Deleting rather than blanking matters: a literal `apiKey: ""` in the yaml *shadows*
   the env default, because `deepMerge` copies any value that is not `undefined`/`null`.
   Tool: `mercury-secrets-migrate.cjs`.

2. **Redaction on save.** New `redactEnvBackedSecrets()` (`dist\index.js:545`), called
   from `saveConfigUnlocked()` (`dist\index.js:593`). It deep-clones the config and
   deletes any credential whose value is byte-identical to its env var, across 19
   mapped paths. Without this the next config save would re-persist the secret.

**Verified end to end:**

- yaml re-parse: both fields report `ABSENT`
- `.env` supplies 35- and 46-char values
- a faithful copy of `deepMerge` resolves the full values after merging yaml over
  env-backed defaults
- the live DeepSeek probe authenticated using the **`.env`-sourced** key and returned
  HTTP 400 (failing combo) / 200 (patched combo) as expected
- `node --check` on the patched bundle: exit 0

**Known limitation.** Redaction is deliberately conservative — it only removes values
that match their env var. A key newly entered through the web UI (which matches no env
var) would still be written in plaintext. Treat `.env` as the source of truth, or
extend the redactor to write new values back to `.env`.

### Watchdog upgraded

`mercury-guard-monitor.ps1` was rebuilt (parse-clean) with six checks:

- **Check 5** now resolves credentials **env → `.env` → `mercury.yaml`**. This was a
  forced change: the original probe read the key only from the yaml, so it would have
  broken the moment the key moved.
- **Check 6 (new)** — secrets at rest: fails if any non-empty credential field appears
  in `mercury.yaml`, or if `.env` is missing a required secret.
- New verdict state `SECRETS-IN-PLAINTEXT` (red), ranked above `READY-RESTART-PENDING`.

Why Check 6 matters: **until the runtime restarts, the pre-patch process still holds the
plaintext key in memory**, and its `saveConfigUnlocked` has no redaction — so it can
re-add the secret to the yaml. Check 6 detects exactly that window.

### Files touched

| File | State |
|---|---|
| `dist\index.js` | 4 patches: Fix A ×2, Bug 1, Bug 2 redactor |
| `~/.mercury\mercury.yaml` | 181 → 179 lines; zero credentials |
| `~/.mercury\.env` | +2 secrets |
| `Coding\mercury-guard-monitor.ps1` | rebuilt, 6 checks |
| `Coding\mercury-secrets-migrate.cjs` | new migration tool |

Backups: `index.js.bak-20260918-2208`, `index.js.bak2-20260918-222108`,
`mercury.yaml.bak-20260918-222108`, `.env.bak-20260918-222108`.

Watchdog verdict at time of writing:

```
patch          : PATCHED      (2/2 sites, lines 26417 + 28222)
journal hook   : PRESENT
restart        : PENDING
recurrence     : NONE
probe (fail)   : 400
probe (fixed)  : 200
secrets        : CLEAN
STATUS: READY-RESTART-PENDING
```

---

## 20. Bug 3 — the Windows autostart task points at a path that does not exist

Discovered while planning the restart: the logon task registered by
`mercury service install` could never have worked.

`schtasks /query /tn MercuryAgent` reported `LastTaskResult: 1`, and the
registered action was:

```
Command   : C:\Users\nicho\AppData\Local\hermes\node\node.exe
Arguments : C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\lib\node_modules\@cosmicstack\mercury-agent\dist\index.js start --daemon
                                                                                  ^^^^
```

That `lib\node_modules\` segment does not exist on disk. It comes from
`getDistPath()` in the bundle:

```js
function getDistPath() {
  if (!process.argv[1]) {
    return join25(homedir8(), ".nvm", "versions", "node",
      `v${process.version.slice(1)}`, "lib", "node_modules",
      "@cosmicstack", "mercury-agent", "dist", "index.js");
  }
  return join25(process.argv[1], "..", "..", "lib", "node_modules",
    "@cosmicstack", "mercury-agent", "dist", "index.js");
}
```

**This is a Linux-ism.** It assumes an npm global prefix laid out as
`<prefix>/lib/node_modules/<pkg>` — true on Linux and macOS, but on
Windows the npm global prefix is `<prefix>/node_modules/<pkg>` with no
`lib` segment. `join(argv[1], "..", "..", "lib", ...)` therefore resolves
to a directory tree that is never created.

Impact:

| Item | Value |
|---|---|
| `MercuryAgent` task | present, trigger `onlogon`, state `Ready` |
| `LastTaskResult` | `1` (failure) |
| Autostart after reboot | **broken** — the daemon would never launch |
| Blast radius | `installWindows()` / `getServiceLaunchArgs()` only |

Crucially the **daemon spawner is not affected**:
`buildDaemonSpawnArgs()` returns `{ command: process.execPath, args: [process.argv[1], "start", "--daemon"] }`
— it uses `argv[1]` directly, which is correct on every platform. That is
why `mercury start` works while the service task fails.

### 20.1 Repair applied

The task action was re-registered against the real entry script:

```
Command   : C:\Users\nicho\AppData\Local\hermes\node\node.exe
Arguments : C:\Users\nicho\AppData\Local\hermes\node\node_modules\@cosmicstack\mercury-agent\dist\index.js start --daemon
```

Verified: `entry exists = True`.

Original task definition backed up to
`Coding\mercury-agent-task-backup-20260918.xml` (1,364 bytes) so the
broken definition can be restored if ever needed.

Upstream fix: in `getDistPath()`, drop the `lib` segment on Windows (or
branch on `process.platform`), e.g.
`return join25(process.argv[1], "..", "..", ...(process.platform === "win32" ? [] : ["lib"]), "node_modules", "@cosmicstack", "mercury-agent", "dist", "index.js");`

---

## 21. Restart mechanics — what the runtime actually looks like

Anomaly investigated before restarting: **two** Mercury processes were
running with different roles.

| PID | Mode | Started | Command line | Sockets |
|---|---|---|---|---|
| 2112 | `--daemon` | 21:29:50 | `node.exe ...mercury-agent\dist\index.js start --daemon` | LISTEN `127.0.0.1:6174` |
| 20764 | `--foreground` | 21:36:08 | `node.exe ...dist\index.js start --foreground` | ESTABLISHED `149.154.166.110:443` |

`149.154.x.x` is Telegram. So the **foreground instance owned the Telegram
connection**, while the daemon held only the local IPC port. Any restart
must therefore stop the foreground *first* — otherwise two pollers race
and Telegram answers `409 Conflict` for `getUpdates`.

PID tracking (both files under `~/.mercury`):

```
daemon.pid     = 2112
foreground.pid = 20764
```

Relevant CLI surface and what it really does:

| Command | Implementation |
|---|---|
| `mercury start` | `startBackground()` -> `ensureDaemonRunning()` -> detached `spawn` of `argv[1] start --daemon` |
| `mercury stop`  | stops foreground (via `foreground.pid`) **then** daemon (via `daemon.pid`) |
| `mercury restart` | `restartDaemon()` |
| `mercury start --daemon` | `runWithWatchdog(() => runAgent(true))` — runs the agent in-process |

Secrets plumbing re-verified for the post-restart process:

```
MERCURY_HOME   = join(homedir(), ".mercury")          -> C:\Users\nicho\.mercury
line 1200      loadDotenv()                            (cwd .env)
line 1201      mercuryEnvPath = join(MERCURY_HOME, ".env")
line 1203      loadDotenv({ path: mercuryEnvPath })    -> ~/.mercury/.env IS loaded
```

`~/.mercury/.env` holds `GITHUB_TOKEN`, `DEEPSEEK_API_KEY`,
`TELEGRAM_BOT_TOKEN` — so the post-restart process resolves the migrated
credentials with no yaml involvement. `channels.telegram.enabled: true`
is set at config level, so the daemon will claim the Telegram channel once
the foreground poller is gone.

### 21.1 Why the restart is launched by Task Scheduler

The agent's own tool shell is a descendant of the foreground process:

```
node 20764 (--foreground)
  cmd.exe 3684
    powershell.exe 22684   <- tool shell
```

Stopping the foreground therefore kills the shell mid-script. Any restart
run *from inside the agent* would execute the stop and then die before the
start. `mercury-restart.ps1` is instead launched through Windows Task
Scheduler, which runs as a service independent of the Mercury process
tree, so it survives the kill it performs.

### 21.2 Restart procedure (encoded in `Coding\mercury-restart.ps1`)

1. **Patch sanity gate** — refuse to restart unless the bundle still shows
   2x `type: "disabled"` and 2x `redactEnvBackedSecrets`. Prevents
   restarting into an unpatched (or update-reverted) bundle.
2. **Grace delay** (default 60 s) so the "restarting now" message is
   flushed to Telegram before the poller dies.
3. **Stop foreground**, then **stop daemon** — graceful first, forced after
   5 s, using the tracked pid files.
4. **Sweep strays** — any remaining `node.exe` whose command line contains
   `mercury-agent`.
5. **Clear stale pid files** so the fresh daemon can register cleanly.
6. **Start** via `mercury.cmd start`; if no daemon pid + IPC port within
   45 s, fall back to a direct detached spawn of
   `node.exe <entry> start --daemon` with output to `daemon.log`.
7. **Verify** daemon pid alive + `127.0.0.1:6174` listening + a Telegram
   socket to `149.154.*:443`.
8. **Verdict** written to `~/.mercury/restart-<stamp>.log`:
   `HEALTHY` / `DAEMON-UP-TELEGRAM-PENDING` / `FAILED`.
9. **Self-cleanup** — deletes the one-shot `MercuryRestartOnce` task so it
   can never re-fire.

Written by PiePeP, 2026-09-18.
