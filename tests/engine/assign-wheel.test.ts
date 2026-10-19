import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { assignAddresses, isJigPosition, listPositions, parseCsv, proposePlan, type RuleSet } from '../../src/engine'
import { detectColumns } from '../../src/engine/columns'

const RULES: RuleSet = JSON.parse(readFileSync(resolve(__dirname, '../../rules/rules.json'), 'utf8'))
const HEADER = 'CUE,HH,MM,SS,FF,ADDR,CONTROL,POS,TYPE,Effect Description'
const csvOf = (lines: string[]) => parseCsv(Buffer.from([HEADER, ...lines].join('\r\n')), 'raw.csv')

/** H1 휠 16개 위치에 2바퀴(32발) + H2 휠 위치 2개. 효과 이름은 시간과 반대 순서 */
function wheelLines(): string[] {
  const lines: string[] = []
  let cue = 1
  for (let lap = 0; lap < 2; lap++)
    for (let n = 1; n <= 16; n++) {
      const pos = `H1-${String(n).padStart(2, '0')}`
      lines.push(`${cue++},0,1,${10 + lap * 5},${n},,FC-01,${pos},single_shot,${lap === 0 ? 'Z mine' : 'A mine'}`)
    }
  lines.push(`${cue++},0,2,0,0,,FC-01,H2-02,single_shot,X`)
  lines.push(`${cue++},0,2,0,0,,FC-01,H2-01,single_shot,X`)
  return lines
}

describe('H군 (휠) 주소 규칙', () => {
  it('위치가 아니라 군(H1, H2)마다 한 줄로 묶는다', () => {
    const slots = listPositions(csvOf(wheelLines()), RULES)
    expect(slots.map((s) => `${s.pos}/${s.needed}/${s.wheel?.length}`)).toEqual(['H1-*/32/16', 'H2-*/2/2'])
  })

  it('군 안에서 먼저 나가는 약부터 16발씩 한 모듈 (효과순 설정과 상관없이), 군마다 새 모듈', () => {
    const csv = csvOf(wheelLines())
    const plan = proposePlan(listPositions(csv, RULES))
    expect(plan.map((p) => [p.pos, p.ranges, p.wheel])).toEqual([
      ['H1-*', '100-11F', true],
      ['H2-*', '120-121', true]
    ])
    const r = assignAddresses(csv, { sortMode: 'effect', plan })
    expect(r.blocked).toBe(false)
    const addr = r.csv.rows.map((row) => row[5])
    // 첫 바퀴(1~16번째) = 모듈 10, 둘째 바퀴(17~32번째) = 모듈 11
    expect(addr.slice(0, 16)).toEqual([...'0123456789ABCDEF'].map((p) => `10${p}`))
    expect(addr.slice(16, 32)).toEqual([...'0123456789ABCDEF'].map((p) => `11${p}`))
    // 동시에 나가면 위치 번호순
    expect(addr.slice(32)).toEqual(['121', '120'])
  })

  it('범위가 모듈 중간에서 시작해도 16발 묶음은 모듈 처음부터', () => {
    const csv = csvOf(wheelLines())
    const plan = proposePlan(listPositions(csv, RULES)).map((p) => (p.pos === 'H1-*' ? { ...p, ranges: '205' } : p))
    const r = assignAddresses(csv, { sortMode: 'time', plan })
    expect(r.csv.rows[0][5]).toBe('210')
    expect(r.csv.rows[16][5]).toBe('220')
  })

  it('기존 주소는 그대로 두고, 16발 묶음이 모듈에 걸치면 경고', () => {
    const lines = wheelLines()
    lines[31] = lines[31].replace(',,FC-01', ',105,FC-01')
    const csv = csvOf(lines)
    const r = assignAddresses(csv, { sortMode: 'time', plan: [{ control: 'FC-01', pos: 'H1-*', ranges: '100', wheel: true }] })
    expect(r.csv.rows[31][5]).toBe('105')
    expect(r.issues.map((i) => i.code)).toContain('WHEEL_SPLIT')
    expect(r.issues.map((i) => i.code)).not.toContain('RANGE_OVERLAP')
  })

  it('휠 위치는 치구 대상이 아니다', () => {
    expect(isJigPosition(RULES, 'H1-01')).toBe(false)
    expect(isJigPosition(RULES, 'S-01')).toBe(true)
  })
})

const GEOJE = resolve(__dirname, '../../samples/sets/시트정리 공유/260614 거제옥포대첩/NO ADDR.csv')
describe.skipIf(!existsSync(GEOJE))('거제 H군 샘플', () => {
  it('H1·H2 각각 64발 → 모듈 4개씩, 한 모듈 = 한 바퀴', () => {
    const csv = parseCsv(readFileSync(GEOJE), 'NO ADDR.csv')
    const r = assignAddresses(csv, { sortMode: 'effect', plan: proposePlan(listPositions(csv, RULES)) })
    const cols = detectColumns(r.csv.headers)
    const at = (row: string[], k: 'POS' | 'ADDR') => row[cols.get(k)!]
    for (const g of ['H1', 'H2']) {
      const rows = r.csv.rows.filter((row) => at(row, 'POS').startsWith(`${g}-`))
      const byModule = new Map<string, string[]>()
      for (const row of rows) {
        const m = at(row, 'ADDR').slice(0, 2)
        byModule.set(m, [...(byModule.get(m) ?? []), row[cols.get('POS')!]])
      }
      expect(rows).toHaveLength(64)
      expect(byModule.size).toBe(4)
      // 모듈마다 16개 위치를 한 번씩
      for (const positions of byModule.values()) expect(new Set(positions).size).toBe(16)
    }
  })
})
