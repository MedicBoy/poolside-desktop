// Session and navigation policy.
//
// The security posture lived inline in main.cjs and is now a named, testable surface: game windows
// may only navigate over https, popups inherit their account's session with the same restrictions,
// downloads are blocked, and every permission request is denied.

/**
 * Sessions that already carry the download guard. A WeakSet rather than a property on Electron's
 * Session object, which is not ours to extend.
 */
const guardedSessions = new WeakSet();

/**
 * Only https navigation is permitted.
 * @param {string} url
 * @returns {boolean}
 */
function isWeb(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Block downloads for one session, once.
 * @param {import('electron').Session} isolated
 * @param {string} label
 * @param {import('./types.cjs').LogFn} log
 */
function guardDownloads(isolated, label, log) {
  if (guardedSessions.has(isolated)) return;
  isolated.on('will-download', event => {
    event.preventDefault();
    log(`${label}: a download was blocked.`, 'warning');
  });
  guardedSessions.add(isolated);
}

/**
 * Apply the full session policy: deny every permission request, block downloads.
 * @param {import('electron').Session} isolated
 * @param {string} label
 * @param {import('./types.cjs').LogFn} log
 */
function applySessionPolicy(isolated, label, log) {
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  guardDownloads(isolated, label, log);
}

/**
 * Apply the navigation and popup policy to a webContents, recursively to any popup it opens.
 * @param {import('electron').WebContents} contents
 * @param {import('./types.cjs').SessionGroup} group
 */
function applyNavigationPolicy(contents, group) {
  contents.on('will-navigate', (event, url) => {
    if (!isWeb(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isWeb(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => ({
    action: isWeb(url) ? 'allow' : 'deny',
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      width: 960,
      height: 760,
      webPreferences: {
        session: group.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    }
  }));
  contents.on('did-create-window', child => {
    group.children.add(child);
    applyNavigationPolicy(child.webContents, group);
    child.on('closed', () => group.children.delete(child));
  });
}

module.exports = { isWeb, applySessionPolicy, applyNavigationPolicy };
