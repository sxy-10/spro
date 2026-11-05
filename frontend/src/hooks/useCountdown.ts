/**
 * 组员4（阶段三·前端状态流与网络层）
 * 短信验证码 60 秒倒计时：抽成 hook，登录页和找回密码页共用一份逻辑。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Countdown {
  /** 剩余秒数，0 表示可再次发送 */
  remaining: number;
  /** 是否正在倒计时 */
  running: boolean;
  /** 开始倒计时 */
  start: () => void;
  /** 重置（例如切换了手机号） */
  reset: () => void;
}

export function useCountdown(totalSeconds: number): Countdown {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  const start = useCallback(() => {
    stopTimer();
    setRemaining(totalSeconds);
    timer.current = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          stopTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stopTimer, totalSeconds]);

  const reset = useCallback(() => {
    stopTimer();
    setRemaining(0);
  }, [stopTimer]);

  return { remaining, running: remaining > 0, start, reset };
}
