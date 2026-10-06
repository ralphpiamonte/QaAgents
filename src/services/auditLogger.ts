import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

interface AuditEvent {
  event: string;
  issueKey?: string;
  details?: Record<string, unknown>;
}

export class AuditLogger {
  constructor(private readonly logPath: string) {}

  async log(entry: AuditEvent): Promise<void> {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry
    });

    const dir = path.dirname(this.logPath);
    await mkdir(dir, { recursive: true });
    await appendFile(this.logPath, line + "\n", "utf8");
  }
}

