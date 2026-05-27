import type { BizShuffleServer } from "./server.js";

export class SwapScheduler {
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(private readonly server: BizShuffleServer) {}

  start(): void {
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
  }

  notify(): void {
    this.wake?.();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const st = this.server.snapshotState();
      if (!st.running || !st.swap_enabled) {
        await this.waitForWake();
        continue;
      }

      const minv = st.min_interval_secs ?? 5;
      const maxv = st.max_interval_secs ?? 300;
      let interval: number;
      if (minv > 0 && maxv > 0 && maxv >= minv) {
        interval = minv + Math.floor(Math.random() * (maxv - minv + 1));
      } else if (minv > 0) {
        interval = minv;
      } else if (maxv > 0) {
        interval = maxv;
      } else {
        interval = 300;
      }

      const nextAt = Math.floor(Date.now() / 1000) + interval;
      this.server.updateStateAndPersist((s) => {
        s.next_swap_at = nextAt;
      });

      if (st.countdown_enabled && interval >= 3) {
        const countdownDelay = interval - 3;
        if (countdownDelay > 0) {
          if (!(await this.sleepOrWake(countdownDelay * 1000))) continue;
        }
        if (!this.shouldRun()) continue;
        this.server.sendMessage("3", 1, 10, 10, 12, "#FFFFFF", "#000000");
        if (!(await this.sleepOrWake(1000))) continue;
        this.server.sendMessage("2", 1, 10, 10, 12, "#FFFFFF", "#000000");
        if (!(await this.sleepOrWake(1000))) continue;
        this.server.sendMessage("1", 1, 10, 10, 12, "#FFFFFF", "#000000");
        if (!this.shouldRun()) continue;
      } else {
        if (!(await this.sleepOrWake(interval * 1000))) continue;
        if (!this.shouldRun()) continue;
      }

      void this.server
        .performSwap()
        .catch((err) => console.error("scheduled swap:", err))
        .finally(() => this.notify());
    }
  }

  private shouldRun(): boolean {
    const st = this.server.snapshotState();
    return st.running && st.swap_enabled;
  }

  private waitForWake(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }

  private sleepOrWake(ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return new Promise((resolve) => {
      timer = setTimeout(() => resolve(true), ms);
      const prev = this.wake;
      this.wake = () => {
        if (timer !== undefined) clearTimeout(timer);
        prev?.();
        resolve(false);
      };
    });
  }
}
