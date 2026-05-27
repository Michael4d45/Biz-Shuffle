import type { SavestateErrorCode } from "@bizshuffle-bun/savestate";

export class SaveUploadRejectedError extends Error {
  readonly name = "SaveUploadRejectedError";

  constructor(
    readonly code: SavestateErrorCode | "INVALID_SAVESTATE",
    message: string
  ) {
    super(message);
  }
}

export function parseSaveUploadRejected(
  status: number,
  body: string
): SaveUploadRejectedError | null {
  if (status !== 422) return null;
  try {
    const parsed = JSON.parse(body) as { code?: string; message?: string };
    const code = (parsed.code ?? "INVALID_SAVESTATE") as SavestateErrorCode | "INVALID_SAVESTATE";
    return new SaveUploadRejectedError(code, parsed.message ?? body);
  } catch {
    return new SaveUploadRejectedError("INVALID_SAVESTATE", body || "save rejected");
  }
}
