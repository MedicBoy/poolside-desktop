// Which workspace documents this build will read, and what it says about the ones it will not.
//
// The document has carried `version: 1` since it was written, and until now the answer to any other version was
// one sentence: "Unsupported workspace data." That sentence is true and useless. The operator cannot tell a file
// from a newer build from a file that has been corrupted, and those two need opposite actions — go and get the
// newer build, or restore a copy.
//
// So the version is checked first and each answer is its own: a document from a newer build is named as such and
// the file is left exactly as it is; an older or unnumbered document is refused rather than guessed at; and a
// document that is the right version but unreadable keeps the existing wording. Nothing here writes.
//
// Migrations live in one ordered list. There are none between version 1 and version 1 — this build wrote that
// version itself — and the list existing is what makes adding a version a decision rather than an improvisation:
// a document from version N must be carried to N+1 by a named step, or refused by name.

const model = require('./model.cjs');

/** The version this build writes and reads. */
const CURRENT_VERSION = 1;

/**
 * Ordered migrations, oldest first: each entry carries the document from `from` to `from + 1`.
 * Empty on purpose — version 1 is the only version that has ever shipped.
 */
const MIGRATIONS = [];

/** @param {unknown} value */
function versionOf(value) {
  const raw = value && typeof value === 'object' ? /** @type {any} */ (value).version : undefined;
  return Number.isInteger(raw) ? raw : null;
}

/**
 * Read a workspace document from parsed JSON.
 *
 * Returns `{ok: true, document}` with the validated document, or `{ok: false, kind, message}` where `kind` is one
 * of `future`, `legacy`, `malformed`. The message is written for the operator, not for a developer.
 * @param {unknown} parsed
 * @returns {{ok: true, document: any} | {ok: false, kind: 'future'|'legacy'|'malformed', message: string}}
 */
function readDocument(parsed) {
  const version = versionOf(parsed);
  if (version === null || version < 1)
    return {
      ok: false,
      kind: 'legacy',
      message: `This workspace file does not say which version it is, so Poolside will not guess at it. Nothing has been changed${
        version === null ? '' : ` (it reports version ${version})`
      }.`
    };
  if (version > CURRENT_VERSION)
    return {
      ok: false,
      kind: 'future',
      message: `This workspace was written by a newer version of Poolside (version ${version}). This build reads version ${CURRENT_VERSION}, and it has not changed the file. Use the newer build, or restore an earlier copy from Settings.`
    };
  try {
    return { ok: true, document: model.decode(parsed) };
  } catch (error) {
    return {
      ok: false,
      kind: 'malformed',
      message: `This workspace file is version ${version} but could not be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

module.exports = { CURRENT_VERSION, MIGRATIONS, versionOf, readDocument };
