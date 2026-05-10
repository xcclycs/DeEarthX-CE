/**
 * LogParser - 实时日志解析器
 * 逐行读取服务端输出，用状态机匹配已知 Minecraft 崩溃模式
 */

import { CrashSeverity } from './types.js';

/** 解析结果 */
export interface ParsedLogLine {
  raw: string;
  timestamp?: string;
  level: string;
  content: string;
  severity: CrashSeverity;
  isError: boolean;
  matchedPatterns: string[];
}

/** 崩溃模式定义 */
interface CrashPattern {
  name: string;
  regex: RegExp;
  severity: CrashSeverity;
  category?: string;
}

export class LogParser {
  private readonly patterns: CrashPattern[] = [
    // Fatal 错误
    { name: 'FATAL_ERROR', regex: /FATAL\s+ERROR/i, severity: 'fatal' },
    { name: 'FATAL_EXCEPTION', regex: /^FATAL$/im, severity: 'fatal' },
    // Java 致命错误
    { name: 'OUT_OF_MEMORY', regex: /java\.lang\.OutOfMemoryError/i, severity: 'fatal', category: 'OOM' },
    { name: 'STACK_OVERFLOW', regex: /java\.lang\.StackOverflowError/i, severity: 'fatal' },
    // 服务端 Tick 异常
    { name: 'TICK_EXCEPTION', regex: /Exception in server tick loop/i, severity: 'fatal', category: 'TICK' },
    { name: 'TICK_ERROR', regex: /Exception in thread "(Server thread|main)"/i, severity: 'fatal' },
    // 模组加载错误
    { name: 'MOD_LOAD_ERROR', regex: /The game crashed whilst (ticking block entity|ticking entity|initializing mod)/i, severity: 'fatal', category: 'MOD_CONFLICT' },
    { name: 'MOD_CRASH', regex: /Could not load mod/i, severity: 'error', category: 'MOD_CONFLICT' },
    { name: 'MOD_MISSING', regex: /Missing mod/i, severity: 'error', category: 'MOD_CONFLICT' },
    { name: 'MOD_VERSION_CONFLICT', regex: /Mod version conflict/i, severity: 'error', category: 'MOD_CONFLICT' },
    { name: 'NEEDS_LANGUAGE_PROVIDER', regex: /needs language provider/i, severity: 'error', category: 'MOD_CONFLICT' },
    // Forge 典型崩溃
    { name: 'FORGE_CRASH', regex: /The game crashed whilst/i, severity: 'fatal' },
    { name: 'FORGE_ERROR', regex: /Encountered an unexpected exception/i, severity: 'fatal' },
    // 配置错误
    { name: 'CONFIG_ERROR', regex: /Error loading config/i, severity: 'error', category: 'CONFIG_ERROR' },
    { name: 'INVALID_CONFIG', regex: /Configuration error/i, severity: 'error', category: 'CONFIG_ERROR' },
    // 一般错误
    { name: 'GENERAL_ERROR', regex: /^Error:/im, severity: 'error' },
    { name: 'EXCEPTION', regex: /^\s*at\s+[\w.]+\([\w.]+(\.java:\d+)\)/m, severity: 'error' },
    { name: 'CAUSED_BY', regex: /Caused by:/i, severity: 'error' },
    // 服务端启动/停止
    { name: 'SERVER_STARTED', regex: /Done \(.+\)!/i, severity: 'info' },
    { name: 'SERVER_STOPPING', regex: /Stopping server/i, severity: 'info' },
    { name: 'SERVER_STOPPED', regex: /Server stopped/i, severity: 'info' },
    // 未捕获异常
    { name: 'UNCAUGHT_EXCEPTION', regex: /Uncaught exception/i, severity: 'fatal' },
    // Thread Dump
    { name: 'THREAD_DUMP', regex: /Full thread dump/i, severity: 'warning' },
    // EULA 未同意
    { name: 'EULA', regex: /(EULA|eula\.txt)/i, severity: 'warning', category: 'EULA' },
  ];

  /** 是否在缓冲区中匹配到了 EULA 相关行 */
  public hasEULA(): boolean {
    return this.buffer.some(line => /(EULA|eula\.txt)/i.test(line));
  }

  private buffer: string[] = [];
  private readonly maxBufferSize: number;

  constructor(maxBufferSize: number = 1000) {
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * 解析单行日志
   */
  public parseLine(line: string, isStderr: boolean = false): ParsedLogLine {
    // 自动添加到缓冲区
    this.addToBuffer(line);

    const matchedPatterns: string[] = [];
    let maxSeverity: CrashSeverity = isStderr ? 'error' : 'info';
    let category: string | undefined;

    for (const pattern of this.patterns) {
      if (pattern.regex.test(line)) {
        matchedPatterns.push(pattern.name);
        if (this.severityWeight(pattern.severity) > this.severityWeight(maxSeverity)) {
          maxSeverity = pattern.severity;
        }
        if (pattern.category) {
          category = pattern.category;
        }
      }
    }

    // 提取时间戳
    const timestamp = this.extractTimestamp(line);

    return {
      raw: line,
      timestamp,
      level: this.mapSeverityToLevel(maxSeverity),
      content: line,
      severity: maxSeverity,
      isError: isStderr || matchedPatterns.some(p => 
        ['FATAL_ERROR', 'FATAL_EXCEPTION', 'OUT_OF_MEMORY', 'TICK_EXCEPTION', 
         'FORGE_CRASH', 'UNCAUGHT_EXCEPTION', 'MOD_LOAD_ERROR'].includes(p)
      ),
      matchedPatterns
    };
  }

  /**
   * 批量解析日志行
   */
  public parseLines(lines: string[]): ParsedLogLine[] {
    return lines.map(line => this.parseLine(line));
  }

  /**
   * 提取崩溃上下文（最后 N 行 + 报错附近行）
   */
  public extractCrashContext(errorLineIndex?: number, contextLines: number = 50): string[] {
    if (errorLineIndex !== undefined) {
      const start = Math.max(0, errorLineIndex - contextLines);
      const end = Math.min(this.buffer.length, errorLineIndex + contextLines + 1);
      return this.buffer.slice(start, end);
    }
    // 没有指定行号，返回最后 contextLines 行
    return this.buffer.slice(-contextLines);
  }

  /**
   * 获取最后 N 行日志
   */
  public getLastLines(count: number): string[] {
    return this.buffer.slice(-count);
  }

  /**
   * 获取完整缓冲区
   */
  public getBuffer(): string[] {
    return [...this.buffer];
  }

  /**
   * 清除缓冲区
   */
  public clearBuffer(): void {
    this.buffer = [];
  }

  /**
   * 添加行到缓冲区
   */
  private addToBuffer(line: string): void {
    this.buffer.push(line);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.splice(0, this.buffer.length - this.maxBufferSize);
    }
  }

  /**
   * 从行中提取时间戳
   */
  private extractTimestamp(line: string): string | undefined {
    const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
    return match ? match[1] : undefined;
  }

  /**
   * 映射严重等级到日志级别
   */
  private mapSeverityToLevel(severity: CrashSeverity): string {
    const map: Record<CrashSeverity, string> = {
      fatal: 'FATAL',
      error: 'ERROR',
      warning: 'WARN',
      info: 'INFO'
    };
    return map[severity];
  }

  /**
   * 严重等级权重比较
   */
  private severityWeight(severity: CrashSeverity): number {
    const weights: Record<CrashSeverity, number> = {
      fatal: 4,
      error: 3,
      warning: 2,
      info: 1
    };
    return weights[severity];
  }

  /**
   * 判断一行是否包含严重错误
   */
  public isCriticalError(line: string): boolean {
    const criticalPatterns = [
      /FATAL/i,
      /Exception in server tick loop/i,
      /java\.lang\.OutOfMemoryError/i,
      /The game crashed whilst/i,
      /Encountered an unexpected exception/i,
      /Uncaught exception/i,
      /A problem occurred running the Server launcher/i
    ];
    return criticalPatterns.some(p => p.test(line));
  }

  /**
   * 检测是否包含崩溃报告引用
   */
  public detectCrashReport(line: string): string | null {
    const match = line.match(/crash-reports[/\\]([\w-]+\.txt)/i);
    return match ? match[0] : null;
  }
}
