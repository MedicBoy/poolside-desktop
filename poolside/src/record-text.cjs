// The two helpers every stored record shares: how a piece of text is made safe to store, and how a moment is
// written down.
//
// Split out because the match record and the run record both need them, and a shared helper living in one of
// them would make the two depend on each other for no reason other than convenience.

const NAME_LIMIT = 60;
const TEXT_LIMIT = 200;
const ID_LIMIT = 64;

/**
 * One line of text, without control characters, at most `max` characters. Anything that is not a string is
 * empty, because a record that stores a number where a sentence belongs is a record nobody can read.
 * @param {unknown} value @param {number} max
 */
function text(value, max) {
  return typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}

/** @param {number} now */
function stamp(now) {
  return new Date(now).toISOString();
}

module.exports = { text, stamp, NAME_LIMIT, TEXT_LIMIT, ID_LIMIT };
