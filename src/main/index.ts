import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import {
  assignAddresses,
  buildXlsx,
  listPositions,
  parseCsv,
  proposePlan,
  serializeCsv,
  transform,
  type AssignOptions,
  type LocalRules,
  type ParsedCsv,
  type Resolution,
  type TransformOptions
} from '../engine'
import { REPO_URL, RULES_EDIT_URL } from './config'
import { exportMergedRulesJson, getRules, loadRules, saveLocalRules } from './rules-store'
import { checkForUpdates, installUpdate } from './updates'

let win: BrowserWindow | null = null
let current: { path: string; csv: ParsedCsv } | null = null
/** 주소 매기기용 원본 */
let assignSource: { path: string; csv: ParsedCsv } | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: '불꽃쇼 CSV 자동 정리',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  const hash = process.env.PYRO_START_TAB ?? ''
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  win.webContents.once('did-finish-load', () => {
    checkForUpdates(win!)
    const argPath = process.argv.slice(1).find((a) => /\.(csv|txt)$/i.test(a) && existsSync(a))
    if (argPath) {
      if (hash === 'assign') {
        openAssignSource(argPath)
          .then((s) => win!.webContents.send('assign:opened', s))
          .catch(() => undefined)
      } else {
        try {
          win!.webContents.send('csv:opened', openCsv(argPath))
        } catch {
          /* 무시: 화면에서 다시 열 수 있음 */
        }
      }
    }
    // 개발용: PYRO_CAPTURE=경로.png 이면 화면을 캡처하고 종료
    const capture = process.env.PYRO_CAPTURE
    if (capture) {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage()
        writeFileSync(capture, img.toPNG())
        app.quit()
      }, Number(process.env.PYRO_CAPTURE_DELAY ?? 2500))
    }
  })
}

function openCsv(path: string) {
  const csv = parseCsv(readFileSync(path), basename(path))
  current = { path, csv }
  return { path, fileName: csv.fileName, encoding: csv.encoding, rows: csv.rows.length }
}

async function run(resolutions: Record<string, Resolution>, options: TransformOptions) {
  if (!current) throw new Error('CSV 파일을 먼저 불러오세요.')
  const { effective } = await getRules()
  return transform(current.csv, effective, resolutions, options)
}

ipcMain.handle('csv:pick', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'CSV 파일 선택',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }]
  })
  return r.canceled || !r.filePaths[0] ? null : openCsv(r.filePaths[0])
})

ipcMain.handle('csv:open', (_e, path: string) => openCsv(path))

ipcMain.handle('engine:run', (_e, resolutions: Record<string, Resolution>, options: TransformOptions) =>
  run(resolutions, options)
)

ipcMain.handle('excel:save', async (_e, resolutions: Record<string, Resolution>, options: TransformOptions) => {
  const result = await run(resolutions, options)
  if (result.analysis.blocked) throw new Error('해결되지 않은 항목이 있어 Excel을 만들 수 없습니다.')
  const src = current!.path
  const r = await dialog.showSaveDialog(win!, {
    title: 'Excel 저장',
    defaultPath: join(dirname(src), `${basename(src, extname(src))}_정리.xlsx`),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, await buildXlsx(result.sheets))
  return r.filePath
})

// ---- 1→2단계: 주소 매기기 ----
async function openAssignSource(path: string) {
  const csv = parseCsv(readFileSync(path), basename(path))
  assignSource = { path, csv }
  const { effective } = await getRules()
  const positions = listPositions(csv, effective)
  return { path, fileName: csv.fileName, encoding: csv.encoding, rows: csv.rows.length, positions }
}

ipcMain.handle('assign:pick', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: '주소를 매길 원본 CSV 선택',
    properties: ['openFile'],
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }]
  })
  return r.canceled || !r.filePaths[0] ? null : openAssignSource(r.filePaths[0])
})
ipcMain.handle('assign:open', (_e, path: string) => openAssignSource(path))
ipcMain.handle('assign:propose', async (_e, startModule: string) => {
  if (!assignSource) throw new Error('원본 CSV를 먼저 불러오세요.')
  const { effective } = await getRules()
  return proposePlan(listPositions(assignSource.csv, effective), startModule)
})

function runAssign(opts: AssignOptions) {
  if (!assignSource) throw new Error('원본 CSV를 먼저 불러오세요.')
  return assignAddresses(assignSource.csv, opts)
}
const addrFileName = (p: string) => `${basename(p, extname(p))}_ADDR.csv`

ipcMain.handle('assign:run', (_e, opts: AssignOptions) => {
  const { issues, blocked, summary } = runAssign(opts)
  return { issues, blocked, summary }
})
ipcMain.handle('assign:save', async (_e, opts: AssignOptions) => {
  const result = runAssign(opts)
  if (result.blocked) throw new Error('해결되지 않은 항목이 있어 저장할 수 없습니다.')
  const src = assignSource!.path
  const r = await dialog.showSaveDialog(win!, {
    title: '주소 매긴 CSV 저장',
    defaultPath: join(dirname(src), addrFileName(src)),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, serializeCsv(result.csv))
  return r.filePath
})
/** 주소 매긴 결과를 바로 변환 화면으로 넘긴다 */
ipcMain.handle('assign:toConvert', (_e, opts: AssignOptions) => {
  const result = runAssign(opts)
  if (result.blocked) throw new Error('해결되지 않은 항목이 있어 넘길 수 없습니다.')
  const src = assignSource!.path
  const csv = { ...result.csv, fileName: addrFileName(src) }
  current = { path: join(dirname(src), csv.fileName), csv }
  return { path: current.path, fileName: csv.fileName, encoding: csv.encoding, rows: csv.rows.length }
})

ipcMain.handle('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url)
})

ipcMain.handle('rules:get', () => getRules())
ipcMain.handle('rules:refresh', () => loadRules(true))
ipcMain.handle('rules:saveLocal', (_e, local: LocalRules) => saveLocalRules(local))
ipcMain.handle('rules:share', () => {
  clipboard.writeText(exportMergedRulesJson())
  shell.openExternal(RULES_EDIT_URL)
})

ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, repoUrl: REPO_URL }))
ipcMain.handle('update:install', () => installUpdate())

app.whenReady().then(() => {
  loadRules(true)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
