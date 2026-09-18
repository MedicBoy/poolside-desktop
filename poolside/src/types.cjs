// Shared JSDoc typedefs.
//
// This file is never required at runtime; it exists so `tsc --checkJs` has one place to resolve the
// shapes that cross module boundaries — most importantly the `SessionGroup` that used to be
// knowable only by reading hundreds of lines of main.cjs.

/**
 * @typedef {object} Health
 * @property {number} failures
 * @property {number} recoveries
 * @property {number} consecutive
 * @property {number} attempts
 * @property {boolean} exhausted
 * @property {string|null} lastFailureAt
 * @property {string|null} lastFailureReason
 * @property {string|null} nextAttemptAt
 */

/**
 * One account's open browser session and everything observed about it.
 * @typedef {object} SessionGroup
 * @property {import('electron').BrowserWindow} window
 * @property {import('electron').Session} session
 * @property {Set<import('electron').BrowserWindow>} children
 * @property {import('./session-fsm.cjs').SessionFsm} fsm
 * @property {{dispose: () => void}} [supervision]
 * @property {Health} [health]
 * @property {{used: boolean, reset: () => void, observe: (url: string, shop: boolean, now: number) => boolean}} [shopGate]
 * @property {number} [observationGeneration]
 * @property {{state: string, score?: number, evidence?: string[], observedAt?: string}|null} [gameScreen]
 * @property {{status: 'checking'|'checked'|'error', ip?: string, checkedAt?: string}} [network]
 * @property {boolean} [inspecting]
 */

/**
 * @typedef {(message: string, kind?: 'info'|'warning') => void} LogFn
 */

/**
 * One account's saved-session queue. Outlives its window so a debounced save still flushes on quit.
 * @typedef {object} ProfileStore
 * @property {Promise<unknown>} queue
 * @property {NodeJS.Timeout|undefined} timer
 * @property {Promise<void>} ready
 * @property {() => Promise<unknown>} flush
 */

/**
 * @typedef {object} Account
 * @property {string} id
 * @property {string} name
 * @property {'receiver'|'sender'} role
 * @property {boolean} archived
 * @property {string} createdAt
 */

/**
 * @typedef {object} WorkspaceSettings
 * @property {string} table
 * @property {number} limit
 */

/**
 * @typedef {object} WorkspaceData
 * @property {number} version
 * @property {Account[]} accounts
 * @property {WorkspaceSettings} settings
 */

/**
 * @typedef {object} ActivityEvent
 * @property {number} id
 * @property {string} at
 * @property {string} message
 * @property {'info'|'warning'} kind
 */

module.exports = {};
