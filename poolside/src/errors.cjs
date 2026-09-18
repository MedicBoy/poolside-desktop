// Error helpers.
//
// A caught value is `unknown` under strict checking, and this codebase logged `error.message`
// directly in seven places. One normaliser keeps that honest and gives ADR-009's error taxonomy a
// single place to grow.

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = { messageOf };
