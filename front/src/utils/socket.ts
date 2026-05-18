import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export interface SocketIOOptions {
  host?: string;
  port?: number;
  path?: string;
  transports?: string[];
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

export function getSocketIO(options: SocketIOOptions = {}): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  const host = options.host || import.meta.env.VITE_API_HOST || 'localhost';
  const port = options.port || import.meta.env.VITE_API_PORT || 37019;
  const path = options.path || '/socket.io';
  const transports = options.transports || ['polling', 'websocket'];
  const reconnection = options.reconnection !== undefined ? options.reconnection : true;
  const reconnectionAttempts = options.reconnectionAttempts || 5;
  const reconnectionDelay = options.reconnectionDelay || 1000;

  socket = io(`http://${host}:${port}`, {
    path,
    transports,
    reconnection,
    reconnectionAttempts,
    reconnectionDelay,
    timeout: 20000,
    autoConnect: true,
  });

  socket.on('connect', () => {
    console.log('Socket.IO 已连接:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket.IO 已断开:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('Socket.IO 连接错误:', error.message);
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}

export function emit(event: string, data?: any): void {
  if (socket && socket.connected) {
    socket.emit(event, data);
  } else {
    console.warn('Socket.IO 未连接，无法发送事件:', event);
  }
}

export function on(event: string, callback: (...args: any[]) => void): void {
  if (socket) {
    socket.on(event, callback);
  }
}

export function off(event: string, callback?: (...args: any[]) => void): void {
  if (socket) {
    if (callback) {
      socket.off(event, callback);
    } else {
      socket.removeAllListeners(event);
    }
  }
}

export function isConnected(): boolean {
  return socket !== null && socket.connected;
}
