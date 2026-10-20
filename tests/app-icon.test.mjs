import { pathToFileURL } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HeartHandshake } from 'lucide-react'

test('Icon assets reproduce the sidebar mark and include all required ICO frames',()=>{
 const svg=readFileSync('assets/hromadaaid.svg','utf8')
 const glyph=renderToStaticMarkup(React.createElement(HeartHandshake,{size:22,strokeWidth:2.1,color:'#fff',x:10,y:10}))
 assert.ok(svg.includes(glyph),'same Lucide geometry, stroke and spacing')
 assert.ok(svg.includes('rx="12" fill="#286343"'))
 const png=readFileSync('assets/hromadaaid.png')
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
 assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512)
 const ico=readFileSync('assets/hromadaaid.ico')
 assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7)
 const sizes=[]
 for(let i=0;i<7;i++) {
  const offset=6+i*16,width=ico[offset]||256,height=ico[offset+1]||256
  assert.equal(width,height);sizes.push(width)
  const bytes=ico.readUInt32LE(offset+8),start=ico.readUInt32LE(offset+12)
  assert.ok(start+bytes<=ico.length&&bytes>0)
 }
 assert.deepEqual(sizes,[16,24,32,48,64,128,256])
})
test('Dev/build resources and future Windows installer reference the same icon and application identity',()=>{
 const pkg=JSON.parse(readFileSync('package.json','utf8'))
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
 for(const extension of ['ico','png','svg'])assert.equal(hash('assets/hromadaaid.'+extension),hash('dist-electron/assets/hromadaaid.'+extension))
 const main=readFileSync('electron/main.ts','utf8')
 assert.ok(main.includes("app.setAppUserModelId('"+pkg.build.appId+"')"))
 assert.ok(main.includes("icon: join(iconDirectory,"))
 assert.ok(main.includes("app.isPackaged ? join(process.resourcesPath, 'assets') : join(currentDirectory, 'assets')"))
 assert.deepEqual(pkg.build.extraResources,[{from:'assets',to:'assets',filter:['hromadaaid.ico','hromadaaid.png','hromadaaid.svg']}])
 assert.equal(pkg.name,'hromada-aid');assert.equal(pkg.productName,undefined)
 assert.equal(pkg.build.win.target,'nsis')
 for(const path of [pkg.build.win.icon,pkg.build.nsis.installerIcon,pkg.build.nsis.uninstallerIcon,pkg.build.nsis.installerHeaderIcon])assert.ok(existsSync(path))
 assert.ok(pkg.build.files.includes('dist-electron/**/*'))
 assert.equal(pkg.build.nsis.shortcutName,'HromadaAID')
})
test('Actual Electron window exposes the branded small/title and large/taskbar icons in an isolated profile',{skip:process.env.HROMADA_TEST_ELECTRON_ICON!=='1',timeout:60000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'hromada-icon-test-'))
 let app,server
 t.after(async()=>{await app?.close();await server?.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
 const {createServer}=await import('vite')
 server=await createServer({server:{host:'127.0.0.1',port:5175,strictPort:true,open:false},clearScreen:false})
 await server.listen() // Never stop or replace an existing dev server.
 const runtime=process.env.HROMADA_PLAYWRIGHT_MODULE??join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
 const {_electron}=await import(pathToFileURL(runtime).href)
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='ELECTRON_RUN_AS_NODE'))
 app=await _electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('.')],cwd:resolve('.'),env:{...env,HROMADA_AID_TEST_DATA_DIR:root}})
 const page=await app.firstWindow()
 await page.waitForSelector('.brand-mark')
 const actual=await app.evaluate(({app,BrowserWindow})=>({profile:app.getPath('userData'),name:app.getName(),windows:BrowserWindow.getAllWindows().length,handle:BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString()}))
 assert.equal(resolve(actual.profile),resolve(root));assert.equal(actual.name,'hromada-aid');assert.equal(actual.windows,1)
 const ps=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
 const capture=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('tests/read-window-icons.ps1'),'-WindowHandle',actual.handle,'-OutputDirectory',root],{encoding:'utf8',windowsHide:true})
 assert.equal(capture.status,0,capture.stderr)
 const python=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
 const inspected=spawnSync(python,['-c',`
from PIL import Image,ImageChops,ImageStat
import sys,os
ico=Image.open(sys.argv[2])
for name in ['small','large']:
 actual=Image.open(os.path.join(sys.argv[1],name+'.png')).convert('RGBA')
 expected=ico.ico.getimage(actual.size).convert('RGBA')
 white=Image.new('RGBA',actual.size,'white')
 difference=ImageChops.difference(Image.alpha_composite(white,actual).convert('RGB'),Image.alpha_composite(white,expected).convert('RGB'))
 assert max(ImageStat.Stat(difference).mean)<5,(name,ImageStat.Stat(difference).mean)
 print(name,actual.size,'matches branded ICO')
`,root,resolve('assets/hromadaaid.ico')],{encoding:'utf8',windowsHide:true})
 assert.equal(inspected.status,0,inspected.stderr)
 console.log(inspected.stdout.trim())
})
