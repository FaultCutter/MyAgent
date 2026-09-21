import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResponseInput } from "openai/resources/responses/responses";

export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  history: ResponseInput;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  title: string;
}

// 在本地目录中维护多个独立会话，并以最近使用的会话作为当前会话。
export class SessionStore {
  private readonly sessionsDirectory: string;
  private readonly legacySessionPath: string;

  // 创建使用指定数据目录的会话存储器。
  constructor(rootDirectory = path.resolve(".myagent")) {
    this.sessionsDirectory = path.join(rootDirectory, "sessions");
    this.legacySessionPath = path.join(rootDirectory, "session.json");
  }

  // 创建并立即持久化一个新的当前会话。
  async create(history: ResponseInput = []): Promise<SessionData> {
    const timestamp = await this.nextUpdatedAt();
    const session: SessionData = {
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      history
    };

    await this.writeSession(session);
    return session;
  }

  // 加载最近使用的已有会话；确实无会话时才创建。
  async loadCurrent(): Promise<SessionData> {
    const existingSessions = await this.list();
    const latestSession = existingSessions[0];
    if (latestSession) {
      return this.load(latestSession.id);
    }

    const legacyHistory = await this.loadLegacyHistory();
    return this.create(legacyHistory);
  }

  // 按 ID 加载一个已保存的会话。
  async load(sessionId: string): Promise<SessionData> {
    this.assertSessionId(sessionId);
    const parsed: unknown = JSON.parse(
      await readFile(path.join(this.sessionsDirectory, `${sessionId}.json`), "utf8")
    );
    return this.parseSessionData(parsed);
  }

  // 保存指定会话的完整历史，并刷新更新时间。
  async save(sessionId: string, history: ResponseInput): Promise<SessionData> {
    const current = await this.load(sessionId);
    const session: SessionData = {
      ...current,
      updatedAt: await this.nextUpdatedAt(),
      history
    };

    await this.writeSession(session);
    return session;
  }

  // 列出全部会话，最近更新的排在前面。
  async list(): Promise<SessionSummary[]> {
    try {
      const fileNames = await readdir(this.sessionsDirectory);
      const sessions = await Promise.all(
        fileNames
          .filter((fileName) => fileName.endsWith(".json"))
          .map((fileName) => this.load(path.basename(fileName, ".json")))
      );

      return sessions
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((session) => ({
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          itemCount: session.history.length,
          title: this.sessionTitle(session.history)
        }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  // 将一个已有会话设为当前会话。
  async select(sessionId: string): Promise<SessionData> {
    const session = await this.load(sessionId);
    const selectedSession: SessionData = {
      ...session,
      updatedAt: await this.nextUpdatedAt()
    };
    await this.writeSession(selectedSession);
    return selectedSession;
  }

  // 删除指定会话；删除当前或最后一个会话时保证仍有可用的当前会话。
  async delete(sessionId: string): Promise<SessionData> {
    await this.load(sessionId);
    const currentSession = await this.loadCurrent();
    await rm(path.join(this.sessionsDirectory, `${sessionId}.json`));

    if (currentSession.id !== sessionId) {
      return currentSession;
    }

    const remainingSessions = await this.list();
    const nextSession = remainingSessions[0];
    return nextSession ? this.select(nextSession.id) : this.create();
  }

  // 把会话记录写入它自己的 JSON 文件。
  private async writeSession(session: SessionData): Promise<void> {
    await mkdir(this.sessionsDirectory, { recursive: true });
    await writeFile(
      path.join(this.sessionsDirectory, `${session.id}.json`),
      JSON.stringify(session, null, 2),
      "utf8"
    );
  }

  // 生成严格晚于现有会话的更新时间，使新建和选择在快速连续操作时仍可稳定恢复。
  private async nextUpdatedAt(): Promise<string> {
    const latest = (await this.list())[0];
    const latestTime = latest ? Date.parse(latest.updatedAt) : 0;
    const timestamp = Math.max(Date.now(), Number.isNaN(latestTime) ? 0 : latestTime + 1);
    return new Date(timestamp).toISOString();
  }

  // 读取旧版 session.json；不存在时返回空历史。
  private async loadLegacyHistory(): Promise<ResponseInput> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.legacySessionPath, "utf8"));

      if (!Array.isArray(parsed)) {
        throw new Error("Legacy session file must contain a JSON array.");
      }

      return parsed as ResponseInput;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  // 校验磁盘中的会话记录结构。
  private parseSessionData(value: unknown): SessionData {
    if (!value || typeof value !== "object") {
      throw new Error("Session file must contain an object.");
    }

    const candidate = value as Partial<SessionData>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.updatedAt !== "string" ||
      !Array.isArray(candidate.history)
    ) {
      throw new Error("Session file has an invalid structure.");
    }

    this.assertSessionId(candidate.id);
    return candidate as SessionData;
  }

  // 限制会话 ID 为本进程生成的 UUID，避免越界访问文件。
  private assertSessionId(sessionId: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      throw new Error("Invalid session ID.");
    }
  }

  // 使用第一条用户文本为会话生成简短标题。
  private sessionTitle(history: ResponseInput): string {
    for (const item of history as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as { role?: string; content?: unknown };
      if (candidate.role === "user" && typeof candidate.content === "string") {
        const text = candidate.content.trim();
        if (text) return text.length > 30 ? `${text.slice(0, 30)}…` : text;
      }
    }

    return "新会话";
  }
}
