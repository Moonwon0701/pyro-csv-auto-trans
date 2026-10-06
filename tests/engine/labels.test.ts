import { existsSync, readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildLabelSheets, buildXlsx, parseCsv, type RuleSet, type SheetModel } from '../../src/engine'
import { firstSheetCells } from '../helpers/xlsx-cells'

const RULES: RuleSet = JSON.parse(readFileSync('rules/rules.json', 'utf8'))
const csvOf = (text: string) => parseCsv(new TextEncoder().encode(text), '260725 울주 테스트.csv')

const HEAD = 'CUE,HH,MM,SS,FF,Event Description,ADDR,POS,QTY,TYPE,DUR,Effect Description,CUSTOM1,CUSTOM2,CUSTOM3,TILT'
const SAMPLE = `${HEAD}
0,00,00,01,00,,30,S-01,2,single_shot,229,b comet,,,,-60-60
1,00,00,01,00,,031,S-02,1,single_shot,229,b comet,,,,90
2,00,00,01,00,,032,S-03,1,single_shot,229,b comet,,,,-30
3,00,00,02,00,,033,S-03,1,mine,215,a mine,,,,70
4,00,00,03,00,R,704,C-01,1,cake,18,sparkler,,,,90
5,00,00,03,00,,705,C-01,1,cake,1600,jewels,,,,-75
6,00,00,03,00,,707,C-01,3,cake,3000,candle,,,,-50-90-50
7,00,00,04,00,,300,3P-01,1,shell,115,3 peony,,,,90
8,00,00,04,00,,301,3P-01,2,shell,115,3 peony,,,,90-90
9,00,00,05,00,chain,36F,3P-03,5,shell,1200,3 purple,,,,90-90-90-90-90
`

const col = (s: SheetModel, h: string) => s.columns.indexOf(h)
const pick = (s: SheetModel, ...hs: string[]) => s.rows.map((r) => hs.map((h) => r[col(s, h)].value).join('|'))

describe('라벨 시트', () => {
  const r = buildLabelSheets(csvOf(SAMPLE), RULES)
  const sheet = (name: string) => r.sheets.find((s) => s.name === name)!

  it('시트 구성과 장수', () => {
    expect(r.sheets.map((s) => s.name)).toEqual(['260725 울주 테스트', '타상', '연발', '단발'])
    expect(r.sheets.every((s) => s.plain)).toBe(true)
    expect(r.counts).toEqual([
      { category: '타상', sourceRows: 3, labels: 3 },
      { category: '연발', sourceRows: 3, labels: 5 },
      { category: '단발', sourceRows: 4, labels: 5 }
    ])
    expect(r.issues).toEqual([])
  })

  it('타상: 직렬은 2직, 체인은 간격 초', () => {
    expect(pick(sheet('타상'), 'ADDR', 'Effect Description')).toEqual(['300|3 peony', '301|3 peony 2직', '36F|3 purple 3초 체인'])
  })

  it('연발: 직렬 캔들을 펼치고, 수직 한 발 케이크는 비우고, R은 START_R', () => {
    expect(pick(sheet('연발'), 'ADDR', 'Effect Description', 'QTY', 'CUSTOM1', 'CUSTOM2', 'CUSTOM3')).toEqual([
      '707|candle|3|-50||',
      '707|candle|3|||50',
      '707|candle|3||90|',
      '705|jewels|1|-75||',
      '704|sparkler|1||(START_R)|'
    ])
  })

  it('단발: 제품 → 각도(왼쪽 → 오른쪽 → 수직) → 주소, 주소는 3자리', () => {
    expect(pick(sheet('단발'), 'ADDR', 'Effect Description', 'CUSTOM1', 'CUSTOM2', 'CUSTOM3')).toEqual([
      '033|a mine|||70',
      '030|b comet|-60||',
      '032|b comet|-30||',
      '030|b comet|||60',
      '031|b comet||90|'
    ])
  })

  it('엑셀로 계산된 직렬 TILT는 경고', () => {
    const damaged = buildLabelSheets(csvOf(SAMPLE.replace('-60-60', '-120')), RULES)
    expect(damaged.issues.map((i) => i.code)).toEqual(['LABEL_TILT_DAMAGED'])
  })

  it('엑셀로 쓰면 ADDR 앞자리 0과 시트 이름이 남는다', async () => {
    const cells = await firstSheetCells(await buildXlsx(r.sheets), '단발')
    expect(cells.get('A1')).toBe('CUE')
    expect(cells.get('G2')).toBe('033')
  })
})

/** 울주 라벨작업 (2026-10-06 샘플). CSV의 직렬 TILT는 이미 엑셀로 깨져 있어 한 발짜리 행만 값까지 비교한다 */
const U = 'samples/2026-10-06-02'
const U_CSV = `${U}/260725 울주 다이어트 2차.csv`
const U_XLSX = `${U}/260725 울주 라벨작업.xlsx`

describe.skipIf(!existsSync(U_CSV) || !existsSync(U_XLSX))('울주 라벨작업 재현', () => {
  const LETTERS = (n: number) => (n < 26 ? String.fromCharCode(65 + n) : 'A' + String.fromCharCode(65 + n - 26))
  async function humanRows(name: string) {
    const cells = await firstSheetCells(readFileSync(U_XLSX), name)
    const head: string[] = []
    for (let c = 0; cells.has(`${LETTERS(c)}1`); c++) head.push(cells.get(`${LETTERS(c)}1`)!)
    const rows: Record<string, string>[] = []
    for (let r = 2; cells.has(`A${r}`); r++) rows.push(Object.fromEntries(head.map((h, c) => [h, cells.get(`${LETTERS(c)}${r}`) ?? ''])))
    return rows
  }
  const KEY = ['POS', 'Effect Description', 'CUSTOM1', 'CUSTOM2', 'CUSTOM3', 'QTY']
  const key = (o: Record<string, string>) => KEY.map((k) => o[k] ?? '').join('|')

  for (const name of ['타상', '연발', '단발'] as const) {
    it(name, async () => {
      const ours = buildLabelSheets(parseCsv(readFileSync(U_CSV), 'u.csv'), RULES).sheets.find((s) => s.name === name)!
      const human = await humanRows(name)
      expect(ours.rows.length).toBe(human.length)
      const asObj = ours.rows.map((r) => Object.fromEntries(ours.columns.map((h, i) => [h, r[i].value])))
      // 사람은 직렬을 원래 각도로 적었고 우리는 깨진 TILT라 추정값이다. 한 발짜리만 비교
      const single = (o: Record<string, string>) => (Number(o.QTY) || 1) === 1
      const count = (rows: Record<string, string>[]) => {
        const m = new Map<string, number>()
        for (const o of rows.filter(single)) m.set(key(o), (m.get(key(o)) ?? 0) + 1)
        return m
      }
      const expected = count(human)
      const actual = count(asObj)
      // 사람이 케이크 하나를 -75 대신 -15(기운 정도)로 적은 것은 TILT 그대로 쓰기로 했다 (2026-10-06)
      const humanOnly = [...expected].filter(([k, n]) => (actual.get(k) ?? 0) !== n).map(([k]) => k)
      expect(humanOnly).toEqual(name === '연발' ? ['C-01|19shot crown jewels|-15|||1', 'C-05|19shot crown jewels|||15|1'] : [])
      // 타상 붙임말 (2직, 3초 체인)
      if (name === '타상') expect(asObj.map((o) => o['Effect Description']).sort()).toEqual(human.map((o) => o['Effect Description']).sort())
      // 단발: 주소 3자리
      if (name === '단발') expect(asObj.filter(single).map((o) => o.ADDR).sort()).toEqual(human.filter(single).map((o) => o.ADDR).sort())
    })
  }
})
