import { Server as SocketIOServer, Socket as SocketIOSocket } from "socket.io";
import { Server as HTTPServer } from "node:http";
import { logger } from "./logger.js";

export interface IOServer {
  io: SocketIOServer;
  getSocket: () => SocketIOSocket | null;
  broadcast: (event: string, data: any) => void;
}

let ioInstance: SocketIOServer | null = null;
let currentSocket: SocketIOSocket | null = null;

export function initializeIO(httpServer: HTTPServer): SocketIOServer {
  if (ioInstance) {
    return ioInstance;
  }

  ioInstance = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  ioInstance.on("connection", (socket: SocketIOSocket) => {
    currentSocket = socket;
    logger.info(`Socket.IO 客户端连接: ${socket.id}`);

    socket.on("disconnect", (reason) => {
      logger.info(`Socket.IO 客户端断开: ${socket.id}, 原因: ${reason}`);
      if (currentSocket?.id === socket.id) {
        currentSocket = null;
      }
    });

    socket.on("error", (err: Error) => {
      logger.error(`Socket.IO 错误: ${socket.id}`, err);
    });
  });

  logger.info("Socket.IO 服务器已初始化");
  return ioInstance;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function getCurrentSocket(): SocketIOSocket | null {
  return currentSocket;
}

export function sendToSocket(event: string, data: any): void {
  if (currentSocket && currentSocket.connected) {
    try {
      const message = JSON.stringify({ status: event, result: data });
      logger.debug(`发送 Socket.IO 消息: ${event}`);
      currentSocket.emit(event, data);
    } catch (err) {
      logger.error(`发送 Socket.IO 消息失败: ${event}`, err as Error);
    }
  } else {
    logger.warn(`无法发送消息，客户端未连接: ${event}`);
  }
}

export function broadcastToRoom(room: string, event: string, data: any): void {
  if (ioInstance) {
    ioInstance.to(room).emit(event, data);
  }
}

export function broadcast(event: string, data: any): void {
  if (ioInstance) {
    ioInstance.emit(event, data);
  }
}

export class MessageIO {
  private socket: SocketIOSocket;

  constructor(socket: SocketIOSocket) {
    this.socket = socket;

    this.socket.on("error", (err: Error) => {
      logger.error("Socket.IO 错误", err);
    });

    this.socket.on("disconnect", (reason?: string) => {
      logger.info("Socket.IO 连接断开", { reason: reason?.toString() || 'unknown' });
    });
  }

  finish(startTime: number, endTime: number) {
    this.send("finish", endTime - startTime);
  }

  unzip(entryName: string, total: number, current: number) {
    this.send("unzip", { name: entryName, total, current });
  }

  download(total: number, index: number, name: string) {
    this.send("downloading", { total, index, name });
  }

  statusChange() {
    this.send("changed", undefined);
  }

  handleError(error: Error) {
    this.send("error", error.message);
  }

  info(message: string) {
    this.send("info", message);
  }

  serverInstallStart(modpackName: string, minecraftVersion: string, loaderType: string, loaderVersion: string) {
    this.send("server_install_start", { modpackName, minecraftVersion, loaderType, loaderVersion });
  }

  serverInstallStep(step: string, stepIndex: number, totalSteps: number, message?: string) {
    this.send("server_install_step", { step, stepIndex, totalSteps, message });
  }

  serverInstallProgress(step: string, progress: number, message?: string) {
    this.send("server_install_progress", { step, progress, message });
  }

  serverInstallComplete(installPath: string, duration: number) {
    this.send("server_install_complete", { installPath, duration });
  }

  serverInstallError(error: string, step?: string, details?: string) {
    this.send("server_install_error", { error, step, details });
  }

  filterModsStart(totalMods: number) {
    this.send("filter_mods_start", { totalMods });
  }

  filterModsProgress(current: number, total: number, modName: string) {
    this.send("filter_mods_progress", { current, total, modName });
  }

  filterModsComplete(filteredCount: number, movedCount: number, duration: number) {
    this.send("filter_mods_complete", { filteredCount, movedCount, duration });
  }

  filterModsError(error: string) {
    this.send("filter_mods_error", { error });
  }

  guardianStatus(status: string, data?: any) {
    this.send("guardian_status", { status, data });
  }

  guardianLog(line: string, isError: boolean) {
    this.send("guardian_log", { line, isError });
  }

  guardianCrashDetected(crashInfo: any) {
    this.send("guardian_crash_detected", crashInfo);
  }

  guardianAIAnalysis(diagnosis: any) {
    this.send("guardian_ai_analysis", diagnosis);
  }

  guardianActionsRequired(actions: any[]) {
    this.send("guardian_actions_required", actions);
  }

  guardianActionExecuted(result: any) {
    this.send("guardian_action_executed", result);
  }

  guardianGiveUp(reason: string) {
    this.send("guardian_give_up", { reason });
  }

  guardianRollback(result: any) {
    this.send("guardian_rollback", result);
  }

  guardianRestart(data: any) {
    this.send("guardian_restart", data);
  }

  private send(status: string, result: any) {
    try {
      if (this.socket.connected) {
        const message = { status, result };
        logger.debug("发送 Socket.IO 消息", { status, result });
        this.socket.emit(status, result);
      } else {
        logger.warn(`Socket.IO 未连接，无法发送消息: ${status}`);
      }
    } catch (err) {
      logger.error("发送 Socket.IO 消息失败", err as Error);
    }
  }
}
