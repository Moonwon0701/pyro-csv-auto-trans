import { CATEGORIES, EXCLUDE, outputPrefixOf, type Category, type PositionRule, type Resolution, type RuleSet, type TypeRule } from './types'
import { prefixOfPattern, type LocalRules } from './rules'

/** GitHub 이슈 제목 머리말. 워크플로가 이것으로 Rule 요청을 알아본다 */
export const RULE_REQUEST_TITLE = '[Rule 요청]'

export interface RuleRequest {
  positionRules: { prefix: string; category: Resolution; active: boolean }[]
  typeRules: TypeRule[]
}

const RESOLUTIONS: readonly string[] = [...CATEGORIES, EXCLUDE]
const PREFIX_RE = /^[A-Z0-9_]{1,16}$/
const TYPE_RE = /^[a-z0-9_ -]{1,32}$/

/** 내 PC Rule 중 공용 Rule과 다른 것만 골라 요청으로 만든다. 올릴 것이 없으면 null */
export function buildRuleRequest(local: LocalRules, shared: RuleSet): RuleRequest | null {
  const sharedPos = new Map(shared.positionRules.map((r) => [prefixOfPattern(r.pattern), r]))
  const positionRules = local.positionRules
    .map((r) => ({ prefix: prefixOfPattern(r.pattern), category: r.category, active: r.active }))
    .filter((r) => {
      const s = sharedPos.get(r.prefix)
      return !s || s.category !== r.category || s.active !== r.active
    })
  const sharedTypes = new Map(shared.typeRules.map((t) => [t.type.toLowerCase(), t.category]))
  const typeRules = local.typeRules.filter((t) => sharedTypes.get(t.type.toLowerCase()) !== t.category)
  return positionRules.length || typeRules.length ? { positionRules, typeRules } : null
}

export function ruleRequestTitle(req: RuleRequest): string {
  const names = [...req.positionRules.map((r) => `${r.prefix}-*`), ...req.typeRules.map((t) => `TYPE ${t.type}`)]
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` 외 ${names.length - 5}개` : '')
  return `${RULE_REQUEST_TITLE} ${shown}`
}

/** 사람이 읽는 표 + 워크플로가 읽는 JSON */
export function ruleRequestBody(req: RuleRequest): string {
  const lines = ['공용 Rule에 아래 내용을 반영해 주세요. (앱의 "공용 Rule로 올리기"로 만든 요청입니다)', '']
  if (req.positionRules.length) {
    lines.push('| Prefix | 분류 | 사용 |', '|---|---|---|')
    for (const r of req.positionRules) lines.push(`| \`${r.prefix}-*\` | ${r.category} | ${r.active ? '✓' : '끔'} |`)
    lines.push('')
  }
  if (req.typeRules.length) {
    lines.push('| TYPE | 분류 |', '|---|---|')
    for (const t of req.typeRules) lines.push(`| \`${t.type}\` | ${t.category} |`)
    lines.push('')
  }
  lines.push('아래 내용은 수정하지 마세요.', '', '```json', JSON.stringify(req), '```', '')
  return lines.join('\n')
}

/** 이슈 본문에서 요청을 꺼내 검사한다. 형식이 틀리면 이유를 담아 throw */
export function parseRuleRequest(body: string): RuleRequest {
  const m = body.match(/```json\s*([\s\S]*?)```/)
  if (!m) throw new Error('본문에서 JSON 블록을 찾지 못했습니다.')
  let raw: unknown
  try {
    raw = JSON.parse(m[1])
  } catch {
    throw new Error('JSON 형식이 올바르지 않습니다.')
  }
  const r = raw as Partial<RuleRequest>
  if (!r || !Array.isArray(r.positionRules ?? []) || !Array.isArray(r.typeRules ?? [])) throw new Error('positionRules / typeRules 목록이 없습니다.')

  const positionRules = (r.positionRules ?? []).map((p) => {
    const prefix = String(p?.prefix ?? '').trim().toUpperCase()
    if (!PREFIX_RE.test(prefix)) throw new Error(`Prefix 형식이 올바르지 않습니다: ${JSON.stringify(p?.prefix)}`)
    if (!RESOLUTIONS.includes(p.category)) throw new Error(`${prefix}-*: 분류는 ${RESOLUTIONS.join('/')} 중 하나여야 합니다.`)
    if (typeof p.active !== 'boolean') throw new Error(`${prefix}-*: active 값이 올바르지 않습니다.`)
    return { prefix, category: p.category, active: p.active }
  })
  const typeRules = (r.typeRules ?? []).map((t) => {
    const type = String(t?.type ?? '').trim().toLowerCase()
    if (!TYPE_RE.test(type)) throw new Error(`TYPE 형식이 올바르지 않습니다: ${JSON.stringify(t?.type)}`)
    if (!(CATEGORIES as readonly string[]).includes(t.category)) throw new Error(`TYPE ${type}: 분류는 ${CATEGORIES.join('/')} 중 하나여야 합니다.`)
    return { type, category: t.category as Category }
  })
  if (!positionRules.length && !typeRules.length) throw new Error('반영할 Rule이 없습니다.')
  return { positionRules, typeRules }
}

/** 공용 Rule에 요청을 Prefix/TYPE 단위로 합친다. 바뀐 게 없으면 changes가 비어 있다 */
export function applyRuleRequest(rules: RuleSet, req: RuleRequest, today: string): { rules: RuleSet; changes: string[] } {
  const changes: string[] = []
  const positionRules = [...rules.positionRules]
  for (const p of req.positionRules) {
    const next: PositionRule = {
      pattern: `${p.prefix}-*`,
      category: p.category,
      output_prefix: outputPrefixOf(p.prefix, p.category),
      active: p.active,
      source: 'user'
    }
    const i = positionRules.findIndex((r) => prefixOfPattern(r.pattern) === p.prefix)
    const label = `\`${p.prefix}-*\` → ${p.category}${p.active ? '' : ' (사용 안 함)'}`
    if (i < 0) {
      positionRules.push({ ...next, created_at: today })
      changes.push(`추가: ${label}`)
    } else if (positionRules[i].category !== next.category || positionRules[i].active !== next.active) {
      positionRules[i] = { ...positionRules[i], ...next, source: positionRules[i].source }
      changes.push(`변경: ${label}`)
    }
  }
  const typeRules = [...rules.typeRules]
  for (const t of req.typeRules) {
    const i = typeRules.findIndex((x) => x.type.toLowerCase() === t.type)
    if (i < 0) {
      typeRules.push(t)
      changes.push(`추가: TYPE \`${t.type}\` → ${t.category}`)
    } else if (typeRules[i].category !== t.category) {
      typeRules[i] = t
      changes.push(`변경: TYPE \`${t.type}\` → ${t.category}`)
    }
  }
  if (!changes.length) return { rules, changes }
  return { rules: { ...rules, version: (rules.version ?? 0) + 1, updated_at: today, positionRules, typeRules }, changes }
}

/** rules.json을 지금 형식대로 (Rule 한 줄에 하나) 쓴다 */
export function formatRulesJson(rules: RuleSet): string {
  const row = (x: object) => `{ ${Object.entries(x).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`
  const rows = (xs: object[]) => xs.map((x) => `    ${row(x)}`).join(',\n')
  const { positionRules, typeRules, profiles, ...head } = rules
  const headLines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  const profileJson = JSON.stringify(profiles ?? [], null, 2)
    .replace(/\[\n\s+("[^"]*"(,\n\s+"[^"]*")*)\n\s+\]/g, (_s, inner: string) => `[${inner.replace(/,\n\s+/g, ', ')}]`)
    .replace(/\n/g, '\n  ')
  return [
    '{',
    ...headLines,
    '  "positionRules": [',
    rows(positionRules),
    '  ],',
    '  "typeRules": [',
    rows(typeRules),
    '  ],',
    `  "profiles": ${profileJson}`,
    '}',
    ''
  ].join('\n')
}
