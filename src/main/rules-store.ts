import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { buildRuleRequest, mergeRules, ruleRequestBody, ruleRequestTitle, type LocalRules, type RuleSet } from '../engine'
import bundledRules from '../../rules/rules.json'
import { RULES_RAW_URL } from './config'

export type SharedSource = 'remote' | 'cache' | 'bundled'

export interface RulesState {
  effective: RuleSet
  shared: RuleSet
  local: LocalRules
  sharedSource: SharedSource
  sharedFetchedAt: string | null
  fetchError: string | null
}

const cachePath = () => join(app.getPath('userData'), 'shared-rules-cache.json')
const localPath = () => join(app.getPath('userData'), 'local-rules.json')

function readJson<T>(path: string): T | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
  } catch {
    return null
  }
}

function isRuleSet(x: unknown): x is RuleSet {
  const r = x as RuleSet
  return !!r && Array.isArray(r.positionRules) && Array.isArray(r.typeRules)
}

function withSharedSource(r: RuleSet): RuleSet {
  return {
    ...r,
    profiles: r.profiles ?? [],
    positionRules: r.positionRules.map((p) => ({ ...p, source: p.source === 'user' ? 'shared' : p.source }))
  }
}

let state: RulesState | null = null
let pending: Promise<RulesState> | null = null

export function loadRules(forceRemote = true): Promise<RulesState> {
  pending = doLoad(forceRemote).finally(() => (pending = null))
  return pending
}

async function doLoad(forceRemote: boolean): Promise<RulesState> {
  let shared: RuleSet = withSharedSource(bundledRules as unknown as RuleSet)
  let sharedSource: SharedSource = 'bundled'
  let sharedFetchedAt: string | null = null
  let fetchError: string | null = null

  const cached = readJson<{ fetchedAt: string; rules: RuleSet }>(cachePath())
  if (cached && isRuleSet(cached.rules)) {
    shared = withSharedSource(cached.rules)
    sharedSource = 'cache'
    sharedFetchedAt = cached.fetchedAt
  }

  if (forceRemote) {
    try {
      const res = await fetch(`${RULES_RAW_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const remote = await res.json()
      if (!isRuleSet(remote)) throw new Error('rules.json 형식이 올바르지 않습니다')
      shared = withSharedSource(remote)
      sharedSource = 'remote'
      sharedFetchedAt = new Date().toISOString()
      writeFileSync(cachePath(), JSON.stringify({ fetchedAt: sharedFetchedAt, rules: remote }, null, 2))
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e)
    }
  }

  const local = readJson<LocalRules>(localPath()) ?? { positionRules: [], typeRules: [] }
  state = { effective: mergeRules(shared, local), shared, local, sharedSource, sharedFetchedAt, fetchError }
  return state
}

export async function getRules(): Promise<RulesState> {
  return state ?? pending ?? loadRules(true)
}

export function saveLocalRules(local: LocalRules): RulesState {
  writeFileSync(localPath(), JSON.stringify(local, null, 2))
  const s = state!
  state = { ...s, local, effective: mergeRules(s.shared, local) }
  return state
}

/** 내 PC Rule 중 공용과 다른 것을 GitHub 이슈 요청(제목·본문)으로 만든다. 올릴 것이 없으면 null */
export function buildShareRequest(): { title: string; body: string; count: number } | null {
  const s = state!
  const req = buildRuleRequest(s.local, s.shared)
  return req && { title: ruleRequestTitle(req), body: ruleRequestBody(req), count: req.positionRules.length + req.typeRules.length }
}

export interface ShareResult {
  /** 올린 Rule 수. 0이면 공용과 다른 것이 없어 이슈를 열지 않았다 */
  count: number
  /** 본문이 길어서 주소에 못 넣고 클립보드로 복사했다 */
  pasteNeeded: boolean
  state: RulesState
}
