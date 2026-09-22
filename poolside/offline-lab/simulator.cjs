'use strict';

// This process has no browser, HTTP client, live-game adapter, credentials, or disk storage.
// Every login creates a fresh local guest identity. All state is discarded at exit.
const crypto = require('node:crypto');
const readline = require('node:readline');

function createOfflineLab({ makeId = () => crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  const sessions = new Map();
  const matches = new Map();
  let nextGuest = 1;
  let nextMatch = 1;

  function getSession(handle) {
    const session = sessions.get(handle);
    if (!session) throw new Error(`Unknown guest session: ${handle}.`);
    return session;
  }

  function activeSession(handle) {
    const session = getSession(handle);
    if (session.state !== 'active') throw new Error(`${handle} has logged out.`);
    return session;
  }

  function login(label = '') {
    if (typeof label !== 'string' || /[\x00-\x1f\x7f]/.test(label)) throw new Error('Guest label must be plain single-line text.');
    const handle = `g${nextGuest++}`;
    const session = {
      handle,
      guestId: makeId(),
      label: label.trim() || `Guest ${handle}`,
      state: 'active',
      startedAt: now(),
      endedAt: null
    };
    if (!session.guestId || [...sessions.values()].some(existing => existing.guestId === session.guestId))
      throw new Error('Could not generate a unique guest identity.');
    sessions.set(handle, session);
    return structuredClone(session);
  }

  function logout(handle) {
    const session = activeSession(handle);
    session.state = 'logged-out';
    session.endedAt = now();
    for (const match of matches.values()) {
      if (match.state === 'active' && match.guests.includes(handle)) {
        match.state = 'cancelled';
        match.endedAt = now();
        match.reason = `${handle} logged out before the simulated result.`;
      }
    }
    return structuredClone(session);
  }

  function pair(firstHandle, secondHandle) {
    if (firstHandle === secondHandle) throw new Error('A guest cannot be paired with itself.');
    activeSession(firstHandle);
    activeSession(secondHandle);
    for (const match of matches.values()) {
      if (match.state === 'active' && match.guests.some(handle => handle === firstHandle || handle === secondHandle))
        throw new Error('One of these guests is already in an active simulated match.');
    }
    const match = {
      handle: `m${nextMatch++}`,
      matchId: makeId(),
      guests: [firstHandle, secondHandle],
      state: 'active',
      startedAt: now(),
      endedAt: null,
      winner: null,
      simulated: true
    };
    if (!match.matchId || [...matches.values()].some(existing => existing.matchId === match.matchId))
      throw new Error('Could not generate a unique match identity.');
    matches.set(match.handle, match);
    return structuredClone(match);
  }

  function finish(matchHandle, winnerHandle) {
    const match = matches.get(matchHandle);
    if (!match) throw new Error(`Unknown simulated match: ${matchHandle}.`);
    if (match.state !== 'active') throw new Error(`${matchHandle} is not active.`);
    if (!match.guests.includes(winnerHandle)) throw new Error('The winner must be a participant in this simulated match.');
    activeSession(winnerHandle);
    match.state = 'completed';
    match.winner = winnerHandle;
    match.endedAt = now();
    return structuredClone(match);
  }

  function snapshot() {
    return structuredClone({
      mode: 'offline-simulation',
      sessions: [...sessions.values()],
      matches: [...matches.values()]
    });
  }

  return { login, logout, pair, finish, snapshot };
}

function help() {
  return [
    'Commands:',
    '  login [label]           Create a NEW local guest session every time',
    '  logout <guest>         End that guest session; next login gets a new identity',
    '  sessions               Show current and logged-out guests',
    '  pair <guest> <guest>   Start a synthetic match between two active guests',
    '  finish <match> <guest> Record a manually chosen simulated winner',
    '  matches                Show synthetic match records',
    '  help                   Show these commands',
    '  exit                   Discard this in-memory lab and close',
    '',
    'Example: login Alice; login Bob; pair g1 g2; finish m1 g1',
    'No game is opened or played. No network requests, coins, passwords, or real accounts are used.'
  ].join('\n');
}

function execute(lab, line) {
  const trimmed = String(line).trim();
  if (!trimmed) return '';
  const [command, ...args] = trimmed.split(/\s+/);
  switch (command.toLowerCase()) {
    case 'login':
      return JSON.stringify(lab.login(trimmed.slice(command.length).trim()));
    case 'logout':
      if (args.length !== 1) throw new Error('Usage: logout <guest>.');
      return JSON.stringify(lab.logout(args[0]));
    case 'sessions':
      if (args.length) throw new Error('Usage: sessions.');
      return JSON.stringify(lab.snapshot().sessions, null, 2);
    case 'pair':
      if (args.length !== 2) throw new Error('Usage: pair <guest> <guest>.');
      return JSON.stringify(lab.pair(args[0], args[1]));
    case 'finish':
      if (args.length !== 2) throw new Error('Usage: finish <match> <winner guest>.');
      return JSON.stringify(lab.finish(args[0], args[1]));
    case 'matches':
      if (args.length) throw new Error('Usage: matches.');
      return JSON.stringify(lab.snapshot().matches, null, 2);
    case 'help':
      return help();
    case 'exit':
    case 'quit':
      return null;
    default:
      throw new Error(`Unknown command: ${command}. Type help.`);
  }
}

function runSelfTest() {
  const assert = require('node:assert/strict');
  const lab = createOfflineLab();
  const guests = Array.from({ length: 128 }, (_, index) => lab.login(`Guest ${index + 1}`));
  assert.equal(new Set(guests.map(guest => guest.guestId)).size, 128);
  assert.equal(lab.snapshot().sessions.length, 128);
  const first = guests[0];
  const second = guests[1];
  assert.notEqual(first.guestId, second.guestId);
  assert.throws(() => lab.pair(first.handle, first.handle));
  const match = lab.pair(first.handle, second.handle);
  assert.throws(() => lab.pair(first.handle, guests[2].handle));
  assert.throws(() => lab.finish(match.handle, guests[2].handle));
  assert.equal(lab.finish(match.handle, first.handle).winner, first.handle);
  assert.throws(() => lab.finish(match.handle, second.handle));
  const interrupted = lab.pair(first.handle, second.handle);
  lab.logout(first.handle);
  assert.equal(lab.snapshot().matches.find(item => item.handle === interrupted.handle).state, 'cancelled');
  assert.throws(() => lab.pair(first.handle, second.handle));
  const replacement = lab.login('Guest 1');
  assert.notEqual(replacement.guestId, first.guestId);
  assert.notEqual(replacement.handle, first.handle);
  assert.equal(lab.pair(replacement.handle, second.handle).state, 'active');
  const copy = lab.snapshot();
  copy.sessions[0].state = 'tampered';
  assert.equal(lab.snapshot().sessions[0].state, 'logged-out');
  assert.match(execute(lab, 'help'), /No network requests/);
  console.log('Offline lab self-test passed: 128 dynamic guests, new identity after logout, pair/result/cancel guards.');
}

function runCli() {
  const lab = createOfflineLab();
  const interface_ = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  console.log('Poolside Offline Lab · dynamic local guests · memory-only');
  console.log(help());
  interface_.setPrompt('offline-lab> ');
  interface_.prompt();
  interface_.on('line', line => {
    try {
      const result = execute(lab, line);
      if (result === null) return interface_.close();
      if (result) console.log(result);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Command failed.');
    }
    interface_.prompt();
  });
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else runCli();
}

module.exports = { createOfflineLab, execute };
