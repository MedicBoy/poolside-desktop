const { isIP } = require('node:net');
const IP_ENDPOINT = 'https://api.ipify.org?format=json';

async function checkPublicIP(browserSession) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await browserSession.fetch(IP_ENDPOINT, {
      signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error'
    });
    if (!response.ok) throw new Error('IP service unavailable. Try again later.');
    const reader = response.body.getReader();
    let body = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        body += Buffer.from(value).toString('utf8');
        if (body.length > 1024) throw new Error('Unexpected response from IP service.');
      }
    } finally { await reader.cancel(); }
    const ip = JSON.parse(body).ip;
    if (typeof ip !== 'string' || !isIP(ip)) throw new Error('Unexpected response from IP service.');
    return { ip, checkedAt: new Date().toISOString() };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('IP check timed out. Check your connection and retry.');
    throw new Error('IP check failed. Check your connection and retry.');
  } finally { clearTimeout(timer); }
}
module.exports = { checkPublicIP };
