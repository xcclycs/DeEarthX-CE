using System.Text.Json.Serialization;

namespace DeEarthX.Guardian;

public enum GuardianState
{
    Idle,
    Starting,
    Monitoring,
    CrashDetected,
    Analyzing,
    AwaitingUser,
    Fixing,
    Restarting,
    Stopped,
    GiveUp
}

public enum GuardianEventType
{
    Status,
    Log,
    CrashDetected,
    AiAnalysis,
    AiConversation,
    ActionsRequired,
    ActionExecuted,
    GiveUp,
    Report,
    Metrics
}

public enum CrashSeverity
{
    Fatal,
    Error,
    Warning,
    Info
}

public enum ActionRiskLevel
{
    Low,
    Medium,
    High,
    Critical
}

public enum ProcessStatus
{
    Stopped,
    Starting,
    Running,
    Crashed,
    Hanging
}

public enum ActionType
{
    MoveFile,
    DeleteFile,
    EditConfig,
    AddJvmArg,
    RemoveMod,
    DownloadFile,
    Complete
}

public enum CrashType
{
    CrashKnown,
    CrashUnknown,
    Hang,
    Oom,
    ModConflict,
    ConfigError,
    Eula
}

public enum AiProvider
{
    OpenAI,
    Ollama,
    None
}

public enum CrashReportResult
{
    Fixed,
    Unfixed,
    UserStopped,
    GiveUp
}

public enum AiConversationType
{
    Diagnosis,
    Test,
    Fallback
}

public sealed class ServerContext
{
    public string WorkDir { get; set; } = string.Empty;
    public string ServerType { get; set; } = "unknown";
    public string McVersion { get; set; } = string.Empty;
    public string JavaVersion { get; set; } = string.Empty;
    public string JavaCommand { get; set; } = string.Empty;
    public List<string> ModList { get; set; } = new();
    public List<string> CrashReports { get; set; } = new();
}

public sealed class CrashClassification
{
    public CrashType Type { get; set; } = CrashType.CrashUnknown;
    public string Reason { get; set; } = string.Empty;
    public List<string> SuspectedMods { get; set; } = new();
    public List<string> SuspectedConfigs { get; set; } = new();
}

public sealed class CrashInfo
{
    public string Id { get; set; } = string.Empty;
    public string Timestamp { get; set; } = string.Empty;
    public CrashSeverity Severity { get; set; } = CrashSeverity.Error;
    public int? ExitCode { get; set; }
    public string? Signal { get; set; }
    public List<string> DetectedPatterns { get; set; } = new();
    public List<string> LogContext { get; set; } = new();
    public string? LogFilePath { get; set; }
    public string? CrashReportPath { get; set; }
    public CrashClassification Classification { get; set; } = new();
}

public sealed class AiAction
{
    public string Id { get; set; } = string.Empty;
    public ActionType Type { get; set; }
    public ActionRiskLevel RiskLevel { get; set; } = ActionRiskLevel.Medium;
    public string Target { get; set; } = string.Empty;
    public string? Destination { get; set; }
    public string? File { get; set; }
    [JsonPropertyName("key_path")]
    public string? KeyPath { get; set; }
    [JsonPropertyName("new_value")]
    public string? NewValue { get; set; }
    [JsonPropertyName("jvm_arg")]
    public string? JvmArg { get; set; }
    public string? Url { get; set; }
    public string Reason { get; set; } = string.Empty;
    public bool Approved { get; set; }
}

public sealed class AiDiagnosisResult
{
    public string Diagnosis { get; set; } = string.Empty;
    public List<string> Causes { get; set; } = new();
    public List<AiAction> Actions { get; set; } = new();
    public double Confidence { get; set; }
    public string? RawResponse { get; set; }
}

public sealed class AiConversationEntry
{
    public string Id { get; set; } = string.Empty;
    public string Timestamp { get; set; } = string.Empty;
    public AiConversationType Type { get; set; }
    public string Prompt { get; set; } = string.Empty;
    public string RawResponse { get; set; } = string.Empty;
    public AiDiagnosisResult? Diagnosis { get; set; }
    public long? LatencyMs { get; set; }
}

public sealed class ProcessInfo
{
    public int? Pid { get; set; }
    public ProcessStatus Status { get; set; } = ProcessStatus.Stopped;
    public string? StartTime { get; set; }
    public string? EndTime { get; set; }
    public int? ExitCode { get; set; }
    public string? Signal { get; set; }
    public string Command { get; set; } = string.Empty;
    public List<string> Args { get; set; } = new();
    public string WorkDir { get; set; } = string.Empty;
}

public sealed class ProcessMetrics
{
    public int? Pid { get; set; }
    public double UptimeSeconds { get; set; }
    public int RestartCount { get; set; }
    public ProcessStatus Status { get; set; } = ProcessStatus.Running;
}

public sealed class ParsedLogLine
{
    public string Raw { get; set; } = string.Empty;
    public string? Timestamp { get; set; }
    public string Level { get; set; } = "INFO";
    public string Content { get; set; } = string.Empty;
    public CrashSeverity Severity { get; set; } = CrashSeverity.Info;
    public bool IsError { get; set; }
    public List<string> MatchedPatterns { get; set; } = new();
}

public sealed class ExecutionResult
{
    public string ActionId { get; set; } = string.Empty;
    public bool Success { get; set; }
    public string? Error { get; set; }
    public string? Snapshot { get; set; }
}

public sealed class CrashReport
{
    public string Id { get; set; } = string.Empty;
    public string Timestamp { get; set; } = string.Empty;
    public string ServerDir { get; set; } = string.Empty;
    public string ServerType { get; set; } = string.Empty;
    public string JavaVersion { get; set; } = string.Empty;
    public string McVersion { get; set; } = string.Empty;
    public CrashInfo? CrashInfo { get; set; }
    public AiDiagnosisResult? Diagnosis { get; set; }
    public List<AiAction> ExecutedActions { get; set; } = new();
    public CrashReportResult Result { get; set; }
    public int RestartCount { get; set; }
    public string? ReportPath { get; set; }
}

public sealed class RollbackSnapshot
{
    public string OriginalPath { get; set; } = string.Empty;
    public string BackupPath { get; set; } = string.Empty;
    public string Type { get; set; } = "edit";
    public string Description { get; set; } = string.Empty;
}

public sealed class RollbackCheckpoint
{
    public string Id { get; set; } = string.Empty;
    public string Timestamp { get; set; } = string.Empty;
    public string CrashId { get; set; } = string.Empty;
    public List<RollbackSnapshot> Snapshots { get; set; } = new();
    public bool Reverted { get; set; }
}

public sealed class ReportListItem
{
    public string Id { get; set; } = string.Empty;
    public string Timestamp { get; set; } = string.Empty;
    public string File { get; set; } = string.Empty;
}

public sealed class CheckpointListItem
{
    public string Id { get; set; } = string.Empty;
    public string Timestamp { get; set; } = string.Empty;
    public string CrashId { get; set; } = string.Empty;
    public bool Reverted { get; set; }
    public int OperationCount { get; set; }
}

public sealed class TestAiResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public long? Latency { get; set; }
}

public sealed class RollbackRestoreResult
{
    public bool Success { get; set; }
    public List<string> Errors { get; set; } = new();
}

public sealed class PathSafetyResult
{
    public bool Safe { get; set; }
    public string Resolved { get; set; } = string.Empty;
    public string? Reason { get; set; }
}

public static class GuardianEventNames
{
    public const string Status = "guardian_status";
    public const string Log = "guardian_log";
    public const string CrashDetected = "guardian_crash_detected";
    public const string AiAnalysis = "guardian_ai_analysis";
    public const string AiConversation = "guardian_ai_conversation";
    public const string ActionsRequired = "guardian_actions_required";
    public const string ActionExecuted = "guardian_action_executed";
    public const string GiveUp = "guardian_give_up";
    public const string Report = "guardian_report";
    public const string Metrics = "guardian_metrics";
}
