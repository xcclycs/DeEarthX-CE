/**
 * ServerGuardian 类型定义
 * DeEarthX-CE AI-Agent 服务端崩溃监视与修复智能体
 */

/** 服务端类型 */
export type ServerType = 'forge' | 'neoforge' | 'fabric' | 'vanilla' | 'unknown';

/** 崩溃严重等级 */
export type CrashSeverity = 'fatal' | 'error' | 'warning' | 'info';

/** 操作风险等级 */
export type ActionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** 自动化级别 */
export type AutomationLevel = 'strict' | 'monitor'; // 严厉模式 / 监护模式

/** 进程状态 */
export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'crashed' | 'hanging';

/** Guardian 状态 */
export type GuardianStatus = 
  | 'idle'           // 空闲
  | 'starting'       // 正在启动服务端
  | 'monitoring'     // 监控中
  | 'crash_detected' // 检测到崩溃
  | 'analyzing'      // AI 分析中
  | 'awaiting_user'  // 等待用户确认
  | 'fixing'         // 正在执行修复
  | 'restarting'     // 正在重启
  | 'stopped'        // 已停止
  | 'give_up';       // 放弃（连续崩溃超限）

/** AI 提供商类型 */
export type AIProvider = 'openai' | 'ollama' | 'none';

/** 操作类型（白名单） */
export type ActionType = 
  | 'move_file'
  | 'delete_file'
  | 'edit_config'
  | 'add_jvm_arg'
  | 'remove_mod'
  | 'download_file'
  | 'complete';

/** Guardian 配置 */
export interface IGuardianConfig {
  enabled: boolean;
  ai: {
    provider: AIProvider;
    apiKey: string;
    model: string;
    baseURL: string;
    maxTokens?: number;
  };
  autoAcceptLowRisk: boolean;
  maxConsecutiveCrashes: number;
  monitoringTimeout: number;  // 毫秒
  maxLogContextLines: number;
  workDir: string;
  javaCommand: string;
  serverType: ServerType;
  automationLevel: AutomationLevel;
}

/** 崩溃信息 */
export interface CrashInfo {
  id: string;
  timestamp: string;
  severity: CrashSeverity;
  exitCode?: number;
  signal?: string;
  detectedPatterns: string[];
  logContext: string[];       // 崩溃前后的日志行
  logFilePath?: string;       // latest.log 路径
  crashReportPath?: string;   // crash-reports 路径
  classification: CrashClassification;
}

/** 崩溃分类 */
export interface CrashClassification {
  type: 'CRASH_KNOWN' | 'CRASH_UNKNOWN' | 'HANG' | 'OOM' | 'MOD_CONFLICT' | 'CONFIG_ERROR' | 'EULA';
  reason: string;
  suspectedMods: string[];    // 疑似问题模组
  suspectedConfigs: string[];  // 疑似问题配置
}

/** AI 诊断结果 */
export interface AIDiagnosis {
  diagnosis: string;          // 中文诊断（严厉父亲口吻）
  causes: string[];           // 原因分析列表
  actions: RepairAction[];
  confidence: number;          // 置信度 0-1
  rawResponse?: string;        // 原始 AI 响应
}

/** 修复操作 */
export interface RepairAction {
  id: string;
  type: ActionType;
  riskLevel: ActionRiskLevel;
  target: string;              // 目标文件路径
  destination?: string;        // 移动目标路径
  file?: string;               // 配置文件路径（edit_config）
  keyPath?: string;            // 配置键路径
  newValue?: string;           // 新值
  jvmArg?: string;             // JVM 参数
  url?: string;                // 下载 URL
  reason: string;              // 操作原因
  approved?: boolean;          // 用户是否已批准
}

/** 回滚检查点 */
export interface RollbackCheckpoint {
  id: string;
  timestamp: string;
  crashId: string;
  operations: RollbackOperation[];
  reverted: boolean;
}

/** 回滚操作记录 */
export interface RollbackOperation {
  type: 'move' | 'delete' | 'edit' | 'add_arg';
  description: string;
  undo: () => Promise<void>;
}

/** 崩溃报告 */
export interface CrashReport {
  id: string;
  timestamp: string;
  serverDir: string;
  serverType: ServerType;
  javaVersion: string;
  mcVersion: string;
  crashInfo: CrashInfo;
  diagnosis?: AIDiagnosis;
  executedActions: RepairAction[];
  result: 'fixed' | 'unfixed' | 'user_stopped' | 'give_up';
  restartCount: number;
  reportPath?: string;
}

/** AI 对话记录条目 */
export interface AIConversationEntry {
  id: string;
  timestamp: string;
  type: 'diagnosis' | 'test' | 'fallback';
  /** 发送给 AI 的完整 Prompt */
  prompt: string;
  /** AI 返回的原始响应（非流式完整内容） */
  rawResponse: string;
  /** 解析后的诊断结果 */
  diagnosis?: AIDiagnosis;
  /** 耗时（毫秒） */
  latencyMs?: number;
}

/** 日志行 */
export interface LogLine {
  timestamp: string;
  level: string;
  content: string;
  raw: string;
}

/** WebSocket 事件类型 */
export type GuardianWSEventType =
  | 'guardian_started'
  | 'guardian_stopped'
  | 'guardian_log'
  | 'guardian_crash_detected'
  | 'guardian_ai_analysis_start'
  | 'guardian_ai_analysis'
  | 'guardian_ai_analysis_complete'
  | 'guardian_actions_required'
  | 'guardian_action_executed'
  | 'guardian_restart'
  | 'guardian_give_up'
  | 'guardian_rollback'
  | 'guardian_status';

/** WebSocket 事件 */
export interface GuardianWSEvent {
  type: GuardianWSEventType;
  data?: any;
  message?: string;
  timestamp: string;
}
