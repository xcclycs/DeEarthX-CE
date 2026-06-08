import { formatLevel, formatTime, colorize, COLORS } from "./colors.js";
import * as fs from "fs";
import * as path from "path";

type LogLevel = "debug" | "info" | "warn" | "error";

interface Logger {
  debug: (message: string, meta?: any) => void;
  info: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
}

function getAppDir(): string {
  const execPath = process.execPath;
  const cwd = process.cwd();
  
  const isDevelopment = execPath.toLowerCase().includes('node.exe') && 
                        !cwd.toLowerCase().includes('program files') &&
                        !cwd.toLowerCase().includes('nodejs');
  
  if (isDevelopment) {
    return cwd;
  }
  
  return path.dirname(execPath);
}

const logsDir = path.join(getAppDir(), "logs");
const LOG_BUFFER_SIZE = 50;
const LOG_FLUSH_INTERVAL = 1000;
const LOG_FILE_DATE = new Date().toISOString().split('T')[0];

let logBuffer: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let logFilePath = path.join(logsDir, `deearthx-${LOG_FILE_DATE}.log`);
let currentLogDate = LOG_FILE_DATE;

const ensureLogsDir = () => {
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch (err) {
      console.error("创建日志目录失败:", err);
    }
  }
};

const updateLogFilePath = () => {
  const today = new Date().toISOString().split('T')[0];
  if (today !== currentLogDate) {
    currentLogDate = today;
    logFilePath = path.join(logsDir, `deearthx-${currentLogDate}.log`);
  }
};

const flushBuffer = async () => {
  if (logBuffer.length === 0) return;
  
  const bufferToWrite = [...logBuffer];
  logBuffer = [];
  
  try {
    updateLogFilePath();
    await fs.promises.appendFile(logFilePath, bufferToWrite.join(''), "utf-8");
  } catch (err) {
    console.error("写入日志文件失败:", err);
    logBuffer.unshift(...bufferToWrite);
  }
};

const startFlushTimer = () => {
  if (flushTimer) return;
  
  flushTimer = setInterval(() => {
    if (logBuffer.length > 0) {
      flushBuffer();
    }
  }, LOG_FLUSH_INTERVAL);
  
  flushTimer.unref();
};

const addToBuffer = (logLine: string) => {
  logBuffer.push(logLine);
  if (logBuffer.length >= LOG_BUFFER_SIZE) {
    flushBuffer();
  }
};

const metaToString = (meta: any): string => {
  if (meta instanceof Error) {
    return `${meta.message} ${meta.stack || ''}`;
  }
  if (typeof meta === "object") {
    try {
      return JSON.stringify(meta);
    } catch {
      return String(meta);
    }
  }
  return String(meta);
};

const writeToFile = (level: LogLevel, message: string, meta?: any) => {
  const timestamp = formatTime();
  let metaStr = "";
  if (meta) {
    try {
      metaStr = ` ${metaToString(meta)}`;
    } catch {
      metaStr = " [元数据解析错误]";
    }
  }
  const logLine = `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}\n`;
  addToBuffer(logLine);
};

const log = (level: LogLevel, message: string, meta?: any) => {
  const timestamp = formatTime();
  const levelTag = formatLevel(level);
  
  writeToFile(level, message, meta);
  
  let metaStr = "";
  if (meta) {
    try {
      const metaContent = metaToString(meta);
      metaStr = ` ${colorize(metaContent, COLORS.dim)}`;
    } catch {
      metaStr = ` ${colorize("[元数据解析错误]", COLORS.red)}`;
    }
  }
  
  const msg = level === "error" 
    ? colorize(message, COLORS.bright) 
    : message;
  
  console.log(`${timestamp} ${levelTag} ${msg}${metaStr}`);
};

process.on('beforeExit', async () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
});

process.on('SIGINT', async () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
  process.exit(0);
});

ensureLogsDir();
startFlushTimer();

export const logger: Logger = {
  debug: (msg, meta) => log("debug", msg, meta),
  info: (msg, meta) => log("info", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  error: (msg, meta) => log("error", msg, meta),
};

// 导出日志相关路径和工具函数
export function getLogFilePath(): string {
  updateLogFilePath();
  return logFilePath;
}

export function getLogsDir(): string {
  return logsDir;
}

export async function getLogFileContent(lines?: number): Promise<string> {
  updateLogFilePath();
  // 先刷新缓冲区
  if (logBuffer.length > 0) {
    await flushBuffer();
  }
  
  try {
    if (!fs.existsSync(logFilePath)) {
      return '';
    }
    const content = await fs.promises.readFile(logFilePath, 'utf-8');
    if (lines && lines > 0) {
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    }
    return content;
  } catch (err) {
    return '';
  }
}

export async function listLogFiles(): Promise<{ name: string; size: number; date: string }[]> {
  try {
    if (!fs.existsSync(logsDir)) {
      return [];
    }
    const files = await fs.promises.readdir(logsDir);
    const result: { name: string; size: number; date: string }[] = [];
    for (const file of files) {
      if (file.endsWith('.log')) {
        const filePath = path.join(logsDir, file);
        const stats = await fs.promises.stat(filePath);
        result.push({
          name: file,
          size: stats.size,
          date: stats.mtime.toISOString()
        });
      }
    }
    result.sort((a, b) => b.date.localeCompare(a.date));
    return result;
  } catch {
    return [];
  }
}
