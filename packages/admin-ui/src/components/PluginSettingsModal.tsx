import { useEffect, useState } from "react";
import { getPluginDetails, getPluginSettings, postPluginSettings } from "../api.js";
import type { Plugin } from "../types.js";
import { Modal } from "./Modal.js";
import { Button, FieldLabel, Input, Select } from "./ui.js";

type Props = {
  open: boolean;
  pluginName: string | null;
  onClose: () => void;
  onSaved: () => void;
  onLog: (msg: string) => void;
};

export function PluginSettingsModal({ open, pluginName, onClose, onSaved, onLog }: Props) {
  const [details, setDetails] = useState<Plugin | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    if (!open || !pluginName) return;
    void (async () => {
      try {
        const [meta, kv] = await Promise.all([
          getPluginDetails(pluginName),
          getPluginSettings(pluginName),
        ]);
        setDetails(meta);
        setSettings(kv);
      } catch (e) {
        onLog(String(e));
      }
    })();
  }, [open, pluginName, onLog]);

  const save = async () => {
    if (!pluginName) return;
    const res = await postPluginSettings(pluginName, settings);
    if (res.ok) {
      onLog("plugin settings saved");
      onSaved();
      onClose();
    } else {
      onLog("failed to save plugin settings");
    }
  };

  const settingKeys = Object.keys(settings).filter((k) => k !== "status");

  return (
    <Modal
      open={open}
      wide
      title={pluginName ? `Plugin: ${pluginName}` : "Plugin settings"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save settings
          </Button>
        </>
      }
    >
      {details ? (
        <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500">
          <p>{details.description || "No description"}</p>
          <p className="mt-1">
            v{details.version} · {details.author} · BizHawk {details.bizhawk_version}
          </p>
        </div>
      ) : null}
      <div className="mb-3">
        <FieldLabel>Status</FieldLabel>
        <Select
          value={settings.status ?? "disabled"}
          onChange={(e) => setSettings((s) => ({ ...s, status: e.target.value }))}
        >
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </Select>
      </div>
      {settingKeys.map((key) => {
        const meta = details?.settings_meta?.[key];
        return (
          <div key={key} className="mb-3">
            <FieldLabel>{key}</FieldLabel>
            {meta?.type === "dropdown" && meta.options ? (
              <Select
                value={settings[key] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
              >
                {meta.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            ) : meta?.type === "multiselect" && meta.options ? (
              <div className="mt-1 space-y-1">
                {meta.options.map((opt) => {
                  const selected = (settings[key] ?? "").split(",").filter(Boolean);
                  const checked = selected.includes(opt);
                  return (
                    <label key={opt} className="flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(opt);
                          else next.delete(opt);
                          setSettings((s) => ({
                            ...s,
                            [key]: [...next].join(","),
                          }));
                        }}
                      />
                      {opt}
                    </label>
                  );
                })}
              </div>
            ) : (
              <Input
                value={settings[key] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
              />
            )}
          </div>
        );
      })}
      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
        <p className="mb-2 text-[11px] font-medium text-slate-500">Add setting</p>
        <div className="flex gap-2">
          <Input placeholder="Key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <Input
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!newKey}
            onClick={() => {
              setSettings((s) => ({ ...s, [newKey]: newValue }));
              setNewKey("");
              setNewValue("");
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}
