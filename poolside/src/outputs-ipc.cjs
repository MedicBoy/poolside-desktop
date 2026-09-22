// The dashboard surface for the files Poolside wrote itself: see them, and erase them deliberately.
//
// Erasing is irreversible, so it asks natively — like deleting a profile, and like replacing the workspace from
// a recovery copy — rather than through a confirmation a page script could forge. The detail names what is about
// to go and, in the same breath, what is untouched.

/** Only the first few names are read out; a hundred would be a wall of text rather than a confirmation. */
const NAMES_IN_DETAIL = 5;

/**
 * @param {{handle: (name: string, fn: (input?: any) => any) => void, inventory: {list: Function, clear: Function}, root: string, confirmDestructive: (title: string, detail: string) => Promise<boolean>, log: (message: string, level?: 'info'|'warning') => void}} deps
 */
function registerOutputsIpc({ handle, inventory, root, confirmDestructive, log }) {
  handle('outputs:list', () => inventory.list({ root }));

  handle('outputs:clear', async input => {
    const names = Array.isArray(input?.names) ? input.names.filter(name => typeof name === 'string') : [];
    if (!names.length) throw new Error('There is nothing to erase.');
    const shown = names.slice(0, NAMES_IN_DETAIL).join(', ');
    const rest = names.length > NAMES_IN_DETAIL ? ` and ${names.length - NAMES_IN_DETAIL} more` : '';
    const agreed = await confirmDestructive(
      `Erase ${names.length} local file${names.length === 1 ? '' : 's'}?`,
      `This deletes ${shown}${rest} from Poolside's own export folder. Browser profiles, saved sessions, the workspace and your accounts are untouched.`
    );
    if (!agreed) throw new Error('Nothing was erased.');
    const result = inventory.clear({ root, names });
    if (result.removed.length)
      log(`Erased ${result.removed.length} local export file(s), about ${Math.max(1, Math.round(result.bytes / 1024))} KB.`);
    // A file that could not be erased is reported, never swallowed: the panel would otherwise keep listing it
    // with no explanation of why it is still there.
    for (const entry of result.skipped) log(`Left ${entry.name} alone: ${entry.reason}.`, 'warning');
    return result;
  });
}

module.exports = { registerOutputsIpc, NAMES_IN_DETAIL };
