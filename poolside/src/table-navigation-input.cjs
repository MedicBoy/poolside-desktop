// Dry-run game-input adapter. It explains the next manual action and deliberately performs none.

const INSTRUCTIONS = {
  'inspect-screen': 'Check the visible game screen. Poolside will classify one frame without clicking anything.',
  'return-to-lobby': 'Return to the lobby manually, then check the screen again.',
  'open-table-selection': 'Open the 1-on-1 table selector manually, then confirm that step here.',
  'search-table-list': 'Move through the table list manually until the target table is visible, then check again.',
  'open-target-table': 'Open the target table manually, then confirm that step here.',
  retry: 'Retry the dry run from the current game window.'
};

function createDryRunTableInput() {
  return {
    mode: 'dry-run',
    perform(action, context = {}) {
      if (action === null) return { mode: 'dry-run', action: null, performed: false, instruction: 'No further input is required.' };
      if (!Object.hasOwn(INSTRUCTIONS, action)) throw new Error(`Unsupported table-navigation action: ${action}`);
      const target = context.targetTable ? ` Target: ${context.targetTable}.` : '';
      return { mode: 'dry-run', action, performed: false, instruction: `${INSTRUCTIONS[action]}${target}` };
    }
  };
}

module.exports = { createDryRunTableInput, INSTRUCTIONS };
