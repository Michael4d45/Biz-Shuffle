import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ensureDirSync, pathExists, writeBytesAtomic } from "./bun-io.js";
import type { MutablePlugin } from "@bizshuffle-bun/protocol";
import { verifyBizHawkSavestate } from "@bizshuffle-bun/savestate";
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
import {
  HttpError,
  json,
  ok,
  readJsonBody,
  readUrlencodedBody,
  serveFile,
  serveUnderRoot,
  text,
} from "./http-utils.js";

const UPLOAD_LIMIT = 32 * 1024 * 1024;

function parseMessageStyleFields(b: Record<string, unknown>) {
  return {
    duration: (b.duration as number | undefined) ?? 3,
    x: (b.x as number | undefined) ?? 10,
    y: (b.y as number | undefined) ?? 10,
    fontsize: (b.fontsize as number | undefined) ?? 12,
    fg: (b.fg as string | undefined) ?? "#FFFFFF",
    bg: (b.bg as string | undefined) ?? "#000000",
  };
}

export async function handleHttpRequest(server: BizShuffleServer, req: Request): Promise<Response> {
  try {
    return await route(server, req);
  } catch (err) {
    if (err instanceof HttpError) return text(err.message, err.status);
    console.error("http:", err);
    return text(err instanceof Error ? err.message : String(err), 500);
  }
}

async function route(server: BizShuffleServer, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method.toUpperCase();
  const dataDir = server.dataDir;
  const staticDir = server.adminStaticDir;

  if (method === "GET" && pathname === "/state.json") {
    return json({ state: server.snapshotState() });
  }

  if (method === "GET" && pathname === "/api/share_urls") {
    const host = server.getBindHost();
    const port = server.getListeningPort();
    try {
      const urls = await resolveShareUrls(host, port);
      return json(urls);
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), 500);
    }
  }

  if (method === "GET" && pathname === "/") {
    const index = serveFile(join(staticDir, "index.html"));
    return index ?? text("not found", 404);
  }

  if (method === "GET" && pathname.startsWith("/assets/")) {
    const asset = serveUnderRoot(join(staticDir, "assets"), pathname.slice("/assets/".length));
    return asset ?? text("not found", 404);
  }

  if (method === "POST" && pathname === "/api/start") {
    server.updateStateAndPersist((st) => {
      st.running = true;
    });
    server.broadcastToPlayers({ cmd: "start", id: `${Date.now()}` });
    server.notifyScheduler();
    return ok();
  }

  if (method === "POST" && pathname === "/api/pause") {
    server.updateStateAndPersist((st) => {
      st.running = false;
    });
    server.broadcastToPlayers({ cmd: "pause", id: `${Date.now()}` });
    server.notifyScheduler();
    return ok();
  }

  if (method === "POST" && pathname === "/api/clear_saves") {
    const savesDir = join(dataDir, "saves");
    if (pathExists(savesDir)) {
      const trash = `${savesDir}.trash.${Date.now()}`;
      try {
        renameSync(savesDir, trash);
      } catch {
        /* ignore */
      }
    }
    ensureDirSync(savesDir);
    server.broadcastToPlayers({ cmd: "clear_saves", id: `${Date.now()}` });
    return ok();
  }

  if (method === "POST" && pathname === "/api/toggle_swaps") {
    server.updateStateAndPersist((st) => {
      st.swap_enabled = !st.swap_enabled;
      if (!st.swap_enabled) st.next_swap_at = 0;
    });
    server.notifyScheduler();
    return ok();
  }

  if (method === "POST" && pathname === "/api/toggle_countdown") {
    server.updateStateAndPersist((st) => {
      st.countdown_enabled = !st.countdown_enabled;
    });
    return ok();
  }

  if (method === "POST" && pathname === "/api/toggle_prevent_same_game") {
    server.updateStateAndPersist((st) => {
      st.prevent_same_game_swap = !st.prevent_same_game_swap;
    });
    return ok();
  }

  if (method === "POST" && pathname === "/api/do_swap") {
    try {
      await server.performSwap();
      return ok();
    } catch (err) {
      console.error("do_swap:", err);
      return text(String(err), 500);
    }
  }

  if (method === "POST" && pathname === "/api/random_swap") {
    const body = await readJsonBody(req);
    const player = (body.player as string | undefined) ?? "";
    if (!player) return text("missing player", 400);
    try {
      await server.performRandomSwapForPlayer(player);
      return ok();
    } catch (err) {
      return text(err instanceof Error ? err.message : String(err), 400);
    }
  }

  if (method === "GET" && pathname === "/api/mode") {
    return json({ mode: server.snapshotState().mode ?? "sync" });
  }

  if (method === "POST" && pathname === "/api/mode") {
    const body = await readJsonBody(req);
    const mode = body.mode as string | undefined;
    if (mode !== "sync" && mode !== "save") return text("invalid mode", 400);
    server.updateStateAndPersist((st) => {
      st.mode = mode;
    });
    return ok();
  }

  if (method === "POST" && pathname === "/api/mode/setup") {
    try {
      if (await syncCatalogFromRoms(server)) server.broadcastGamesUpdate();
      return ok();
    } catch (err) {
      return text(`something went wrong ${err instanceof Error ? err.message : String(err)}`, 400);
    }
  }

  if (method === "GET" && pathname === "/api/games") {
    const { games, mainGames, instances } = server.session.snapshotGames();
    return json({ main_games: mainGames, game_instances: instances, games });
  }

  if (method === "POST" && pathname === "/api/games") {
    const raw = await readJsonBody(req);
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
    return ok();
  }

  if (method === "GET" && pathname === "/api/interval") {
    const st = server.snapshotState();
    return json({
      min_interval_secs: st.min_interval_secs ?? 5,
      max_interval_secs: st.max_interval_secs ?? 300,
    });
  }

  if (method === "POST" && pathname === "/api/interval") {
    const body = await readJsonBody(req);
    server.updateStateAndPersist((st) => {
      if (typeof body.min_interval_secs === "number") st.min_interval_secs = body.min_interval_secs;
      if (typeof body.max_interval_secs === "number") st.max_interval_secs = body.max_interval_secs;
    });
    return ok();
  }

  if (method === "POST" && pathname === "/api/swap_player") {
    const body = await readJsonBody(req);
    let gameFile = (body.game as string | undefined) ?? "";
    const instanceId = (body.instance_id as string | undefined) ?? "";
    if (!gameFile && instanceId) {
      const inst = (server.snapshotState().game_instances ?? []).find((i) => i.id === instanceId);
      if (!inst) return text("instance not found", 400);
      gameFile = inst.game;
    }
    const player = (body.player as string | undefined) ?? "";
    if (!gameFile || !player) return text("missing game or instance_id", 400);
    try {
      await server.getGameModeHandler().handlePlayerSwap(player, gameFile, instanceId);
      return new Response(null, { status: 200 });
    } catch (err) {
      return text(`handler: ${err instanceof Error ? err.message : String(err)}`, 400);
    }
  }

  if (method === "POST" && pathname === "/api/remove_player") {
    const body = await readJsonBody(req);
    const player = (body.player as string | undefined) ?? "";
    if (!player) return text("missing player", 400);
    server.updateStateAndPersist((st) => {
      delete st.players[player];
    });
    return json({ result: "ok" });
  }

  if (method === "POST" && pathname === "/api/add_player") {
    const body = await readJsonBody(req);
    const player = (body.player as string | undefined) ?? "";
    if (!player) return text("missing player", 400);
    server.updateStateAndPersist((st) => {
      st.players[player] ??= {
        name: player,
        connected: false,
        has_files: false,
        bizhawk_ready: false,
      };
    });
    return json({ result: "ok" });
  }

  if (method === "POST" && pathname === "/api/swap_all_to_game") {
    const body = await readJsonBody(req);
    const game = (body.game as string | undefined) ?? "";
    server.updateStateAndPersist((st) => {
      for (const [name, player] of Object.entries(st.players)) {
        player.game = game;
        st.players[name] = player;
      }
    });
    server.sendSwapAll();
    return json({ result: "ok" });
  }

  if (method === "POST" && pathname === "/api/players/remove_all_completions") {
    server.updateStateAndPersist((st) => {
      for (const [name, player] of Object.entries(st.players)) {
        player.completed_games = [];
        player.completed_instances = [];
        st.players[name] = player;
      }
    });
    return json({ result: "ok" });
  }

  const playerCompletedGames = pathname.match(/^\/api\/players\/([^/]+)\/completed_games$/);
  if (playerCompletedGames) {
    const playerName = decodeURIComponent(playerCompletedGames[1]!);
    if (method === "POST") {
      const body = await readJsonBody(req);
      const game = (body.game as string | undefined) ?? "";
      if (!game) return text("missing game", 400);
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
      return json({ result: "ok" });
    }
    if (method === "DELETE") {
      const game = url.searchParams.get("game") ?? "";
      server.updateStateAndPersist((st) => {
        const p = st.players[playerName];
        if (p) {
          p.completed_games = (p.completed_games ?? []).filter((g) => g !== game);
          st.players[playerName] = p;
        }
      });
      return json({ result: "ok" });
    }
  }

  const playerCompletedInstances = pathname.match(/^\/api\/players\/([^/]+)\/completed_instances$/);
  if (playerCompletedInstances) {
    const playerName = decodeURIComponent(playerCompletedInstances[1]!);
    if (method === "POST") {
      const body = await readJsonBody(req);
      const instance = (body.instance as string | undefined) ?? "";
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
      return json({ result: "ok" });
    }
    if (method === "DELETE") {
      const instance = url.searchParams.get("instance") ?? "";
      server.updateStateAndPersist((st) => {
        const p = st.players[playerName];
        if (p) {
          p.completed_instances = (p.completed_instances ?? []).filter((i) => i !== instance);
          st.players[playerName] = p;
        }
      });
      return json({ result: "ok" });
    }
  }

  const markGameCompleted = pathname.match(/^\/api\/games\/([^/]+)\/mark_completed_all$/);
  if (markGameCompleted && method === "POST") {
    const game = decodeURIComponent(markGameCompleted[1]!);
    server.updateStateAndPersist((st) => {
      for (const [name, player] of Object.entries(st.players)) {
        if (!(player.completed_games ?? []).includes(game)) {
          player.completed_games = [...(player.completed_games ?? []), game];
        }
        st.players[name] = player;
      }
    });
    return json({ result: "ok" });
  }

  const markInstanceCompleted = pathname.match(/^\/api\/instances\/([^/]+)\/mark_completed_all$/);
  if (markInstanceCompleted && method === "POST") {
    const instance = decodeURIComponent(markInstanceCompleted[1]!);
    server.updateStateAndPersist((st) => {
      for (const [name, player] of Object.entries(st.players)) {
        if (!(player.completed_instances ?? []).includes(instance)) {
          player.completed_instances = [...(player.completed_instances ?? []), instance];
        }
        st.players[name] = player;
      }
    });
    return json({ result: "ok" });
  }

  if (method === "GET" && pathname === "/api/plugins") {
    const pluginsDir = join(dataDir, "plugins");
    const plugins = { ...server.snapshotState().plugins, ...loadPluginsFromDisk(pluginsDir) };
    return json({ plugins });
  }

  const pluginByName = pathname.match(/^\/api\/plugins\/([^/]+)$/);
  if (pluginByName) {
    const name = decodeURIComponent(pluginByName[1]!);
    if (method === "GET") {
      const plugin = loadPluginMetadata(join(dataDir, "plugins"), name);
      if (!plugin) return text("plugin not found", 404);
      const statePlugin = server.snapshotState().plugins?.[name];
      return json({ ...plugin, status: statePlugin?.status ?? plugin.status });
    }
    if (method === "DELETE") {
      rmSync(join(dataDir, "plugins", name), { recursive: true, force: true });
      server.updateStateAndPersist((st) => {
        delete st.plugins?.[name];
      });
      return ok();
    }
  }

  const pluginSettings = pathname.match(/^\/api\/plugins\/([^/]+)\/settings$/);
  if (pluginSettings) {
    const name = decodeURIComponent(pluginSettings[1]!);
    if (method === "GET") {
      return json(loadSettingsKv(join(dataDir, "plugins", name, "settings.kv")));
    }
    if (method === "POST") {
      const incoming = (await readJsonBody(req)) as Record<string, string>;
      const settingsPath = join(dataDir, "plugins", name, "settings.kv");
      const settings = { ...loadSettingsKv(settingsPath), ...incoming };
      if (!settings.status) return text("status field is required", 400);
      if (settings.status !== "enabled" && settings.status !== "disabled") {
        return text("status must be 'enabled' or 'disabled'", 400);
      }
      const pluginDir = join(dataDir, "plugins", name);
      scanPluginsDir(join(dataDir, "plugins"));
      ensureDirSync(pluginDir);
      saveSettingsKv(settings, join(pluginDir, "settings.kv"));
      server.updateStateAndPersist((st) => {
        st.plugins ??= {};
        const existing = structuredClone(
          loadPluginMetadata(join(dataDir, "plugins"), name) ?? {
            name,
            version: "",
            description: "",
            author: "",
            bizhawk_version: "",
            status: "disabled",
          }
        ) as MutablePlugin;
        existing.status = settings.status as typeof existing.status;
        st.plugins[name] = existing;
      });
      return json({ status: "ok" });
    }
  }

  const pluginReload = pathname.match(/^\/api\/plugins\/([^/]+)\/reload$/);
  if (pluginReload && method === "POST") {
    const name = decodeURIComponent(pluginReload[1]!);
    server.broadcastToPlayers({
      cmd: "plugin_reload",
      id: `plugin-reload-${Date.now()}-${name}`,
      payload: { plugin_name: name },
    });
    return json({ status: "ok" });
  }

  if (method === "POST" && pathname === "/api/open_roms_folder") {
    openPathInFileManager(join(dataDir, "roms"));
    return ok();
  }

  if (method === "POST" && pathname === "/api/open_plugins_folder") {
    openPathInFileManager(join(dataDir, "plugins"));
    return ok();
  }

  if (method === "POST" && pathname === "/api/message_player") {
    const b = await readJsonBody(req);
    const playerName = (b.player as string | undefined) ?? "";
    const message = (b.message as string | undefined) ?? "";
    if (!playerName || !message) return text("missing player or message", 400);
    const player = server.snapshotState().players[playerName];
    if (!player) return text("player not found", 404);
    try {
      server.sendToPlayer(player, {
        cmd: "message",
        id: `message-${Date.now()}`,
        payload: { message, ...parseMessageStyleFields(b) },
      });
      return json({ result: "ok" });
    } catch (err) {
      return text(String(err), 500);
    }
  }

  if (method === "POST" && pathname === "/api/message_all") {
    const b = await readJsonBody(req);
    const message = (b.message as string | undefined) ?? "";
    if (!message) return text("missing message", 400);
    server.broadcastToPlayers({
      cmd: "message",
      id: `message-all-${Date.now()}`,
      payload: { message, ...parseMessageStyleFields(b) },
    });
    return json({ result: "ok" });
  }

  if (method === "POST" && pathname === "/api/fullscreen_toggle") {
    const body = await readJsonBody(req);
    const playerName = (body.player as string | undefined) ?? "";
    const player = server.snapshotState().players[playerName];
    if (!player) return text("player not found", 404);
    try {
      server.sendToPlayer(player, {
        cmd: "fullscreen_toggle",
        id: `fs-${Date.now()}`,
        payload: {},
      });
      return json({ result: "ok" });
    } catch (err) {
      return text(String(err), 500);
    }
  }

  if (method === "POST" && pathname === "/api/check_player_config") {
    const body = await readJsonBody(req);
    const playerName = (body.player as string | undefined) ?? "";
    const player = server.snapshotState().players[playerName];
    if (!player) return text("player not found", 404);
    if (!player.connected) return text("player not connected", 400);
    server.sendToPlayer(player, {
      cmd: "check_config",
      id: `check-config-${Date.now()}`,
      payload: { config_keys: server.snapshotState().config_keys ?? [] },
    });
    return json({ status: "command_sent" });
  }

  if (method === "POST" && pathname === "/api/update_player_config") {
    const b = await readJsonBody(req);
    const player = b.player ? server.snapshotState().players[b.player as string] : undefined;
    if (!player) return text("player not found", 404);
    try {
      server.sendToPlayer(player, {
        cmd: "update_config",
        id: `update-config-${Date.now()}`,
        payload: { config_updates: b.config },
      });
      return json({ status: "command_sent" });
    } catch (err) {
      return text(String(err), 500);
    }
  }

  if (method === "POST" && pathname === "/api/set_config_keys") {
    const body = await readJsonBody(req);
    const keys = (body.config_keys as string[] | undefined) ?? [];
    server.updateStateAndPersist((st) => {
      st.config_keys = keys;
    });
    return json({ status: "config_keys_updated" });
  }

  if (method === "GET" && pathname === "/files/list.json") {
    return json(listRoms(dataDir));
  }

  if (method === "GET" && pathname.startsWith("/files/plugins/")) {
    const file = serveUnderRoot(join(dataDir, "plugins"), pathname.slice("/files/plugins/".length));
    return file ?? text("not found", 404);
  }

  if (method === "GET" && pathname.startsWith("/files/")) {
    const file = serveUnderRoot(join(dataDir, "roms"), pathname.slice("/files/".length));
    return file ?? text("not found", 404);
  }

  if (method === "POST" && pathname === "/upload") {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return text("file missing", 400);
    if (file.size > UPLOAD_LIMIT) return text("file too large", 413);
    const romsDir = join(dataDir, "roms");
    ensureDirSync(romsDir);
    const dst = join(romsDir, file.name);
    await writeBytesAtomic(dst, Buffer.from(await file.arrayBuffer()));
    return ok();
  }

  if (method === "GET" && pathname === "/api/BizhawkFiles.zip") {
    return text("BizhawkFiles not found", 404);
  }

  if (method === "POST" && pathname === "/save/upload") {
    const form = await req.formData();
    const save = form.get("save");
    if (!(save instanceof File)) return text("save file missing", 400);
    if (save.size > UPLOAD_LIMIT) return text("save file too large", 413);
    const filename = (form.get("filename") as string | null) ?? save.name;
    const instanceId = filename.replace(/\.state$/, "");
    const buffer = Buffer.from(await save.arrayBuffer());
    const verified = verifyBizHawkSavestate(buffer);
    if (!verified.ok) {
      return json(
        {
          error: "INVALID_SAVESTATE",
          code: verified.code,
          message: verified.message,
          detail: verified.detail,
        },
        422
      );
    }
    const savesDir = join(dataDir, "saves");
    ensureDirSync(savesDir);
    await writeBytesAtomic(join(savesDir, filename), buffer);
    server.setInstanceFileState(instanceId, "ready");
    return ok();
  }

  if (method === "POST" && pathname === "/save/no-save") {
    const body = await readUrlencodedBody(req);
    const instanceId = body.instance_id ?? "";
    if (!instanceId) return text("instance_id required", 400);
    server.setInstanceFileState(instanceId, "none");
    return ok();
  }

  const saveFile = pathname.match(/^\/save\/([^/]+)$/);
  if (saveFile && method === "GET") {
    const filename = decodeURIComponent(saveFile[1]!);
    const instanceId = filename.replace(/\.state$/, "");
    const savePath = join(dataDir, "saves", filename);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const inst = (server.snapshotState().game_instances ?? []).find((i) => i.id === instanceId);
      if (!inst || inst.file_state === "ready" || inst.file_state === "none") break;
      await Bun.sleep(100);
    }
    if (!pathExists(savePath)) return text("save file not found", 404);
    server.setInstanceFileState(instanceId, "ready");
    const file = serveFile(savePath);
    return file ?? text("save file not found", 404);
  }

  return text("not found", 404);
}
