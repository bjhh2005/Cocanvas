// 50ms 节流，trailing 策略：保留最后一次未发送的调用
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
): (...args: Args) => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let trailingArgs: Args | null = null

  return (...args: Args) => {
    const now = Date.now()
    const remain = wait - (now - last)
    if (remain <= 0) {
      last = now
      if (timer) { clearTimeout(timer); timer = null }
      fn(...args)
    } else {
      trailingArgs = args
      if (!timer) {
        timer = setTimeout(() => {
          last = Date.now()
          timer = null
          if (trailingArgs) {
            fn(...trailingArgs)
            trailingArgs = null
          }
        }, remain)
      }
    }
  }
}
