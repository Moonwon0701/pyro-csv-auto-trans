import ExcelJS from 'exceljs'
import type { GridCell, GridSheet } from './layout'
import type { SheetBlock, SheetModel } from './types'

/** 1행 제목, 2행 요약, 3행 헤더 */
export const HEADER_ROW = 3
export const EMPTY_TEXT = '해당 분류 데이터 없음'
const FILL_HEADER = 'FFD9E1F2'
const FILL_CONFLICT = 'FFFFFF00'
const FILL_MISSING = 'FFFFC000'
const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFBFBFBF' } }
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN }

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

/** 시트 전체를 표 하나로 볼 때 */
function wholeSheet(sheet: SheetModel): SheetBlock {
  return { label: '', columns: sheet.columns.map((_, i) => i), rows: sheet.rows.map((_, i) => i) }
}

/**
 * 모든 값은 문자열로 기록한다 (47A, 1F0, 앞자리 0 보존). CUE만 숫자.
 * blocks가 있으면 표마다 헤더를 달아 빈 줄 하나를 두고 위아래로 쌓는다.
 * grids(레이아웃·치구 배치도)는 맨 앞 시트로 넣는다.
 */
export async function buildXlsx(sheets: SheetModel[], grids: GridSheet[] = []): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Pyro CSV Organizer'
  wb.created = new Date()
  const usedNames = new Set(sheets.map((s) => s.name.toLowerCase()))
  for (const g of grids) addGrid(wb, g, usedNames)

  for (const sheet of sheets) {
    const blocks = sheet.blocks ?? [wholeSheet(sheet)]
    // 표가 여러 개면 맨 위 헤더를 고정하면 아래 표에서 열 이름이 틀리게 보인다
    const ySplit = sheet.plain ? 1 : blocks.length > 1 ? 0 : HEADER_ROW
    const ws = wb.addWorksheet(sheet.name, { views: ySplit ? [{ state: 'frozen', ySplit }] : [] })
    if (!sheet.plain) {
      ws.addRow([sheet.title]).getCell(1).font = { bold: true, size: 14 }
      ws.addRow([sheet.summary]).getCell(1).font = { italic: true, color: { argb: 'FF666666' } }
    }
    const border = sheet.plain ? undefined : BORDER
    const cueIsNumber = sheet.columns[0] === 'CUE'
    const widths: number[] = []
    const fit = (i: number, text: string) => (widths[i] = Math.min(60, Math.max(widths[i] ?? 6, displayWidth(text) + 2)))

    blocks.forEach((block, bi) => {
      if (bi > 0) ws.addRow([])
      const header = ws.addRow(block.columns.map((c) => sheet.columns[c]))
      header.eachCell((c, col) => {
        c.font = { bold: true }
        c.fill = solid(FILL_HEADER)
        c.alignment = { horizontal: 'center', vertical: 'middle' }
        if (border) c.border = border
        fit(col - 1, String(c.value ?? ''))
      })
      for (const r of block.rows) {
        const cells = block.columns.map((c) => sheet.rows[r][c])
        const row = ws.addRow(cells.map((c, i) => (i === 0 && cueIsNumber ? Number(c.value) : c.value)))
        cells.forEach((cell, i) => {
          const xc = row.getCell(i + 1)
          if (!(i === 0 && cueIsNumber)) xc.numFmt = '@'
          if (cell.flag === 'conflict') xc.fill = solid(FILL_CONFLICT)
          if (cell.flag === 'missing') xc.fill = solid(FILL_MISSING)
          if (border) xc.border = border
          fit(i, cell.value)
        })
      }
    })
    if (sheet.rows.length === 0 && !sheet.plain) ws.addRow([EMPTY_TEXT]).getCell(1).font = { color: { argb: 'FF999999' } }
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Uint8Array(buf as ArrayBuffer)
}

const GRID_STYLE: Record<NonNullable<GridCell['style']>, { font?: Partial<ExcelJS.Font>; fill?: string; border?: boolean; wrap?: boolean }> = {
  title: { font: { bold: true, size: 16 } },
  section: { font: { bold: true, size: 12 }, fill: 'FFFFE699' },
  header: { font: { bold: true }, fill: FILL_HEADER, border: true },
  control: { font: { bold: true, color: { argb: 'FF1F4E79' } } },
  pos: { font: { bold: true }, fill: 'FFFFD966', border: true },
  module: { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: 'FF3F3F3F', border: true },
  total: { border: true },
  note: { font: { color: { argb: 'FF666666' } } },
  slot: { border: true, wrap: true },
  'slot-field': { border: true, wrap: true, fill: 'FFF8CBAD' },
  'slot-estimated': { border: true, wrap: true, fill: FILL_MISSING }
}

/** 레이아웃 양식 글꼴 */
const GRID_FONT = '맑은 고딕'

/** 레이아웃·치구 배치도처럼 칸 위치를 직접 정하는 시트. 맨 앞에 넣는다 */
function addGrid(wb: ExcelJS.Workbook, grid: GridSheet, usedNames: Set<string>) {
  let name = grid.name
  for (let i = 2; usedNames.has(name.toLowerCase()); i++) name = `${grid.name} (${i})`
  usedNames.add(name.toLowerCase())
  const ws = wb.addWorksheet(
    name,
    grid.fitLandscape ? { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 } } : {}
  )
  for (const [c, w] of Object.entries(grid.widths ?? {})) ws.getColumn(Number(c)).width = w
  for (const [r, h] of Object.entries(grid.heights ?? {})) ws.getRow(Number(r)).height = h
  for (const cell of grid.cells) {
    const xc = ws.getCell(cell.row, cell.col)
    xc.value = cell.value
    xc.numFmt = '@'
    if (cell.format) {
      const f = cell.format
      xc.font = { name: GRID_FONT, size: f.size ?? 11, bold: f.bold, color: { argb: f.color ?? 'FF000000' } }
      if (f.fill) xc.fill = solid(f.fill)
      if (f.border) {
        xc.border = Object.fromEntries(
          Object.entries(f.border).map(([side, style]) => [side, { style, color: { argb: 'FF000000' } }])
        ) as Partial<ExcelJS.Borders>
      }
      xc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: f.wrap }
      continue
    }
    const st = cell.style ? GRID_STYLE[cell.style] : undefined
    xc.font = { name: GRID_FONT, ...(st?.font ?? {}) }
    if (!st) continue
    if (st.fill) xc.fill = solid(st.fill)
    if (st.border) xc.border = BORDER
    xc.alignment = { vertical: 'middle', horizontal: st.wrap || cell.style === 'module' || cell.style === 'pos' ? 'center' : undefined, wrapText: st.wrap }
  }
  for (const [r1, c1, r2, c2] of grid.merges ?? []) ws.mergeCells(r1, c1, r2, c2)
}

/** 한글은 2칸으로 계산 */
function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 2 : 1
  return w
}
