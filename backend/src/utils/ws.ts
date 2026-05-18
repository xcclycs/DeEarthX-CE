import { Socket } from "socket.io";
import { logger } from "./logger.js";

export { MessageIO as MessageWS } from "./socket.io.js";

export function sendWS(status: string, data: any): void {
  try {
    const { getCurrentSocket } = require("./socket.io.js");
    const socket = getCurrentSocket();
    if (socket && socket.connected) {
      socket.emit(status, data);
      logger.debug(`发送 WebSocket 消息: ${status}`, data);
    } else {
      logger.warn(`无法发送消息，客户端未连接: ${status}`);
    }
  } catch (err) {
    logger.error(`发送 WebSocket 消息失败: ${status}`, err as Error);
  }
}

export function getSocket(): Socket | null {
  try {
    const { getCurrentSocket } = require("./socket.io.js");
    return getCurrentSocket();
  } catch {
    return null;
  }
}
