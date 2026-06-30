using System.Text.RegularExpressions;

namespace DeEarthX.Guardian;

public sealed class CrashDetector
{
    private readonly LogParser _logParser;
    private long _lastOutputTimeTicks;

    public int MaxLogContextLines { get; set; } = 200;
    public int MonitoringTimeoutMs { get; set; } = 30000;

    public CrashDetector(LogParser logParser)
    {
        _logParser = logParser;
        _lastOutputTimeTicks = DateTime.UtcNow.Ticks;
    }

    public CrashDetectionResult DetectFromLogLine(string line, bool isStderr)
    {
        var parsed = _logParser.ParseLine(line, isStderr);

        if (parsed.Severity == CrashSeverity.Fatal)
        {
            var classification = ClassifyCrash(parsed);
            return new CrashDetectionResult(true, BuildCrashInfo(parsed, classification));
        }

        return new CrashDetectionResult(false, null);
    }

    public CrashInfo? DetectFromExitCode(int exitCode, string? signal)
    {
        if (exitCode == 0 && string.IsNullOrEmpty(signal))
        {
            return null;
        }

        var severity = exitCode == -1 ? CrashSeverity.Fatal : CrashSeverity.Error;
        var detectedPatterns = new List<string> { $"EXIT_CODE_{exitCode}" };
        if (!string.IsNullOrEmpty(signal))
        {
            detectedPatterns.Add($"SIGNAL_{signal}");
        }

        var classification = new CrashClassification
        {
            Type = exitCode < 0 ? CrashType.CrashUnknown : CrashType.CrashKnown,
            Reason = $"服务端进程异常退出 (退出码: {exitCode}{(string.IsNullOrEmpty(signal) ? "" : $", 信号: {signal}")})",
            SuspectedMods = new(),
            SuspectedConfigs = new()
        };

        return new CrashInfo
        {
            Id = GenerateCrashId(),
            Timestamp = DateTime.UtcNow.ToString("o"),
            Severity = severity,
            ExitCode = exitCode,
            Signal = signal,
            DetectedPatterns = detectedPatterns,
            LogContext = _logParser.GetLastLines(MaxLogContextLines).ToList(),
            Classification = classification
        };
    }

    public CrashInfo? DetectHang(long nowTicks, bool isRunning)
    {
        if (!isRunning) return null;

        var silenceMs = (nowTicks - _lastOutputTimeTicks) / TimeSpan.TicksPerMillisecond;
        if (silenceMs <= MonitoringTimeoutMs) return null;

        var classification = new CrashClassification
        {
            Type = CrashType.Hang,
            Reason = $"服务端可能卡死（{Math.Round(silenceMs / 1000.0)} 秒无输出）",
            SuspectedMods = new(),
            SuspectedConfigs = new()
        };

        return new CrashInfo
        {
            Id = GenerateCrashId(),
            Timestamp = DateTime.UtcNow.ToString("o"),
            Severity = CrashSeverity.Warning,
            DetectedPatterns = new List<string> { "HANG_DETECTED", $"SILENCE_{Math.Round(silenceMs / 1000.0)}s" },
            LogContext = _logParser.GetLastLines(50).ToList(),
            Classification = classification
        };
    }

    public void UpdateLastOutputTime()
    {
        _lastOutputTimeTicks = DateTime.UtcNow.Ticks;
    }

    public void Reset()
    {
        UpdateLastOutputTime();
    }

    private CrashClassification ClassifyCrash(ParsedLogLine parsed)
    {
        var content = parsed.Content.ToLowerInvariant();
        var patterns = parsed.MatchedPatterns;

        if (patterns.Contains("OUT_OF_MEMORY") || content.Contains("outofmemory"))
        {
            return new CrashClassification
            {
                Type = CrashType.Oom,
                Reason = "Java 内存不足（OutOfMemoryError），需要增加 -Xmx 参数或减少模组数量",
                SuspectedMods = new(),
                SuspectedConfigs = new()
            };
        }

        if (patterns.Contains("MOD_LOAD_ERROR") || patterns.Contains("MOD_CRASH")
            || patterns.Contains("MOD_VERSION_CONFLICT") || patterns.Contains("NEEDS_LANGUAGE_PROVIDER"))
        {
            var modMatch = Regex.Match(parsed.Content, @"mod[s]?\s+['""]?([\w-]+)['""]?", RegexOptions.IgnoreCase);
            return new CrashClassification
            {
                Type = CrashType.ModConflict,
                Reason = "模组加载错误或冲突",
                SuspectedMods = modMatch.Success ? new List<string> { modMatch.Groups[1].Value } : new(),
                SuspectedConfigs = new()
            };
        }

        if (patterns.Contains("TICK_EXCEPTION"))
        {
            var blockMatch = Regex.Match(parsed.Content, @"(?:block entity|entity|tile entity)\s+['""]?([\w:.-]+)['""]?", RegexOptions.IgnoreCase);
            return new CrashClassification
            {
                Type = CrashType.CrashKnown,
                Reason = "服务端 Tick 循环异常（通常由某个方块/实体导致）",
                SuspectedMods = blockMatch.Success ? new List<string> { blockMatch.Groups[1].Value } : new(),
                SuspectedConfigs = new()
            };
        }

        if (patterns.Contains("CONFIG_ERROR") || patterns.Contains("INVALID_CONFIG"))
        {
            var configMatch = Regex.Match(parsed.Content, @"config[\\/][\w.]+", RegexOptions.IgnoreCase);
            return new CrashClassification
            {
                Type = CrashType.ConfigError,
                Reason = "配置文件错误或损坏",
                SuspectedMods = new(),
                SuspectedConfigs = configMatch.Success ? new List<string> { configMatch.Value } : new()
            };
        }

        return new CrashClassification
        {
            Type = CrashType.CrashUnknown,
            Reason = "未知崩溃原因，需要 AI 进一步分析",
            SuspectedMods = new(),
            SuspectedConfigs = new()
        };
    }

    private CrashInfo BuildCrashInfo(ParsedLogLine parsed, CrashClassification classification)
    {
        return new CrashInfo
        {
            Id = GenerateCrashId(),
            Timestamp = DateTime.UtcNow.ToString("o"),
            Severity = parsed.Severity,
            DetectedPatterns = parsed.MatchedPatterns,
            LogContext = _logParser.GetLastLines(MaxLogContextLines).ToList(),
            Classification = classification
        };
    }

    private static string GenerateCrashId()
    {
        return $"crash_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_{Guid.NewGuid():N}".Substring(0, 28);
    }
}

public sealed class CrashDetectionResult
{
    public bool IsCrash { get; }
    public CrashInfo? CrashInfo { get; }

    public CrashDetectionResult(bool isCrash, CrashInfo? crashInfo)
    {
        IsCrash = isCrash;
        CrashInfo = crashInfo;
    }
}
