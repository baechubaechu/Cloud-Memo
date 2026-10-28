// 이벤트 핸들러 묶음을 렌더가 바뀌어도 같은 함수로 돌려준다. 호출할 때는 항상 최신
// 핸들러를 부른다. React.memo 로 감싼 자식에 넘기는 핸들러용 — 렌더 중에 부르는
// 함수(목록 계산 등)에는 쓰지 않는다 (값이 바뀌어도 자식이 다시 그려지지 않는다).

import { useRef, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handlers = Record<string, (...args: any[]) => any>;

export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers);
  latest.current = handlers;
  const [stable] = useState(() => {
    const out: Handlers = {};
    for (const key of Object.keys(handlers)) {
      out[key] = (...args) => latest.current[key](...args);
    }
    return out as T;
  });
  return stable;
}
