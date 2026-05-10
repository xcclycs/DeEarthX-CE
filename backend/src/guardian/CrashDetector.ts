/**
 * CrashDetector - 崩溃/异常检测引擎
 * 综合判断：进程退出码、日志关键字、无响应超时
 */

import { CrashInfo, CrashSeverity, CrashClassification, GuardianStatus } from './types.js';
import { LogParser, ParsedLogLine } from './LogParser.js';

export interface CrashDetectorOptions {
  maxLogContextLines: number;
  monitoringTimeout: number;   // 无响应超时（毫秒）
}

export class CrashDetector {
  private readonly logParser: LogParser;
  private readonly options: Required<CrashDetectorOptions>;
  private consecutiveErrorCount: number = 0;
  private lastErrorTimestamp: number = 0;
  private errorHistory: Array<{ timestamp: number; pattern: string }> = [];
  private readonly errorHistoryWindow = 60000; // 1分钟窗口
  private lastOutputTime: number = Date.now();

  constructor(logParser: LogParser, options?: Partial<CrashDetectorOptions>) {
    this.logParser = logParser;
    this.options = {
      maxLogContextLines: options?.maxLogContextLines ?? 200,
      monitoringTimeout: options?.monitoringTimeout ?? 30000,
    };
  }

  /**
   * 检测日志行是否为崩溃信号
   */
  public detectFromLogLine(line: string, isStderr: boolean): { isCrash: boolean; crashInfo?: CrashInfo } {
    const parsed = this.logParser.parseLine(line, isStderr);
    
    if (parsed.severity === 'fatal' || (parsed.severity === 'error' && isStderr)) {
      this.recordError(parsed);
    }

    // 严重程度达到 fatal 视为崩溃
    if (parsed.severity === 'fatal') {
      const classification = this.classifyCrash(parsed);
      return {
        isCrash: true,
        crashInfo: this.buildCrashInfo(parsed, classification)
      };
    }

    return { isCrash: false };
  }

  /**
   * 根据进程退出码检测崩溃
   */
  public detectFromExitCode(exitCode: number, signal: string | null): CrashInfo | null {
    if (exitCode === 0) {
      return null; // 正常退出
    }

    const severity: CrashSeverity = exitCode === -1 ? 'fatal' : 'error';
    const detectedPatterns: string[] = [`EXIT_CODE_${exitCode}`];
    if (signal) {
      detectedPatterns.push(`SIGNAL_${signal}`);
    }

    const classification: CrashClassification = {
      type: exitCode < 0 ? 'CRASH_UNKNOWN' : 'CRASH_KNOWN',
      reason: `服务端进程异常退出 (退出码: ${exitCode}${signal ? `, 信号: ${signal}` : ''})`,
      suspectedMods: [],
      suspectedConfigs: []
    };

    return {
      id: this.generateCrashId(),
      timestamp: new Date().toISOString(),
      severity,
      exitCode,
      signal: signal ?? undefined,
      detectedPatterns,
      logContext: this.logParser.getLastLines(this.options.maxLogContextLines),
      classification: classification
    };
  }

  /**
   * 检测服务端是否卡死（无响应）
   */
  public detectHang(now: number, isRunning: boolean): CrashInfo | null {
    if (!isRunning) return null;

    const silenceDuration = now - this.lastOutputTime;
    if (silenceDuration > this.options.monitoringTimeout) {
      const classification: CrashClassification = {
        type: 'HANG',
        reason: `服务端可能卡死（${Math.round(silenceDuration / 1000)} 秒无输出）`,
        suspectedMods: [],
        suspectedConfigs: []
      };

      return {
        id: this.generateCrashId(),
        timestamp: new Date().toISOString(),
        severity: 'warning',
        detectedPatterns: ['HANG_DETECTED', `SILENCE_${Math.round(silenceDuration / 1000)}s`],
        logContext: this.logParser.getLastLines(50),
        classification: classification
      };
    }

    return null;
  }

  /**
   * 记录输出时间戳（由 ProcessManager 更新）
   */
  public updateLastOutputTime(): void {
    this.lastOutputTime = Date.now();
  }

  /**
   * 重置连续错误计数
   */
  public reset(): void {
    this.consecutiveErrorCount = 0;
    this.lastErrorTimestamp = 0;
    this.errorHistory = [];
    this.updateLastOutputTime();
  }

  /**
   * 获取错误历史
   */
  public getErrorHistory(): Array<{ timestamp: number; pattern: string }> {
    return [...this.errorHistory];
  }

  /**
   * 获取连续错误次数
   */
  public getConsecutiveErrorCount(): number {
    return this.consecutiveErrorCount;
  }

  /**
   * 记录错误
   */
  private recordError(parsed: ParsedLogLine): void {
    this.consecutiveErrorCount++;
    this.lastErrorTimestamp = Date.now();

    this.errorHistory.push({
      timestamp: Date.now(),
      pattern: parsed.matchedPatterns[0] || 'UNKNOWN'
    });

    // 清理窗口外历史
    const cutoff = Date.now() - this.errorHistoryWindow;
    this.errorHistory = this.errorHistory.filter(h => h.timestamp >= cutoff);
  }

  /**
   * 对崩溃进行分类
   */
  private classifyCrash(parsed: ParsedLogLine): CrashClassification {
    const content = parsed.content.toLowerCase();
    const patterns = parsed.matchedPatterns;

    // OOM 检测
    if (patterns.includes('OUT_OF_MEMORY') || content.includes('outofmemory')) {
      return {
        type: 'OOM',
        reason: 'Java 内存不足（OutOfMemoryError），需要增加 -Xmx 参数或减少模组数量',
        suspectedMods: [],
        suspectedConfigs: []
      };
    }

    // 模组冲突检测
    if (patterns.includes('MOD_LOAD_ERROR') || patterns.includes('MOD_CRASH') || 
        patterns.includes('MOD_VERSION_CONFLICT') || patterns.includes('NEEDS_LANGUAGE_PROVIDER')) {
      const modMatch = parsed.content.match(/mod[s]?\s+['"]?([\w-]+)['"]?/i);
      const suspectedMods = modMatch ? [modMatch[1]] : [];
      return {
        type: 'MOD_CONFLICT',
        reason: '模组加载错误或冲突',
        suspectedMods,
        suspectedConfigs: []
      };
    }

    // Tick 异常
    if (patterns.includes('TICK_EXCEPTION')) {
      const blockMatch = parsed.content.match(/(?:block entity|entity|tile entity)\s+['"]?([\w:.-]+)['"]?/i);
      return {
        type: 'CRASH_KNOWN',
        reason: '服务端 Tick 循环异常（通常由某个方块/实体导致）',
        suspectedMods: blockMatch ? [blockMatch[1]] : [],
        suspectedConfigs: []
      };
    }

    // 配置错误
    if (patterns.includes('CONFIG_ERROR') || patterns.includes('INVALID_CONFIG')) {
      const configMatch = parsed.content.match(/config[\\/][\w.]+/i);
      return {
        type: 'CONFIG_ERROR',
        reason: '配置文件错误或损坏',
        suspectedMods: [],
        suspectedConfigs: configMatch ? [configMatch[0]] : []
      };
    }

    // 未知崩溃
    return {
      type: 'CRASH_UNKNOWN',
      reason: '未知崩溃原因，需要 AI 进一步分析',
      suspectedMods: [],
      suspectedConfigs: []
    };
  }

  /**
   * 构建 CrashInfo
   */
  private buildCrashInfo(parsed: ParsedLogLine, classification: CrashClassification): CrashInfo {
    return {
      id: this.generateCrashId(),
      timestamp: new Date().toISOString(),
      severity: parsed.severity,
      detectedPatterns: parsed.matchedPatterns,
      logContext: this.logParser.getLastLines(this.options.maxLogContextLines),
      classification: classification
    };
  }

  /**
   * 生成崩溃 ID
   */
  private generateCrashId(): string {
    return `crash_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}
