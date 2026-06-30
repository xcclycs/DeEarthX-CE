using System.Collections.Concurrent;
using System.Text.Json;
using DeEarthX.Core;
using DeEarthX.Core.Abstractions;
using DeEarthX.Core.Configuration;
using DeEarthX.Infrastructure.Http;
using DeEarthX.Realtime;

namespace DeEarthX.Guardian;

public sealed class GuardianController : IGuardianHubHandlers
{
    private readonly ProcessManager _processManager;
    private readonly LogParser _logParser;
    private readonly CrashDetector _crashDetector;
    private readonly AIAdvisor _aiAdvisor;
    private readonly SafeExecutor _safeExecutor;
    private readonly RollbackManager _rollbackManager;
    private readonly Reporter _reporter;
    private readonly IGuardianBroadcaster _broadcaster;
    private readonly IMessageService _messageService;
    private readonly ILogService _log;
    private readonly IDeEarthXHttpService _http;
    private readonly DeEarthXConfig _config;

    private readonly object _stateLock = new();
    private readonly SemaphoreSlim _crashLock = new(1, 1);

    private GuardianState _state = GuardianState.Idle;
    private ServerContext _serverContext = new();
    private int _consecutiveCrashes;
    private int _restartCount;
    private int _maxConsecutiveCrashes = 5;
    private bool _autoAcceptLowRisk = true;
    private int _monitoringTimeoutMs = 30000;
    private CrashInfo? _currentCrashInfo;
    private AiDiagnosisResult? _currentDiagnosis;
    private readonly List<AiAction> _pendingActions = new();
    private readonly List<AiAction> _executedActions = new();
    private bool _isFixCycleActive;
    private int _eulaAutoFixCount;
    private Timer? _startupCheckTimer;
    private Timer? _metricsTimer;
    private int _startupCheckAttempt;
    private bool _eventsWired;

    public GuardianController(
        ProcessManager processManager,
        LogParser logParser,
        CrashDetector crashDetector,
        AIAdvisor aiAdvisor,
        SafeExecutor safeExecutor,
        RollbackManager rollbackManager,
        Reporter reporter,
        IGuardianBroadcaster broadcaster,
        IMessageService messageService,
        ILogService log,
        IDeEarthXHttpService http,
        DeEarthXConfig config)
    {
        _processManager = processManager;
        _logParser = logParser;
        _crashDetector = crashDetector;
        _aiAdvisor = aiAdvisor;
        _safeExecutor = safeExecutor;
        _rollbackManager = rollbackManager;
        _reporter = reporter;
        _broadcaster = broadcaster;
        _messageService = messageService;
        _log = log;
        _http = http;
        _config = config;

        LoadConfig();
        WireProcessEvents();
        _rollbackManager.LoadRecords();
    }

    public GuardianState State
    {
        get { lock (_stateLock) return _state; }
    }

    public ProcessInfo GetProcessInfo() => _processManager.GetProcessInfo();

    public IReadOnlyList<string> GetLogBuffer() => _logParser.GetBuffer();

    public List<ReportListItem> GetReportsList() => _reporter.GetReportsList();

    public List<CheckpointListItem> GetCheckpoints() => _rollbackManager.GetCheckpoints();

    public IReadOnlyList<AiConversationEntry> GetAiConversations() => _aiAdvisor.GetConversations();

    public void ResetAiConversations()
    {
        _aiAdvisor.ResetConversations();
    }

    public async Task<bool> StartAsync(ServerContext ctx, CancellationToken ct = default)
    {
        lock (_stateLock)
        {
            if (_state is not (GuardianState.Idle or GuardianState.Stopped or GuardianState.GiveUp))
            {
                _log.Warn("Guardian 已在运行中");
                return false;
            }
        }

        LoadConfig();
        ApplyServerContext(ctx);

        SetState(GuardianState.Starting);
        _log.Info($"ServerGuardian 正在启动，工作目录: {ctx.WorkDir}");

        var started = await _processManager.StartAsync(ct: ct);
        if (!started)
        {
            SetState(GuardianState.Stopped, new { error = "服务端启动失败" });
            return false;
        }

        lock (_stateLock)
        {
            _consecutiveCrashes = 0;
            _restartCount = 0;
            _executedActions.Clear();
            _pendingActions.Clear();
            _currentCrashInfo = null;
            _currentDiagnosis = null;
            _eulaAutoFixCount = 0;
            _isFixCycleActive = false;
        }

        SetState(GuardianState.Monitoring);
        _log.Info("ServerGuardian 已启动，正在监控服务端...");

        StartStartupCheck();
        StartMetricsPolling();
        return true;
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        lock (_stateLock) _isFixCycleActive = false;
        ClearStartupCheck();
        StopMetricsPolling();

        SetState(GuardianState.Analyzing, new { message = "停止前确认服务端启动状态..." });
        await EnsureServerStartedBeforeStopAsync(ct);

        await _processManager.StopAsync(ct);

        lock (_stateLock)
        {
            _state = GuardianState.Stopped;
            _currentCrashInfo = null;
            _currentDiagnosis = null;
            _pendingActions.Clear();
        }
        await BroadcastAsync(GuardianEventType.Status, new { state = GuardianState.Stopped.ToString().ToLowerInvariant() });
        _log.Info("ServerGuardian 已停止");
    }

    private async Task EnsureServerStartedBeforeStopAsync(CancellationToken ct)
    {
        const int maxAttempts = 5;
        for (var i = 0; i < maxAttempts; i++)
        {
            var recentLogs = string.Join('\n', _logParser.GetLastLines(120));
            try
            {
                var complete = await _aiAdvisor.CheckCompletionAsync(recentLogs, ct);
                if (complete)
                {
                    _log.Info($"停止前确认：AI 判定服务端已完成加载（第 {i + 1} 次检查）");
                    await BroadcastAiConversation();
                    return;
                }
            }
            catch (Exception ex)
            {
                _log.Warn("停止前 AI 确认失败", ex);
            }
            _log.Info($"停止前确认：服务端未完成启动（第 {i + 1}/{maxAttempts} 次），20s 后再次检查");
            await Task.Delay(20000, ct);
        }
        _log.Warn($"{maxAttempts} 次检查后仍未确认完成启动，强制进入停止流程");
        await BroadcastAiConversation();
    }

    public async Task<TestAiResult> TestAiAsync(CancellationToken ct = default)
    {
        var result = await _aiAdvisor.TestConnectionDetailedAsync(ct);
        await BroadcastAsync(GuardianEventType.AiAnalysis, new
        {
            type = "test",
            success = result.Success,
            message = result.Message,
            latency = result.Latency
        });
        return result;
    }

    public async Task ApproveActionsAsync(IReadOnlyList<string> actionIds, CancellationToken ct = default)
    {
        List<AiAction> toExecute;
        lock (_stateLock)
        {
            toExecute = _pendingActions.Where(a => actionIds.Contains(a.Id)).ToList();
        }
        if (toExecute.Count == 0) return;

        SetState(GuardianState.Fixing);

        var crashId = _currentCrashInfo?.Id ?? "unknown";
        var checkpoint = _rollbackManager.CreateCheckpoint(crashId);

        foreach (var action in toExecute)
        {
            if (action.Type is ActionType.MoveFile or ActionType.DeleteFile or ActionType.RemoveMod)
            {
                var originalPath = Path.Combine(_serverContext.WorkDir, action.Target);
                if (File.Exists(originalPath))
                {
                    var backupPath = Path.Combine(_serverContext.WorkDir, ".rubbish", $"rollback_{checkpoint.Id}_{Path.GetFileName(action.Target)}");
                    _rollbackManager.RecordSnapshot(checkpoint.Id, originalPath, backupPath, MapSnapshotType(action.Type), action.Reason);
                }
            }

            action.Approved = true;
            var result = await _safeExecutor.ExecuteActionAsync(action, ct);
            if (result.Success)
            {
                lock (_stateLock) _executedActions.Add(action);
            }
            await BroadcastAsync(GuardianEventType.ActionExecuted, result);
        }

        lock (_stateLock)
        {
            _pendingActions.RemoveAll(a => actionIds.Contains(a.Id));
            if (_pendingActions.Count > 0)
            {
                _state = GuardianState.AwaitingUser;
            }
        }

        if (GetPendingCount() > 0)
        {
            SetState(GuardianState.AwaitingUser, new { pendingCount = GetPendingCount(), message = $"仍有 {GetPendingCount()} 个修复操作等待确认" });
            await BroadcastAsync(GuardianEventType.ActionsRequired, GetPendingActions());
            return;
        }

        SetState(GuardianState.AwaitingUser, new { pendingCount = 0, restartNeeded = true, message = "修复操作已全部执行，等待用户确认重启服务端" });
        await BroadcastLog("[Guardian] 修复操作已全部执行，请确认是否重启服务端", false);
    }

    public Task RejectActionsAsync(IReadOnlyList<string> actionIds, CancellationToken ct = default)
    {
        lock (_stateLock)
        {
            _pendingActions.RemoveAll(a => actionIds.Contains(a.Id));
            if (_pendingActions.Count == 0)
            {
                _state = GuardianState.GiveUp;
            }
        }

        if (State == GuardianState.GiveUp)
        {
            return HandleGiveUpAsync("用户拒绝了所有修复操作", ct);
        }

        SetState(GuardianState.AwaitingUser, new { pendingCount = GetPendingCount() });
        return BroadcastAsync(GuardianEventType.ActionsRequired, GetPendingActions());
    }

    public async Task ConfirmRestartAsync(CancellationToken ct = default)
    {
        if (GetPendingCount() > 0)
        {
            await BroadcastLog("[Guardian] 仍有待确认的修复操作，拒绝重启", true);
            return;
        }
        await BroadcastLog("[Guardian] 用户已确认，正在重启服务端...", false);
        await RestartServerAsync(ct);
    }

    public async Task<RollbackRestoreResult> RollbackLastFixAsync(CancellationToken ct = default)
    {
        var checkpoint = _rollbackManager.GetLatestRestorableCheckpoint();
        if (checkpoint is null)
        {
            return new RollbackRestoreResult { Success = false, Errors = new List<string> { "无可恢复的检查点" } };
        }
        var result = await _rollbackManager.RestoreAsync(checkpoint.Id, ct);
        await BroadcastAsync(GuardianEventType.Status, new
        {
            state = State.ToString().ToLowerInvariant(),
            rollback = new { success = result.Success, errors = result.Errors, checkpointId = checkpoint.Id }
        });
        return result;
    }

    public async Task<CrashReport?> GenerateReportAsync(CrashReportResult result, CancellationToken ct = default)
    {
        if (_currentCrashInfo is null) return null;
        var report = await _reporter.GenerateReportAsync(new ReportParams
        {
            ServerDir = _serverContext.WorkDir,
            ServerType = _serverContext.ServerType,
            JavaVersion = _serverContext.JavaVersion,
            McVersion = _serverContext.McVersion,
            CrashInfo = _currentCrashInfo,
            Diagnosis = _currentDiagnosis,
            ExecutedActions = _executedActions.ToList(),
            Result = result,
            RestartCount = _restartCount
        }, ct);
        await BroadcastAsync(GuardianEventType.Report, report);
        return report;
    }

    public bool SendCommand(string command)
    {
        return _processManager.SendCommand(command);
    }

    Task IGuardianHubHandlers.StartAsync(object data)
    {
        return StartFromHubAsync(data);
    }

    private async Task StartFromHubAsync(object data)
    {
        var ctx = ParseServerContext(data);
        if (string.IsNullOrEmpty(ctx.WorkDir))
        {
            await BroadcastLog("[Guardian] 启动失败：缺少工作目录 workDir", true);
            return;
        }
        await StartAsync(ctx);
        await BroadcastAsync(GuardianEventType.Status, new
        {
            state = State.ToString().ToLowerInvariant(),
            workDir = ctx.WorkDir
        });
    }

    Task IGuardianHubHandlers.StopAsync()
    {
        return StopAsync();
    }

    Task IGuardianHubHandlers.TestAiAsync()
    {
        return TestAiAsync();
    }

    Task IGuardianHubHandlers.ApproveAsync(object data)
    {
        var ids = ParseStringArray(data, "actionIds");
        return ApproveActionsAsync(ids);
    }

    Task IGuardianHubHandlers.RejectAsync(object data)
    {
        var ids = ParseStringArray(data, "actionIds");
        return RejectActionsAsync(ids);
    }

    Task IGuardianHubHandlers.RollbackAsync()
    {
        return RollbackLastFixAsync();
    }

    Task IGuardianHubHandlers.RestartAsync()
    {
        return ConfirmRestartAsync();
    }

    Task IGuardianHubHandlers.CommandAsync(object data)
    {
        var command = ParseString(data, "command");
        if (!string.IsNullOrEmpty(command))
        {
            _processManager.SendCommand(command);
        }
        return Task.CompletedTask;
    }

    Task IGuardianHubHandlers.GetAiConversationAsync()
    {
        return BroadcastAiConversation();
    }

    Task IGuardianHubHandlers.ResetAiConversationAsync()
    {
        ResetAiConversations();
        return BroadcastAiConversation();
    }

    Task IGuardianHubHandlers.UpdateConfigAsync(object data)
    {
        UpdateConfigFromHub(data);
        return BroadcastAsync(GuardianEventType.Status, new { state = State.ToString().ToLowerInvariant(), configUpdated = true });
    }

    private void WireProcessEvents()
    {
        if (_eventsWired) return;
        _eventsWired = true;
        _processManager.OnOutput += HandleProcessOutput;
        _processManager.OnCrash += HandleProcessExit;
    }

    private void HandleProcessOutput(string line, bool isError)
    {
        _ = BroadcastAsync(GuardianEventType.Log, new { line, isError });
        _crashDetector.UpdateLastOutputTime();

        bool inCycle;
        lock (_stateLock) inCycle = _isFixCycleActive;
        if (inCycle) return;

        var result = _crashDetector.DetectFromLogLine(line, isError);
        if (result.IsCrash && result.CrashInfo is not null)
        {
            _ = HandleCrashAsync(result.CrashInfo, source: "log");
        }
    }

    private void HandleProcessExit(int exitCode, string? signal)
    {
        _ = HandleProcessExitAsync(exitCode, signal);
    }

    private async Task HandleProcessExitAsync(int exitCode, string? signal)
    {
        ClearStartupCheck();
        StopMetricsPolling();

        bool inCycle;
        lock (_stateLock) inCycle = _isFixCycleActive;
        if (inCycle || State == GuardianState.Stopped) return;

        if (GetPendingCount() > 0)
        {
            _log.Info("有待用户确认的修复操作，忽略本次进程退出事件");
            return;
        }

        if (_logParser.HasEulaPrompt() || _logParser.HasEula())
        {
            _eulaAutoFixCount++;
            _log.Info($"检测到 EULA 未同意（第 {_eulaAutoFixCount} 次）");

            if (_eulaAutoFixCount > 3)
            {
                _log.Warn("EULA 自动修复已失效，转交 AI 分析");
                var crashInfo = _crashDetector.DetectFromExitCode(exitCode, signal);
                if (crashInfo is not null)
                {
                    crashInfo.DetectedPatterns.Add("EULA");
                    crashInfo.Classification = new CrashClassification
                    {
                        Type = CrashType.Eula,
                        Reason = "EULA 自动修复超过 3 次仍未解决",
                        SuspectedMods = new(),
                        SuspectedConfigs = new()
                    };
                    await HandleCrashAsync(crashInfo, source: "exit");
                }
                return;
            }

            try
            {
                var eulaPath = Path.Combine(_serverContext.WorkDir, "eula.txt");
                await File.WriteAllTextAsync(eulaPath, "eula=true\n");
                _log.Info($"已自动设置 {eulaPath} → eula=true");
                await BroadcastLog("[Guardian] 已自动接受 EULA（eula.txt → eula=true）", false);
                await BroadcastLog("[Guardian] 准备重新启动服务端...", false);
            }
            catch (Exception ex)
            {
                _log.Error("自动设置 eula.txt 失败", ex);
                var crashInfo = _crashDetector.DetectFromExitCode(exitCode, signal);
                if (crashInfo is not null)
                {
                    crashInfo.DetectedPatterns.Add("EULA");
                    await HandleCrashAsync(crashInfo, source: "exit");
                }
                return;
            }

            await RestartServerAsync();
            return;
        }

        if (exitCode != 0 || !string.IsNullOrEmpty(signal))
        {
            var crashInfo = _crashDetector.DetectFromExitCode(exitCode, signal);
            if (crashInfo is not null)
            {
                await HandleCrashAsync(crashInfo, source: "exit");
            }
        }
        else
        {
            _log.Info("服务端进程退出（退出码 0），正在请求 AI 确认...");
            SetState(GuardianState.Analyzing);
            var recentLogs = string.Join('\n', _logParser.GetLastLines(120));
            try
            {
                var complete = await _aiAdvisor.CheckCompletionAsync(recentLogs);
                await BroadcastAiConversation();
                var crashKeywords = new[] { "Failed to start the minecraft server", "LoadingFailedException", "has failed to load correctly", "FATAL" };
                var hasCrashKeyword = crashKeywords.Any(k => recentLogs.Contains(k, StringComparison.OrdinalIgnoreCase));
                if (complete && !hasCrashKeyword)
                {
                    _log.Info("AI 确认服务端已完成运行（日志中未检测到错误）");
                    lock (_stateLock) _state = GuardianState.Stopped;
                    await BroadcastAsync(GuardianEventType.Status, new { state = "stopped", exitCode = 0, message = "服务端已完成运行" });
                }
                else
                {
                    var crashInfo = new CrashInfo
                    {
                        Id = $"ai-exit-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
                        Timestamp = DateTime.UtcNow.ToString("o"),
                        Severity = CrashSeverity.Warning,
                        ExitCode = 0,
                        DetectedPatterns = new List<string> { "AI_DETECTED" },
                        LogContext = recentLogs.Split('\n').ToList(),
                        Classification = new CrashClassification
                        {
                            Type = CrashType.CrashUnknown,
                            Reason = "checkCompletion 检测到异常或退出时存在崩溃关键字",
                            SuspectedMods = new(),
                            SuspectedConfigs = new()
                        }
                    };
                    await HandleCrashAsync(crashInfo, source: "exit");
                }
            }
            catch (Exception ex)
            {
                _log.Error("退出后 AI 确认失败", ex);
                lock (_stateLock) _state = GuardianState.Stopped;
                await BroadcastAsync(GuardianEventType.Status, new { state = "stopped", exitCode = 0, message = "服务端已完成运行" });
            }
        }
    }

    private async Task HandleCrashAsync(CrashInfo crashInfo, string source = "unknown")
    {
        await _crashLock.WaitAsync();
        try
        {
            lock (_stateLock)
            {
                if (_isFixCycleActive) return;
                if (_state is GuardianState.Analyzing or GuardianState.AwaitingUser
                    or GuardianState.Fixing or GuardianState.Restarting
                    or GuardianState.GiveUp or GuardianState.Stopped)
                {
                    return;
                }
                _currentCrashInfo = crashInfo;
                _consecutiveCrashes++;
                _state = GuardianState.CrashDetected;
            }

            await BroadcastAsync(GuardianEventType.Status, new
            {
                state = "crash_detected",
                crashCount = _consecutiveCrashes,
                maxCrashes = _maxConsecutiveCrashes
            });
            await BroadcastAsync(GuardianEventType.CrashDetected, crashInfo);

            if (_consecutiveCrashes >= _maxConsecutiveCrashes)
            {
                await HandleGiveUpAsync($"连续崩溃 {_consecutiveCrashes} 次，已达到上限");
                return;
            }

            SetState(GuardianState.Analyzing);
            try
            {
                var diagnosis = await _aiAdvisor.AnalyzeCrashAsync(crashInfo, _serverContext);
                await BroadcastAiConversation();

                lock (_stateLock) _currentDiagnosis = diagnosis;

                if (diagnosis is not null)
                {
                    await BroadcastAsync(GuardianEventType.AiAnalysis, diagnosis);
                }

                if (diagnosis is not null && diagnosis.Actions.Count > 0)
                {
                    await HandleRepairActionsAsync(diagnosis.Actions);
                }
                else
                {
                    await HandleGiveUpAsync("AI 未能生成修复建议");
                }
            }
            catch (Exception ex)
            {
                _log.Error("崩溃处理流程出错", ex);
                SetState(GuardianState.AwaitingUser, new { error = ex.Message });
            }
        }
        finally
        {
            _crashLock.Release();
        }
    }

    private async Task HandleRepairActionsAsync(List<AiAction> actions)
    {
        var lowRisk = actions.Where(a => a.RiskLevel is ActionRiskLevel.Low or ActionRiskLevel.Medium).ToList();
        var highRisk = actions.Where(a => a.RiskLevel is ActionRiskLevel.High or ActionRiskLevel.Critical).ToList();

        lock (_stateLock)
        {
            _state = GuardianState.AwaitingUser;
            _pendingActions.Clear();
            _pendingActions.AddRange(actions);
        }

        await BroadcastAsync(GuardianEventType.ActionsRequired, actions);

        if (_autoAcceptLowRisk && lowRisk.Count > 0)
        {
            var autoIds = lowRisk.Select(a => a.Id).ToList();
            await ApproveActionsAsync(autoIds);
        }
    }

    private async Task HandleGiveUpAsync(string reason, CancellationToken ct = default)
    {
        lock (_stateLock) _state = GuardianState.GiveUp;
        await BroadcastAsync(GuardianEventType.GiveUp, new { reason, crashCount = _consecutiveCrashes });
        await BroadcastAsync(GuardianEventType.Status, new { state = "give_up", reason });
        await GenerateReportAsync(CrashReportResult.GiveUp, ct);
    }

    private async Task RestartServerAsync(CancellationToken ct = default)
    {
        if (GetPendingCount() > 0)
        {
            _log.Info("有待用户确认的修复操作，等待用户处理后再重启");
            return;
        }

        lock (_stateLock) _isFixCycleActive = true;
        SetState(GuardianState.Restarting, new { restartCount = _restartCount + 1 });
        _restartCount++;

        await _processManager.StopAsync(ct);
        await Task.Delay(2000, ct);
        _crashDetector.Reset();

        var started = await _processManager.StartAsync(ct: ct);

        lock (_stateLock) _isFixCycleActive = false;

        if (started)
        {
            lock (_stateLock) _state = GuardianState.Monitoring;
            await BroadcastAsync(GuardianEventType.Status, new { state = "monitoring", restartCount = _restartCount });
            _log.Info($"服务端已重启（第 {_restartCount} 次）");
            StartMetricsPolling();
        }
        else
        {
            lock (_stateLock) _state = GuardianState.Stopped;
            await BroadcastAsync(GuardianEventType.Status, new { state = "stopped", error = "重启失败" });
            await GenerateReportAsync(CrashReportResult.Unfixed, ct);
        }
    }

    private void StartStartupCheck()
    {
        ClearStartupCheck();
        _startupCheckAttempt = 0;
        _startupCheckTimer = new Timer(_ => _ = DoStartupCheckAsync(), null, 20000, 20000);
    }

    private void ClearStartupCheck()
    {
        if (_startupCheckTimer is not null)
        {
            try { _startupCheckTimer.Change(Timeout.Infinite, Timeout.Infinite); _startupCheckTimer.Dispose(); } catch { }
            _startupCheckTimer = null;
        }
    }

    private async Task DoStartupCheckAsync()
    {
        if (State != GuardianState.Monitoring) return;
        bool inCycle;
        lock (_stateLock) inCycle = _isFixCycleActive;
        if (inCycle) return;

        _startupCheckAttempt++;
        var recentLogs = string.Join('\n', _logParser.GetLastLines(120));
        try
        {
            var complete = await _aiAdvisor.CheckCompletionAsync(recentLogs);
            await BroadcastAiConversation();
            if (State != GuardianState.Monitoring) return;

            if (complete)
            {
                _log.Info($"启动确认：AI 判定服务端已完成加载（第 {_startupCheckAttempt} 次检查）");
                await BroadcastLog("[Guardian] 启动确认通过，服务端运行正常", false);
                _startupCheckAttempt = 0;
                ClearStartupCheck();
            }
            else if (_startupCheckAttempt >= 5)
            {
                _log.Warn($"启动确认：AI 判定服务端未完成（已检查 {_startupCheckAttempt} 次），正在强制终止...");
                await BroadcastLog("[Guardian] 启动超时，正在强制终止...", true);
                await _processManager.StopAsync();
                lock (_stateLock) _state = GuardianState.Stopped;
                await BroadcastAsync(GuardianEventType.Status, new { state = "stopped", exitCode = 0, message = "启动超时已终止" });
                ClearStartupCheck();
            }
            else
            {
                _log.Info($"启动确认：AI 判定服务端未完成（第 {_startupCheckAttempt} 次检查），20s 后再次检查");
            }
        }
        catch (Exception ex)
        {
            _log.Warn("启动确认 AI 调用失败", ex);
        }
    }

    private void StartMetricsPolling()
    {
        StopMetricsPolling();
        _metricsTimer = new Timer(_ => _ = BroadcastMetricsAsync(), null, 2000, 2000);
    }

    private void StopMetricsPolling()
    {
        if (_metricsTimer is not null)
        {
            try { _metricsTimer.Change(Timeout.Infinite, Timeout.Infinite); _metricsTimer.Dispose(); } catch { }
            _metricsTimer = null;
        }
    }

    private async Task BroadcastMetricsAsync()
    {
        var metrics = _processManager.GetMetrics(_restartCount);
        if (metrics is null) return;
        await BroadcastAsync(GuardianEventType.Metrics, metrics);
    }

    private async Task BroadcastAiConversation()
    {
        await BroadcastAsync(GuardianEventType.AiConversation, _aiAdvisor.GetConversations());
    }

    private async Task BroadcastLog(string line, bool isError)
    {
        await BroadcastAsync(GuardianEventType.Log, new { line, isError });
    }

    private void SetState(GuardianState state, object? data = null)
    {
        lock (_stateLock) _state = state;
        _ = BroadcastAsync(GuardianEventType.Status, new
        {
            state = state.ToString().ToLowerInvariant(),
            data
        });
    }

    private Task BroadcastAsync(GuardianEventType evt, object data)
    {
        var name = evt switch
        {
            GuardianEventType.Status => GuardianEventNames.Status,
            GuardianEventType.Log => GuardianEventNames.Log,
            GuardianEventType.CrashDetected => GuardianEventNames.CrashDetected,
            GuardianEventType.AiAnalysis => GuardianEventNames.AiAnalysis,
            GuardianEventType.AiConversation => GuardianEventNames.AiConversation,
            GuardianEventType.ActionsRequired => GuardianEventNames.ActionsRequired,
            GuardianEventType.ActionExecuted => GuardianEventNames.ActionExecuted,
            GuardianEventType.GiveUp => GuardianEventNames.GiveUp,
            GuardianEventType.Report => GuardianEventNames.Report,
            GuardianEventType.Metrics => GuardianEventNames.Metrics,
            _ => GuardianEventNames.Status
        };
        return _broadcaster.BroadcastAsync(name, data);
    }

    private int GetPendingCount()
    {
        lock (_stateLock) return _pendingActions.Count;
    }

    private List<AiAction> GetPendingActions()
    {
        lock (_stateLock) return _pendingActions.ToList();
    }

    private static string MapSnapshotType(ActionType type) => type switch
    {
        ActionType.RemoveMod or ActionType.MoveFile => "move",
        ActionType.DeleteFile => "delete",
        ActionType.EditConfig => "edit",
        ActionType.AddJvmArg => "add_arg",
        _ => "edit"
    };

    private void LoadConfig()
    {
        var g = _config.Guardian;
        if (g is null) return;
        _autoAcceptLowRisk = g.AutoAcceptLowRisk;
        _maxConsecutiveCrashes = g.MaxConsecutiveCrashes > 0 ? g.MaxConsecutiveCrashes : 5;
        _monitoringTimeoutMs = g.MonitoringTimeout > 0 ? g.MonitoringTimeout : 30000;

        _processManager.HangTimeoutMs = _monitoringTimeoutMs;
        _crashDetector.MonitoringTimeoutMs = _monitoringTimeoutMs;
    }

    private void ApplyServerContext(ServerContext ctx)
    {
        _serverContext = ctx;
        if (string.IsNullOrEmpty(ctx.JavaCommand))
        {
            ctx.JavaCommand = !string.IsNullOrEmpty(_config.JavaPath) ? _config.JavaPath : "java";
        }
        _processManager.Configure(ctx.WorkDir, ctx.JavaCommand);
        _safeExecutor.Configure(ctx.WorkDir);
        _rollbackManager.Configure(ctx.WorkDir);
        _rollbackManager.LoadRecords();
        _logParser.ClearBuffer();
        _crashDetector.Reset();
    }

    private void UpdateConfigFromHub(object data)
    {
        if (data is not JsonElement el || el.ValueKind != JsonValueKind.Object) return;

        var g = _config.Guardian ??= new GuardianConfig();

        if (el.TryGetProperty("autoAcceptLowRisk", out var aalr) && aalr.ValueKind == JsonValueKind.False)
        {
            g.AutoAcceptLowRisk = false;
            _autoAcceptLowRisk = false;
        }
        else if (aalr.ValueKind == JsonValueKind.True)
        {
            g.AutoAcceptLowRisk = true;
            _autoAcceptLowRisk = true;
        }

        if (el.TryGetProperty("maxConsecutiveCrashes", out var mcc) && mcc.TryGetInt32(out var mc) && mc > 0)
        {
            g.MaxConsecutiveCrashes = mc;
            _maxConsecutiveCrashes = mc;
        }

        if (el.TryGetProperty("monitoringTimeout", out var mt) && mt.TryGetInt32(out var mtv) && mtv > 0)
        {
            g.MonitoringTimeout = mtv;
            _monitoringTimeoutMs = mtv;
            _processManager.HangTimeoutMs = mtv;
            _crashDetector.MonitoringTimeoutMs = mtv;
        }

        if (el.TryGetProperty("workDir", out var wd) && wd.ValueKind == JsonValueKind.String)
        {
            _serverContext.WorkDir = wd.GetString() ?? _serverContext.WorkDir;
            _processManager.Configure(_serverContext.WorkDir, _serverContext.JavaCommand);
            _safeExecutor.Configure(_serverContext.WorkDir);
            _rollbackManager.Configure(_serverContext.WorkDir);
        }

        if (el.TryGetProperty("javaCommand", out var jc) && jc.ValueKind == JsonValueKind.String)
        {
            _serverContext.JavaCommand = jc.GetString() ?? _serverContext.JavaCommand;
        }

        if (el.TryGetProperty("ai", out var aiEl) && aiEl.ValueKind == JsonValueKind.Object)
        {
            if (aiEl.TryGetProperty("provider", out var p)) g.Ai.Provider = p.GetString() ?? g.Ai.Provider;
            if (aiEl.TryGetProperty("apiKey", out var k)) g.Ai.ApiKey = k.GetString() ?? g.Ai.ApiKey;
            if (aiEl.TryGetProperty("model", out var m)) g.Ai.Model = m.GetString() ?? g.Ai.Model;
            if (aiEl.TryGetProperty("baseUrl", out var b)) g.Ai.BaseUrl = b.GetString() ?? g.Ai.BaseUrl;
            if (aiEl.TryGetProperty("baseURL", out var b2)) g.Ai.BaseUrl = b2.GetString() ?? g.Ai.BaseUrl;
            _aiAdvisor.UpdateConfig(g.Ai);
        }
    }

    private static ServerContext ParseServerContext(object data)
    {
        var ctx = new ServerContext();
        if (data is not JsonElement el || el.ValueKind != JsonValueKind.Object) return ctx;

        ctx.WorkDir = GetStringProperty(el, "workDir") ?? string.Empty;
        ctx.JavaCommand = GetStringProperty(el, "javaCommand") ?? string.Empty;
        ctx.ServerType = GetStringProperty(el, "serverType") ?? "unknown";
        ctx.McVersion = GetStringProperty(el, "mcVersion") ?? string.Empty;
        ctx.JavaVersion = GetStringProperty(el, "javaVersion") ?? string.Empty;
        return ctx;
    }

    private static string? ParseString(object data, string name)
    {
        if (data is not JsonElement el || el.ValueKind != JsonValueKind.Object) return null;
        return GetStringProperty(el, name);
    }

    private static IReadOnlyList<string> ParseStringArray(object data, string name)
    {
        var list = new List<string>();
        if (data is not JsonElement el || el.ValueKind != JsonValueKind.Object) return list;
        if (!el.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array) return list;
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                list.Add(item.GetString() ?? string.Empty);
            }
        }
        return list;
    }

    private static string? GetStringProperty(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String)
        {
            return prop.GetString();
        }
        return null;
    }
}
