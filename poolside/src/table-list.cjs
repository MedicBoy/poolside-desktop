// The supported 8 Ball Pool 1-on-1 venue labels.
// A local preference only: Poolside never enters a table or controls gameplay.
const TABLES = [
  'Bangkok',
  'London',
  'Sydney',
  'Moscow',
  'Tokyo',
  'Las Vegas',
  'Jakarta',
  'Toronto',
  'Cairo',
  'Mumbai',
  'Seoul',
  'Rome',
  'Paris',
  'Berlin',
  'Dubai',
  'Shanghai'
];

// These venues appeared in earlier Poolside builds but are not available in the supported web 1-on-1
// surface. Keep the migration at the storage boundary only so an old preference cannot make the whole
// workspace unreadable; no retired name is offered by the UI or accepted for a new setting.
function migrateStoredTable(value) {
  return ['Dallas', 'Venice', 'Miami'].includes(value) ? 'Dubai' : value;
}

module.exports = { TABLES, migrateStoredTable };
