import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "@bizshuffle-bun/protocol";
import type { BizhawkIpc } from "./bizhawk-ipc.js";
import type { ClientApiPort } from "./api.js";
import { ensureFile } from "./downloads.js";
import type { SendFn } from "./ws-client.js";
import { PluginSyncManager } from "./plugin-sync.js";

async function waitForLocalSave(path: string, timeoutMs = 5000): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return readFileSync(path);
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`save file not written: ${path}`);
}

export interface ControllerDeps {
  dataDir: string;
  api: ClientApiPort;
  bipc: BizhawkIpc | null;
  send: SendFn;
  pluginsDir: string;
}

export class Controller {
  private pendingSwap: {
    cmd: Command;
    ack: (id: string) => Promise<void>;
    nack: (id: string, reason: string) => Promise<void>;
  } | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  async onBizhawkReady(): Promise<void> {
    if (!this.pendingSwap) return;
    const pending = this.pendingSwap;
    this.pendingSwap = null;
    await this.handleSwap(pending.cmd, pending.ack, pending.nack);
  }

  async handle(cmd: Command): Promise<void> {
    const { ack, nack } = this.acks();
    switch (cmd.cmd) {
      case "start":
        if (this.deps.bipc?.isReady()) {
          try {
            await this.deps.bipc.sendResume();
            await ack(cmd.id);
          } catch (err) {
            await nack(cmd.id, String(err));
          }
        } else {
          await ack(cmd.id);
        }
        return;
      case "pause":
        if (this.deps.bipc?.isReady()) {
          try {
            await this.deps.bipc.sendPause();
            await ack(cmd.id);
          } catch (err) {
            await nack(cmd.id, String(err));
          }
        } else {
          await ack(cmd.id);
        }
        return;
      case "swap":
        await this.handleSwap(cmd, ack, nack);
        return;
      case "message":
        await this.handleMessage(cmd, ack, nack);
        return;
      case "games_update":
        void this.handleGamesUpdate(cmd);
        return;
      case "clear_saves":
        if (this.deps.bipc?.isReady()) {
          try {
            await this.deps.bipc.sendMessage("clear_saves");
            await ack(cmd.id);
          } catch (err) {
            await nack(cmd.id, String(err));
          }
        } else {
          await ack(cmd.id);
        }
        return;
      case "request_save":
        await this.handleRequestSave(cmd, ack, nack);
        return;
      case "plugin_reload": {
        const sync = new PluginSyncManager(this.deps.api, this.deps.pluginsDir);
        try {
          await sync.syncPlugins();
          await ack(cmd.id);
        } catch (err) {
          await nack(cmd.id, String(err));
        }
        return;
      }
      case "check_config":
      case "update_config":
      case "fullscreen_toggle":
      case "state_update":
        await ack(cmd.id);
        return;
      default:
        return;
    }
  }

  private acks() {
    const send = this.deps.send;
    return {
      ack: (id: string) => send({ cmd: "ack", id }),
      nack: (id: string, reason: string) => send({ cmd: "nack", id, payload: { reason } }),
    };
  }

  private async handleSwap(
    cmd: Command,
    ack: (id: string) => Promise<void>,
    nack: (id: string, reason: string) => Promise<void>
  ): Promise<void> {
    const payload = (cmd.payload ?? {}) as { game?: string; instance_id?: string };
    const game = payload.game ?? "";
    const instanceId = payload.instance_id ?? "";

    if (game) {
      try {
        await ensureFile(this.deps.api.baseUrl, this.deps.dataDir, game);
      } catch (err) {
        await nack(cmd.id, `download failed: ${err}`);
        return;
      }
    }

    if (this.deps.bipc?.isReady()) {
      try {
        if (instanceId) {
          await this.deps.bipc.sendSave();
        }
        if (game) {
          await this.deps.bipc.sendSwap(game, instanceId);
        }
        await ack(cmd.id);
      } catch (err) {
        await nack(cmd.id, String(err));
      }
    } else if (this.deps.bipc) {
      this.pendingSwap = { cmd, ack, nack };
    } else {
      await ack(cmd.id);
    }
  }

  private async handleMessage(
    cmd: Command,
    ack: (id: string) => Promise<void>,
    nack: (id: string, reason: string) => Promise<void>
  ): Promise<void> {
    const p = (cmd.payload ?? {}) as { message?: string };
    if (!p.message) {
      await nack(cmd.id, "missing message");
      return;
    }
    if (this.deps.bipc?.isReady()) {
      try {
        await this.deps.bipc.sendMessage(p.message);
        await ack(cmd.id);
      } catch (err) {
        await nack(cmd.id, String(err));
      }
    } else {
      await ack(cmd.id);
    }
  }

  private async handleGamesUpdate(cmd: Command): Promise<void> {
    const payload = (cmd.payload ?? {}) as {
      games?: string[];
      game_instances?: Array<{ game?: string }>;
    };
    const required = new Set<string>();
    for (const inst of payload.game_instances ?? []) {
      if (inst.game) required.add(inst.game);
    }
    for (const g of payload.games ?? []) required.add(g);

    const errors: string[] = [];
    await Promise.all(
      [...required].map(async (name) => {
        try {
          await ensureFile(this.deps.api.baseUrl, this.deps.dataDir, name);
        } catch (err) {
          errors.push(`${name}: ${err}`);
        }
      })
    );

    await this.deps.send({
      cmd: "games_update_ack",
      id: `${Date.now()}`,
      payload: { has_files: errors.length === 0, errors: errors.length ? errors : undefined },
    });
  }

  private async handleRequestSave(
    cmd: Command,
    ack: (id: string) => Promise<void>,
    nack: (id: string, reason: string) => Promise<void>
  ): Promise<void> {
    const instanceId = ((cmd.payload ?? {}) as { instance_id?: string }).instance_id ?? "";
    if (!instanceId) {
      await nack(cmd.id, "missing instance_id");
      return;
    }
    if (!this.deps.bipc?.isReady()) {
      await nack(cmd.id, "IPC not ready");
      return;
    }
    try {
      await this.deps.bipc.sendSave();
      const savePath = join(this.deps.dataDir, "saves", `${instanceId}.state`);
      const data = await waitForLocalSave(savePath);
      await this.deps.api.uploadSave(instanceId, data);
      await ack(cmd.id);
    } catch (err) {
      await nack(cmd.id, String(err));
    }
  }
}
