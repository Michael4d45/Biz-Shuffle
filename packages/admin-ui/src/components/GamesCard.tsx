import { useState } from "react";
import type { AdminTrigger } from "../adminActions.js";
import { postForm } from "../api.js";
import type { GameEntry, ServerState } from "../types.js";

type Props = {
  state: ServerState | null;
  trigger: AdminTrigger;
  pushLog: (msg: string) => void;
  refreshState: () => Promise<ServerState | null>;
};

export function GamesCard({ state, trigger, pushLog, refreshState }: Props) {
  const [romFile, setRomFile] = useState<File | null>(null);

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
    <section className="card">
      <h2>Games ({state?.mode})</h2>
      <div className="row wrap">
        <button type="button" onClick={() => void trigger("/api/open_roms_folder")}>
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
              <button
                type="button"
                onClick={() => void trigger("/api/swap_all_to_game", { game: g.file })}
              >
                Swap all
              </button>
              <button
                type="button"
                onClick={() =>
                  void trigger(`/api/games/${encodeURIComponent(g.file)}/mark_completed_all`)
                }
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
  );
}
