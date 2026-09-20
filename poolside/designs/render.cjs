// Render one design mock-up to a PNG, using the same Chromium the app itself ships.
//
// The mock-ups are real HTML/CSS rather than generated pictures, so the text stays legible and whatever
// direction gets picked can be moved into `src/ui` instead of being redrawn by hand.
//
// Usage: `electron designs/render.cjs designs/01-nebula-glass.html`
// One file per run: a second offscreen surface created in the same process as the first one's teardown
// fails to load, and the failure is silent.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const WIDTH = 1600;
const HEIGHT = 1000;

app.disableHardwareAcceleration();

const directory = __dirname;
const target = process.argv[2];

async function render(file) {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(directory, file));
  await new Promise(resolve => setTimeout(resolve, 1200));
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const out = path.join(directory, file.replace(/\.html$/, '.png'));
  fs.writeFileSync(out, image.toPNG());
  win.destroy();
  // One offscreen renderer at a time: a second window created in the same tick as the first one's
  // teardown fails to load, so the loop waits for the previous surface to go away.
  await new Promise(resolve => setTimeout(resolve, 500));
  return `${path.basename(out)}  ${size.width}x${size.height}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`;
}

app.whenReady().then(async () => {
  try {
    console.log(await render(target));
  } catch (error) {
    console.log(`${target}  FAILED: ${error && error.message}`);
    process.exitCode = 1;
  }
  app.quit();
});
