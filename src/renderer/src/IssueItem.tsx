import type { Issue } from '@engine/types'

/** 검증 결과 한 줄. 상세(줄 번호·예시)가 있으면 펼쳐 볼 수 있다 */
export default function IssueItem({ issue }: { issue: Issue }) {
  const hasMore = (issue.details?.length ?? 0) > 0 || (issue.lines?.length ?? 0) > 0
  const label = (
    <>
      {issue.message}
      {issue.count && issue.count > 1 ? <b> ({issue.count}건)</b> : null}
    </>
  )
  if (!hasMore) return <div className={`issue ${issue.severity}`}>{label}</div>
  return (
    <details className={`issue ${issue.severity}`}>
      <summary>{label}</summary>
      <div className="detail">
        {issue.details?.map((d, i) => <div key={i}>{d}</div>)}
        {!issue.details && issue.lines && (
          <div>
            CSV 줄: {issue.lines.join(', ')}
            {(issue.count ?? 0) > issue.lines.length && ' …'}
          </div>
        )}
      </div>
    </details>
  )
}
