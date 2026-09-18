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
 * @property {Footprint} footprint
 * @property {{used: boolean, reset: () => void, observe: (url: string, shop: boolean, now: number) => boolean}} [shopGate]
 * @property {number} [observationGeneration]
 * @property {{state: string, score?: number, evidence?: string[], observedAt?: string}|null} [gameScreen]
 * @property {{status: 'checking'|'checked'|'error', ip?: string, checkedAt?: string}} [network]
 * @property {boolean} [inspecting]
 */

/**
 * The configured footprint of a live session and what was reported back about it. `summary` is computed
 * in the main process because the dashboard is a sandboxed page with no access to identity.cjs.
 * @typedef {object} Footprint
 * @property {object} identity
 * @property {string} [summary]
 * @property {any} route
 * @property {{applied: boolean, mode: string, error?: string}} [routeStatus]
 * @property {{applied: string[], attached: boolean, error?: string, skipped?: string}|null} [target]
 * @property {{cacheBytes: number|null, quotaBytes: number|null, overQuota: boolean, at: string}|null} [storage]
 * @property {{ok: boolean, resolved?: string, route?: any, matches?: boolean, error?: string, at: string}|null} [verified]
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
 * @property {object} [identity] identity defaults for every account, overridden per account
 * @property {object} [proxy] route defaults for every account, overridden per account
 */

/**
 * @typedef {object} WorkspaceData
 * @property {number} version
 * @property {Account[]} accounts
 * @property {WorkspaceSettings} settings
 * @property {Record<string, object>} [windows] remembered window geometry, keyed by account id
 */

/**
 * @typedef {object} ActivityEvent
 * @property {number} id
 * @property {string} at
 * @property {string} message
 * @property {'info'|'warning'} kind
 */

module.exports = {};
