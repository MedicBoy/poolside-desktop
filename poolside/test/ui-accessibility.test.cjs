// Static contracts for the sandboxed renderer. Browser-level keyboard traversal is supplied by native
// controls and <dialog>; these checks stop later markup edits from removing the labels and restoration
// hooks that make those native behaviors usable.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = name => fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', name), 'utf8');

test('every modal dialog is named and the renderer restores focus to its opener', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const dialogs = [...html.matchAll(/<dialog\s+[^>]*aria-labelledby="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(
    dialogs.sort(),
    ['account-dialog-title', 'account-preferences-title', 'capture-preview-title', 'edit-account-dialog-title'].sort()
  );
  for (const label of dialogs) assert.match(html, new RegExp(`id="${label}"`));
  assert.match(renderer, /const dialogOpeners = new WeakMap\(\)/);
  assert.match(renderer, /dialog\.addEventListener\('close'/);
  assert.match(renderer, /opener\.focus\(\)/);
});

test('navigation announces its selected view and all regular controls have visible keyboard focus', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  assert.match(html, /data-view="sessions" aria-current="page"/);
  assert.match(renderer, /el\.toggleAttribute\('aria-current', active\)/);
  for (const selector of ['button:focus-visible', 'a:focus-visible', 'input:focus-visible', 'select:focus-visible']) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('setting help uses one keyboard-accessible tooltip clamped to the visible window', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  assert.match(html, /id="info-tooltip" class="info-tooltip" role="tooltip" popover="manual"/);
  assert.match(renderer, /function positionInfoTooltip\(owner\)/);
  assert.match(renderer, /Math\.min\(Math\.max\(anchor\.left/);
  assert.match(renderer, /above >= edge \? above : anchor\.bottom \+ gap/);
  assert.match(renderer, /addEventListener\('focusin'/);
  assert.match(renderer, /setAttribute\('aria-describedby', 'info-tooltip'\)/);
  assert.match(renderer, /tooltip\.showPopover\(\)/);
  assert.match(css, /\.info-tooltip\s*\{[^}]*position: fixed/s);
  assert.doesNotMatch(css, /\.info-dot::after/);
});

test('capture corpus filters have labels and preserve a filterable, local-only sample list', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  assert.match(html, /aria-label="Filter local samples"/);
  for (const id of ['capture-filter-state', 'capture-filter-cohort', 'capture-filter-result']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(renderer, new RegExp(`'${id}'`));
  }
  assert.match(renderer, /function filteredCaptureSamples\(\)/);
  assert.match(renderer, /No samples match the current filters/);
});

test('the table label is available only for table-selection captures and starts without a default', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  assert.match(html, /id="capture-table-field" hidden/);
  assert.match(html, /id="capture-table" disabled/);
  assert.match(renderer, /function syncCaptureTableField\(\)/);
  assert.match(renderer, /tableSelect\.disabled = !needsTable/);
  assert.match(renderer, /<option value="">Choose a table…<\/option>/);
  assert.match(renderer, /expectedTable: \$\('#capture-state'\)\.value === 'table-selection'/);
  assert.match(css, /\[hidden\][^{]*\{[^}]*display: none !important/s);
});

test('the dashboard shows the running app version and only highlights a non-empty review queue', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  assert.doesNotMatch(html, /Poolside v\d+\.\d+\.\d+/);
  assert.equal((html.match(/class="app-version"/g) || []).length, 2);
  assert.match(renderer, /element\.textContent = state\.version \? `Poolside v\$\{state\.version\}` : 'Poolside'/);
  assert.match(renderer, /reviewNeeded > 0 \? 'review' : null/);
});

test('capture metrics count evidence samples while reporting label coverage separately', () => {
  const renderer = ui('renderer.js');
  assert.match(renderer, /'Evidence samples'/);
  assert.match(renderer, /evaluation\.evidenceSamples \|\| 0/);
  assert.match(renderer, /screen labels covered/);
  assert.match(renderer, /detector matches/);
});

test('capture lab resets the document scroll position whenever the view opens', () => {
  const renderer = ui('renderer.js');
  assert.match(renderer, /if \(name === 'capture-lab'\) \{\s*window\.scrollTo\(0, 0\);/s);
  assert.match(renderer, /requestAnimationFrame\(\(\) => window\.scrollTo\(0, 0\)\)/);
});

test('workspace status is driven by current browser and observed game state', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  assert.match(html, /id="workspace-state-label"/);
  assert.match(html, /id="workspace-state-detail"/);
  assert.match(renderer, /function renderWorkspaceState\(\)/);
  assert.match(renderer, /gameScreenLabel\(observed\.gameScreen\)/);
  assert.match(renderer, /Live status starts automatically/);
});

test('receiving role stays selectable and explains that reassignment requires confirmation', () => {
  const renderer = ui('renderer.js');
  assert.match(renderer, /option\[value="receiver"\]'\)\.disabled = false/);
  assert.match(renderer, /Poolside will ask before changing that account to Sending/);
  assert.match(renderer, /\$\('#account-role'\)\.addEventListener\('change'/);
  assert.match(renderer, /\$\('#edit-account-role'\)\.addEventListener\('change'/);
});

test('table captures expose saved and detected table names and the report tracks every table separately', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  assert.match(html, /id="capture-table-coverage"/);
  assert.match(renderer, /function captureTableCoverage\(evaluation\)/);
  assert.match(renderer, /<dt>Expected table<\/dt>/);
  assert.match(renderer, /<dt>Detected table<\/dt>/);
  assert.match(renderer, /No supported table name detected/);
  assert.match(html, /Your Evidence captures and held-out Benchmark captures are separate/);
  assert.match(renderer, /Benchmark: no held-out images yet/);
  assert.match(renderer, /Centered table matched against reviewed local Evidence/);
});

test('table navigation is visibly identified as a no-click dry run with a labelled per-session target', () => {
  const renderer = ui('renderer.js');
  assert.match(renderer, /Table navigation · dry run/);
  assert.match(renderer, /class="outline-badge">No clicks/);
  assert.match(renderer, /aria-label="Target table for/);
  for (const action of ['navigation-start', 'navigation-observe', 'navigation-advance', 'navigation-cancel', 'navigation-retry']) {
    assert.match(renderer, new RegExp(action));
  }
});

test('account disclosures preserve both session-details and recent-screen-changes state across dashboard renders', () => {
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  assert.match(renderer, /class=\"account-disclosure account-overview\"/);
  assert.match(renderer, /class=\"account-disclosure screen-history\"/);
  assert.match(renderer, /function openAccountDisclosureIds\(\)/);
  assert.match(renderer, /function restoreAccountDisclosureIds\(ids\)/);
  assert.match(renderer, /restoreAccountDisclosureIds\(openDetails\)/);
  assert.match(css, /\.account-disclosure summary/);
});

test('no form is nested inside another form, because the parser drops the inner one', () => {
  // The settings page once wrapped the saved-route-preset form inside the workspace-settings form. HTML does
  // not allow that, so the browser discarded the inner form element, the renderer's `#route-preset-form`
  // lookup returned null, and the first `addEventListener` on it threw — which aborted every later line of
  // the dashboard bootstrap. The visible result was an empty workspace and a form that never filled in.
  const html = ui('index.html');
  let depth = 0;
  let deepest = 0;
  for (const token of html.matchAll(/<\/?form\b[^>]*>/g)) {
    depth += token[0].startsWith('</') ? -1 : 1;
    assert.ok(depth >= 0, 'a </form> closes a form that was never opened');
    if (depth > deepest) deepest = depth;
  }
  assert.equal(depth, 0, 'every opened form is closed');
  assert.equal(deepest, 1, 'a form nested inside another form is dropped by the HTML parser, so its controls stop existing');
});

test('match coordination is a navigable, labelled local record of who played whom', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  assert.match(html, /data-view="matches"/);
  assert.match(html, /<section class="view hidden" id="view-matches">/);
  assert.match(html, /id="match-first" aria-label="First account in the match"/);
  assert.match(html, /id="match-second" aria-label="Second account in the match"/);
  assert.match(html, /id="match-hint" class="muted" role="status"/);
  assert.match(html, /Local records only/);
  assert.match(renderer, /function renderMatches\(\)/);
  assert.match(renderer, /renderMatches\(\);/);
  assert.match(renderer, /data-action="match-complete"/);
  assert.match(renderer, /data-action="match-cancel"/);
  assert.match(renderer, /data-action="match-load"/);
  assert.match(html, /id="route-preset-test"/);
  assert.match(html, /id="route-preset-test-result" role="status"/);
  assert.match(renderer, /poolside\.testRoute\(/);
  assert.match(renderer, /Load both profiles/);
  assert.match(renderer, /function matchReadiness\(match\)/);
  assert.match(renderer, /Release blocked — /);
  assert.match(renderer, /waiting for \$|Waiting for /);
  assert.match(renderer, /match-readiness/);
  assert.match(renderer, /poolside\.loadMatchSessions\(/);
  assert.match(renderer, /poolside\.startMatch\(/);
  assert.match(renderer, /poolside\.completeMatch\(/);
  assert.match(renderer, /'sessions', 'matches', 'activity'/);
});

test('each saved location offers a labelled tick box per account and reports the assignment', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  assert.match(html, /tick the accounts that should use it/);
  assert.match(renderer, /function routePresetAccounts\(preset\)/);
  assert.match(renderer, /data-route-preset-assign="\$\{escapeHtml\(preset\.id\)\}"/);
  assert.match(renderer, /data-route-account="\$\{escapeHtml\(account\.id\)\}"/);
  // The accessible name has to say what the box does; a bare account name next to a location is not
  // enough to know whether the box means "connect from here" or "make this the account I edit".
  assert.match(renderer, /aria-label="\$\{escapeHtml\(`Connect \$\{account\.name\} from \$\{preset\.name\}`\)\}"/);
  // The box is drawn from the stored assignment, not from anything the renderer remembers.
  assert.match(renderer, /const checked = account\.routePresetId === preset\.id;/);
  assert.match(renderer, /\$\{checked \? ' checked' : ''\}/);
  assert.match(renderer, /poolside\.assignRoutePreset\(/);
  assert.match(renderer, /presetId: box\.checked \? box\.dataset\.routePresetAssign : ''/);
  assert.match(css, /\.route-preset-accounts\s*\{/);
});

test('the run plan is a labelled form over the account selects, and a run can be stopped from its card', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  const runPlan = require('../src/run-plan.cjs');
  assert.match(html, /id="run-form"/);
  for (const id of ['run-table', 'run-limit', 'run-failures', 'run-minutes', 'run-start', 'run-hint', 'run-active', 'run-recent']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-label="Table the run is for"/);
  assert.match(html, /aria-label="Matches with a result before the run stops"/);
  assert.match(html, /aria-label="Minutes before the run stops"/);
  // The form's defaults are the plan's defaults, so the two cannot drift apart in wording or in numbers.
  for (const [id, value] of [
    ['run-limit', runPlan.DEFAULTS.matchLimit],
    ['run-failures', runPlan.DEFAULTS.stopAfterFailures],
    ['run-minutes', runPlan.DEFAULTS.stopAfterMinutes]
  ]) {
    assert.match(html, new RegExp(`id="${id}"[\\s\\S]*?value="${value}"`));
  }
  // The one thing a plan cannot enforce is said out loud rather than offered as a field.
  assert.match(html, /Balance-based stops are not offered/);
  assert.match(renderer, /function paintRunTable\(\)/);
  assert.match(renderer, /function runCard\(run, actionable\)/);
  assert.match(renderer, /run\.bounds\.map\(/);
  assert.match(renderer, /poolside\.startRun\(\{/);
  assert.match(renderer, /plan: \{/);
  assert.match(renderer, /data-action="run-stop"/);
  // Stop, pause and resume all address the same run by its id, chosen by the action on the button.
  assert.match(renderer, /poolside\.stopRun\(\{ runId \}\)/);
  assert.match(css, /\.run-panel\s*\{/);
  assert.match(css, /\.run-bounds\s*\{/);
});

test('the match card reports what the pairing evidence amounted to and can be asked again', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  // The rule the roadmap states in words: a connecting screen does not say which match it is connecting to,
  // so the view says that rather than implying two loaded profiles are a pairing.
  assert.match(html, /two of them are never counted as proof/);
  assert.match(renderer, /function matchPairing\(match, actionable\)/);
  assert.match(renderer, /Pairing evidence: \$\{escapeHtml\(detail\)\}/);
  assert.match(renderer, /match\.readiness\?\.verdict !== 'ready'/);
  assert.match(renderer, /data-action="match-pairing"/);
  assert.match(renderer, /poolside\.checkMatchPairing\(\{ matchId: button\.dataset\.match \}\)/);
  // Every verdict gets a colour, and the weakest one is not coloured like a result.
  for (const verdict of ['paired', 'agreed', 'incomplete', 'mismatch']) {
    assert.match(css, new RegExp(`\\.match-pairing\\.${verdict}`));
  }
});

test('a run can be paused and resumed from its card, and a match with nothing open says so', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  // Pause and stop are different promises, and the panel says which is which.
  assert.match(html, /<em>Pause<\/em> holds the run where it is/);
  assert.match(html, /both sessions stay open and independent/);
  assert.match(renderer, /data-action="run-pause"/);
  assert.match(renderer, /data-action="run-resume"/);
  assert.match(renderer, /poolside\.pauseRun\(\{ runId \}\)/);
  assert.match(renderer, /poolside\.resumeRun\(\{ runId \}\)/);
  assert.match(renderer, /min paused, not counted/);
  // The state the operator reported as a contradiction: a match in progress with nothing open behind it.
  assert.match(renderer, /const stuck = matches\.active\.find\(/);
  assert.match(renderer, /has nothing open behind it — cancel it below to free/);
  assert.match(renderer, /No session is open for this match, so it is not really in progress\./);
  assert.match(css, /\.match-empty\s*\{/);
});

test('the run card reports the stage, the release, the reading ages and the next action', () => {
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  // The things the roadmap asks a run dashboard to show, each on its own labelled line.
  assert.match(renderer, /function runStatus\(status\)/);
  // Each fact gets its own name in front of it; "Next stop" is chosen at render time, so it is checked as a
  // label rather than as the first element of a literal.
  for (const label of ['Stage', 'Attempt', 'Release', 'Screens', 'Next']) {
    assert.ok(renderer.includes("['" + label + "', "), label + ' should be a labelled line on the run card');
  }
  assert.ok(renderer.includes("'Next stop'"), 'the line that says what will stop the run next should be labelled');
  assert.ok(renderer.includes("'Stopped'"), 'and so should the line that says what did stop it');
  assert.match(renderer, /status\.pairing\.line/);
  assert.match(renderer, /status\.nextStop/);
  assert.match(renderer, /\$\{runStatus\(run\.status\)\}/);
  // The line that needs the operator is coloured differently from the one that does not.
  assert.match(css, /\.run-status\.act dd:last-of-type\s*\{/);
  assert.match(css, /\.run-status\.watch dd:last-of-type\s*\{/);
});

test('the match card offers the count-in and says what it measured', () => {
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  // The count-in is a moment to aim at plus a measurement, never a click: the card says so, and the
  // measured line is drawn like the other evidence on the card.
  assert.match(renderer, /function matchRelease\(match, actionable\)/);
  assert.match(renderer, /Count me in — 5 s/);
  assert.match(renderer, /Stop the count-in/);
  assert.match(renderer, /one moment to aim at, then measures the gap your two clicks produced/);
  assert.match(renderer, /poolside\.armRelease\(\{ matchId: button\.dataset\.match \}\)/);
  assert.match(renderer, /poolside\.cancelRelease\(\{ matchId: button\.dataset\.match \}\)/);
  assert.match(renderer, /\$\{matchRelease\(match, actionable\)\}/);
  for (const phase of ['counting', 'go', 'done', 'cancelled']) {
    assert.match(css, new RegExp('\\.match-release\\.' + phase));
  }
});

test('a paused run still offers Resume and Stop, because paused is not finished', () => {
  const renderer = ui('renderer.js');
  // The defect: the controls were gated on the run being `active`, so a paused run rendered with no buttons
  // at all — no way back and no way out. The operator reported it as "there was no resume match button".
  assert.match(renderer, /const running = run\.state !== 'ended';/);
  assert.match(renderer, /actionable && running/);
  assert.match(renderer, /data-action="run-resume"/);
  assert.match(renderer, /data-action="run-pause"/);
  assert.match(renderer, /data-action="run-stop"/);
  // And the run card itself is drawn in the paused state, so the buttons it now offers are reachable.
  assert.match(renderer, /class="match-card run-card \$\{escapeHtml\(run\.state\)\}"/);
});

test('settings offers the recovery copies, and says a restore can itself be undone', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  assert.match(html, /id="recovery-panel" hidden/);
  assert.match(html, /id="recovery-list"/);
  assert.match(html, /the copy in place now is kept first/);
  assert.match(renderer, /function loadRecovery\(\)/);
  assert.match(renderer, /function recoveryRow\(candidate\)/);
  assert.match(renderer, /poolside\.recoveryPreview\(\)/);
  assert.match(renderer, /poolside\.recoveryRestore\(\{ name: button\.dataset\.recoveryName \}\)/);
  assert.match(renderer, /data-recovery-name="\$\{escapeHtml\(candidate\.name\)\}"/);
  // The panel is filled when the settings view is opened, not on every dashboard render.
  assert.match(renderer, /if \(name === 'settings'\) loadRecovery\(\);/);
});

test('the match card reports what the balances did, in the wording the evidence owns', () => {
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  assert.match(renderer, /function matchOutcome\(match\)/);
  assert.match(renderer, /Balances: \$\{escapeHtml\(outcome\.reason\)\}/);
  assert.match(renderer, /\$\{matchOutcome\(match\)\}/);
  // The four verdicts the record accepts each get a colour, and the weakest is not coloured like a result.
  for (const verdict of ['observed', 'uncertain', 'unchanged', 'incomplete']) {
    assert.match(css, new RegExp('\\.match-outcome\\.' + verdict));
  }
});

test('the sessions view lists what needs attention, and hides itself when there is nothing', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  assert.match(html, /id="attention-panel" hidden aria-labelledby="attention-title"/);
  assert.match(html, /<h2 id="attention-title">Needs your attention<\/h2>/);
  assert.match(html, /id="attention-summary"/);
  assert.match(html, /id="attention-list"/);
  assert.match(renderer, /function renderAttention\(\)/);
  assert.match(renderer, /\$\('#attention-panel'\)\.hidden = items\.length === 0;/);
  assert.match(renderer, /renderAttention\(\);/);
  assert.match(renderer, /class="attention-item \$\{escapeHtml\(entry\.level\)\}"/);
  assert.match(css, /\.attention-panel\s*\{/);
});

test('a new workspace is told what to do, and the guidance yields to a problem', () => {
  const html = ui('index.html');
  const renderer = ui('renderer.js');
  const css = ui('style.css');
  assert.match(html, /id="guidance-panel" hidden aria-labelledby="guidance-title"/);
  assert.match(html, /<h2 id="guidance-title">Set up your first session<\/h2>/);
  assert.match(html, /id="guidance-steps"/);
  assert.match(renderer, /function renderGuidance\(\)/);
  // The steps reuse the existing actions rather than a second implementation of them.
  assert.match(renderer, /poolside\.openAll\(\)/);
  assert.match(renderer, /dataset\.action === 'add-account'/);
  assert.match(renderer, /renderGuidance\(\);/);
  assert.match(css, /\.guidance-panel\s*\{/);
});
