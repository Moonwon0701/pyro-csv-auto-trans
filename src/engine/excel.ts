import ExcelJS from 'exceljs'
import type { SheetModel } from './types'

/** 1행 제목, 2행 요약, 3행 헤더 */
export const HEADER_ROW = 3
export const EMPTY_TEXT = '해당 분류 데이터 없음'
const FILL_HEADER = 'FFD9E1F2'
const FILL_CONFLICT = 'FFFFFF00'
const FILL_MISSING = 'FFFFC000'

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

/** 모든 값은 문자열로 기록한다 (47A, 1F0, 앞자리 0 보존). CUE만 숫자 */
export async function buildXlsx(sheets: SheetModel[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Pyro CSV Organizer'
  wb.created = new Date()

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: sheet.plain ? 1 : HEADER_ROW }] })
    if (!sheet.plain) {
      ws.addRow([sheet.title]).getCell(1).font = { bold: true, size: 14 }
      ws.addRow([sheet.summary]).getCell(1).font = { italic: true, color: { argb: 'FF666666' } }
    }
    const header = ws.addRow(sheet.columns)
    header.eachCell((c) => {
      c.font = { bold: true }
      c.fill = solid(FILL_HEADER)
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    const widths = sheet.columns.map((h) => Math.max(6, displayWidth(h) + 2))
    const cueIsNumber = sheet.columns[0] === 'CUE'
    for (const cells of sheet.rows) {
      const row = ws.addRow(cells.map((c, i) => (i === 0 && cueIsNumber ? Number(c.value) : c.value)))
      cells.forEach((cell, i) => {
        const xc = row.getCell(i + 1)
        if (!(i === 0 && cueIsNumber)) xc.numFmt = '@'
        if (cell.flag === 'conflict') xc.fill = solid(FILL_CONFLICT)
        if (cell.flag === 'missing') xc.fill = solid(FILL_MISSING)
        widths[i] = Math.min(60, Math.max(widths[i], displayWidth(cell.value) + 2))
      })
    }
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
