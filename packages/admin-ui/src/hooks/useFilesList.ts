import { useCallback, useEffect, useState } from "react";
import { fetchFilesList } from "../api.js";

export function useFilesList(autoLoad = false) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFiles(await fetchFilesList());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoLoad) void refresh();
  }, [autoLoad, refresh]);

  return { files, loading, refresh };
}
