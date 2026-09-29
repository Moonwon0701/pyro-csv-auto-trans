/**
 * 사람이 만든 LAYOUT.xlsx와 우리 레이아웃의 모듈 칸("36F", "3FF (19)")을 비교한다 (samples/는 git 제외, 없으면 건너뜀).
 * 열 위치는 파일마다 달라서 칸 글자 목록만 본다. 모듈을 옆 위치와 나눠 쓰는 LINK 등 수작업 흔적은 재현하지 않는다.
 */
import ExcelJS from 'exceljs'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import {
  buildXlsx,
  DEFAULT_JIG_SETTINGS,
  DEFAULT_OPTIONS,
  extraSheets,
  layoutLines,
  layoutSheet,
  parseCsv,
  planJigs,
  transform,
  type RuleSet
} from '../../src/engine'
import { firstSheetCells } from '../helpers/xlsx-cells'

const S = 'samples/sets/시트정리 공유'
const RULES: RuleSet = JSON.parse(readFileSync('rules/rules.json', 'utf8'))
const CASES = [
  { name: '통영', dir: '260314 통영요트폐막', min: 0.9 },
  { name: '거제', dir: '260614 거제옥포대첩', min: 0.9 },
  { name: '울주', dir: '260725 울주해양레포츠', min: 0.9 },
  { name: '퐁피두', dir: '260904 퐁피두', min: 0.9 }
].filter((c) => existsSync(`${S}/${c.dir}`))
const LABEL = /^[0-9A-F]{3}(?: \(\d+\))?$/

function multisetDiff(a: string[], b: string[]) {
  const count = new Map<string, number>()
  for (const x of b) count.set(x, (count.get(x) ?? 0) + 1)
  const missing: string[] = []
  for (const x of a) {
    const n = count.get(x) ?? 0
    if (n > 0) count.set(x, n - 1)
    else missing.push(x)
  }
  const extra = [...count].flatMap(([x, n]) => Array(n).fill(x))
  return { missing, extra }
}

describe.skipIf(CASES.length === 0)('레이아웃: 사람이 만든 LAYOUT 재현', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const files = readdirSync(`${S}/${c.dir}`)
      const layout = files.find((f) => /LAYOUT/i.test(f))!
      const cells = await firstSheetCells(readFileSync(`${S}/${c.dir}/${layout}`))
      // 발수 합계("101 | 발", "141 | EA", 오른쪽 발수 열)는 모듈 칸과 모양이 같아서 뺀다
      const colOf = (ref: string) => ref.match(/^[A-Z]+/)![0]
      const right = (ref: string) => {
        const [, col, row] = ref.match(/^([A-Z]+)(\d+)$/)!
        const n = [...col].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) + 1
        let s = ''
        for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
        return cells.get(`${s}${row}`)
      }
      const totalCols = new Set([...cells].filter(([, v]) => v === '발수').map(([ref]) => colOf(ref)))
      const expected = [...cells]
        .filter(([ref, v]) => LABEL.test(v) && !['발', 'EA'].includes(right(ref) ?? '') && !totalCols.has(colOf(ref)))
        .map(([, v]) => v)
      // 5S·10P처럼 Rule에 없는 타상 접두어는 화면에서 사용자가 고르는 것과 같게 타상으로
      const resolutions = { '5S': '타상', '8P': '타상', '10P': '타상', G: '단발' } as const
      const lines = files
        .filter((f) => /^FC-\d+\.csv$/i.test(f))
        .flatMap((f) => layoutLines(parseCsv(readFileSync(`${S}/${c.dir}/${f}`), f), RULES, resolutions))
      // 눈으로 비교할 때: PYRO_DUMP_DIR=폴더 → 샘플마다 우리 LAYOUT.xlsx
      if (process.env.PYRO_DUMP_DIR) writeFileSync(`${process.env.PYRO_DUMP_DIR}/${c.name}_LAYOUT.xlsx`, await buildXlsx([], [layoutSheet(c.name, lines)]))
      const ours = lines.flatMap((l) => l.positions.flatMap((p) => p.modules.map((m) => m.label)))
      const { missing, extra } = multisetDiff(expected, ours)
      const rate = 1 - missing.length / expected.length
      console.log(`${c.name}: 모듈 칸 ${expected.length}개 중 ${expected.length - missing.length}개 일치 (${(rate * 100).toFixed(1)}%)`)
      if (missing.length) console.log(`  레이아웃에만: ${missing.join(', ')}`)
      if (extra.length) console.log(`  우리에게만: ${extra.join(', ')}`)
      expect(rate).toBeGreaterThanOrEqual(c.min)
    })
  }
})

const GEOJE = `${S}/260614 거제옥포대첩/FC-02.csv`
describe.skipIf(!existsSync(GEOJE))('Excel: LAYOUT·치구 배치도 시트', () => {
  const resolutions = { G: '단발', CF: '연발', H1: '단발', H2: '단발' } as const
  it('② 치구 배치를 거친 파일이면 LAYOUT·치구 배치도가 맨 앞에 들어간다', async () => {
    const arranged = planJigs(parseCsv(readFileSync(GEOJE), 'FC-02.csv'), RULES).csv
    const { grids, notes } = extraSheets(arranged, RULES, resolutions, DEFAULT_JIG_SETTINGS, { layout: true, jig: true, title: '거제' })
    expect(notes).toEqual([])
    const { sheets } = transform(arranged, RULES, resolutions, DEFAULT_OPTIONS)
    const bytes = await buildXlsx(sheets, grids)
    // 눈으로 확인할 때: PYRO_DUMP=경로.xlsx
    if (process.env.PYRO_DUMP) writeFileSync(process.env.PYRO_DUMP, bytes)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name).slice(0, 2)).toEqual(['LAYOUT', '치구 배치도'])
    const layout: string[] = []
    wb.getWorksheet('LAYOUT')!.eachRow((r) => r.eachCell((c) => layout.push(String(c.value))))
    expect(layout).toContain('S-05')
    // 치구 수는 이전 양식을 깨지 않게 오른쪽 요약 열(단발 줄의 비어 있던 발수 칸)에만
    expect(layout.some((v) => /^치구 \d+$/.test(v))).toBe(true)
    expect(layout).toContain('관객')
  })
  it('치구 배치를 거치지 않은 파일이면 배치도는 빼고 알린다', () => {
    const raw = parseCsv(readFileSync(GEOJE), 'FC-02.csv')
    const { grids, notes } = extraSheets(raw, RULES, resolutions, DEFAULT_JIG_SETTINGS, { layout: true, jig: true, title: '거제' })
    expect(grids.map((g) => g.name)).toEqual(['LAYOUT'])
    expect(notes).toHaveLength(1)
  })
})
