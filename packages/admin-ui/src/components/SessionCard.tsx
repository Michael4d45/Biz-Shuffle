import { useState } from "react";
import type { AdminTrigger } from "../adminActions.js";
import { SESSION_BUTTONS } from "../sessionButtons.js";
import { nextSwapDisplay } from "../swapDisplay.js";
import type { ServerState } from "../types.js";

type Props = {
  state: ServerState | null;
  trigger: AdminTrigger;
};

export function SessionCard({ state, trigger }: Props) {
  const [intervalMin, setIntervalMin] = useState(5);
  const [intervalMax, setIntervalMax] = useState(10);

  return (
    <section className="card">
      <h2>Session</h2>
      <p>
        <strong className={state?.running ? "ok" : "err"}>
          {state?.running ? "Running" : "Stopped"}
        </strong>
      </p>
      <p>Next swap: {nextSwapDisplay(state)}</p>
      <label>
        Mode{" "}
        <select
          value={state?.mode ?? "sync"}
          onChange={(e) => void trigger("/api/mode", { mode: e.target.value })}
        >
          <option value="sync">Sync</option>
          <option value="save">Save</option>
        </select>
      </label>
      <div className="row wrap">
        {SESSION_BUTTONS.map((btn) => (
          <button key={btn.path} type="button" onClick={() => void trigger(btn.path)}>
            {btn.label}
            {"toggle" in btn && state && btn.toggle
              ? ` (${state[btn.toggle] ? "On" : "Off"})`
              : null}
          </button>
        ))}
        <button type="button" onClick={() => void trigger("/api/mode/setup")}>
          Auto Setup
        </button>
      </div>
      <div className="row">
        <input
          type="number"
          value={intervalMin}
          onChange={(e) => setIntervalMin(+e.target.value)}
        />
        <input
          type="number"
          value={intervalMax}
          onChange={(e) => setIntervalMax(+e.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            void trigger("/api/interval", {
              min_interval_secs: intervalMin,
              max_interval_secs: intervalMax,
            })
          }
        >
          Save interval
        </button>
      </div>
    </section>
  );
}
