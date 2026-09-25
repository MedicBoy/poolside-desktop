// A single, bounded account observation. Missing control evidence stays unavailable for live input.

const { createHash } = require('node:crypto');
const { TABLES } = require('./table-list.cjs');

/** @param {any} result @param {{png: Buffer, generation?: number, frame: any, timing: any}} capture */
function buildObservation(result, { png, generation, frame, timing }) {
  const score = Number.isFinite(result?.score) ? Math.max(0, Math.min(1, result.score)) : 0;
  const state = typeof result?.state === 'string' ? result.state : 'unrecognized';
  const observedAt = Number.isFinite(Date.parse(result?.observedAt)) ? result.observedAt : new Date().toISOString();
  const visibleTables = Array.isArray(result?.visibleTables)
    ? [...new Set(result.visibleTables.filter(table => TABLES.includes(table)))]
    : [];
  const contradictions = Array.isArray(result?.alternatives)
    ? result.alternatives
        .slice(0, 3)
        .filter(item => item && typeof item.state === 'string')
        .map(item => item.state)
    : [];
  const stageTimings = result?.stages && typeof result.stages === 'object' ? result.stages : {};
  const timings = {};
  for (const [name, value] of Object.entries({ ...stageTimings, ...timing })) {
    if (Number.isFinite(value) && value >= 0) timings[name] = value;
  }
  const readings = {};
  for (const [name, reading] of Object.entries(result?.readings || {})) {
    if (reading && Number.isFinite(reading.value) && Number.isFinite(reading.confidence)) readings[name] = reading;
  }
  return {
    screen: { state, confidence: score },
    visibleTables,
    tableTarget:
      result?.tableMatch?.method === 'local-evidence' && visibleTables.includes(result.tableMatch.table)
        ? { name: result.tableMatch.table, source: 'local-evidence', confidence: null }
        : null,
    controls: Array.isArray(result?.controls) ? result.controls.filter(control => control && typeof control.name === 'string') : [],
    readings,
    contradictions,
    capture: {
      sha256: createHash('sha256').update(png).digest('hex'),
      generation: typeof generation === 'number' && Number.isSafeInteger(generation) && generation >= 0 ? generation : null,
      width: Number.isFinite(frame?.width) ? frame.width : null,
      height: Number.isFinite(frame?.height) ? frame.height : null,
      pageRect: frame?.pageRect ? { ...frame.pageRect } : null,
      matched: frame?.matched === true
    },
    timings,
    ruleVersion: typeof result?.ruleVersion === 'string' ? result.ruleVersion : 'unknown',
    observedAt,
    inputReady: false
  };
}

module.exports = { buildObservation };
