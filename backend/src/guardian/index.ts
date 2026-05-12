/**
 * GuardianController - ServerGuardian 主控制器
 * 对外暴露 API，管理 Agent 生命周期，协调各模块
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  GuardianStatus, CrashInfo, AIDiagnosis, RepairAction,
  CrashReport, IGuardianConfig, ServerType, ProcessStatus,
  AIConversationEntry
} from './types.js';
import { ProcessManager, ProcessInfo } from './ProcessManager.js';
import { LogParser } from './LogParser.js';
import { CrashDetector } from './CrashDetector.js';
import { AIAdvisor, AIConfig } from './AIAdvisor.js';
import { SafeExecutor, ExecutionResult } from './SafeExecutor.js';
import { RollbackManager } from './RollbackManager.js';
import { Reporter } from './Reporter.js';
import { logger } from '../utils/logger.js';

/** 单条 AI 对话记录 */
export interface AIConversation {
  id: string;
  type: 'diagnosis' | 'test' | 'fallback';
  prompt: string;
  rawResponse: string;
  diagnosis?: AIDiagnosis;
  timestamp: string;
  latencyMs?: number;
}

/** Guardian 事件回调接口 */
export interface GuardianCallbacks {
  onStatusChange: (status: GuardianStatus, data?: any) => void;
  onLogLine: (line: string, isError: boolean) => void;
  onCrashDetected: (crashInfo: CrashInfo) => void;
  onAIAnalysis: (diagnosis: AIDiagnosis) => void;
  onActionsRequired: (actions: RepairAction[]) => void;
  onActionExecuted: (result: ExecutionResult) => void;
  onGiveUp: (reason: string) => void;
  onReport: (report: CrashReport) => void;
  onAIConversation: (conversations: AIConversation[]) => void;
  onMetrics?: (metrics: { cpuPercent: number; memPercent: number }) => void;
}

export class GuardianController {
  private status: GuardianStatus = 'idle';
  private config: IGuardianConfig;
  private callbacks: GuardianCallbacks;
  private serverContext: ServerContext;

  // 子模块
  private processManager!: ProcessManager;
  private logParser!: LogParser;
  private crashDetector!: CrashDetector;
  private aiAdvisor!: AIAdvisor;
  private safeExecutor!: SafeExecutor;
  private rollbackManager!: RollbackManager;
  private reporter!: Reporter;

  // 状态跟踪
  private consecutiveCrashes: number = 0;
  private restartCount: number = 0;
  private maxConsecutiveCrashes: number = 5;
  private currentCrashInfo: CrashInfo | null = null;
  private currentDiagnosis: AIDiagnosis | null = null;
  private pendingActions: RepairAction[] = [];
  private executedActions: RepairAction[] = [];
  private autoAcceptLowRisk: boolean = true;
  private isFixCycleActive: boolean = false;
  /** EULA 自动修复计数器 */
  private eulaAutoFixCount: number = 0;
  /** AI 对话记录 */
  private aiConversations: AIConversation[] = [];
  /** 启动确认定时器 */
  private startupCheckTimer: ReturnType<typeof setTimeout> | null = null;
  /** 启动确认检查计数器 */
  private startupCheckAttempt: number = 0;
  /** 指标采集定时器 */
  private metricsInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: IGuardianConfig, callbacks: GuardianCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.maxConsecutiveCrashes = config.maxConsecutiveCrashes || 5;
    this.autoAcceptLowRisk = config.autoAcceptLowRisk ?? true;

    this.serverContext = {
      workDir: config.workDir,
      serverType: config.serverType,
      mcVersion: '',
      javaVersion: '',
      modList: [],
      crashReports: []
    };

    this.initializeModules();
  }

  /**
   * 初始化子模块
   */
  private initializeModules(): void {
    this.logParser = new LogParser();

    this.crashDetector = new CrashDetector(this.logParser, {
      maxLogContextLines: configLogLines,
      monitoringTimeout: configTimeout
    });

    this.aiAdvisor = new AIAdvisor({
      provider: this.config.ai.provider,
      apiKey: this.config.ai.apiKey,
      model: this.config.ai.model,
      baseURL: this.config.ai.baseURL,
      maxTokens: this.config.ai.maxTokens || 1500
    });

    this.safeExecutor = new SafeExecutor(this.config.workDir);
    this.rollbackManager = new RollbackManager(this.config.workDir);
    this.reporter = new Reporter(this.config.workDir);
    this.rollbackManager.loadRecords();

    // 初始化 ProcessManager
    this.processManager = new ProcessManager({
      onOutput: this.handleProcessOutput.bind(this),
      onStatusChange: this.handleProcessStatusChange.bind(this),
      onCrash: this.handleProcessCrash.bind(this),
      hangTimeoutMs: this.config.monitoringTimeout
    });

    this.processManager.configure(this.config.workDir, this.config.javaCommand);
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<IGuardianConfig>): void {
    Object.assign(this.config, config);

    // 将更新后的 workDir / javaCommand 同步到 ProcessManager
    if (config.workDir !== undefined || config.javaCommand !== undefined) {
      this.processManager.configure(this.config.workDir, this.config.javaCommand);
    }
    
    if (config.ai) {
      this.aiAdvisor.updateConfig({
        provider: config.ai.provider ?? this.config.ai.provider,
        apiKey: config.ai.apiKey ?? this.config.ai.apiKey,
        model: config.ai.model ?? this.config.ai.model,
        baseURL: config.ai.baseURL ?? this.config.ai.baseURL,
        maxTokens: config.ai.maxTokens ?? this.config.ai.maxTokens ?? 1500
      });
    }

    if (config.maxConsecutiveCrashes) {
      this.maxConsecutiveCrashes = config.maxConsecutiveCrashes;
    }

    if (config.autoAcceptLowRisk !== undefined) {
      this.autoAcceptLowRisk = config.autoAcceptLowRisk;
    }

    if (config.workDir) {
      this.serverContext.workDir = config.workDir;
    }
  }

  /**
   * 测试 AI 连接是否可用
   */
  public async testAI(): Promise<{ success: boolean; message: string; latency?: number }> {
    return this.aiAdvisor.testConnection();
  }

  /**
   * 启动 Guardian
   */
  public async start(): Promise<boolean> {
    if (this.status !== 'idle' && this.status !== 'stopped' && this.status !== 'give_up') {
      logger.warn('Guardian 已在运行中');
      return false;
    }

    this.status = 'starting';
    this.callbacks.onStatusChange('starting');

    // 读取服务端信息
    await this.loadServerContext();

    // 启动服务端进程
    const started = await this.processManager.start();
    if (!started) {
      this.status = 'stopped';
      this.callbacks.onStatusChange('stopped', { error: '服务端启动失败' });
      return false;
    }

    this.status = 'monitoring';
    this.consecutiveCrashes = 0;
    this.restartCount = 0;
    this.executedActions = [];
    this.eulaAutoFixCount = 0;
    this.isFixCycleActive = false;

    this.callbacks.onStatusChange('monitoring');
    logger.info('ServerGuardian 已启动，正在监控服务端...');

    // 启动确认检查：20s 后向 AI 确认服务端是否已完成加载
    this.startStartupCheck();
    // 开始采集 CPU/内存指标
    this.startMetricsPolling();
    return true;
  }

  /**
   * 停止 Guardian
   */
  public async stop(): Promise<void> {
    this.isFixCycleActive = false;
    this.clearStartupCheck();
    this.stopMetricsPolling();

    // 停止前先确认服务端是否已完成启动
    // 若未完成，用 AI 的多轮检测等待它完成（最多 5 轮 × 20s）
    this.status = 'analyzing';
    this.callbacks.onStatusChange('analyzing', { message: '停止前确认服务端启动状态...' });
    await this.ensureServerStartedBeforeStop();

    await this.processManager.stop();
    this.status = 'stopped';
    this.currentCrashInfo = null;
    this.currentDiagnosis = null;
    this.pendingActions = [];
    this.callbacks.onStatusChange('stopped');
    logger.info('ServerGuardian 已停止');
  }

  /**
   * 停止前等 AI 确认服务端启动完成（最多 5 次 × 20s）
   */
  private async ensureServerStartedBeforeStop(): Promise<void> {
    const maxAttempts = 5;
    for (let i = 0; i < maxAttempts; i++) {
      const recentLogs = this.logParser?.getBuffer()?.slice(-120).join('\n') || '（无日志）';
      try {
        const diagnosis = await this.aiAdvisor.checkCompletion(recentLogs);
        const hasComplete = diagnosis.actions.some(a => a.type === 'complete');
        if (hasComplete) {
          logger.info(`停止前确认：AI 判定服务端已完成加载（第 ${i + 1} 次检查），继续停止流程`);
          return;
        }
      } catch {
        // AI 失败时继续等待
      }

      logger.info(`停止前确认：服务端未完成启动（第 ${i + 1}/${maxAttempts} 次），20s 后再次检查`);
      await new Promise(r => setTimeout(r, 20000));
    }

    logger.warn(`停止前确认：${maxAttempts} 次检查后仍未确认完成启动，强制进入停止流程`);
  }

  /**
   * 获取当前状态
   */
  public getStatus(): GuardianStatus {
    return this.status;
  }

  /**
   * 获取进程信息
   */
  public getProcessInfo(): ProcessInfo {
    return this.processManager.getProcessInfo();
  }

  /**
   * 获取日志缓冲区
   */
  public getLogBuffer(): string[] {
    return this.logParser.getBuffer();
  }

  /**
   * 用户批准操作
   */
  public async approveActions(actionIds: string[]): Promise<void> {
    const toExecute = this.pendingActions.filter(a => actionIds.includes(a.id));
    
    if (toExecute.length === 0) return;

    this.status = 'fixing';
    this.callbacks.onStatusChange('fixing');

    // 记录操作前状态
    const checkpoint = this.rollbackManager.createCheckpoint(
      this.currentCrashInfo?.id || 'unknown'
    );

    // 执行操作
    for (const action of toExecute) {
      // 记录快照
      if (['move_file', 'delete_file', 'remove_mod'].includes(action.type)) {
        const backupPath = path.join(this.config.workDir, '.rubbish', `rollback_${checkpoint.id}_${path.basename(action.target)}`);
        const originalPath = path.join(this.config.workDir, action.target);
        if (fs.existsSync(originalPath)) {
          this.rollbackManager.recordSnapshot(
            checkpoint.id,
            originalPath,
            backupPath,
            action.type as any,
            action.reason
          );
        }
      }

      action.approved = true;
      const result = await this.safeExecutor.executeAction(action);
      
      if (result.success) {
        this.executedActions.push(action);
      }
      
      this.callbacks.onActionExecuted(result);
    }

    // 清理已处理的待执行项
    this.pendingActions = this.pendingActions.filter(a => !actionIds.includes(a.id));

    // 仍有等待确认的操作 → 继续等待用户处理
    if (this.pendingActions.length > 0) {
      this.status = 'awaiting_user';
      this.callbacks.onStatusChange('awaiting_user', {
        pendingCount: this.pendingActions.length,
        message: `仍有 ${this.pendingActions.length} 个修复操作等待确认`
      });
      this.callbacks.onActionsRequired(this.pendingActions);
      logger.info(`仍有 ${this.pendingActions.length} 个修复操作等待确认`);
      return;
    }

    // 所有待确认操作已全部执行完成 → 等用户手动确认重启，绝不自动重启
    this.status = 'awaiting_user';
    this.callbacks.onStatusChange('awaiting_user', {
      pendingCount: 0,
      restartNeeded: true,
      message: '修复操作已全部执行，等待用户确认重启服务端'
    });
    this.callbacks.onLogLine('[Guardian] 修复操作已全部执行，请确认是否重启服务端', false);
    logger.info('所有修复操作已执行，等待用户确认重启');
  }

  /**
   * 拒绝操作
   */
  public async rejectActions(actionIds: string[]): Promise<void> {
    this.pendingActions = this.pendingActions.filter(a => !actionIds.includes(a.id));

    if (this.pendingActions.length === 0) {
      // 所有操作都被拒绝，通知用户
      this.callbacks.onGiveUp('用户拒绝了所有修复操作');
      this.isFixCycleActive = false;
    } else {
      // 还有剩余操作等待用户处理
      this.callbacks.onActionsRequired(this.pendingActions);
      this.callbacks.onStatusChange('awaiting_user', {
        pendingCount: this.pendingActions.length
      });
    }
  }

  /**
   * 用户手动确认重启服务端（修复操作全部处理完毕后调用）
   */
  public async confirmRestart(): Promise<void> {
    if (this.pendingActions.length > 0) {
      this.callbacks.onLogLine('[Guardian] 仍有待确认的修复操作，拒绝重启', true);
      logger.warn(`用户请求重启，但仍有 ${this.pendingActions.length} 个操作待确认，已拒绝`);
      return;
    }
    this.callbacks.onLogLine('[Guardian] 用户已确认，正在重启服务端...', false);
    await this.restartServer();
  }

  /**
   * 回滚上次修复
   */
  public async rollbackLastFix(): Promise<{ success: boolean; errors: string[] }> {
    const checkpoint = this.rollbackManager.getLatestRestorableCheckpoint();
    if (!checkpoint) {
      return { success: false, errors: ['无可恢复的检查点'] };
    }

    const result = await this.rollbackManager.restore(checkpoint.id);
    return result;
  }

  /**
   * 生成报告
   */
  public async generateReport(result: 'fixed' | 'unfixed' | 'user_stopped' | 'give_up'): Promise<CrashReport | null> {
    if (!this.currentCrashInfo) return null;

    return await this.reporter.generateReport({
      serverDir: this.serverContext.workDir,
      serverType: this.serverContext.serverType,
      javaVersion: this.serverContext.javaVersion,
      mcVersion: this.serverContext.mcVersion,
      crashInfo: this.currentCrashInfo,
      diagnosis: this.currentDiagnosis ?? undefined,
      executedActions: this.executedActions,
      result,
      restartCount: this.restartCount
    });
  }

  /**
   * 获取报告列表
   */
  public getReportsList(): Array<{ id: string; timestamp: string; file: string }> {
    return this.reporter.getReportsList();
  }

  /**
   * 获取检查点列表
   */
  public getCheckpoints(): any[] {
    return this.rollbackManager.getCheckpoints();
  }

  /**
   * 获取 AI 对话记录
   */
  public getAIConversations(): AIConversation[] {
    return this.aiConversations;
  }

  /**
   * 重置 AI 对话记录
   */
  public resetAIConversations(): void {
    this.aiConversations = [];
    logger.info('AI 对话记录已重置');
  }

  /**
   * 记录一次 AI 对话
   */
  private recordAIConversation(conv: AIConversation): void {
    this.aiConversations.push(conv);
    this.callbacks.onAIConversation(this.aiConversations);
  }

  /**
   * 启动确认检查：服务端启动后 20s，收集日志给 AI 判断是否已完成加载
   */
  private startStartupCheck(): void {
    this.clearStartupCheck();
    this.startupCheckAttempt = 0;
    this.doStartupCheck();
  }

  private clearStartupCheck(): void {
    if (this.startupCheckTimer) {
      clearTimeout(this.startupCheckTimer);
      this.startupCheckTimer = null;
    }
  }

  /** 开始采集进程指标（每 2 秒一次） */
  private startMetricsPolling(): void {
    this.stopMetricsPolling();
    this.metricsInterval = setInterval(() => {
      if (!this.processManager) return;
      const metrics = this.processManager.getMetrics();
      if (metrics && this.callbacks.onMetrics) {
        this.callbacks.onMetrics(metrics);
      }
    }, 2000);
  }

  private stopMetricsPolling(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  private doStartupCheck(): void {
    if (this.status !== 'monitoring' || this.isFixCycleActive) return;

    this.startupCheckAttempt++;
    this.startupCheckTimer = setTimeout(async () => {
      if (this.status !== 'monitoring' || this.isFixCycleActive) return;

      const recentLogs = this.logParser?.getBuffer()?.slice(-120).join('\n') || '（无日志）';
      try {
        const diagnosis = await this.aiAdvisor.checkCompletion(recentLogs);
        // AI 返回后再次检查状态（await 期间可能进程已退出）
        if (this.status !== 'monitoring' || this.isFixCycleActive) return;
        const hasComplete = diagnosis.actions.some(a => a.type === 'complete');

        if (hasComplete) {
          // AI 确认服务端已成功加载 → 完成启动检查，保持运行
          logger.info(`启动确认：AI 判定服务端已完成加载（第 ${this.startupCheckAttempt} 次检查），启动检查通过`);
          this.callbacks.onLogLine('[Guardian] 启动确认通过，服务端运行正常 ✅', false);
          this.startupCheckAttempt = 0;
          this.clearStartupCheck();
        } else if (this.startupCheckAttempt >= 5) {
          // 连续检查 5 次仍未完成 → 强制终止，再由 AI 确认退出状态
          logger.warn(`启动确认：AI 判定服务端未完成（已检查 ${this.startupCheckAttempt} 次），正在强制终止...`);
          this.callbacks.onLogLine('[Guardian] 启动超时，正在强制终止...', true);
          await this.processManager.stop();
          await new Promise(r => setTimeout(r, 1000));
          const exitLogs = this.logParser?.getBuffer()?.slice(-120).join('\n') || '（无日志）';
          try {
            const exitDiag = await this.aiAdvisor.checkCompletion(exitLogs);
            const exitComplete = exitDiag.actions.some(a => a.type === 'complete');
            if (exitComplete) {
              logger.info('启动确认：AI 确认终止后运行正常完成');
              this.callbacks.onLogLine('[Guardian] AI 确认终止后状态正常', false);
            } else {
              logger.warn('启动确认：AI 检测到终止后日志中包含异常');
              this.callbacks.onLogLine('[Guardian] AI 检测到终止后存在异常', true);
            }
          } catch {
            logger.warn('启动确认：终止后 AI 确认失败，使用规则判断');
          }
          this.status = 'stopped';
          this.callbacks.onStatusChange('stopped', { exitCode: 0, message: '启动超时已终止' });
          this.callbacks.onLogLine('[Guardian] 进程已终止', true);
        } else {
          // 仍在启动中，20s 后再检查
          logger.info(`启动确认：AI 判定服务端未完成（第 ${this.startupCheckAttempt} 次检查），20s 后再次检查`);
          this.doStartupCheck();
        }
      } catch {
        // AI 失败时继续等待（最多 5 次）
        if (this.startupCheckAttempt < 5) {
          this.doStartupCheck();
        }
      }
    }, 20000);
  }

  /**
   * 加载服务端上下文
   */
  private async loadServerContext(): Promise<void> {
    const workDir = this.serverContext.workDir;
    
    // 读取模组列表
    const modsDir = path.join(workDir, 'mods');
    if (fs.existsSync(modsDir)) {
      try {
        const files = fs.readdirSync(modsDir);
        this.serverContext.modList = files
          .filter(f => f.endsWith('.jar'))
          .sort();
      } catch {
        this.serverContext.modList = [];
      }
    }

    // 读取 crash-reports 目录
    const crashReportsDir = path.join(workDir, 'crash-reports');
    if (fs.existsSync(crashReportsDir)) {
      try {
        const files = fs.readdirSync(crashReportsDir);
        this.serverContext.crashReports = files
          .filter(f => f.endsWith('.txt'))
          .map(f => path.join(crashReportsDir, f))
          .slice(-3); // 只取最近 3 个
      } catch {
        this.serverContext.crashReports = [];
      }
    }

    // 读取 server.properties 获取 MC 版本信息
    const propsPath = path.join(workDir, 'server.properties');
    // 简化处理，不深入解析
    logger.info(`服务端上下文已加载: ${workDir}`);
  }

  /**
   * 处理进程输出
   */
  private handleProcessOutput(line: string, isError: boolean): void {
    // 转发日志到前端
    this.callbacks.onLogLine(line, isError);
    
    // 更新检测器输出时间
    this.crashDetector.updateLastOutputTime();

    // 检测崩溃
    if (!this.isFixCycleActive) {
      const result = this.crashDetector.detectFromLogLine(line, isError);
      if (result.isCrash && result.crashInfo) {
        this.handleCrash(result.crashInfo);
      }
    }
  }

  /**
   * 处理进程状态变更
   */
  private handleProcessStatusChange(status: ProcessStatus, data?: any): void {
    if (this.isFixCycleActive) return;

    if (status === 'running') {
      this.crashDetector.reset();
    }
  }

  /**
   * 处理进程崩溃（退出码检测）
   */
  private handleProcessCrash(exitCode: number, signal: string | null): void {
    this.clearStartupCheck();
    this.stopMetricsPolling();
    if (this.isFixCycleActive || this.status === 'stopped') return;

    // 有待用户确认的操作时，忽略任何进程退出事件
    if (this.pendingActions.length > 0) {
      logger.info('有待用户确认的修复操作，忽略本次进程退出事件');
      return;
    }

    // 检测 EULA 问题（无论退出码如何）
    const eulaDetected = this.logParser?.hasEULA?.() || false;
    if (eulaDetected) {
      this.eulaAutoFixCount++;
      logger.info(`检测到 EULA 未同意（第 ${this.eulaAutoFixCount} 次）`);

      if (this.eulaAutoFixCount > 3) {
        // 超过 3 次仍然出现 → 交给 AI 处理
        logger.warn('EULA 自动修复已失效，转交 AI 分析');
        const crashInfo = this.crashDetector.detectFromExitCode(exitCode, signal);
        if (crashInfo) {
          crashInfo.detectedPatterns.push('EULA');
          crashInfo.classification = { type: 'EULA', reason: 'EULA 自动修复超过 3 次仍未解决', suspectedMods: [], suspectedConfigs: [] };
          this.handleCrash(crashInfo);
        }
        return;
      }

      // 自动修复 eula.txt
      const eulaPath = path.join(this.config.workDir, 'eula.txt');
      try {
        fs.writeFileSync(eulaPath, 'eula=true\n', 'utf-8');
        logger.info(`已自动设置 ${eulaPath} → eula=true`);
        this.callbacks.onLogLine(`[Guardian] 已自动接受 EULA（eula.txt → eula=true）`, false);
        this.callbacks.onLogLine(`[Guardian] 准备重新启动服务端...`, false);
      } catch (err) {
        logger.error(`自动设置 eula.txt 失败: ${(err as Error).message}`);
        const crashInfo = this.crashDetector.detectFromExitCode(exitCode, signal);
        if (crashInfo) {
          crashInfo.detectedPatterns.push('EULA');
          this.handleCrash(crashInfo);
        }
        return;
      }

      // 重启服务端
      this.restartServer();
      return;
    }

    // 正常处理
    if (exitCode !== 0 || signal) {
      const crashInfo = this.crashDetector.detectFromExitCode(exitCode, signal);
      if (crashInfo) {
        this.handleCrash(crashInfo);
      }
    } else {
      // 退出码为 0 — 不直接确认完成，而是让 AI 分析最近日志
      logger.info('服务端进程退出（退出码 0），正在请求 AI 确认...');
      this.status = 'analyzing';
      this.callbacks.onStatusChange('analyzing');

      // 收集最近日志作为上下文
      const recentLogs = this.logParser?.getBuffer()?.slice(-120).join('\n') || '（无日志）';
      this.aiAdvisor.checkCompletion(recentLogs).then(async diagnosis => {
        const hasComplete = diagnosis.actions.some(a => a.type === 'complete');
        // 即使 AI 说完成，也要二次确认日志中没有明显错误关键字
        const crashKeywords = ['Failed to start the minecraft server', 'LoadingFailedException', 'has failed to load correctly', 'FATAL'];
        const hasCrashKeyword = crashKeywords.some(k => recentLogs.includes(k));
        if (hasComplete && !hasCrashKeyword) {
          logger.info('AI 确认服务端已完成运行（日志中未检测到错误）');
          this.status = 'stopped';
          this.callbacks.onStatusChange('stopped', { exitCode: 0, message: '服务端已完成运行' });
          const completeAction = diagnosis.actions.find(a => a.type === 'complete')!;
          this.safeExecutor.executeAction(completeAction);
        } else if (diagnosis.actions.length > 0) {
          // AI 通过 checkCompletion 检测到异常 → 调用 handleCrash 进行完整的崩溃分析
          logger.warn('AI 检测到日志中存在异常，调用崩溃分析进行二次诊断');
          const crashInfo: CrashInfo = {
            id: `ai-exit-${Date.now()}`,
            severity: 'warning',
            detectedPatterns: ['AI_DETECTED'],
            classification: { type: 'CRASH_UNKNOWN', reason: 'checkCompletion 检测到异常', suspectedMods: diagnosis.causes, suspectedConfigs: [] },
            timestamp: new Date().toISOString(),
            exitCode: 0,
            logContext: recentLogs.split('\n')
          };
          this.handleCrash(crashInfo);
        } else {
          // AI 未返回具体修复建议，日志中也没发现崩溃关键字 → 直接标记完成
          logger.info('AI 未能给出明确结论，但日志中未检测到崩溃关键字，标记为完成');
          this.status = 'stopped';
          this.callbacks.onStatusChange('stopped', { exitCode: 0, message: '服务端已完成运行' });
          this.safeExecutor.executeAction({
            id: `complete-${Date.now()}`,
            type: 'complete',
            target: '',
            riskLevel: 'low',
            reason: 'AI 无修复建议，按完成处理'
          });
        }
      });
    }
  }

  /**
   * 处理崩溃事件
   */
  private async handleCrash(crashInfo: CrashInfo): Promise<void> {
    this.currentCrashInfo = crashInfo;
    this.consecutiveCrashes++;

    // 触发崩溃通知
    this.status = 'crash_detected';
    this.callbacks.onStatusChange('crash_detected', {
      crashCount: this.consecutiveCrashes,
      maxCrashes: this.maxConsecutiveCrashes
    });
    this.callbacks.onCrashDetected(crashInfo);

    // 检查是否超过最大崩溃次数
    if (this.consecutiveCrashes >= this.maxConsecutiveCrashes) {
      this.status = 'give_up';
      this.callbacks.onGiveUp(`连续崩溃 ${this.consecutiveCrashes} 次，已达到上限`);
      this.callbacks.onStatusChange('give_up');
      
      // 生成报告
      await this.generateReport('give_up');
      return;
    }

    // 开始 AI 分析
    this.status = 'analyzing';
    this.callbacks.onStatusChange('analyzing');

    try {
      const diagnosis = await this.aiAdvisor.analyzeCrash(crashInfo, {
        serverType: this.serverContext.serverType,
        mcVersion: this.serverContext.mcVersion,
        javaVersion: this.serverContext.javaVersion,
        modList: this.serverContext.modList,
        previousActions: this.executedActions
      });

      this.currentDiagnosis = diagnosis;
      this.callbacks.onAIAnalysis(diagnosis);

      // 记录 AI 对话
      this.recordAIConversation({
        id: `diag-${Date.now()}`,
        type: 'diagnosis',
        prompt: `服务端类型: ${this.serverContext.serverType}\nMC 版本: ${this.serverContext.mcVersion}\nJava: ${this.serverContext.javaVersion}\n崩溃类型: ${crashInfo.classification}`,
        rawResponse: JSON.stringify(diagnosis, null, 2),
        diagnosis,
        timestamp: new Date().toISOString(),
        latencyMs: 0
      });

      // 处理修复操作
      if (diagnosis.actions.length > 0) {
        await this.handleRepairActions(diagnosis.actions);
      } else {
        // 没有建议操作，给出无建议的通知
        this.callbacks.onGiveUp('AI 未能生成修复建议');
      }
    } catch (err) {
      logger.error('崩溃处理流程出错', err as Error);
      this.status = 'awaiting_user';
      this.callbacks.onStatusChange('awaiting_user', { error: (err as Error).message });
    }
  }

  /**
   * 处理修复操作
   */
  private async handleRepairActions(actions: RepairAction[]): Promise<void> {
    // 过滤风险操作
    const { lowRisk, highRisk } = this.splitActionsByRisk(actions);

    // 进入等待用户确认状态
    this.status = 'awaiting_user';
    this.pendingActions = actions;
    
    // 发送待确认操作到前端
    this.callbacks.onActionsRequired(actions);

    // 自动执行低风险操作（如果开启了自动接受）
    if (this.autoAcceptLowRisk && lowRisk.length > 0) {
      const autoIds = lowRisk.map(a => a.id);
      await this.approveActions(autoIds);
    }

    // 高风险操作等待用户在前端手动确认
  }

  /**
   * 按风险等级拆分操作
   */
  private splitActionsByRisk(actions: RepairAction[]): { lowRisk: RepairAction[]; highRisk: RepairAction[] } {
    const lowRisk: RepairAction[] = [];
    const highRisk: RepairAction[] = [];

    for (const action of actions) {
      if (action.riskLevel === 'low' || action.riskLevel === 'medium') {
        lowRisk.push(action);
      } else {
        highRisk.push(action);
      }
    }

    return { lowRisk, highRisk };
  }

  /**
   * 重启服务端
   */
  private async restartServer(): Promise<void> {
    // 有等待用户确认的操作时，不自动重启
    if (this.pendingActions.length > 0) {
      logger.info('有待用户确认的修复操作，等待用户处理后再重启');
      return;
    }
    this.isFixCycleActive = true;
    this.status = 'restarting';
    this.restartCount++;
    this.callbacks.onStatusChange('restarting', { restartCount: this.restartCount });

    // 停止当前进程
    await this.processManager.stop();

    // 短等待后重启
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 重置检测器
    this.crashDetector.reset();

    // 重新启动
    const started = await this.processManager.start();
    
    this.isFixCycleActive = false;

    if (started) {
      this.status = 'monitoring';
      this.callbacks.onStatusChange('monitoring');
      logger.info(`服务端已重启（第 ${this.restartCount} 次）`);
      this.startMetricsPolling();
    } else {
      this.status = 'stopped';
      this.callbacks.onStatusChange('stopped', { error: '重启失败' });
      
      // 生成报告
      await this.generateReport('unfixed');
    }
  }

  /**
   * 挂起检测（外部定时调用）
   */
  public checkHang(now: number): void {
    if (this.status !== 'monitoring' || this.isFixCycleActive) return;

    const hangInfo = this.crashDetector.detectHang(
      now,
      this.processManager.isRunning()
    );

    if (hangInfo) {
      this.handleCrash(hangInfo);
    }
  }

  /**
   * 发送命令到服务端控制台
   */
  public sendCommand(command: string): boolean {
    return this.processManager.sendCommand(command);
  }

  /**
   * 获取 AI 对话记录
   */
  public getAIConversation(): AIConversationEntry[] {
    return this.aiAdvisor.getConversations();
  }
}

/** 服务端上下文 */
interface ServerContext {
  workDir: string;
  serverType: ServerType;
  mcVersion: string;
  javaVersion: string;
  modList: string[];
  crashReports: string[];
}

// 默认值
const configLogLines: number = 200;
const configTimeout: number = 30000;
