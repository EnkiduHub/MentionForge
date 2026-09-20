import { jsonLog } from "./crypto";

export function logRequest(fields: Record<string, unknown>): void {
  jsonLog({ svc: "mentionforge", ...fields });
}
