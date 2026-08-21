import { useEffect, useState } from 'react'

import { fetchPasswordPolicy } from '../api/auth'
import type { PasswordPolicy } from '../api/types'

/**
 * 초기 비밀번호와 최소 길이를 서버에서 받아온다.
 *
 * 프론트에 같은 값을 적어두면 백엔드가 정책을 바꿨을 때 화면만 옛 값을 안내한다.
 * 응답은 api/auth.ts에서 캐시하므로 화면마다 호출해도 요청은 한 번뿐이다.
 * 아직 못 받았으면 null이다. 호출하는 쪽이 그 상태를 그려야 한다.
 */
export function usePasswordPolicy(): PasswordPolicy | null {
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchPasswordPolicy().then(
      (p) => {
        if (!cancelled) setPolicy(p)
      },
      () => {
        // 실패해도 화면을 막지 않는다. 값이 필요한 영역만 로딩 상태로 남는다.
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return policy
}
