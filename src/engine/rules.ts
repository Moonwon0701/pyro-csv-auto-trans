import { parsePosition } from './position'
import type { PositionRule, Resolution, RuleSet, TypeRule } from './types'

/** "3P-*" → "3P" */
export function prefixOfPattern(pattern: string): string {
  return pattern.trim().replace(/-?\*$/, '').replace(/-$/, '').toUpperCase()
}

export function patternOfPrefix(prefix: string): string {
  return `${prefix.toUpperCase()}-*`
}

export function findPositionRule(rules: PositionRule[], prefix: string): PositionRule | undefined {
  const p = prefix.toUpperCase()
  return rules.find((r) => r.active && prefixOfPattern(r.pattern) === p)
}

export function findTypeRule(rules: TypeRule[], type: string): TypeRule | undefined {
  const t = type.trim().toLowerCase()
  if (!t) return undefined
  return rules.find((r) => r.type.trim().toLowerCase() === t)
}

/** 행 분류: Position Rule → 이번 작업에서 고른 분류 → TYPE Rule */
export function resolveCategory(rules: RuleSet, resolutions: Record<string, Resolution>, pos: string, type: string): Resolution | undefined {
  const parsed = parsePosition(pos)
  const byPos = parsed ? (findPositionRule(rules.positionRules, parsed.prefix)?.category ?? resolutions[parsed.prefix]) : undefined
  return byPos ?? findTypeRule(rules.typeRules, type)?.category
}

export interface LocalRules {
  positionRules: PositionRule[]
  typeRules: TypeRule[]
}

/** 공용 Rule 위에 내 PC Rule을 pattern/type 단위로 덮어쓴다 */
export function mergeRules(base: RuleSet, local: LocalRules): RuleSet {
  const pos = new Map<string, PositionRule>()
  for (const r of base.positionRules) pos.set(prefixOfPattern(r.pattern), r)
  for (const r of local.positionRules) pos.set(prefixOfPattern(r.pattern), { ...r, source: 'user' })
  const types = new Map<string, TypeRule>()
  for (const r of base.typeRules) types.set(r.type.toLowerCase(), r)
  for (const r of local.typeRules) types.set(r.type.toLowerCase(), r)
  return { ...base, positionRules: [...pos.values()], typeRules: [...types.values()] }
}
