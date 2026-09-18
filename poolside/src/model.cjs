const { randomUUID } = require('node:crypto');
const TABLES = ['Bangkok', 'Rome', 'Seoul'];
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40)
    throw new Error('Use an account name between 1 and 40 characters.');
  return value.trim();
}
function account(input, existing = []) {
  const name = label(input.name);
  if (existing.some(a => a.name.toLowerCase() === name.toLowerCase())) throw new Error('An account with this name already exists.');
  if (!['receiver', 'sender'].includes(input.role)) throw new Error('Choose a valid account role.');
  if (input.role === 'receiver' && existing.some(a => a.role === 'receiver')) throw new Error('There is already a receiving account.');
  return { id: randomUUID(), name, role: input.role, createdAt: new Date().toISOString(), archived: false };
}
function settings(input) {
  if (!TABLES.includes(input.table)) throw new Error('Choose a supported table.');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error('Match limit must be between 1 and 100.');
  return { table: input.table, limit: input.limit };
}
function decode(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.accounts)) throw new Error('Unsupported workspace data.');
  const ids = new Set();
  const active = [];
  const accounts = value.accounts.map(a => {
    if (!a || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id) || ids.has(a.id))
      throw new Error('Invalid account identifier.');
    ids.add(a.id);
    label(a.name);
    if (!['receiver', 'sender'].includes(a.role) || typeof a.archived !== 'boolean') throw new Error('Invalid account data.');
    if (!a.archived) {
      account(a, active);
      active.push(a);
    }
    return { id: a.id, name: a.name, role: a.role, archived: a.archived, createdAt: String(a.createdAt) };
  });
  return { version: 1, accounts, settings: settings(value.settings) };
}
module.exports = { account, settings, decode };
