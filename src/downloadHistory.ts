export interface DownloadHistoryStatus {
  state: "ready" | "damaged" | "unsupported" | "unavailable";
  message: string;
  canReset: boolean;
  backupName?: string;
}

export function parseDownloadHistoryStatus(json: string): DownloadHistoryStatus {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Download history status is unavailable");
  const status = value as Record<string, unknown>;
  if (!["ready", "damaged", "unsupported", "unavailable"].includes(String(status.state)) || typeof status.message !== "string")
    throw new Error("Download history status is unavailable");
  return {
    state: status.state as DownloadHistoryStatus["state"],
    message: status.message,
    canReset: status.state === "damaged" && status.canReset === true,
    ...(typeof status.backupName === "string" ? { backupName: status.backupName } : {}),
  };
}
