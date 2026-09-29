import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mergeRules, type LocalRules, type RuleSet } from '../engine'
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

/** 공용 rules.json에 그대로 붙여넣을 수 있는 전체 파일 내용 */
export function exportMergedRulesJson(): string {
  const s = state!
  const merged: RuleSet = {
    ...s.effective,
    version: (s.shared.version ?? 0) + 1,
    updated_at: new Date().toISOString().slice(0, 10),
    positionRules: s.effective.positionRules.map((r) => ({ ...r, source: r.source === 'default' ? 'default' : 'user' }))
  }
  return JSON.stringify(merged, null, 2) + '\n'
}
