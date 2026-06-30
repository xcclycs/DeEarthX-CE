using DeEarthX.Core.Abstractions;

namespace DeEarthX.Guardian;

public sealed class SafeExecutor
{
    private readonly ILogService _log;
    private readonly IAppDirectoryProvider _appDir;
    private string _workDir = string.Empty;
    private string _rubbishDir = string.Empty;

    public string AppDirectory => _appDir.GetAppDirectory();

    public SafeExecutor(ILogService log, IAppDirectoryProvider appDir)
    {
        _log = log;
        _appDir = appDir;
    }

    public void Configure(string workDir)
    {
        _workDir = Path.GetFullPath(workDir);
        _rubbishDir = Path.Combine(_workDir, ".rubbish");
        EnsureRubbishDir();
    }

    public PathSafetyResult IsPathSafe(string targetPath)
    {
        if (string.IsNullOrEmpty(_workDir))
        {
            return new PathSafetyResult { Safe = false, Resolved = targetPath, Reason = "工作目录未配置" };
        }

        var resolved = Path.GetFullPath(Path.Combine(_workDir, targetPath));
        var normalizedWorkDir = Path.GetFullPath(_workDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;

        if (!resolved.StartsWith(normalizedWorkDir, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(resolved, _workDir, StringComparison.OrdinalIgnoreCase))
        {
            return new PathSafetyResult
            {
                Safe = false,
                Resolved = resolved,
                Reason = $"路径越权: {resolved} 不在工作目录 {_workDir} 内"
            };
        }

        return new PathSafetyResult { Safe = true, Resolved = resolved };
    }

    public async Task<ExecutionResult> ExecuteActionAsync(AiAction action, CancellationToken ct = default)
    {
        try
        {
            if (action.Type == ActionType.Complete)
            {
                _log.Info($"服务端运行完成: {action.Reason}");
                return new ExecutionResult { ActionId = action.Id, Success = true, Error = "" };
            }

            if (string.IsNullOrEmpty(action.Target))
            {
                return new ExecutionResult { ActionId = action.Id, Success = false, Error = "操作目标路径为空" };
            }

            if (action.Target.IndexOfAny(new[] { '<', '>', '|', ':', '"' }) >= 0)
            {
                return new ExecutionResult { ActionId = action.Id, Success = false, Error = $"目标路径含非法字符: {action.Target}" };
            }

            var pathCheck = IsPathSafe(action.Target);
            if (!pathCheck.Safe)
            {
                return new ExecutionResult { ActionId = action.Id, Success = false, Error = pathCheck.Reason };
            }

            return action.Type switch
            {
                ActionType.MoveFile or ActionType.RemoveMod => await ExecuteMoveAsync(pathCheck.Resolved, action, ct),
                ActionType.DeleteFile => await ExecuteDeleteAsync(pathCheck.Resolved, action, ct),
                ActionType.EditConfig => await ExecuteEditConfigAsync(pathCheck.Resolved, action, ct),
                ActionType.AddJvmArg => await ExecuteAddJvmArgAsync(action, ct),
                ActionType.DownloadFile => new ExecutionResult
                {
                    ActionId = action.Id,
                    Success = false,
                    Error = "下载文件操作需要用户手动确认并验证来源"
                },
                _ => new ExecutionResult { ActionId = action.Id, Success = false, Error = $"不支持的操作类型: {action.Type}" }
            };
        }
        catch (Exception ex)
        {
            _log.Error($"执行操作失败: {action.Type} {action.Target}", ex);
            return new ExecutionResult { ActionId = action.Id, Success = false, Error = ex.Message };
        }
    }

    public async Task<List<ExecutionResult>> ExecuteActionsAsync(IEnumerable<AiAction> actions, CancellationToken ct = default)
    {
        var results = new List<ExecutionResult>();
        foreach (var action in actions)
        {
            results.Add(await ExecuteActionAsync(action, ct));
        }
        return results;
    }

    public static ActionRiskLevel GetActionRiskLevel(ActionType type) => type switch
    {
        ActionType.MoveFile or ActionType.RemoveMod => ActionRiskLevel.Medium,
        ActionType.DeleteFile => ActionRiskLevel.High,
        ActionType.EditConfig or ActionType.AddJvmArg => ActionRiskLevel.Low,
        ActionType.DownloadFile => ActionRiskLevel.Critical,
        _ => ActionRiskLevel.Medium
    };

    private async Task<ExecutionResult> ExecuteMoveAsync(string resolvedPath, AiAction action, CancellationToken ct)
    {
        if (!File.Exists(resolvedPath))
        {
            return new ExecutionResult { ActionId = action.Id, Success = false, Error = $"文件不存在: {resolvedPath}" };
        }

        string destPath;
        if (!string.IsNullOrEmpty(action.Destination))
        {
            var destCheck = IsPathSafe(action.Destination);
            if (!destCheck.Safe)
            {
                return new ExecutionResult { ActionId = action.Id, Success = false, Error = destCheck.Reason };
            }
            destPath = destCheck.Resolved;
        }
        else
        {
            var fileName = Path.GetFileName(resolvedPath);
            destPath = Path.Combine(_rubbishDir, $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_{fileName}");
        }

        var destDir = Path.GetDirectoryName(destPath);
        if (!string.IsNullOrEmpty(destDir)) Directory.CreateDirectory(destDir);

        await Task.Run(() => File.Move(resolvedPath, destPath), ct);
        _log.Info($"文件已移动: {resolvedPath} -> {destPath} (原因: {action.Reason})");
        return new ExecutionResult { ActionId = action.Id, Success = true, Snapshot = destPath };
    }

    private async Task<ExecutionResult> ExecuteDeleteAsync(string resolvedPath, AiAction action, CancellationToken ct)
    {
        if (!File.Exists(resolvedPath))
        {
            return new ExecutionResult { ActionId = action.Id, Success = false, Error = $"文件不存在: {resolvedPath}" };
        }

        var fileName = Path.GetFileName(resolvedPath);
        var backupPath = Path.Combine(_rubbishDir, $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_DELETE_{fileName}");
        await Task.Run(() => File.Move(resolvedPath, backupPath), ct);
        _log.Info($"文件已删除（备份）: {resolvedPath} -> {backupPath} (原因: {action.Reason})");
        return new ExecutionResult { ActionId = action.Id, Success = true, Snapshot = backupPath };
    }

    private async Task<ExecutionResult> ExecuteEditConfigAsync(string resolvedPath, AiAction action, CancellationToken ct)
    {
        if (!File.Exists(resolvedPath))
        {
            return new ExecutionResult { ActionId = action.Id, Success = false, Error = $"配置文件不存在: {resolvedPath}" };
        }

        var content = await File.ReadAllTextAsync(resolvedPath, ct);
        var backupPath = resolvedPath + ".bak";
        await File.WriteAllTextAsync(backupPath, content, ct);

        var ext = Path.GetExtension(resolvedPath).ToLowerInvariant();
        string newContent = ext switch
        {
            ".json" => EditJsonConfig(content, action),
            ".toml" => EditLineConfig(content, action),
            ".yml" or ".yaml" => EditLineConfig(content, action),
            ".properties" => EditPropertiesConfig(content, action),
            _ => content
        };

        await File.WriteAllTextAsync(resolvedPath, newContent, ct);
        _log.Info($"配置文件已修改: {resolvedPath} (原因: {action.Reason})");
        return new ExecutionResult { ActionId = action.Id, Success = true, Snapshot = backupPath };
    }

    private async Task<ExecutionResult> ExecuteAddJvmArgAsync(AiAction action, CancellationToken ct)
    {
        string? startPath = null;
        foreach (var name in new[] { "start.bat", "run.bat", "start.sh" })
        {
            var p = Path.Combine(_workDir, name);
            if (File.Exists(p)) { startPath = p; break; }
        }

        if (startPath is null)
        {
            return new ExecutionResult { ActionId = action.Id, Success = false, Error = "未找到启动脚本 (start.bat / run.bat / start.sh)" };
        }

        var content = await File.ReadAllTextAsync(startPath, ct);
        var backupPath = startPath + ".bak";
        await File.WriteAllTextAsync(backupPath, content, ct);

        if (!string.IsNullOrEmpty(action.JvmArg) && !content.Contains(action.JvmArg))
        {
            var newContent = System.Text.RegularExpressions.Regex.Replace(
                content,
                @"(java\s+(?:-\w+\s+)*)",
                m => $"{m.Groups[1].Value}{action.JvmArg} ",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            await File.WriteAllTextAsync(startPath, newContent, ct);
            _log.Info($"JVM 参数已添加: {action.JvmArg} (原因: {action.Reason})");
        }

        return new ExecutionResult { ActionId = action.Id, Success = true, Snapshot = backupPath };
    }

    private static string EditJsonConfig(string content, AiAction action)
    {
        if (string.IsNullOrEmpty(action.KeyPath)) return content;
        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(content);
            if (node is not null)
            {
                SetNestedValue(node, action.KeyPath, action.NewValue ?? "");
                return node.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
            }
        }
        catch
        {
        }
        return content;
    }

    private static void SetNestedValue(System.Text.Json.Nodes.JsonNode root, string keyPath, string value)
    {
        var keys = keyPath.Split('.');
        System.Text.Json.Nodes.JsonNode current = root;
        for (var i = 0; i < keys.Length - 1; i++)
        {
            var key = keys[i];
            if (current is System.Text.Json.Nodes.JsonObject obj)
            {
                current = obj.ContainsKey(key) ? obj[key]! : (obj[key] = new System.Text.Json.Nodes.JsonObject());
            }
            else
            {
                return;
            }
        }
        if (current is System.Text.Json.Nodes.JsonObject leaf)
        {
            leaf[keys[^1]] = System.Text.Json.JsonSerializer.SerializeToNode(value);
        }
    }

    private static string EditLineConfig(string content, AiAction action)
    {
        if (string.IsNullOrEmpty(action.KeyPath)) return content;
        var lastKey = action.KeyPath.Split('.').Last();
        var lines = content.Split('\n');
        var regex = new System.Text.RegularExpressions.Regex($"^{System.Text.RegularExpressions.Regex.Escape(lastKey)}\\s*[=:]");
        for (var i = 0; i < lines.Length; i++)
        {
            var trimmed = lines[i].TrimStart();
            if (trimmed.StartsWith('#')) continue;
            if (regex.IsMatch(trimmed))
            {
                lines[i] = $"{lastKey} = {action.NewValue ?? ""}";
            }
        }
        return string.Join('\n', lines);
    }

    private static string EditPropertiesConfig(string content, AiAction action)
    {
        if (string.IsNullOrEmpty(action.KeyPath)) return content;
        var lines = content.Split('\n');
        var regex = new System.Text.RegularExpressions.Regex($"^{System.Text.RegularExpressions.Regex.Escape(action.KeyPath)}\\s*=");
        for (var i = 0; i < lines.Length; i++)
        {
            var trimmed = lines[i].TrimStart();
            if (trimmed.StartsWith('#')) continue;
            if (regex.IsMatch(trimmed))
            {
                lines[i] = $"{action.KeyPath}={action.NewValue ?? ""}";
            }
        }
        return string.Join('\n', lines);
    }

    private void EnsureRubbishDir()
    {
        if (!string.IsNullOrEmpty(_rubbishDir) && !Directory.Exists(_rubbishDir))
        {
            Directory.CreateDirectory(_rubbishDir);
        }
    }
}
