import { Socket } from "socket.io";
import { logger } from "./logger.js";
import { getCurrentSocket } from "./socket.io.js";

export { MessageIO as MessageWS } from "./socket.io.js";

export function sendWS(status: string, data: any): void {
  try {
    const socket = getCurrentSocket();
    if (socket && socket.connected) {
      socket.emit(status, data);
    }
  } catch (err) {
    logger.error(`发送 WebSocket 消息失败: ${status}`, err instanceof Error ? err : new Error(String(err)));
  }
}

export function getSocket(): Socket | null {
  try {
    return getCurrentSocket();
  } catch {
    return null;
  }
}
