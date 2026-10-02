import { app, BrowserWindow, Menu, net, protocol, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The desktop shell: one window showing the built web app (`dist/`), nothing more. The app itself
 * is unchanged — no preload, no IPC — so the browser build and the installed one stay the same code.
 *
 * `dist/` is served over a private `app://` scheme rather than `file://`. That gives the page a
 * real, stable origin, which is what keeps `localStorage` (the project autosave) across updates
 * and lets the solver's module worker load.
 */
const SCHEME = 'app'
const ORIGIN = `${SCHEME}://schedule-maker`
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// A second launch focuses the window already open, so two copies never fight over the autosave.
if (!app.requestSingleInstanceLock()) app.quit()

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 420,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e10',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once('ready-to-show', () => win.show())

  // The app has no links of its own to other sites; anything that tries goes to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault()
  })

  void win.loadURL(`${ORIGIN}/index.html`)
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    const file = path.join(DIST, decodeURIComponent(pathname))
    // Never serve anything outside dist/, whatever the URL says.
    if (path.relative(DIST, file).startsWith('..')) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // The web app's own top bar is the whole interface; the default File/Edit/View menu adds nothing.
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
