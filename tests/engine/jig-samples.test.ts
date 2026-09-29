/**
 * 사람이 주소를 매긴 과거 쇼로 치구 배치를 검증한다 (samples/는 git 제외, 없으면 건너뜀).
 * - 치구 대상 위치의 모듈 수가 사람이 쓴 것보다 많지 않을 것
 * - 기본 설정에서는 현장 결선이 없을 것 (모듈이 치구 두 개에 걸치지 않음)
 * - 모듈 16핀·20발, 치구 20칸 이하, 주소는 Control 안에서 겹치지 않을 것
 */
import { existsSync, readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { addressToIndex, DEFAULT_JIG_SETTINGS, parseCsv, planJigs, type RuleSet } from '../../src/engine'

const S = 'samples/sets/시트정리 공유'
const D = 'samples/data'
const RULES: RuleSet = JSON.parse(readFileSync('rules/rules.json', 'utf8'))
const CASES = [
  { name: '통영', path: `${S}/260314 통영요트폐막/FC-01.csv` },
  { name: '거제 FC-02', path: `${S}/260614 거제옥포대첩/FC-02.csv` },
  { name: '울주', path: `${S}/260725 울주해양레포츠/FC-01.csv` },
  { name: '퐁피두', path: `${S}/260904 퐁피두/FC-01.csv` },
  { name: '방위', path: `${D}/25방위/ADD.csv` },
  { name: '화순', path: `${D}/25화순/ADD.csv` }
].filter((c) => existsSync(c.path))

describe.skipIf(CASES.length === 0)('치구 배치: 과거 쇼와 비교', () => {
  const totals = { before: 0, after: 0, jigs: 0, lowerModules: 0, lowerJigs: 0 }
  for (const c of CASES) {
    it(c.name, () => {
      const csv = parseCsv(readFileSync(c.path), c.name)
      const r = planJigs(csv, RULES)
      expect(r.blocked).toBe(false)
      const capacity = DEFAULT_JIG_SETTINGS.rows * DEFAULT_JIG_SETTINGS.cols
      // 사람이 모듈 하나에 20발 넘게 넣은 위치(통영 S-06: 21발)는 규칙을 지키면 모듈이 하나 더 들 수 있다
      const ai0 = csv.headers.findIndex((h) => h.trim().toUpperCase() === 'ADDR')
      const qi = csv.headers.findIndex((h) => h.trim().toUpperCase() === 'QTY')
      const overfull = (p: (typeof r.positions)[number]) => {
        const byModule = new Map<string, number>()
        for (const c of p.cues) {
          const m = csv.rows[c.rowIndex][ai0].padStart(3, '0').slice(0, 2)
          byModule.set(m, (byModule.get(m) ?? 0) + (parseInt(csv.rows[c.rowIndex][qi], 10) || 1))
        }
        return [...byModule.values()].some((n) => n > capacity)
      }
      for (const p of r.positions) {
        expect(p.modules.length, `${p.pos} 모듈 수`).toBeLessThanOrEqual(p.previousModules + (overfull(p) ? 1 : 0))
        expect(p.fieldWiring, `${p.pos} 현장 결선`).toEqual([])
        for (const m of p.modules) {
          expect(m.pins).toBeLessThanOrEqual(16)
          expect(m.shells).toBeLessThanOrEqual(capacity)
        }
        for (const j of p.jigs) expect(j.shells).toBeLessThanOrEqual(capacity)
        totals.before += p.previousModules
        totals.after += p.modules.length
        totals.jigs += p.jigs.length
        totals.lowerModules += p.lowerBound.modules
        totals.lowerJigs += p.lowerBound.jigs
      }
      // 주소 중복 없음 (Control별)
      const ai = csv.headers.findIndex((h) => h.trim().toUpperCase() === 'ADDR')
      const ci = csv.headers.findIndex((h) => h.trim().toUpperCase() === 'CONTROL')
      const seen = new Map<string, string>()
      const dup: string[] = []
      r.csv.rows.forEach((row, i) => {
        const idx = addressToIndex(row[ai])
        if (idx === null) return
        const key = `${row[ci] ?? ''}:${idx}`
        const pos = row[csv.headers.findIndex((h) => h.trim().toUpperCase() === 'POS')]
        const owner = seen.get(key)
        // 같은 위치의 같은 주소(같은 큐 동시 발사)는 원래도 있다. 다른 위치끼리 겹치면 오류
        if (owner !== undefined && owner !== pos) dup.push(`${row[ai]} ${owner}/${pos} (${i})`)
        seen.set(key, pos)
      })
      expect(dup).toEqual([])
      const before = r.positions.reduce((a, p) => a + p.previousModules, 0)
      const after = r.positions.reduce((a, p) => a + p.modules.length, 0)
      console.log(`${c.name}: 위치 ${r.positions.length}개, 모듈 ${before} → ${after}, 치구 ${r.positions.reduce((a, p) => a + p.jigs.length, 0)}`)
    })
  }
  it('합계', () => {
    console.log(`합계: 모듈 ${totals.before} → ${totals.after} (하한 ${totals.lowerModules}), 치구 ${totals.jigs} (하한 ${totals.lowerJigs})`)
    expect(totals.after).toBeLessThanOrEqual(totals.before)
  })
})
