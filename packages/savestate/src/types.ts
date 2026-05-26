export const SAVESTATE_ERROR_CODES = [
  "FILE_TOO_LARGE",
  "NOT_ZIP_SAVESTATE",
  "ZIP_CORRUPT",
  "DUPLICATE_LUMP",
  "MISSING_BIZSTATE_VERSION",
  "INVALID_BIZSTATE_VERSION",
  "MISSING_CORE_STATE",
  "MISSING_BIZ_VERSION",
  "EMU_VERSION_MISMATCH",
  "MISSING_SYNC_SETTINGS",
  "SYNC_SETTINGS_MISMATCH",
  "MOVIE_MISMATCH",
  "CORE_BLOB_SUSPECT",
] as const;

export type SavestateErrorCode = (typeof SAVESTATE_ERROR_CODES)[number];

export type VerifySavestateOptions = {
  maxFileBytes?: number;
  expectedEmuVersion?: string | null;
  expectedSyncSettings?: string | null;
  expectedMovieInputLog?: readonly string[] | null;
  systemId?: string | null;
};

export type VerifySavestateOk = {
  ok: true;
  formatVersion: string;
  zipSubVersion: number;
  frame: number | null;
  hasCoreText: boolean;
};

export type VerifySavestateFail = {
  ok: false;
  code: SavestateErrorCode;
  message: string;
  detail?: unknown;
};

export type VerifySavestateResult = VerifySavestateOk | VerifySavestateFail;
