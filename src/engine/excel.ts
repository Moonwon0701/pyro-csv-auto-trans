import ExcelJS from 'exceljs'
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
 */
export async function buildXlsx(sheets: SheetModel[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Pyro CSV Organizer'
  wb.created = new Date()

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

/** 한글은 2칸으로 계산 */
function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 2 : 1
  return w
}
