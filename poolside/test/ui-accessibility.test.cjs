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
