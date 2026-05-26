import { useState } from "react";
import type { AdminTrigger } from "../adminActions.js";
import type { Player, ServerState } from "../types.js";

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
    <section className="card span2">
      <h2>Players</h2>
      <div className="row">
        <input
          value={newPlayer}
          onChange={(e) => setNewPlayer(e.target.value)}
          placeholder="Add player"
        />
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
                <button
                  type="button"
                  onClick={() => void trigger("/api/random_swap", { player: name })}
                >
                  Random
                </button>
                <button
                  type="button"
                  onClick={() => void trigger("/api/remove_player", { player: name })}
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => void trigger("/api/fullscreen_toggle", { player: name })}
                >
                  Fullscreen
                </button>
                <button
                  type="button"
                  onClick={() => void trigger("/api/check_player_config", { player: name })}
                >
                  Config
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <input
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          placeholder="Message"
        />
        <button
          type="button"
          onClick={() => void trigger("/api/message_all", { message: messageText, duration: 3 })}
        >
          Message all
        </button>
      </div>
    </section>
  );
}
