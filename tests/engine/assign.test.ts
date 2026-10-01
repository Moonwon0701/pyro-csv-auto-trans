import { describe, expect, it } from 'vitest'
import {
  addressToIndex,
  assignAddresses,
  indexToAddress,
  listPositions,
  normalizeAddress,
  parseCsv,
  parseRanges,
  proposePlan,
  type RuleSet
} from '../../src/engine'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const RULES: RuleSet = JSON.parse(readFileSync(resolve(__dirname, '../../rules/rules.json'), 'utf8'))
const HEADER = 'CUE,HH,MM,SS,FF,ADDR,CONTROL,POS,TYPE,Effect Description'
const csvOf = (lines: string[]) => parseCsv(Buffer.from([HEADER, ...lines].join('\r\n')), 'raw.csv')
const addrOf = (csv: ReturnType<typeof csvOf>) => csv.rows.map((r) => r[5])

describe('FM-A 주소', () => {
  it('모듈 00과 xE는 건너뛴다', () => {
    expect(indexToAddress(0)).toBe('010')
    expect(indexToAddress(addressToIndex('0DF')! + 1)).toBe('0F0')
    expect(indexToAddress(addressToIndex('2DF')! + 1)).toBe('2F0')
    expect(addressToIndex('0E0')).toBeNull()
    expect(addressToIndex('000')).toBeNull()
  })
  it('엑셀이 앞자리 0을 지운 주소도 인식 (28 → 028)', () => {
    expect(normalizeAddress('28')).toBe('028')
    expect(normalizeAddress('1f0')).toBe('1F0')
  })
  it('범위 파싱', () => {
    expect(parseRanges('210-22F, 110').ranges.map((r) => [indexToAddress(r.start), r.end === null ? null : indexToAddress(r.end)])).toEqual([
      ['210', '22F'],
      ['110', null]
    ])
    expect(parseRanges('2E0').errors).toHaveLength(1)
  })
})

describe('주소 배정', () => {
  const lines = [
    '1,0,0,10,0,,FC-01,3P-01,shell,B red',
    '2,0,0,20,0,,FC-01,3P-01,shell,A blue',
    '3,0,0,30,0,,FC-01,3P-01,shell,b red',
    '4,0,0,40,0,,FC-01,3P-02,shell,A blue',
    '5,0,0,50,0,,FC-02,S-01,single_shot,X'
  ]

  it('효과순: Effect 알파벳순(대소문자 무시) → 시간순', () => {
    const r = assignAddresses(csvOf(lines), { sortMode: 'effect', plan: [{ control: 'FC-01', pos: '3P-01', ranges: '210' }] })
    expect(addrOf(r.csv).slice(0, 3)).toEqual(['211', '210', '212'])
  })

  it('시간순', () => {
    const r = assignAddresses(csvOf(lines), { sortMode: 'time', plan: [{ control: 'FC-01', pos: '3P-01', ranges: '210' }] })
    expect(addrOf(r.csv).slice(0, 3)).toEqual(['210', '211', '212'])
  })

  it('이미 있는 주소는 유지하고 겹치지 않게 추가', () => {
    const withExisting = [...lines]
    withExisting[1] = '2,0,0,20,0,211,FC-01,3P-01,shell,A blue'
    const r = assignAddresses(csvOf(withExisting), { sortMode: 'time', plan: [{ control: 'FC-01', pos: '3P-01', ranges: '210' }] })
    expect(addrOf(r.csv).slice(0, 3)).toEqual(['210', '211', '212'])
  })

  it('범위가 모자라면 Blocking', () => {
    const r = assignAddresses(csvOf(lines), { sortMode: 'time', plan: [{ control: 'FC-01', pos: '3P-01', ranges: '210-211' }] })
    expect(r.blocked).toBe(true)
  })

  it('여러 범위를 이어서 사용 (S-01 = 01F, 110~)', () => {
    const r = assignAddresses(csvOf(lines), { sortMode: 'time', plan: [{ control: 'FC-01', pos: '3P-01', ranges: '21F-21F, 110' }] })
    expect(addrOf(r.csv).slice(0, 3)).toEqual(['21F', '110', '111'])
  })

  it('자동 제안: 기본은 Control별로 10부터 (앞자리 0 주소를 피함)', () => {
    const slots = listPositions(csvOf(lines), RULES)
    expect(proposePlan(slots).map((p) => p.ranges)).toEqual(['100-102', '110-110', '100-100'])
  })

  it('자동 제안: 시작 모듈 01, 위치마다 새 모듈', () => {
    const slots = listPositions(csvOf(lines), RULES)
    expect(slots.map((s) => `${s.control}/${s.pos}/${s.needed}`)).toEqual(['FC-01/3P-01/3', 'FC-01/3P-02/1', 'FC-02/S-01/1'])
    expect(proposePlan(slots, '01').map((p) => p.ranges)).toEqual(['010-012', '020-020', '010-010'])
    const r = assignAddresses(csvOf(lines), { sortMode: 'time', plan: proposePlan(slots, '01') })
    expect(r.blocked).toBe(false)
    expect(addrOf(r.csv)).toEqual(['010', '011', '012', '020', '010'])
  })

  it('ADDR 컬럼이 없으면 추가', () => {
    const csv = parseCsv(Buffer.from('CUE,POS,Effect Description\r\n1,3P-01,A'), 'x.csv')
    const r = assignAddresses(csv, { sortMode: 'time', plan: [{ control: '', pos: '3P-01', ranges: '100' }] })
    expect(r.csv.headers.at(-1)).toBe('ADDR')
    expect(r.csv.rows[0].at(-1)).toBe('100')
  })
})

describe('튜토리얼 샘플', () => {
  it('자동 배정 → 시트 정리까지 막힘 없이 진행되고, 7P만 미등록으로 묻는다', async () => {
    const { transform, DEFAULT_OPTIONS } = await import('../../src/engine')
    const raw = parseCsv(readFileSync(resolve(__dirname, '../../resources/tutorial-sample.csv')), 'tutorial.csv')
    const assigned = assignAddresses(raw, { sortMode: 'effect', plan: proposePlan(listPositions(raw, RULES)) })
    expect(assigned.blocked).toBe(false)
    expect(assigned.issues).toEqual([])
    const before = transform(assigned.csv, RULES, {}, DEFAULT_OPTIONS)
    expect(before.analysis.prefixMappings.filter((m) => m.status === 'unknown').map((m) => m.prefix)).toEqual(['7P'])
    const after = transform(assigned.csv, RULES, { '7P': '타상' }, DEFAULT_OPTIONS)
    expect(after.analysis.blocked).toBe(false)
    expect(after.sheets.map((s) => s.name)).toEqual(['FC-01 타상', 'FC-01 연발', 'FC-01 단발', 'FC-02 타상', 'FC-02 연발', 'FC-02 단발'])
    expect(after.analysis.issues.filter((i) => i.severity !== 'info')).toEqual([])
  })
})
