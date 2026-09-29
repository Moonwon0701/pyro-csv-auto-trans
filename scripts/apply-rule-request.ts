/**
 * GitHub Actions(rule-request.yml)에서 실행: "[Rule 요청]" 이슈를 읽어 rules/rules.json에 반영한다.
 * 결과는 GITHUB_OUTPUT의 result(applied / nochange / pending / invalid)와
 * RUNNER_TEMP/rule-comment.md(이슈에 남길 댓글)로 넘긴다.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { applyRuleRequest, formatRulesJson, parseRuleRequest, type RuleSet } from '../src/engine'

const RULES_PATH = 'rules/rules.json'
const CONTRIBUTORS_PATH = 'rules/contributors.txt'
const APPROVE_LABEL = '승인'
const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR']

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'))
const issue = event.issue
const author: string = issue.user.login

function contributors(): string[] {
  if (!existsSync(CONTRIBUTORS_PATH)) return []
  return readFileSync(CONTRIBUTORS_PATH, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean)
}

function finish(result: 'applied' | 'nochange' | 'pending' | 'invalid', comment: string) {
  writeFileSync(join(process.env.RUNNER_TEMP ?? '.', 'rule-comment.md'), comment + '\n')
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\n`)
  console.log(`${result}\n${comment}`)
}

const approved =
  TRUSTED_ASSOCIATIONS.includes(issue.author_association) ||
  contributors().includes(author.toLowerCase()) ||
  (event.action === 'labeled' && event.label?.name === APPROVE_LABEL)

let req
try {
  req = parseRuleRequest(issue.body ?? '')
} catch (e) {
  finish('invalid', `요청을 읽지 못했습니다: ${(e as Error).message}\n\n앱의 "Rule 관리 → 공용 Rule로 올리기"로 다시 요청해 주세요.`)
  process.exit(0)
}

if (!approved) {
  finish(
    'pending',
    `@${author} 님은 아직 등록된 디자이너가 아니어서 관리자 확인을 기다립니다.\n\n` +
      `관리자: 내용이 맞으면 이 이슈에 \`${APPROVE_LABEL}\` 라벨을 붙이면 반영됩니다. ` +
      `앞으로 바로 반영되게 하려면 \`${CONTRIBUTORS_PATH}\`에 아이디를 추가하세요.`
  )
  process.exit(0)
}

const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) // 한국 날짜
const current = JSON.parse(readFileSync(RULES_PATH, 'utf8')) as RuleSet
const { rules, changes } = applyRuleRequest(current, req, today)

if (!changes.length) {
  finish('nochange', '요청한 내용이 이미 공용 Rule에 들어 있습니다. 바꿀 것이 없어 닫습니다.')
} else {
  writeFileSync(RULES_PATH, formatRulesJson(rules))
  finish(
    'applied',
    `공용 Rule에 반영했습니다 (버전 ${rules.version}).\n\n${changes.map((c) => `- ${c}`).join('\n')}\n\n` +
      '각 PC에서 앱을 다시 켜거나 "Rule 관리 → 최신 공용 Rule 받기"를 누르면 적용됩니다.'
  )
}
