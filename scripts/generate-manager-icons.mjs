import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = fileURLToPath(new URL('..', import.meta.url))
if (!process.versions.electron) {
  const require = createRequire(import.meta.url)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const profile = mkdtempSync(join(tmpdir(), 'hromada-icon-profile-'))
  try {
    const result = spawnSync(require('electron'), [fileURLToPath(import.meta.url)], { cwd: root, env: { ...env, HROMADA_ICON_PROFILE: profile }, stdio: 'inherit', windowsHide: true })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
} else {
  const { app, BrowserWindow } = await import('electron')
  app.setPath('userData', process.env.HROMADA_ICON_PROFILE)
  app.disableHardwareAcceleration()
  void app.whenReady().then(async () => { try {
    const svg = await readFile(join(root, 'assets/hromadaaid-server-manager.svg'), 'utf8')
    const window = new BrowserWindow({ width: 512, height: 512, useContentSize: true, show: false, transparent: true, backgroundColor: '#00000000', webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true } })
    const painted = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Icon rendering timed out')), 10000)
      window.webContents.on('paint', (_event, _dirty, image) => {
        const raster = image.resize({ width: 512, height: 512, quality: 'best' })
        const pixels = raster.toBitmap(), sample = (40 * 512 + 256) * 4
        // Ignore the initial transparent frame; wait for the SVG's brand background.
        if (pixels[sample + 3] !== 255 || pixels[sample + 2] !== 40 || pixels[sample + 1] !== 99 || pixels[sample] !== 67) return
        clearTimeout(deadline); resolve(raster)
      })
    })
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent;width:512px;height:512px">${svg}</body></html>`))
    const image = (await painted).resize({ width: 512, height: 512, quality: 'best' })
    await writeFile(join(root, 'assets/hromadaaid-server-manager.png'), image.toPNG())
    const sizes = [16, 24, 32, 48, 64, 128, 256]
    const frames = sizes.map(size => image.resize({ width: size, height: size, quality: 'best' }).toPNG())
    const header = Buffer.alloc(6 + frames.length * 16)
    header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4)
    let offset = header.length
    frames.forEach((frame, index) => {
      const entry = 6 + index * 16, size = sizes[index]
      header[entry] = header[entry + 1] = size === 256 ? 0 : size
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
      header.writeUInt32LE(frame.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
      offset += frame.length
    })
    await writeFile(join(root, 'assets/hromadaaid-server-manager.ico'), Buffer.concat([header, ...frames]))
    window.destroy()
    console.log('Manager PNG and multi-size ICO generated from the brand SVG; Client icons unchanged.')
  } finally { app.quit() } }).catch(error => { console.error(error); app.exit(1) })
}
