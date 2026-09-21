function registerCaptureLab({ handle, inspector, captureLab }) {
  handle('capture:list', () => ({
    samples: captureLab.list(),
    states: captureLab.states,
    tables: captureLab.tables,
    cohorts: captureLab.cohorts,
    evaluation: captureLab.evaluation()
  }));
  handle('capture:record', input => {
    if (!input || input.confirmedSafe !== true)
      throw new Error('Confirm that the screen contains no sign-in fields, passwords, tokens, or private messages.');
    return inspector.inspectGame(input.id, {
      expectedState: input.expectedState,
      expectedTable: input.expectedTable,
      cohort: input.cohort
    });
  });
  handle('capture:image', id => captureLab.image(id));
  handle('capture:delete', id => captureLab.remove(id));
  handle('capture:review', id => captureLab.markReviewed(id));
  handle('capture:set-cohort', input => captureLab.setCohort(input?.id, input?.cohort));
}

module.exports = { registerCaptureLab };
