// Native confirmation and folder-selection dialogs kept outside the composition root.

/**
 * @param {{dialog: import('electron').Dialog, dashboard: () => import('electron').BrowserWindow|null, selfTest: boolean}} deps
 */
function createNativeDialogs({ dialog, dashboard, selfTest }) {
  async function confirmDestructive(title, detail) {
    if (selfTest) return false;
    const prompt = {
      type: /** @type {'warning'} */ ('warning'),
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Poolside',
      message: title,
      detail
    };
    const parent = dashboard();
    const { response } = parent ? await dialog.showMessageBox(parent, prompt) : await dialog.showMessageBox(prompt);
    return response === 1;
  }

  async function chooseDirectory(title, allowCreate) {
    if (selfTest) return null;
    /** @type {import('electron').OpenDialogOptions} */
    const options = { title, properties: allowCreate ? ['openDirectory', 'createDirectory'] : ['openDirectory'] };
    const parent = dashboard();
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
  }

  return { confirmDestructive, chooseDirectory };
}

module.exports = { createNativeDialogs };
