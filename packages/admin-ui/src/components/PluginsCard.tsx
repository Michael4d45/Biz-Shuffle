import { useState } from "react";
import type { AdminTrigger } from "../adminActions.js";
import { fetchJson } from "../api.js";
import type { Plugin } from "../types.js";

type Props = {
  trigger: AdminTrigger;
  pushLog: (msg: string) => void;
};

export function PluginsCard({ trigger, pushLog }: Props) {
  const [plugins, setPlugins] = useState<Record<string, Plugin>>({});

  const loadPlugins = async () => {
    try {
      const body = await fetchJson<{ plugins: Record<string, Plugin> }>("/api/plugins");
      setPlugins(body.plugins ?? {});
    } catch (e) {
      pushLog(String(e));
    }
  };

  return (
    <section className="card">
      <h2>Plugins</h2>
      <div className="row">
        <button type="button" onClick={() => void loadPlugins()}>
          Refresh plugins
        </button>
        <button type="button" onClick={() => void trigger("/api/open_plugins_folder")}>
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
                void trigger(`/api/plugins/${encodeURIComponent(name)}/settings`, {
                  status: "enabled",
                })
              }
            >
              Enable
            </button>
            <button
              type="button"
              onClick={() =>
                void trigger(`/api/plugins/${encodeURIComponent(name)}/settings`, {
                  status: "disabled",
                })
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
  );
}
