import { spawn, type ChildProcess } from "node:child_process";
import type { EmulatorState } from "@bizshuffle-bun/protocol";
import { ensureServerLua } from "@bizshuffle-bun/client-host";

const LAUNCH_TIMEOUT_MS = 30_000;
const SETTLE_MS = 2500;

export interface DesktopEmulatorOptions {
  mock?: boolean;
}

/** Spawns BizHawk (EmuHawk) when joining a session — desktop main process only. */
export class DesktopEmulatorService {
  private proc: ChildProcess | null = null;
  private healthState: EmulatorState = "stopped";
  private readonly mock: boolean;
  private resolvedPath: string | null = null;

  constructor(options: DesktopEmulatorOptions = {}) {
    this.mock = options.mock ?? process.env.BIZSHUFFLE_EMULATOR_MOCK === "1";
  }

  get state(): EmulatorState {
    return this.healthState;
  }

  get exePath(): string | null {
    return this.resolvedPath;
  }

  private isProcessAlive(): boolean {
    const pid = this.proc?.pid;
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async launch(
    dataDir: string,
    emuPath: string,
    serverLuaCandidates: string[] = []
  ): Promise<void> {
    if (this.mock) {
      this.healthState = "running";
      this.resolvedPath = emuPath;
      return;
    }
    if (this.proc && !this.isProcessAlive()) {
      this.proc = null;
      this.healthState = "stopped";
    }
    if (this.proc) return;

    this.resolvedPath = emuPath;
    const luaPath = ensureServerLua(dataDir, serverLuaCandidates);
    const args = [`--lua=${luaPath}`];

    this.healthState = "starting";

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(emuPath, args, {
        cwd: dataDir,
        detached: false,
        stdio: "ignore",
        windowsHide: false,
        shell: false,
      });
      this.proc = proc;

      let settled = false;
      let exitedEarly = false;
      let exitCode: number | null = null;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(settleTimer);
        if (err) {
          this.healthState = "crashed";
          this.proc = null;
          reject(err);
        } else {
          this.healthState = "running";
          resolve();
        }
      };

      const timer = setTimeout(() => {
        finish(new Error(`BizHawk did not start within ${LAUNCH_TIMEOUT_MS / 1000}s (${emuPath})`));
      }, LAUNCH_TIMEOUT_MS);

      proc.on("error", (err) => finish(err));
      proc.on("exit", (code) => {
        exitCode = code ?? null;
        exitedEarly = true;
        if (!settled) {
          finish(new Error(`BizHawk exited during launch (code ${exitCode ?? "?"}).`));
        } else {
          this.healthState = "stopped";
          this.proc = null;
        }
      });

      const settleTimer = setTimeout(() => {
        if (exitedEarly) {
          finish(new Error(`BizHawk exited right after launch (code ${exitCode ?? "?"}).`));
          return;
        }
        if (proc.pid) finish();
        else finish(new Error("BizHawk process has no PID after launch"));
      }, SETTLE_MS);
    });
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.healthState = "stopped";
  }
}
