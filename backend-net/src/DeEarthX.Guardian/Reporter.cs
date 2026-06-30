using System.Text;
using System.Text.Json;
using DeEarthX.Core;
using DeEarthX.Core.Abstractions;

namespace DeEarthX.Guardian;

public sealed class Reporter
{
    private readonly IAppDirectoryProvider _appDir;
    private readonly ILogService _log;
    private string _reportsDir = string.Empty;

    public Reporter(IAppDirectoryProvider appDir, ILogService log)
    {
        _appDir = appDir;
        _log = log;
        _reportsDir = Path.Combine(appDir.GetAppDirectory(), "guardian", "reports");
        Directory.CreateDirectory(_reportsDir);
    }

    public void Configure(string _)
    {
        _reportsDir = Path.Combine(_appDir.GetAppDirectory(), "guardian", "reports");
        Directory.CreateDirectory(_reportsDir);
    }

    public async Task<CrashReport> GenerateReportAsync(ReportParams parameters, CancellationToken ct = default)
    {
        var report = new CrashReport
        {
            Id = $"report_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_{Guid.NewGuid():N}".Substring(0, 26),
            Timestamp = DateTime.UtcNow.ToString("o"),
            ServerDir = parameters.ServerDir,
            ServerType = parameters.ServerType,
            JavaVersion = parameters.JavaVersion,
            McVersion = parameters.McVersion,
            CrashInfo = parameters.CrashInfo,
            Diagnosis = parameters.Diagnosis,
            ExecutedActions = parameters.ExecutedActions,
            Result = parameters.Result,
            RestartCount = parameters.RestartCount
        };

        var markdown = BuildMarkdown(report);
        var fileName = $"crash_report_{report.Id}.md";
        var filePath = Path.Combine(_reportsDir, fileName);
        await File.WriteAllTextAsync(filePath, markdown, ct);
        report.ReportPath = filePath;
        _log.Info($"崩溃报告已保存: {filePath}");
        return report;
    }

    public List<ReportListItem> GetReportsList()
    {
        var reports = new List<ReportListItem>();
        if (!Directory.Exists(_reportsDir)) return reports;
        try
        {
            foreach (var file in Directory.EnumerateFiles(_reportsDir, "crash_report_*.md"))
            {
                var info = new FileInfo(file);
                var match = System.Text.RegularExpressions.Regex.Match(info.Name, @"crash_report_(.+)\.md");
                reports.Add(new ReportListItem
                {
                    Id = match.Success ? match.Groups[1].Value : info.Name,
                    Timestamp = info.LastWriteTimeUtc.ToString("o"),
                    File = file
                });
            }
        }
        catch (Exception ex)
        {
            _log.Error("获取报告列表失败", ex);
        }
        return reports.OrderByDescending(r => r.Timestamp).ToList();
    }

    public string? GetReportContent(string reportId)
    {
        if (!Directory.Exists(_reportsDir)) return null;
        try
        {
            foreach (var file in Directory.EnumerateFiles(_reportsDir, "*.md"))
            {
                if (Path.GetFileName(file).Contains(reportId, StringComparison.OrdinalIgnoreCase))
                {
                    return File.ReadAllText(file);
                }
            }
        }
        catch
        {
        }
        return null;
    }

    private static string BuildMarkdown(CrashReport report)
    {
        var crash = report.CrashInfo;
        var sb = new StringBuilder();
        sb.AppendLine("# 服务端崩溃报告");
        sb.AppendLine();
        sb.AppendLine($"> **报告ID**: {report.Id}");
        sb.AppendLine($"> **时间**: {report.Timestamp}");
        sb.AppendLine($"> **结果**: {FormatResult(report.Result)}");
        sb.AppendLine();
        sb.AppendLine("---");
        sb.AppendLine();
        sb.AppendLine("## 服务端信息");
        sb.AppendLine();
        sb.AppendLine("| 项目 | 值 |");
        sb.AppendLine("|------|-----|");
        sb.AppendLine($"| 服务端类型 | {report.ServerType} |");
        sb.AppendLine($"| Minecraft 版本 | {report.McVersion} |");
        sb.AppendLine($"| Java 版本 | {report.JavaVersion} |");
        sb.AppendLine($"| 工作目录 | `{report.ServerDir}` |");
        sb.AppendLine($"| 重启次数 | {report.RestartCount} |");
        sb.AppendLine();

        if (crash is not null)
        {
            sb.AppendLine("## 崩溃信息");
            sb.AppendLine();
            sb.AppendLine($"- **严重等级**: {FormatSeverity(crash.Severity)}");
            sb.AppendLine($"- **退出码**: {crash.ExitCode?.ToString() ?? "N/A"}");
            sb.AppendLine($"- **信号**: {crash.Signal ?? "N/A"}");
            sb.AppendLine($"- **检测模式**: {(crash.DetectedPatterns.Count > 0 ? string.Join(", ", crash.DetectedPatterns) : "无")}");
            sb.AppendLine($"- **分类**: {crash.Classification.Type}");
            sb.AppendLine();
            sb.AppendLine("### 崩溃原因");
            sb.AppendLine();
            sb.AppendLine(crash.Classification.Reason);
            sb.AppendLine();

            if (crash.Classification.SuspectedMods.Count > 0)
            {
                sb.AppendLine("### 疑似问题模组");
                sb.AppendLine();
                foreach (var mod in crash.Classification.SuspectedMods)
                {
                    sb.AppendLine($"- `{mod}`");
                }
                sb.AppendLine();
            }

            if (crash.Classification.SuspectedConfigs.Count > 0)
            {
                sb.AppendLine("### 疑似问题配置");
                sb.AppendLine();
                foreach (var cfg in crash.Classification.SuspectedConfigs)
                {
                    sb.AppendLine($"- `{cfg}`");
                }
                sb.AppendLine();
            }
        }

        if (report.Diagnosis is not null)
        {
            sb.AppendLine("## AI 诊断");
            sb.AppendLine();
            sb.AppendLine($"> {report.Diagnosis.Diagnosis}");
            sb.AppendLine();
            sb.AppendLine("### 原因分析");
            sb.AppendLine();
            for (var i = 0; i < report.Diagnosis.Causes.Count; i++)
            {
                sb.AppendLine($"{i + 1}. {report.Diagnosis.Causes[i]}");
            }
            sb.AppendLine();
            sb.AppendLine($"**置信度**: {Math.Round(report.Diagnosis.Confidence * 100)}%");
            sb.AppendLine();
        }

        if (report.ExecutedActions.Count > 0)
        {
            sb.AppendLine("## 已执行操作");
            sb.AppendLine();
            sb.AppendLine("| 操作 | 目标 | 结果 | 原因 |");
            sb.AppendLine("|------|------|------|------|");
            foreach (var action in report.ExecutedActions)
            {
                sb.AppendLine($"| {action.Type} | `{action.Target}` | {(action.Approved ? "已执行" : "待确认")} | {action.Reason} |");
            }
            sb.AppendLine();
        }

        if (crash is not null && crash.LogContext.Count > 0)
        {
            sb.AppendLine($"## 日志上下文（最后 {Math.Min(30, crash.LogContext.Count)} 行）");
            sb.AppendLine();
            sb.AppendLine("```log");
            var take = crash.LogContext.Count > 30 ? crash.LogContext.GetRange(crash.LogContext.Count - 30, 30) : crash.LogContext;
            sb.AppendLine(string.Join('\n', take));
            sb.AppendLine("```");
            sb.AppendLine();
        }

        sb.AppendLine("---");
        sb.AppendLine("*由 ServerGuardian 自动生成*");
        return sb.ToString();
    }

    private static string FormatResult(CrashReportResult result) => result switch
    {
        CrashReportResult.Fixed => "已修复",
        CrashReportResult.Unfixed => "未修复",
        CrashReportResult.UserStopped => "用户终止",
        CrashReportResult.GiveUp => "已放弃（多次崩溃）",
        _ => result.ToString()
    };

    private static string FormatSeverity(CrashSeverity severity) => severity switch
    {
        CrashSeverity.Fatal => "致命",
        CrashSeverity.Error => "错误",
        CrashSeverity.Warning => "警告",
        _ => "信息"
    };
}

public sealed class ReportParams
{
    public string ServerDir { get; set; } = string.Empty;
    public string ServerType { get; set; } = "unknown";
    public string JavaVersion { get; set; } = string.Empty;
    public string McVersion { get; set; } = string.Empty;
    public CrashInfo CrashInfo { get; set; } = new();
    public AiDiagnosisResult? Diagnosis { get; set; }
    public List<AiAction> ExecutedActions { get; set; } = new();
    public CrashReportResult Result { get; set; }
    public int RestartCount { get; set; }
}
