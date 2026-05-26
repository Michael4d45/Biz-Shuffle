import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Express, type Response } from "express";
import multer from "multer";
import type { MutablePlugin } from "@bizshuffle-bun/protocol";
import type { BizShuffleServer } from "./server.js";
import {
  loadPluginMetadata,
  loadPluginsFromDisk,
  loadSettingsKv,
  saveSettingsKv,
  scanPluginsDir,
} from "./plugins.js";
import { listRoms, syncCatalogFromRoms } from "./rom-catalog.js";
import { openPathInFileManager } from "./open-path.js";
import { resolveShareUrls } from "./share-urls.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });

function ok(res: Response, body: unknown = "ok"): void {
  if (typeof body === "string") {
    res.type("text/plain").send(body);
  } else {
    res.json(body);
  }
}

export function createHttpApp(server: BizShuffleServer): Express {
  const app = express();
  const dataDir = server.dataDir;
  const staticDir = server.adminStaticDir;

  app.use(express.json({ limit: "2mb" }));

  app.get("/state.json", (_req, res) => {
    res.json({ state: server.snapshotState() });
  });

  app.get("/api/share_urls", async (_req, res) => {
    const st = server.snapshotState();
    const host = st.host ?? "127.0.0.1";
    const port = st.port ?? 8080;
    try {
      const urls = await resolveShareUrls(host, port);
      res.json(urls);
    } catch (err) {
      res.status(500).send(err instanceof Error ? err.message : String(err));
    }
  });

  app.get("/", (_req, res) => {
    res.sendFile(join(staticDir, "index.html"));
  });

  app.use("/assets", express.static(join(staticDir, "assets")));

  app.post("/api/start", (_req, res) => {
    server.updateStateAndPersist((st) => {
      st.running = true;
    });
    server.broadcastToPlayers({ cmd: "start", id: `${Date.now()}` });
    server.notifyScheduler();
    ok(res);
  });

  app.post("/api/pause", (_req, res) => {
    server.updateStateAndPersist((st) => {
      st.running = false;
    });
    server.broadcastToPlayers({ cmd: "pause", id: `${Date.now()}` });
    server.notifyScheduler();
    ok(res);
  });

  app.post("/api/clear_saves", (_req, res) => {
    const savesDir = join(dataDir, "saves");
    if (existsSync(savesDir)) {
      const trash = `${savesDir}.trash.${Date.now()}`;
      try {
        renameSync(savesDir, trash);
      } catch {
        /* ignore */
      }
    }
    mkdirSync(savesDir, { recursive: true });
    server.broadcastToPlayers({ cmd: "clear_saves", id: `${Date.now()}` });
    ok(res);
  });

  app.post("/api/toggle_swaps", (_req, res) => {
    server.updateStateAndPersist((st) => {
      st.swap_enabled = !st.swap_enabled;
      if (!st.swap_enabled) st.next_swap_at = 0;
    });
    server.notifyScheduler();
    ok(res);
  });

  app.post("/api/toggle_countdown", (_req, res) => {
    server.updateStateAndPersist((st) => {
      st.countdown_enabled = !st.countdown_enabled;
    });
    ok(res);
  });

  app.post("/api/toggle_prevent_same_game", (_req, res) => {
    server.updateStateAndPersist((st) => {
      st.prevent_same_game_swap = !st.prevent_same_game_swap;
    });
    ok(res);
  });

  app.post("/api/do_swap", (_req, res) => {
    void server.performSwap().catch((err) => console.error("do_swap:", err));
    ok(res);
  });

  app.post("/api/random_swap", async (req, res) => {
    const player = (req.body as { player?: string }).player ?? "";
    if (!player) {
      res.status(400).send("missing player");
      return;
    }
    try {
      await server.performRandomSwapForPlayer(player);
      ok(res);
    } catch (err) {
      res.status(400).send(err instanceof Error ? err.message : String(err));
    }
  });

  app.get("/api/mode", (_req, res) => {
    res.json({ mode: server.snapshotState().mode ?? "sync" });
  });

  app.post("/api/mode", (req, res) => {
    const mode = (req.body as { mode?: string }).mode;
    if (mode !== "sync" && mode !== "save") {
      res.status(400).send("invalid mode");
      return;
    }
    server.updateStateAndPersist((st) => {
      st.mode = mode;
    });
    ok(res);
  });

  app.post("/api/mode/setup", async (_req, res) => {
    try {
      if (await syncCatalogFromRoms(server)) {
        server.broadcastGamesUpdate();
      }
      ok(res);
    } catch (err) {
      res
        .status(400)
        .send(`something went wrong ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  app.get("/api/games", (_req, res) => {
    const { games, mainGames, instances } = server.session.snapshotGames();
    res.json({ main_games: mainGames, game_instances: instances, games });
  });

  app.post("/api/games", (req, res) => {
    const raw = req.body as Record<string, unknown>;
    server.updateStateAndPersist((st) => {
      if (Array.isArray(raw.games)) st.games = raw.games as string[];
      if (Array.isArray(raw.main_games)) st.main_games = raw.main_games as typeof st.main_games;
      if (Array.isArray(raw.game_instances)) {
        st.game_instances = (raw.game_instances as typeof st.game_instances)!.map((i) => ({
          ...i,
          file_state: i.file_state ?? "none",
        }));
      }
    });
    const st = server.snapshotState();
    server.broadcastToPlayers({
      cmd: "games_update",
      id: `${Date.now()}`,
      payload: {
        game_instances: st.game_instances,
        main_games: st.main_games,
        games: st.games,
      },
    });
    ok(res);
  });

  app.get("/api/interval", (_req, res) => {
    const st = server.snapshotState();
    res.json({
      min_interval_secs: st.min_interval_secs ?? 5,
      max_interval_secs: st.max_interval_secs ?? 300,
    });
  });

  app.post("/api/interval", (req, res) => {
    const body = req.body as { min_interval_secs?: number; max_interval_secs?: number };
    server.updateStateAndPersist((st) => {
      if (body.min_interval_secs) st.min_interval_secs = body.min_interval_secs;
      if (body.max_interval_secs) st.max_interval_secs = body.max_interval_secs;
    });
    ok(res);
  });

  app.post("/api/swap_player", async (req, res) => {
    const body = req.body as { player?: string; instance_id?: string; game?: string };
    let gameFile = body.game ?? "";
    if (!gameFile && body.instance_id) {
      const inst = (server.snapshotState().game_instances ?? []).find(
        (i) => i.id === body.instance_id
      );
      if (!inst) {
        res.status(400).send("instance not found");
        return;
      }
      gameFile = inst.game;
    }
    if (!gameFile || !body.player) {
      res.status(400).send("missing game or instance_id");
      return;
    }
    try {
      await server
        .getGameModeHandler()
        .handlePlayerSwap(body.player, gameFile, body.instance_id ?? "");
      res.status(200).end();
    } catch (err) {
      res.status(400).send(`handler: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  app.post("/api/remove_player", (req, res) => {
    const player = (req.body as { player?: string }).player ?? "";
    if (!player) {
      res.status(400).send("missing player");
      return;
    }
    server.updateStateAndPersist((st) => {
      delete st.players[player];
    });
    res.json({ result: "ok" });
  });

  app.post("/api/add_player", (req, res) => {
    const player = (req.body as { player?: string }).player ?? "";
    if (!player) {
      res.status(400).send("missing player");
      return;
    }
    server.updateStateAndPersist((st) => {
      st.players[player] ??= {
        name: player,
        connected: false,
        has_files: false,
        bizhawk_ready: false,
      };
    });
    res.json({ result: "ok" });
  });

  app.post("/api/swap_all_to_game", (req, res) => {
    const game = (req.body as { game?: string }).game ?? "";
    server.updateStateAndPersist((st) => {
      for (const [name, player] of Object.entries(st.players)) {
        player.game = game;
        st.players[name] = player;
      }
    });
    server.sendSwapAll();
    res.json({ result: "ok" });
  });

  app.post("/api/players/remove_all_completions", (_req, res) => {
    server.updateStateAndPersist((st) => {
      for (const [name, player] of Object.entries(st.players)) {
        player.completed_games = [];
        player.completed_instances = [];
        st.players[name] = player;
      }
    });
    res.json({ result: "ok" });
  });

  app.post("/api/players/:player/completed_games", (req, res) => {
    const game = (req.body as { game?: string }).game ?? "";
    if (!game) {
      res.status(400).send("missing game");
      return;
    }
    const playerName = req.params.player!;
    server.updateStateAndPersist((st) => {
      const p = st.players[playerName] ?? {
        name: playerName,
        has_files: false,
        connected: false,
        bizhawk_ready: false,
      };
      if (!(p.completed_games ?? []).includes(game)) {
        p.completed_games = [...(p.completed_games ?? []), game];
      }
      st.players[playerName] = p;
    });
    res.json({ result: "ok" });
  });

  app.delete("/api/players/:player/completed_games", (req, res) => {
    const game = req.query.game as string;
    const playerName = req.params.player!;
    server.updateStateAndPersist((st) => {
      const p = st.players[playerName];
      if (p) {
        p.completed_games = (p.completed_games ?? []).filter((g) => g !== game);
        st.players[playerName] = p;
      }
    });
    res.json({ result: "ok" });
  });

  app.post("/api/players/:player/completed_instances", (req, res) => {
    const instance = (req.body as { instance?: string }).instance ?? "";
    const playerName = req.params.player!;
    server.updateStateAndPersist((st) => {
      const p = st.players[playerName] ?? {
        name: playerName,
        has_files: false,
        connected: false,
        bizhawk_ready: false,
      };
      if (!(p.completed_instances ?? []).includes(instance)) {
        p.completed_instances = [...(p.completed_instances ?? []), instance];
      }
      st.players[playerName] = p;
    });
    res.json({ result: "ok" });
  });

  app.delete("/api/players/:player/completed_instances", (req, res) => {
    const instance = req.query.instance as string;
    const playerName = req.params.player!;
    server.updateStateAndPersist((st) => {
      const p = st.players[playerName];
      if (p) {
        p.completed_instances = (p.completed_instances ?? []).filter((i) => i !== instance);
        st.players[playerName] = p;
      }
    });
    res.json({ result: "ok" });
  });

  app.post("/api/games/:game/mark_completed_all", (req, res) => {
    const game = req.params.game!;
    server.updateStateAndPersist((st) => {
      for (const [name, player] of Object.entries(st.players)) {
        if (!(player.completed_games ?? []).includes(game)) {
          player.completed_games = [...(player.completed_games ?? []), game];
        }
        st.players[name] = player;
      }
    });
    res.json({ result: "ok" });
  });

  app.post("/api/instances/:instance/mark_completed_all", (req, res) => {
    const instance = req.params.instance!;
    server.updateStateAndPersist((st) => {
      for (const [name, player] of Object.entries(st.players)) {
        if (!(player.completed_instances ?? []).includes(instance)) {
          player.completed_instances = [...(player.completed_instances ?? []), instance];
        }
        st.players[name] = player;
      }
    });
    res.json({ result: "ok" });
  });

  app.get("/api/plugins", (_req, res) => {
    const pluginsDir = join(dataDir, "plugins");
    const plugins = { ...server.snapshotState().plugins, ...loadPluginsFromDisk(pluginsDir) };
    res.json({ plugins });
  });

  app.get("/api/plugins/:name", (req, res) => {
    const plugin = loadPluginMetadata(join(dataDir, "plugins"), req.params.name!);
    if (!plugin) {
      res.status(404).send("plugin not found");
      return;
    }
    const statePlugin = server.snapshotState().plugins?.[req.params.name!];
    res.json({
      ...plugin,
      status: statePlugin?.status ?? plugin.status,
    });
  });

  app.delete("/api/plugins/:name", (req, res) => {
    const pluginDir = join(dataDir, "plugins", req.params.name!);
    rmSync(pluginDir, { recursive: true, force: true });
    server.updateStateAndPersist((st) => {
      delete st.plugins?.[req.params.name!];
    });
    ok(res);
  });

  app.get("/api/plugins/:name/settings", (req, res) => {
    const settingsKV = join(dataDir, "plugins", req.params.name!, "settings.kv");
    res.json(loadSettingsKv(settingsKV));
  });

  app.post("/api/plugins/:name/settings", (req, res) => {
    const settings = req.body as Record<string, string>;
    if (!settings.status) {
      res.status(400).send("status field is required");
      return;
    }
    if (settings.status !== "enabled" && settings.status !== "disabled") {
      res.status(400).send("status must be 'enabled' or 'disabled'");
      return;
    }
    const pluginDir = join(dataDir, "plugins", req.params.name!);
    scanPluginsDir(join(dataDir, "plugins"));
    mkdirSync(pluginDir, { recursive: true });
    saveSettingsKv(settings, join(pluginDir, "settings.kv"));
    server.updateStateAndPersist((st) => {
      st.plugins ??= {};
      const existing = structuredClone(
        loadPluginMetadata(join(dataDir, "plugins"), req.params.name!) ?? {
          name: req.params.name!,
          version: "",
          description: "",
          author: "",
          bizhawk_version: "",
          status: "disabled",
        }
      ) as MutablePlugin;
      existing.status = settings.status as typeof existing.status;
      st.plugins[req.params.name!] = existing;
    });
    res.json({ status: "ok" });
  });

  app.post("/api/plugins/:name/reload", (req, res) => {
    server.broadcastToPlayers({
      cmd: "plugin_reload",
      id: `plugin-reload-${Date.now()}-${req.params.name}`,
      payload: { plugin_name: req.params.name },
    });
    res.json({ status: "ok" });
  });

  app.post("/api/open_roms_folder", (_req, res) => {
    const romsDir = join(dataDir, "roms");
    openPathInFileManager(romsDir);
    ok(res);
  });

  app.post("/api/open_plugins_folder", (_req, res) => {
    openPathInFileManager(join(dataDir, "plugins"));
    ok(res);
  });

  app.post("/api/message_player", (req, res) => {
    const b = req.body as {
      player?: string;
      message?: string;
      duration?: number;
      x?: number;
      y?: number;
      fontsize?: number;
      fg?: string;
      bg?: string;
    };
    if (!b.player || !b.message) {
      res.status(400).send("missing player or message");
      return;
    }
    const player = server.snapshotState().players[b.player];
    if (!player) {
      res.status(404).send("player not found");
      return;
    }
    try {
      server.sendToPlayer(player, {
        cmd: "message",
        id: `message-${Date.now()}`,
        payload: {
          message: b.message,
          duration: b.duration ?? 3,
          x: b.x ?? 10,
          y: b.y ?? 10,
          fontsize: b.fontsize ?? 12,
          fg: b.fg ?? "#FFFFFF",
          bg: b.bg ?? "#000000",
        },
      });
      res.json({ result: "ok" });
    } catch (err) {
      res.status(500).send(String(err));
    }
  });

  app.post("/api/message_all", (req, res) => {
    const b = req.body as { message?: string };
    if (!b.message) {
      res.status(400).send("missing message");
      return;
    }
    server.broadcastToPlayers({
      cmd: "message",
      id: `message-all-${Date.now()}`,
      payload: {
        message: b.message,
        duration: 3,
        x: 10,
        y: 10,
        fontsize: 12,
        fg: "#FFFFFF",
        bg: "#000000",
      },
    });
    res.json({ result: "ok" });
  });

  app.post("/api/fullscreen_toggle", (req, res) => {
    const playerName = (req.body as { player?: string }).player ?? "";
    const player = server.snapshotState().players[playerName];
    if (!player) {
      res.status(404).send("player not found");
      return;
    }
    try {
      server.sendToPlayer(player, {
        cmd: "fullscreen_toggle",
        id: `fs-${Date.now()}`,
        payload: {},
      });
      res.json({ result: "ok" });
    } catch (err) {
      res.status(500).send(String(err));
    }
  });

  app.post("/api/check_player_config", (req, res) => {
    const playerName = (req.body as { player?: string }).player ?? "";
    const player = server.snapshotState().players[playerName];
    if (!player) {
      res.status(404).send("player not found");
      return;
    }
    if (!player.connected) {
      res.status(400).send("player not connected");
      return;
    }
    server.sendToPlayer(player, {
      cmd: "check_config",
      id: `check-config-${Date.now()}`,
      payload: { config_keys: server.snapshotState().config_keys ?? [] },
    });
    res.json({ status: "command_sent" });
  });

  app.post("/api/update_player_config", (req, res) => {
    const b = req.body as { player?: string; config?: string };
    const player = b.player ? server.snapshotState().players[b.player] : undefined;
    if (!player) {
      res.status(404).send("player not found");
      return;
    }
    server.sendToPlayer(player, {
      cmd: "update_config",
      id: `update-config-${Date.now()}`,
      payload: { config_updates: b.config },
    });
    res.json({ status: "command_sent" });
  });

  app.post("/api/set_config_keys", (req, res) => {
    const keys = (req.body as { config_keys?: string[] }).config_keys ?? [];
    server.updateStateAndPersist((st) => {
      st.config_keys = keys;
    });
    res.json({ status: "config_keys_updated" });
  });

  app.get("/files/list.json", (_req, res) => {
    res.json(listRoms(dataDir));
  });

  app.use("/files/plugins", express.static(join(dataDir, "plugins")));
  app.use("/files", express.static(join(dataDir, "roms")));

  app.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      res.status(400).send("file missing");
      return;
    }
    const romsDir = join(dataDir, "roms");
    mkdirSync(romsDir, { recursive: true });
    const dst = join(romsDir, req.file.originalname);
    writeFileSync(dst, req.file.buffer);
    ok(res);
  });

  app.get("/api/BizhawkFiles.zip", (_req, res) => {
    res.status(404).send("BizhawkFiles not found");
  });

  app.post("/save/upload", upload.single("save"), (req, res) => {
    if (!req.file) {
      res.status(400).send("save file missing");
      return;
    }
    const filename = (req.body as { filename?: string }).filename ?? req.file.originalname;
    const instanceId = filename.replace(/\.state$/, "");
    const savesDir = join(dataDir, "saves");
    mkdirSync(savesDir, { recursive: true });
    writeFileSync(join(savesDir, filename), req.file.buffer);
    server.setInstanceFileState(instanceId, "ready");
    ok(res);
  });

  app.post("/save/no-save", express.urlencoded({ extended: true }), (req, res) => {
    const instanceId = (req.body as { instance_id?: string }).instance_id ?? "";
    if (!instanceId) {
      res.status(400).send("instance_id required");
      return;
    }
    server.setInstanceFileState(instanceId, "none");
    ok(res);
  });

  app.get("/save/:filename", async (req, res) => {
    const filename = req.params.filename!;
    const instanceId = filename.replace(/\.state$/, "");
    const savePath = join(dataDir, "saves", filename);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const inst = (server.snapshotState().game_instances ?? []).find((i) => i.id === instanceId);
      if (!inst || inst.file_state === "ready" || inst.file_state === "none") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!existsSync(savePath)) {
      server.setInstanceFileState(instanceId, "none");
      res.status(404).send("save file not found");
      return;
    }
    server.setInstanceFileState(instanceId, "ready");
    res.sendFile(savePath);
  });

  return app;
}
