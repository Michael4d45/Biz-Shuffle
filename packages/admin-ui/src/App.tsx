import { useCallback, useMemo, useState } from "react";
import type { GameEntry, Player, Plugin } from "./types.js";
import { fetchJson, postForm } from "./api.js";
import { useAdmin } from "./useAdmin.js";

const SESSION_BUTTONS = [
  { label: "Start", path: "/api/start" },
  { label: "Pause", path: "/api/pause" },
  { label: "Do Swap", path: "/api/do_swap" },
  { label: "Auto Swaps", path: "/api/toggle_swaps", toggle: "swap_enabled" as const },
  { label: "Better Random", path: "/api/toggle_prevent_same_game", toggle: "prevent_same_game_swap" as const },
  { label: "Countdown", path: "/api/toggle_countdown", toggle: "countdown_enabled" as const },
  { label: "Clear Saves", path: "/api/clear_saves" },
];

export function App() {
  const { state, log, pushLog, wsConnected, refreshState, trigger } = useAdmin();
  const [intervalMin, setIntervalMin] = useState(5);
  const [intervalMax, setIntervalMax] = useState(10);
  const [newPlayer, setNewPlayer] = useState("");
  const [messageText, setMessageText] = useState("");
  const [plugins, setPlugins] = useState<Record<string, Plugin>>({});
  const [romFile, setRomFile] = useState<File | null>(null);

  const players = useMemo(() => {
    if (!state?.players) return [] as Array<[string, Player]>;
    return Object.entries(state.players).sort(([a], [b]) => a.localeCompare(b));
  }, [state]);

  const nextSwapDisplay = useMemo(() => {
    if (!state?.next_swap_at) return "—";
    const sec = Math.max(0, Math.floor(state.next_swap_at - Date.now() / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }, [state]);

  const swapProgress = useMemo(() => {
    if (!state?.next_swap_at || !state.min_interval_secs) return 0;
    const total = (state.max_interval_secs ?? state.min_interval_secs) || 300;
    const remaining = Math.max(0, state.next_swap_at - Date.now() / 1000);
    return Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
  }, [state]);

  const loadPlugins = useCallback(async () => {
    try {
      const body = await fetchJson<{ plugins: Record<string, Plugin> }>("/api/plugins");
      setPlugins(body.plugins ?? {});
    } catch (e) {
      pushLog(String(e));
    }
  }, [pushLog]);

  const saveInterval = () => void trigger("/api/interval", { min_interval_secs: intervalMin, max_interval_secs: intervalMax });
  const setMode = (mode: string) => void trigger("/api/mode", { mode });
  const modeSetup = () => void trigger("/api/mode/setup");
  const openRoms = () => void trigger("/api/open_roms_folder");
  const openPlugins = () => void trigger("/api/open_plugins_folder");

  const uploadRom = async () => {
    if (!romFile) return;
    const form = new FormData();
    form.append("file", romFile);
    const res = await postForm("/upload", form);
    pushLog(res.ok ? "ROM uploaded" : `upload failed ${res.status}`);
    setRomFile(null);
    await refreshState();
  };

  const toggleGame = async (file: string, enabled: boolean) => {
    const games = new Set(state?.games ?? []);
    if (enabled) games.add(file);
    else games.delete(file);
    await trigger("/api/games", { games: [...games] });
  };

  const saveCatalog = async (mainGames: GameEntry[]) => {
    await trigger("/api/games", { main_games: mainGames });
  };

  return (
    <main className="layout">
      <div className="progress-top" style={{ transform: `scaleX(${swapProgress / 100})` }} />

      <header className="row header">
        <h1>BizShuffle Admin</h1>
        <span className={wsConnected ? "ok" : "err"}>WS {wsConnected ? "on" : "off"}</span>
      </header>

      <div className="grid">
        <section className="card">
          <h2>Session</h2>
          <p>
            <strong className={state?.running ? "ok" : "err"}>{state?.running ? "Running" : "Stopped"}</strong>
          </p>
          <p>Next swap: {nextSwapDisplay}</p>
          <label>
            Mode{" "}
            <select value={state?.mode ?? "sync"} onChange={(e) => void setMode(e.target.value)}>
              <option value="sync">Sync</option>
              <option value="save">Save</option>
            </select>
          </label>
          <div className="row wrap">
            {SESSION_BUTTONS.map((btn) => (
              <button key={btn.path} type="button" onClick={() => void trigger(btn.path)}>
                {btn.label}
                {"toggle" in btn && state && btn.toggle ? ` (${state[btn.toggle] ? "On" : "Off"})` : null}
              </button>
            ))}
            <button type="button" onClick={() => void modeSetup()}>
              Auto Setup
            </button>
          </div>
          <div className="row">
            <input type="number" value={intervalMin} onChange={(e) => setIntervalMin(+e.target.value)} />
            <input type="number" value={intervalMax} onChange={(e) => setIntervalMax(+e.target.value)} />
            <button type="button" onClick={saveInterval}>
              Save interval
            </button>
          </div>
        </section>

        <section className="card span2">
          <h2>Players</h2>
          <div className="row">
            <input value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)} placeholder="Add player" />
            <button
              type="button"
              onClick={() => {
                if (!newPlayer.trim()) return;
                void trigger("/api/add_player", { player: newPlayer.trim() });
                setNewPlayer("");
              }}
            >
              Add
            </button>
            <button type="button" onClick={() => void trigger("/api/players/remove_all_completions")}>
              Clear all completions
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Game</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {players.map(([name, p]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>
                    {p.game ?? "—"}
                    {p.instance_id ? ` (${p.instance_id})` : ""}
                  </td>
                  <td>
                    {p.connected ? (p.bizhawk_ready ? "Ready" : "Connected") : "Offline"}
                    {p.ping_ms ? ` ${p.ping_ms}ms` : ""}
                  </td>
                  <td className="row wrap">
                    <button type="button" onClick={() => void trigger("/api/random_swap", { player: name })}>
                      Random
                    </button>
                    <button type="button" onClick={() => void trigger("/api/remove_player", { player: name })}>
                      Remove
                    </button>
                    <button type="button" onClick={() => void trigger("/api/fullscreen_toggle", { player: name })}>
                      Fullscreen
                    </button>
                    <button type="button" onClick={() => void trigger("/api/check_player_config", { player: name })}>
                      Config
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <input value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Message" />
            <button
              type="button"
              onClick={() =>
                void trigger("/api/message_all", { message: messageText, duration: 3 })
              }
            >
              Message all
            </button>
          </div>
        </section>

        <section className="card">
          <h2>Games ({state?.mode})</h2>
          <div className="row wrap">
            <button type="button" onClick={openRoms}>
              Open ROMs folder
            </button>
            <input type="file" onChange={(e) => setRomFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => void uploadRom()} disabled={!romFile}>
              Upload ROM
            </button>
          </div>
          {state?.mode === "sync" ? (
            <ul>
              {(state.main_games ?? []).map((g) => (
                <li key={g.file}>
                  <label>
                    <input
                      type="checkbox"
                      checked={(state.games ?? []).includes(g.file)}
                      onChange={(e) => void toggleGame(g.file, e.target.checked)}
                    />
                    {g.file}
                  </label>
                  <button type="button" onClick={() => void trigger("/api/swap_all_to_game", { game: g.file })}>
                    Swap all
                  </button>
                  <button
                    type="button"
                    onClick={() => void trigger(`/api/games/${encodeURIComponent(g.file)}/mark_completed_all`)}
                  >
                    Mark done all
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              {(state?.game_instances ?? []).map((inst) => (
                <li key={inst.id}>
                  {inst.id} — {inst.game} — {inst.file_state}
                  <button
                    type="button"
                    onClick={() =>
                      void trigger(`/api/instances/${encodeURIComponent(inst.id)}/mark_completed_all`)
                    }
                  >
                    Mark done all
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              const file = prompt("Add catalog file name");
              if (!file) return;
              void saveCatalog([...(state?.main_games ?? []), { file }]);
            }}
          >
            Add to catalog
          </button>
        </section>

        <section className="card">
          <h2>Plugins</h2>
          <div className="row">
            <button type="button" onClick={() => void loadPlugins()}>
              Refresh plugins
            </button>
            <button type="button" onClick={openPlugins}>
              Open folder
            </button>
          </div>
          <ul>
            {Object.entries(plugins).map(([name, p]) => (
              <li key={name}>
                {name} — {p.status}
                <button
                  type="button"
                  onClick={() =>
                    void trigger(`/api/plugins/${encodeURIComponent(name)}/settings`, { status: "enabled" })
                  }
                >
                  Enable
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void trigger(`/api/plugins/${encodeURIComponent(name)}/settings`, { status: "disabled" })
                  }
                >
                  Disable
                </button>
                <button
                  type="button"
                  onClick={() => void trigger(`/api/plugins/${encodeURIComponent(name)}/reload`)}
                >
                  Reload
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch(`/api/plugins/${encodeURIComponent(name)}`, { method: "DELETE" });
                    await loadPlugins();
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card span2">
          <h2>Logs</h2>
          <div className="log">{log.map((line, i) => <div key={i}>{line}</div>)}</div>
        </section>
      </div>
    </main>
  );
}
