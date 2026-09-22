// Footprint assertions for the packaged self-test: what a session *claims* to be, read back out of a
// real page through `navigator` and `Intl`, and what route Chromium says it will actually use.
//
// This is the only place the identity surface is verified against a browser rather than against the pure
// module, which is the whole point: `session.setUserAgent` and the CDP overrides are Electron's
// behaviour, not ours, and a unit test asserting our own config shape would prove nothing about them.
//
// Second sessions exist to prove *isolation*: two sessions with different identities must read back
// their own values, or "isolated footprint" is a claim the app cannot support.

const { resolveIdentity } = require('./identity.cjs');
const { resolveProxyRoute } = require('./proxy.cjs');
const { rememberBounds, restoreBounds } = require('./geometry.cjs');
const { applySessionFootprint, applyProxyRoute, measureStorage, verifyRoute } = require('./footprint.cjs');
const { applyTargetFootprint } = require('./target-identity.cjs');

// Read the properties the roadmap promised to assert, from inside the page.
const READ_BACK = `(() => ({
  userAgent: navigator.userAgent,
  language: navigator.language,
  languages: navigator.languages.join(','),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
  viewport: window.innerWidth + 'x' + window.innerHeight,
  dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  storageEstimateAvailable: typeof navigator.storage?.estimate === 'function'
}))()`;

const IDENTITY_A = {
  userAgent: 'PoolsideFixture/1.0 (Identity A)',
  acceptLanguages: 'en-GB,en',
  locale: 'en-GB',
  timezone: 'Europe/London',
  viewport: { width: 800, height: 600 },
  colorScheme: 'dark'
};

const IDENTITY_B = {
  userAgent: 'PoolsideFixture/1.0 (Identity B)',
  acceptLanguages: 'fr-FR,fr',
  locale: 'fr-FR',
  timezone: 'Asia/Tokyo',
  viewport: { width: 1024, height: 400 },
  colorScheme: 'light'
};

/**
 * @param {import('./self-test.cjs').SelfTestContext} ctx
 * @param {typeof import('node:assert/strict')} assert
 * @param {import('./types.cjs').LogFn} log
 */
async function runFootprintChecks(ctx, assert, log) {
  const { BrowserWindow, session, model, fs, workspace } = ctx;
  const fixtureSession = session.fromPartition('test-footprint');
  fixtureSession.protocol.handle('https', () => new Response('<!doctype html><title>identity fixture</title>'));

  /** Open a window on a session with the given identity and read the page back. */
  async function readIdentity(rawIdentity, partition) {
    const isolated = session.fromPartition(partition);
    isolated.protocol.handle('https', () => new Response('<!doctype html><title>identity fixture</title>'));
    const { identity } = resolveIdentity({ identity: rawIdentity }, {});
    applySessionFootprint(isolated, { identity, route: resolveProxyRoute({}, {}) }, { log, baseUserAgent: 'poolside-base/0.0' });
    const window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: { session: isolated, sandbox: true, backgroundThrottling: false }
    });
    // Target overrides are applied while the target is live, which is the real ordering.
    const targetResult = await applyTargetFootprint(window.webContents, { identity }, log);
    await window.loadURL('https://identity.test/');
    const read = await window.webContents.executeJavaScript(READ_BACK);
    // Printed as well as asserted: these values are the evidence for what this session claims to be, and
    // a failure on another machine is far easier to read with them in the output.
    console.log(`... footprint: ${partition} overrides -> ${JSON.stringify(targetResult)}`);
    console.log(`... footprint: ${partition} reads ${JSON.stringify(read)}`);
    // Read while the window is alive: the page reports its own quota, which is what makes the configured
    // ceiling a comparison the app makes rather than a cap Chromium applies.
    const estimate = await window.webContents.executeJavaScript('navigator.storage.estimate()');
    return { identity, read, targetResult, estimate, window };
  }

  const a = await readIdentity(IDENTITY_A, 'test-identity-a');
  assert.equal(a.targetResult.applied.length, 5, 'user agent, locale, timezone, viewport and colour scheme were all accepted');
  // Each accepted override is named by the field it belongs to, not by its CDP method: a refusal has to be
  // reportable as "the control you have to clear" rather than as "Emulation.setTimezoneOverride".
  assert.deepEqual(
    a.targetResult.applied,
    ['User agent', 'Language (locale)', 'Time zone', 'Window size', 'Colour scheme'],
    'the applied overrides are named by field'
  );
  assert.deepEqual(a.targetResult.refused, [], 'nothing was refused in the fixture identity');
  assert.equal(a.read.userAgent, IDENTITY_A.userAgent, 'the session user agent reaches navigator.userAgent');
  assert.equal(a.read.language, 'en-GB', 'accepted languages drive navigator.language');
  assert.equal(a.read.languages, 'en-GB,en', 'the ordered list is preserved');
  assert.equal(a.read.timeZone, 'Europe/London', 'the timezone override reaches Intl');
  assert.equal(a.read.locale, 'en-GB', 'the locale override reaches Intl');
  assert.equal(a.read.viewport, '800x600', 'the viewport override sets the layout viewport, not the window size');
  assert.equal(a.read.dark, true, 'the emulated colour scheme reaches the media query');
  assert.equal(a.read.storageEstimateAvailable, true, 'the page can report its own storage usage');

  // The same reads on a *different* configuration: if any value matched session A, nothing is isolated.
  const b = await readIdentity(IDENTITY_B, 'test-identity-b');
  assert.equal(b.read.userAgent, IDENTITY_B.userAgent);
  assert.equal(b.read.language, 'fr-FR');
  assert.equal(b.read.languages, 'fr-FR,fr');
  assert.equal(b.read.timeZone, 'Asia/Tokyo', "a second session reads its own timezone, not the first session's");
  assert.equal(b.read.locale, 'fr-FR');
  assert.equal(b.read.viewport, '1024x400');
  assert.equal(b.read.dark, false, 'an explicit light scheme is not the same as unset');
  assert.notEqual(a.read.userAgent, b.read.userAgent);
  b.window.destroy();
  a.window.destroy();

  // What Chromium says it will actually use, compared with what was configured.
  const configured = resolveProxyRoute({ proxy: { spec: '127.0.0.1:9' } }, {});
  assert.equal(configured.configured, true);
  const applied = await applyProxyRoute(fixtureSession, configured, log);
  assert.equal(applied.applied, true, 'Electron accepted the route');
  const verified = await verifyRoute(fixtureSession, configured, 'https://example.test/');
  console.log(`... footprint: route configured ${configured.label}, resolver reports ${verified.ok ? verified.route.label : 'nothing'}`);
  assert.equal(verified.ok, true, 'resolveProxy answered');
  assert.equal(verified.route.kind, 'proxy', 'the route in use is a proxy, not a direct connection');
  assert.equal(verified.route.target, '127.0.0.1:9', 'and it is the configured one');
  assert.equal(verified.matches, true, 'the configured route and the route in use agree');

  // An unconfigured session is reported, not judged: whatever Chromium decides is not a mismatch.
  const direct = session.fromPartition('test-footprint-direct');
  const unconfigured = resolveProxyRoute({}, {});
  const answered = await verifyRoute(direct, unconfigured, 'https://example.test/');
  assert.equal(answered.ok, true);
  assert.equal(unconfigured.configured, false);
  assert.equal(routeAnswerIsKnown(answered), true, `the resolver answered with ${answered.route.label}`);

  // The ceiling is reported, not enforced. The measurement path is asserted against the real session,
  // and the comparison itself against a session with a known usage, so the test does not depend on the
  // fixture having actually cached anything.
  const measured = await measureStorage(fixtureSession, { ...a.identity, quotaBytes: 1024 * 1024 * 1024 });
  assert.equal(typeof measured.cacheBytes, 'number', 'the HTTP cache size is readable from the main process');
  assert.equal(measured.overQuota, false, 'a generous ceiling is not reported as exceeded');

  const stub = { getCacheSize: async () => 2048 };
  const over = await measureStorage(stub, { ...a.identity, quotaBytes: 1024 });
  assert.equal(over.cacheBytes, 2048);
  assert.equal(over.overQuota, true, 'a 2 KB cache against a 1 KB ceiling reports as exceeded');
  const under = await measureStorage(stub, { ...a.identity, quotaBytes: 4096 });
  assert.equal(under.overQuota, false);

  const unreadable = await measureStorage(
    {
      getCacheSize: async () => {
        throw new Error('no cache');
      }
    },
    a.identity
  );
  assert.equal(unreadable.cacheBytes, null, 'an unreadable cache is reported as unknown, never as zero');

  // The page reports its own quota independently, which is what makes the configured ceiling a
  // comparison the app makes rather than a cap Chromium applies.
  assert.equal(typeof a.estimate.quota, 'number', 'the renderer reports the quota Chromium actually allows');
  assert.equal(typeof a.estimate.usage, 'number');

  fixtureSession.protocol.unhandle('https');

  // Remembered geometry through the real file: a window's rectangle must survive save + reload, or the
  // "remembered layout" promise is only true until the app restarts (the D3 class of defect).
  const geometryId = workspace.data.accounts[0].id;
  const rectangle = rememberBounds({ x: 40, y: 60, width: 1060, height: 800 }, { maximized: false, displayId: 1 });
  assert.equal(ctx.rememberWindowGeometry(geometryId, rectangle), true, 'the workspace accepted the geometry');
  const reread = model.decode(JSON.parse(fs.readFileSync(workspace.storeFile, 'utf8')));
  const saved = /** @type {Record<string, any>} */ (reread.windows);
  assert.ok(saved, 'the workspace kept its windows map');
  assert.deepEqual(saved[geometryId], rectangle, 'the saved rectangle survives a reload');
  const restored = restoreBounds(saved[geometryId], [{ id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]);
  assert.equal(restored.bounds?.width, 1060, 'and it restores at the size it was saved with');

  console.log(
    'PASS: per-session identity (user agent, languages, locale, timezone, viewport, colour scheme) read back from navigator and Intl, isolated between sessions, with the route, the storage ceiling and remembered window geometry reported honestly.'
  );
}

/** A resolver answer is usable when it is one of the shapes the module claims to understand. */
function routeAnswerIsKnown(verified) {
  return ['direct', 'proxy', 'unknown'].includes(verified.route.kind);
}

module.exports = { runFootprintChecks, IDENTITY_A, IDENTITY_B };
