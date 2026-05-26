import { useState } from "react";
import type { AdminTrigger } from "../adminActions.js";
import { postForm } from "../api.js";
import type { GameEntry, ServerState } from "../types.js";
import { ActionRow, Badge, Button, Card, EmptyState, FieldLabel } from "./ui.js";

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

  const enabledCount = (state?.games ?? []).length;
  const catalogCount = (state?.main_games ?? []).length;

  return (
    <Card
      title="Games & ROMs"
      subtitle={
        state?.mode === "sync"
          ? `${enabledCount} enabled of ${catalogCount} in catalog`
          : `${(state?.game_instances ?? []).length} save instances`
      }
      actions={
        <Button variant="ghost" onClick={() => void trigger("/api/open_roms_folder")}>
          Open ROMs folder
        </Button>
      }
    >
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
        <FieldLabel>Upload ROM</FieldLabel>
        <ActionRow className="mt-1">
          <input
            type="file"
            className="max-w-full flex-1 text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-slate-200 hover:file:bg-slate-600"
            onChange={(e) => setRomFile(e.target.files?.[0] ?? null)}
          />
          <Button variant="primary" onClick={() => void uploadRom()} disabled={!romFile}>
            Upload
          </Button>
        </ActionRow>
        {romFile ? (
          <p className="mt-2 truncate font-mono text-[11px] text-slate-500">{romFile.name}</p>
        ) : null}
      </div>

      <div className="mt-4 max-h-72 space-y-2 overflow-y-auto scrollbar-thin pr-1">
        {state?.mode === "sync" ? (
          (state.main_games ?? []).length === 0 ? (
            <EmptyState>No games in catalog. Add ROMs or use Add to catalog.</EmptyState>
          ) : (
            (state.main_games ?? []).map((g) => {
              const enabled = (state.games ?? []).includes(g.file);
              return (
                <div
                  key={g.file}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-600 bg-slate-900 text-emerald-600 focus:ring-emerald-500/40"
                      checked={enabled}
                      onChange={(e) => void toggleGame(g.file, e.target.checked)}
                    />
                    <span className="truncate font-mono text-xs text-slate-200">{g.file}</span>
                    {enabled ? <Badge variant="ok">In rotation</Badge> : null}
                  </label>
                  <ActionRow>
                    <Button
                      variant="ghost"
                      onClick={() => void trigger("/api/swap_all_to_game", { game: g.file })}
                    >
                      Swap all
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void trigger(`/api/games/${encodeURIComponent(g.file)}/mark_completed_all`)
                      }
                    >
                      Mark done
                    </Button>
                  </ActionRow>
                </div>
              );
            })
          )
        ) : (state?.game_instances ?? []).length === 0 ? (
          <EmptyState>No game instances in save mode.</EmptyState>
        ) : (
          (state?.game_instances ?? []).map((inst) => (
            <div
              key={inst.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="font-mono text-xs text-slate-200">{inst.id}</p>
                <p className="text-[11px] text-slate-500">
                  {inst.game} · <span className="text-slate-400">{inst.file_state}</span>
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() =>
                  void trigger(`/api/instances/${encodeURIComponent(inst.id)}/mark_completed_all`)
                }
              >
                Mark done all
              </Button>
            </div>
          ))
        )}
      </div>

      {state?.mode === "sync" ? (
        <Button
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => {
            const file = prompt("Add catalog file name");
            if (!file) return;
            void saveCatalog([...(state?.main_games ?? []), { file }]);
          }}
        >
          Add to catalog
        </Button>
      ) : null}
    </Card>
  );
}
