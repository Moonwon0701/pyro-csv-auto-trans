import { existsSync, readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { damagedSeriesLines, excelForms, isExcelDamage, parseCsv, repairAddress, restoreCsv, splitCsv, type ParsedCsv } from '../../src/engine'

/** 엑셀로 열고 CSV로 다시 저장한 것처럼 바꾼다 */
function simulateExcel(csv: ParsedCsv): ParsedCsv {
  return { ...csv, encoding: 'CP949', rows: csv.rows.map((r) => r.map((v) => excelForms(v)[0] ?? v)) }
}

const csvOf = (text: string, name = 'show.csv') => parseCsv(new TextEncoder().encode(text), name)

const ORIGINAL = `CUE,HH,MM,SS,FF,Event Description,PFT,ADDR,CONTROL,POS,QTY,TYPE,Effect Description,TILT
0,00,00,08,17,,1.2,030,FC-01,S-01,2,single_shot,45mm comet,-60-60
1,00,00,08,17,,1.2,031,FC-01,S-01,3,single_shot,45mm comet,-75--45-75
2,00,00,08,17,,,1E5,FC-01,S-02,1,single_shot,45mm comet,90
3,01,00,03,08,,,10F,FC-02,3P-01,2,shell,3 peony,90-90
4,01,00,03,08,,,0AD,FC-02,S-03,2,single_shot,45mm comet,-40-40
5,01,00,03,08,R,,0A1,FC-02,C-01,1,cake,fan,90
`

describe('엑셀이 바꾸는 값', () => {
  it('excelForms', () => {
    expect(excelForms('-60-60')).toEqual(['-120'])
    expect(excelForms('-75--45-75')).toEqual(['-105'])
    expect(excelForms('-70--50-90-50-70')).toEqual(['-230'])
    expect(excelForms('030')).toEqual(['30'])
    expect(excelForms('00')).toEqual(['0'])
    expect(excelForms('1E5')).toEqual(['1.00E+05', '100000'])
    expect(excelForms('23000.0')).toEqual(['23000'])
    expect(excelForms('90-90')).toEqual([])
    expect(excelForms('0AD')).toEqual([])
    expect(excelForms('90')).toEqual([])
    expect(excelForms('')).toEqual([])
  })

  it('isExcelDamage는 사람이 고친 값을 손상으로 보지 않는다', () => {
    expect(isExcelDamage('-60-60', '-120')).toBe(true)
    expect(isExcelDamage('01', '0')).toBe(false) // HH 구간 이동
    expect(isExcelDamage('FC-01', 'FC-02')).toBe(false)
  })

  it('repairAddress', () => {
    expect(repairAddress('30')).toBe('030')
    expect(repairAddress('A')).toBe('00A')
    expect(repairAddress('1.00E+05')).toBe('1E5')
    expect(repairAddress('1F0')).toBe('1F0')
  })
})

describe('엑셀 손상 복원', () => {
  const original = csvOf(ORIGINAL)

  it('엑셀로 나누고 PFT를 지운 파일을 원본대로 되돌린다', () => {
    // 현장 작업 흉내: FC별로 나누고 PFT 열을 지운 뒤 엑셀로 저장
    const parts = splitCsv(original, { by: 'CONTROL', dropColumns: ['PFT'], resetHH: true })
    expect(parts.map((p) => p.key)).toEqual(['FC-01', 'FC-02'])
    for (const part of parts) {
      const damaged = simulateExcel(part.csv)
      expect(damagedSeriesLines(damaged).length).toBeGreaterThan(0)
      const r = restoreCsv([original], damaged)
      expect(r.matched).toBe(r.total)
      expect(r.unmatched).toEqual([])
      expect(r.csv.encoding).toBe('UTF-8')
      expect(r.csv.headers).not.toContain('PFT')
      // 엑셀이 바꾼 값은 원본으로, 나누면서 당긴 HH(01 → 00)는 그대로
      expect(r.csv.rows).toEqual(part.csv.rows)
      expect(damagedSeriesLines(r.csv)).toEqual([])
    }
  })

  it('원본에 주소가 없으면 주소 자릿수만 되돌린다', () => {
    const noAddr = csvOf(ORIGINAL.replace(/^(([^,]*,){7})[^,]*/gm, (m, a) => (m.startsWith('CUE') ? m : a)))
    const r = restoreCsv([noAddr], simulateExcel(original))
    const ai = r.csv.headers.indexOf('ADDR')
    expect(r.csv.rows.map((x) => x[ai])).toEqual(original.rows.map((x) => x[ai]))
    expect(r.fixes.find((f) => f.column === 'TILT')?.count).toBe(3)
  })

  it('원본에 없는 행은 그대로 두고 알린다', () => {
    const extra = csvOf(ORIGINAL + '9,00,00,59,00,,,050,FC-01,S-09,2,single_shot,new item,-120\n')
    const r = restoreCsv([original], extra)
    expect(r.unmatched).toEqual([8])
    expect(r.issues.map((i) => i.code)).toEqual(['RESTORE_UNMATCHED', 'RESTORE_STILL_DAMAGED'])
  })
})

/** 디자인 원본(RAW)과 그걸 주소 매긴 뒤 엑셀로 저장한 ADD (samples/는 git 제외, 없으면 건너뜀) */
const REAL = ['25방위', '25하이원_8월', '25하이원_12월']
  .map((d) => ({ name: d, raw: `samples/data/${d}/RAW.csv`, add: `samples/data/${d}/ADD.csv` }))
  .filter((c) => existsSync(c.raw) && existsSync(c.add))

describe.skipIf(REAL.length === 0)('실제 파일: 디자인 원본으로 엑셀 저장본 복원', () => {
  for (const c of REAL) {
    it(c.name, () => {
      const raw = parseCsv(readFileSync(c.raw), 'RAW.csv')
      const add = parseCsv(readFileSync(c.add), 'ADD.csv')
      expect(damagedSeriesLines(add).length).toBeGreaterThan(0)
      const r = restoreCsv([raw], add)
      expect(r.matched).toBe(r.total)
      expect(damagedSeriesLines(r.csv)).toEqual([])
      // 같은 CUE의 원본 TILT와 같아야 한다
      const col = (csv: ParsedCsv, h: string) => csv.headers.indexOf(h)
      const rawTilt = new Map(raw.rows.map((x) => [x[col(raw, 'CUE')], x[col(raw, 'TILT')]]))
      for (const row of r.csv.rows) expect(row[col(r.csv, 'TILT')]).toBe(rawTilt.get(row[col(r.csv, 'CUE')]))
    })
  }
})
