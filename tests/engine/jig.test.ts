import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  assignAddresses,
  assignWithJigs,
  DEFAULT_JIG_SETTINGS,
  jigModuleNeeds,
  leanOf,
  listPositions,
  parseCsv,
  parseTilts,
  placeInGrid,
  planJigs,
  proposePlan,
  segment,
  type RuleSet
} from '../../src/engine'

const RULES: RuleSet = JSON.parse(readFileSync(resolve(__dirname, '../../rules/rules.json'), 'utf8'))
const HEADER = 'CUE,HH,MM,SS,FF,ADDR,CONTROL,POS,QTY,TYPE,Effect Description,TILT'
const csvOf = (lines: string[]) => parseCsv(Buffer.from([HEADER, ...lines].join('\r\n')), 'addr.csv')
/** S-01에 단발 n개 (주소 010부터 연속) */
const singles = (n: number, tilt: (i: number) => number, pos = 'S-01', start = 1) =>
  Array.from({ length: n }, (_, i) => {
    const idx = start * 16 + i
    const addr = `${Math.floor(idx / 16).toString(16).toUpperCase().padStart(2, '0')}${(idx % 16).toString(16).toUpperCase()}`
    return `${i},0,0,${i},0,${addr},FC-01,${pos},1,single_shot,E${i},${tilt(i)}`
  })

describe('TILT 해석', () => {
  it('발별 각도: 숫자 바로 뒤의 - 만 구분자', () => {
    expect(parseTilts('-75--45-75', 3)).toEqual({ tilts: [-75, -45, 75], estimated: false })
    expect(parseTilts('-60-60-90', 3)).toEqual({ tilts: [-60, 60, 90], estimated: false })
    expect(parseTilts('30', 1)).toEqual({ tilts: [30], estimated: false })
    expect(parseTilts('', 2)).toEqual({ tilts: [90, 90], estimated: false })
  })
  it('엑셀이 계산해 버린 직렬 각도(-40-40 → -80)는 평균으로 추정', () => {
    expect(parseTilts('-80', 2)).toEqual({ tilts: [-40, -40], estimated: true })
    expect(parseTilts('-110', 3)).toEqual({ tilts: [-37, -37, -37], estimated: true })
    // 90-90 → 0: 평균이 30° 미만이면 수직으로
    expect(parseTilts('0', 2)).toEqual({ tilts: [90, 90], estimated: true })
  })
})

describe('모듈·치구 나누기', () => {
  it('모듈은 16핀·20발 이하, 이어지는 모듈은 20발 안에서 한 치구', () => {
    const s = segment([...Array(16).fill(1), 3, 3], 20, { priority: 'module', allowSpan: false })
    expect(s.modules.map((m) => m.length)).toEqual([16, 2])
    expect(s.jigs.map((j) => j.length)).toEqual([16, 2])
  })
  it('직렬이 많으면 16핀을 못 채우고 20발에서 끊는다 (거제 S-05 47번 모듈)', () => {
    const s = segment([1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3], 20, { priority: 'module', allowSpan: false })
    expect(s.modules.map((m) => m.length)).toEqual([11, 2])
  })
  it('걸침 허용: 치구는 20발씩, 모듈은 16핀씩', () => {
    const s = segment(Array(40).fill(1), 20, { priority: 'module', allowSpan: true })
    expect(s.jigs.map((j) => j.length)).toEqual([20, 20])
    expect(s.modules.map((m) => m.length)).toEqual([16, 16, 8])
  })
})

describe('치구 칸 배치', () => {
  it('기운 정도: 바닥 기준 각도를 수직 기준으로', () => {
    expect([-30, -75, 90, 75, 30].map(leanOf)).toEqual([-60, -15, 0, 15, 60])
  })
  it('줄마다 왼쪽부터 기운 정도 오름차순, 줄마다 부채꼴이 되게 번갈아 나눈다', () => {
    const tilts = [30, 45, 60, 75, 90, 90, 90, 90, -75, -60, -45, -30]
    const grid = placeInGrid(tilts.map((tilt, cue) => ({ cue, shot: 1, tilt })), 4, 5)
    for (const row of grid) {
      const lean = row.filter(Boolean).map((s) => leanOf(s!.tilt))
      expect(lean).toEqual([...lean].sort((a, b) => a - b))
    }
    // 첫 줄: 가장 왼쪽으로 누운 것, 수직, 오른쪽
    expect(grid[0].map((s) => s?.tilt ?? null)).toEqual([-30, 90, 75, null, null])
  })
})

describe('치구 배치: 주소 재배정', () => {
  it('각도순으로 핀을 다시 매기고 다른 위치·cake은 그대로 둔다', () => {
    const lines = [
      ...singles(3, (i) => [90, -30, 45][i]),
      '9,0,1,0,0,030,FC-01,S-01,1,cake,CAKE,90',
      '10,0,1,0,0,020,FC-01,3P-01,1,shell,SHELL,90'
    ]
    const r = planJigs(csvOf(lines), RULES)
    expect(r.blocked).toBe(false)
    // 기운 정도: 90 → 0, -30 → -60, 45 → 45 → 핀 순서는 -30, 90, 45
    expect(r.csv.rows.map((x) => x[5])).toEqual(['011', '010', '012', '030', '020'])
    expect(r.positions).toHaveLength(1)
    expect(r.positions[0].jigs[0].grid[0][0]!.tilt).toBe(-30)
  })

  it('20발이 넘으면 바로 다음 빈 모듈을 이어 쓴다 (이어지는 모듈이면 따로 알리지 않음)', () => {
    // 16핀 중 직렬 2발짜리가 섞여 20발을 넘는다
    const lines = singles(16, () => 90).map((l, i) => (i < 6 ? l.replace(',S-01,1,', ',S-01,2,').replace(/,90$/, ',90-90') : l))
    const r = planJigs(csvOf(lines), RULES)
    expect(r.positions[0].modules.map((m) => m.module)).toEqual(['01', '02'])
    expect(r.positions[0].addedModules).toEqual(['02'])
    expect(r.positions[0].fieldWiring).toEqual([])
    expect(r.issues.map((i) => i.code)).not.toContain('JIG_MODULE_ADDED')
  })

  it('기본은 현장 결선 0, 걸침 허용이면 걸친 핀을 현장 결선으로 표시', () => {
    const lines = singles(24, () => 90)
    const strict = planJigs(csvOf(lines), RULES)
    expect(strict.positions[0].jigs).toHaveLength(2)
    expect(strict.positions[0].fieldWiring).toEqual([])
    const span = planJigs(csvOf(lines), RULES, { ...DEFAULT_JIG_SETTINGS, allowSpan: true })
    expect(span.positions[0].jigs.map((j) => j.shells)).toEqual([20, 4])
    // 2번 모듈(8핀)은 1번 치구에 4발, 2번 치구에 4발 → 한쪽 4핀이 현장 결선
    expect(span.positions[0].fieldWiring).toHaveLength(4)
  })

  it('① 자동 배정이 ② 치구 배치에 필요한 모듈을 비워 둬서 멀리 있는 모듈을 끌어오지 않는다', () => {
    // S-01: 16핀인데 직렬 때문에 22발 → 모듈 2개 필요. S-02는 그 다음 모듈부터
    const raw = [
      ...Array.from({ length: 16 }, (_, i) => `${i},0,0,${i},0,,FC-01,S-01,${i < 6 ? 2 : 1},single_shot,E${i},${i < 6 ? '90-90' : '90'}`),
      '99,0,1,0,0,,FC-01,S-02,1,single_shot,X,90'
    ]
    const csv = csvOf(raw)
    const plan = proposePlan(listPositions(csv, RULES), '01', jigModuleNeeds(csv, RULES))
    expect(plan.map((p) => p.ranges)).toEqual(['010-01F', '030-030'])
    const assigned = assignAddresses(csv, { sortMode: 'effect', plan }).csv
    const r = planJigs(assigned, RULES)
    // 비워 둔 바로 다음 모듈(02)을 쓴다. S-02(03)와 겹치지 않는다
    expect(r.positions[0].modules.map((m) => m.module)).toEqual(['01', '02'])
    expect(r.positions[1].modules.map((m) => m.module)).toEqual(['03'])
  })

  it('① 주소 매기기: 단발은 치구 배치 순서로, 타상은 고른 순서로, 기존 주소가 있던 단발 위치는 그대로', () => {
    const raw = [
      '1,0,0,1,0,,FC-01,S-01,1,single_shot,A,90',
      '2,0,0,2,0,,FC-01,S-01,1,single_shot,B,-30',
      '3,0,0,3,0,,FC-01,S-01,1,single_shot,C,45',
      '4,0,0,4,0,,FC-01,3P-01,1,shell,B,90',
      '5,0,0,5,0,,FC-01,3P-01,1,shell,A,90',
      '6,0,0,6,0,050,FC-01,S-02,1,single_shot,X,90',
      '7,0,0,7,0,051,FC-01,S-02,1,single_shot,Y,-30'
    ]
    const csv = csvOf(raw)
    const plan = proposePlan(listPositions(csv, RULES), '01', jigModuleNeeds(csv, RULES))
    const r = assignWithJigs(csv, { sortMode: 'effect', plan }, RULES)
    expect(r.blocked).toBe(false)
    const addr = r.csv.rows.map((x) => x[5])
    // 자동 제안은 타상부터: 3P-01 = 모듈 01, S-01 = 모듈 02
    // S-01: -30(B) → 90(A) → 45(C)  /  3P-01: 효과순 A → B  /  S-02: 원래 주소 그대로
    expect(addr.slice(0, 3)).toEqual(['021', '020', '022'])
    expect(addr.slice(3, 5)).toEqual(['011', '010'])
    expect(addr.slice(5)).toEqual(['050', '051'])
    expect(r.issues.map((i) => i.code)).toContain('JIG_KEPT_EXISTING')
    expect(r.summary.find((s) => s.pos === 'S-01')!.range).toContain('치구 1')
  })

  it('① 치구 배치 미리보기: 주소 없이 M1-0 같은 상대 번호, 순서는 ② 주소 매기기 결과와 같다', () => {
    const raw = [
      '1,0,0,1,0,,FC-01,S-01,1,single_shot,A,90',
      '2,0,0,2,0,,FC-01,S-01,1,single_shot,B,-30',
      '3,0,0,3,0,,FC-01,S-01,1,single_shot,C,45'
    ]
    const csv = parseCsv(Buffer.from(['CUE,HH,MM,SS,FF,CONTROL,POS,QTY,TYPE,Effect Description,TILT', ...raw.map((l) => l.replace(',,', ','))].join('\r\n')), 'raw.csv')
    const preview = planJigs(csv, RULES, DEFAULT_JIG_SETTINGS, { preview: true })
    expect(preview.blocked).toBe(false)
    expect(preview.positions[0].cues.map((c) => `${c.effect}=${c.address}`)).toEqual(['B=M1-0', 'A=M1-1', 'C=M1-2'])
    expect(preview.csv.rows).toEqual(csv.rows) // 원본은 그대로
    const assigned = assignWithJigs(csv, { sortMode: 'effect', plan: proposePlan(listPositions(csv, RULES), '01', jigModuleNeeds(csv, RULES)) }, RULES)
    expect(assigned.jigPositions[0].cues.map((c) => `${c.effect}=${c.address}`)).toEqual(['B=010', 'A=011', 'C=012'])
  })

  it('30° 미만 각도와 추정 각도는 경고', () => {
    const r = planJigs(csvOf([...singles(1, () => 20), '1,0,0,1,0,011,FC-01,S-01,2,single_shot,X,-80']), RULES)
    expect(r.issues.map((i) => i.code).sort()).toEqual(['JIG_TILT_ESTIMATED', 'JIG_TILT_LOW'])
  })
})
