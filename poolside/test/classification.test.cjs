const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify, classifyText, RULES } = require('../src/game-screen.cjs');

// Text below is transcribed from the supplied game screenshots and the recording frames, so the
// gates are exercised against the real wording rather than invented strings. These are the
// negative and shape tests the OCR suite lacks: every existing fixture is a positive case, so a
// classifier that answers too eagerly would still be green (risk R3 in the roadmap).

const LOBBY = `Clubs Ashlyn 124 New Missions! Free Rewards Cues 78h 35m 30s Leaderboards Shop
  3 243 4 120 575 362 Check your missions! 8 POOL BY MINICLIP Play 1 on 1 Play Special 2
  Play 9 Ball Box Slot Unlock Bejng 1 hour Box Slot Munich Slot`;

const TABLE_SELECTION = `Berlin Platz GET A RING! 0/75 Wins Prize: 50M Players Online: 6
  Entry fee: 25 000 000 Cushion Shot on 8 Ball Play 1 on 1 Play Special Play 9 Ball Box Slot Unlock`;

const LUCKY_PROMOTION = `Lucky Shot Come back every day Play Free Gold Ball`;

test('the gates still recognise the real screens (no behaviour change from the regex chain)', () => {
  assert.equal(classifyText(LOBBY), 'lobby');
  assert.equal(classifyText(TABLE_SELECTION), 'table-selection');
  assert.equal(classifyText(LUCKY_PROMOTION), 'lucky-promotion');
  assert.equal(classifyText('Connecting'), 'connecting');
  assert.equal(classifyText('Lucky Shot Play Free'), 'lucky-shot');
});

test('table selection wins over lobby wording, because the lobby renders behind it', () => {
  // Precedence is order-based, not score-based: both gates pass on this text.
  assert.ok(LOBBY.split(/\s+/).length > 0);
  const result = classify(TABLE_SELECTION);
  assert.equal(result.state, 'table-selection');
  assert.ok(
    result.alternatives.some(alternative => alternative.state === 'lobby'),
    'lobby is reported as an alternative'
  );
});

test('incomplete or unrelated text stays unknown instead of guessing', () => {
  for (const text of [
    '',
    '8 Ball Pool',
    'Play',
    'Account logged in',
    'Prize',
    'Play 1 on 1',
    'Enter your password',
    'Sign in with Miniclip ID',
    'Weekly Deals',
    'Play Special',
    'Entry fee',
    '9 Ball'
  ]) {
    assert.equal(classifyText(text), 'unknown', text);
  }
});

test('the bare loading gate is permissive by design and is flagged for M3', () => {
  // Pre-existing behaviour, preserved deliberately: the gate is the single word "loading", so any
  // screen whose text contains it reports loading. Tightening it requires the labelled corpus
  // from M3 to prove the change is right; it is recorded here so it is not mistaken for a bug.
  assert.equal(classifyText('Loading'), 'loading');
  assert.equal(classifyText('Loading your profile'), 'loading');
});

test('unknown results carry no confidence', () => {
  const result = classify('Play');
  assert.equal(result.state, 'unknown');
  assert.equal(result.score, 0);
  assert.deepEqual(result.evidence, []);
});

test('results report a bounded score and the phrases that matched', () => {
  const result = classify(LOBBY);
  assert.equal(result.state, 'lobby');
  assert.ok(result.score > 0 && result.score <= 1, `score in range, got ${result.score}`);
  assert.ok(result.evidence.includes('play') && result.evidence.includes('special') && result.evidence.includes('9 ball'));
  assert.ok(result.evidence.length <= 8);
});

test('a fuller screen scores at least as high as a sparser one of the same state', () => {
  const sparse = classify('Play Special 9 Ball Unlock');
  const full = classify(LOBBY);
  assert.equal(sparse.state, 'lobby');
  assert.ok(full.score >= sparse.score, `${full.score} >= ${sparse.score}`);
});

test('arrays of OCR passes are scored together, matching the pipeline contract', () => {
  assert.equal(classify([LOBBY, '']).state, 'lobby');
  assert.equal(classify([null, LOBBY]).state, 'lobby');
  assert.equal(classify([]).state, 'unknown');
  assert.equal(classify(undefined).state, 'unknown');
});

test('non-English or reworded screens degrade to unknown rather than a wrong label', () => {
  const spanish = 'Jugar 1 contra 1 Jugar Especial Tarifa de entrada Premio';
  assert.equal(classifyText(spanish), 'unknown');
  assert.equal(classifyText('Come back every day'), 'unknown', 'partial promotion wording is not enough');
});

test('every rule declares a gate and no rule can match on hints alone', () => {
  for (const rule of RULES) {
    assert.ok(rule.all.length > 0, `${rule.state} needs a required term`);
    const hintsOnly = rule.hints.concat([]).join(' ') || '';
    if (hintsOnly) assert.equal(classifyText(hintsOnly), 'unknown', `${rule.state} must not match hints alone`);
  }
});

// The legacy regex chain, embedded verbatim. The rewrite was supposed to change reporting
// (score, evidence, alternatives) and nothing else, so the two implementations must agree on the
// whole corpus. If a future edit loosens or tightens a gate, this fails and the change has to be
// deliberate. It already earned its place: it caught the rewrite dropping \b semantics, which made
// "Reconnecting to the server" satisfy the "connecting" gate.
function legacyClassify(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (/come back every day/.test(s) && /play free/.test(s)) return 'lucky-promotion';
  if (/lucky/.test(s) && /play free|gold ball/.test(s)) return 'lucky-shot';
  if (/entry fee/.test(s) && /prize/.test(s)) return 'table-selection';
  if (/play/.test(s) && /special/.test(s) && /9 ball/.test(s) && /box|unlock/.test(s)) return 'lobby';
  if (/\bconnecting\b/.test(s)) return 'connecting';
  if (/\bloading\b/.test(s)) return 'loading';
  return 'unknown';
}

test('the rewrite is behaviour-preserving against the embedded legacy classifier', () => {
  const corpus = [
    LOBBY,
    TABLE_SELECTION,
    LUCKY_PROMOTION,
    'Connecting',
    'Connecting...',
    'Reconnecting to the server',
    'Loading',
    'Loading your profile',
    'Unloading assets',
    'Loaded',
    '',
    ' ',
    '8 Ball Pool',
    'BY MINICLIP',
    'Play',
    'Prize',
    'Play 1 on 1',
    'Account logged in',
    'Enter your password',
    'Sign in with Miniclip ID',
    'Weekly Deals',
    'FEATURED',
    'WEB SHOP EXCLUSIVE',
    'Play Special',
    'Play 9 Ball',
    'Play Special 9 Ball Box Slot',
    'Entry fee',
    '9 Ball',
    'Box Slot',
    'Lucky Shot Play Free',
    'Come back every day',
    'Come back every day Play Free',
    'Jugar 1 contra 1 Tarifa de entrada Premio',
    'Game Over',
    'PLAY 1 ON 1 PLAY SPECIAL PLAY 9 BALL BOX SLOT'
  ];
  const disagreements = corpus.filter(text => classifyText(text) !== legacyClassify(text));
  assert.deepEqual(disagreements, [], 'classifier disagrees with the legacy regex chain');
  assert.ok(corpus.length >= 30, 'corpus stays broad');
});
