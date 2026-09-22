// Supply credentials only to the proxy endpoint configured for this one browser window.

/**
 * @param {{on: Function}} webContents
 * @param {import('./proxy.cjs').ProxyRoute} route
 */
function attachProxyAuthentication(webContents, route) {
  const credentials = route?.credentials;
  if (!credentials || !route.expectedTarget) return false;
  const expected = String(route.expectedTarget).toLowerCase();
  webContents.on('login', (event, _details, authInfo, callback) => {
    const challenged = `${authInfo.host}:${authInfo.port}`.toLowerCase();
    if (!authInfo.isProxy || challenged !== expected) return;
    event.preventDefault();
    callback(credentials.username, credentials.password);
  });
  return true;
}

module.exports = { attachProxyAuthentication };
