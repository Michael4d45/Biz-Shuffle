import { useState } from "react";
import type { AdminTrigger } from "../adminActions.js";
import { playerStatusBadge } from "../status.js";
import type { Player, ServerState } from "../types.js";
import { ActionRow, Badge, Button, Card, EmptyState, FieldLabel, Input } from "./ui.js";

type Props = {
  state: ServerState | null;
  trigger: AdminTrigger;
};

function sortedPlayers(state: ServerState | null): Array<[string, Player]> {
  if (!state?.players) return [];
  return Object.entries(state.players).sort(([a], [b]) => a.localeCompare(b));
}

export function PlayersCard({ state, trigger }: Props) {
  const [newPlayer, setNewPlayer] = useState("");
  const [messageText, setMessageText] = useState("");
  const players = sortedPlayers(state);

  return (
    <Card
      title="Players"
      subtitle={`${players.length} registered · manage connections and broadcasts`}
      actions={
        <Button variant="ghost" onClick={() => void trigger("/api/players/remove_all_completions")}>
          Clear completions
        </Button>
      }
    >
      <ActionRow className="mb-4">
        <div className="min-w-[12rem] flex-1">
          <FieldLabel htmlFor="new-player">Add player</FieldLabel>
          <Input
            id="new-player"
            value={newPlayer}
            onChange={(e) => setNewPlayer(e.target.value)}
            placeholder="Player name"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !newPlayer.trim()) return;
              void trigger("/api/add_player", { player: newPlayer.trim() });
              setNewPlayer("");
            }}
          />
        </div>
        <div className="flex items-end">
          <Button
            variant="primary"
            onClick={() => {
              if (!newPlayer.trim()) return;
              void trigger("/api/add_player", { player: newPlayer.trim() });
              setNewPlayer("");
            }}
          >
            Add
          </Button>
        </div>
      </ActionRow>

      {players.length === 0 ? (
        <EmptyState>No players yet. Add a name above to register a slot.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-900/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Game</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {players.map(([name, p]) => {
                const status = playerStatusBadge(p);
                return (
                  <tr key={name} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2.5 font-medium text-slate-100">{name}</td>
                    <td className="px-3 py-2.5 text-slate-400">
                      <span className="text-slate-200">{p.game ?? "—"}</span>
                      {p.instance_id ? (
                        <span className="ml-1 font-mono text-[11px] text-slate-500">
                          {p.instance_id}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      {p.ping_ms != null ? (
                        <span className="ml-2 font-mono text-[11px] text-slate-500">
                          {p.ping_ms}ms
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <ActionRow className="justify-end">
                        <Button
                          variant="ghost"
                          onClick={() => void trigger("/api/random_swap", { player: name })}
                        >
                          Random
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => void trigger("/api/fullscreen_toggle", { player: name })}
                        >
                          Fullscreen
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => void trigger("/api/check_player_config", { player: name })}
                        >
                          Config
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => void trigger("/api/remove_player", { player: name })}
                        >
                          Remove
                        </Button>
                      </ActionRow>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Broadcast
        </p>
        <ActionRow>
          <div className="min-w-[12rem] flex-1">
            <Input
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Message shown to all players"
            />
          </div>
          <Button
            variant="primary"
            onClick={() => void trigger("/api/message_all", { message: messageText, duration: 3 })}
          >
            Send to all
          </Button>
        </ActionRow>
      </div>
    </Card>
  );
}
