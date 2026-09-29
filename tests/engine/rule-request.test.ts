import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  applyRuleRequest,
  buildRuleRequest,
  formatRulesJson,
  parseRuleRequest,
  ruleRequestBody,
  ruleRequestTitle,
  RULE_REQUEST_TITLE,
  type RuleSet
} from '../../src/engine'

const rulesText = readFileSync(resolve(__dirname, '../../rules/rules.json'), 'utf8').replace(/\r\n/g, '\n')
const shared = JSON.parse(rulesText) as RuleSet

describe('Rule 요청', () => {
  it('공용 Rule과 다른 내 PC Rule만 요청에 담는다', () => {
    const req = buildRuleRequest(
      {
        positionRules: [
          { pattern: 'FX-*', category: '연발', output_prefix: 'C', active: true, source: 'user' },
          { pattern: '3P-*', category: '타상', output_prefix: 'P', active: true, source: 'user' }, // 공용과 같음
          { pattern: 'TX-*', category: '제외', output_prefix: '', active: true, source: 'user' }
        ],
        typeRules: []
      },
      shared
    )
    expect(req?.positionRules).toEqual([
      { prefix: 'FX', category: '연발', active: true },
      { prefix: 'TX', category: '제외', active: true }
    ])
    expect(buildRuleRequest({ positionRules: [], typeRules: [] }, shared)).toBeNull()
  })

  it('이슈 본문을 만들고 다시 읽을 수 있다', () => {
    const req = { positionRules: [{ prefix: 'FX', category: '연발' as const, active: true }], typeRules: [] }
    expect(ruleRequestTitle(req)).toBe(`${RULE_REQUEST_TITLE} FX-*`)
    expect(parseRuleRequest(ruleRequestBody(req))).toEqual(req)
  })

  it('형식이 틀린 요청은 거절한다', () => {
    const body = (x: unknown) => '```json\n' + JSON.stringify(x) + '\n```'
    expect(() => parseRuleRequest('그냥 글')).toThrow('JSON 블록')
    expect(() => parseRuleRequest(body({ positionRules: [{ prefix: 'F X|', category: '연발', active: true }] }))).toThrow('Prefix')
    expect(() => parseRuleRequest(body({ positionRules: [{ prefix: 'FX', category: '폭죽', active: true }] }))).toThrow('분류')
    expect(() => parseRuleRequest(body({ positionRules: [], typeRules: [] }))).toThrow('반영할 Rule')
  })

  it('Prefix 단위로 합치고 다른 Rule은 건드리지 않는다', () => {
    const { rules, changes } = applyRuleRequest(
      shared,
      {
        positionRules: [
          { prefix: 'FX', category: '연발', active: true },
          { prefix: 'TX', category: '타상', active: true },
          { prefix: 'CF', category: '연발', active: true } // 이미 같음
        ],
        typeRules: []
      },
      '2026-09-30'
    )
    expect(changes).toEqual(['추가: `FX-*` → 연발', '변경: `TX-*` → 타상'])
    expect(rules.version).toBe(shared.version + 1)
    expect(rules.positionRules).toHaveLength(shared.positionRules.length + 1)
    expect(rules.positionRules.find((r) => r.pattern === 'FX-*')).toMatchObject({ output_prefix: 'FX', source: 'user', created_at: '2026-09-30' })
    expect(rules.positionRules.find((r) => r.pattern === 'TX-*')).toMatchObject({ category: '타상', output_prefix: 'P', source: 'default' })
    expect(rules.profiles).toEqual(shared.profiles)
  })

  it('바뀐 게 없으면 버전을 올리지 않는다', () => {
    const { rules, changes } = applyRuleRequest(shared, { positionRules: [{ prefix: '3P', category: '타상', active: true }], typeRules: [] }, 'x')
    expect(changes).toEqual([])
    expect(rules).toBe(shared)
  })

  it('rules.json을 지금 모양 그대로 다시 쓴다', () => {
    expect(formatRulesJson(shared)).toBe(rulesText)
  })
})
