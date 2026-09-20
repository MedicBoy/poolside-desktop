// Per-account reliability preferences. They affect only Poolside's browser window behaviour.
const SHOP_DELAY_MIN = 3;
const SHOP_DELAY_MAX = 30;
const SHOP_DELAY_DEFAULT = 5;
const MONITOR_INTERVAL_MIN = 15;
const MONITOR_INTERVAL_MAX = 300;
const MONITOR_INTERVAL_DEFAULT = 30;
const RECOVERY_FIELDS = ['shopReturnDelaySeconds', 'backgroundThrottling', 'repaintMitigation', 'monitorIntervalSeconds'];
/** @type {Record<string, import('./config-schema.cjs').FieldSpec>} */
const RECOVERY = {
  shopReturnDelaySeconds: {
    kind: /** @type {'integer'} */ ('integer'),
    label: 'Shop return delay',
    default: SHOP_DELAY_DEFAULT,
    min: SHOP_DELAY_MIN,
    max: SHOP_DELAY_MAX
  },
  backgroundThrottling: { kind: /** @type {'boolean'} */ ('boolean'), label: 'Keep background page active', default: false },
  repaintMitigation: { kind: /** @type {'boolean'} */ ('boolean'), label: 'Refresh display after loading', default: true },
  monitorIntervalSeconds: {
    kind: /** @type {'integer'} */ ('integer'),
    label: 'Live status interval',
    default: MONITOR_INTERVAL_DEFAULT,
    min: MONITOR_INTERVAL_MIN,
    max: MONITOR_INTERVAL_MAX
  }
};
function resolveRecovery(account) {
  const source = account && typeof account.recovery === 'object' ? account.recovery : {};
  return {
    shopReturnDelaySeconds: Number.isInteger(source.shopReturnDelaySeconds) ? source.shopReturnDelaySeconds : SHOP_DELAY_DEFAULT,
    backgroundThrottling: source.backgroundThrottling === true,
    repaintMitigation: source.repaintMitigation !== false,
    monitorIntervalSeconds: Number.isInteger(source.monitorIntervalSeconds) ? source.monitorIntervalSeconds : MONITOR_INTERVAL_DEFAULT
  };
}
module.exports = {
  RECOVERY,
  RECOVERY_FIELDS,
  SHOP_DELAY_MIN,
  SHOP_DELAY_MAX,
  SHOP_DELAY_DEFAULT,
  MONITOR_INTERVAL_MIN,
  MONITOR_INTERVAL_MAX,
  MONITOR_INTERVAL_DEFAULT,
  resolveRecovery
};
