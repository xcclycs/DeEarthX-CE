using System.Diagnostics;
using System.Text.Json;
using DeEarthX.Core;
using DeEarthX.Core.Abstractions;
using DeEarthX.Core.Filter;

namespace DeEarthX.Plugins;

public sealed class ProcessHookExecutor : IPluginHookExecutor
{
    private readonly PluginManager _pluginManager;
    private readonly ILogService _logService;
    private static readonly JsonSerializerOptions JsonOptions = DeEarthXJsonOptions.Default;

    public ProcessHookExecutor(PluginManager pluginManager, ILogService logService)
    {
        _pluginManager = pluginManager;
        _logService = logService;
    }

    public async Task<HookResult> ExecuteAsync(PluginHook hook, HookContext context, CancellationToken ct = default)
    {
        var hookName = hook.ToString();
        var plugins = await _pluginManager.GetPluginsAsync(ct);

        var currentData = context.Data;

        foreach (var plugin in plugins)
        {
            if (!plugin.Enabled) continue;
            if (plugin.Manifest.Hooks is null || !plugin.Manifest.Hooks.Contains(hookName)) continue;
            if (string.IsNullOrWhiteSpace(plugin.Manifest.Main)) continue;

            var dataAware = HookContext.DataAwareHooks.Contains(hook);

            try
            {
                var ctxPayload = new
                {
                    hook = hookName,
                    pluginId = plugin.Manifest.Id,
                    modpackName = context.Meta.TryGetValue("modpackName", out var mn) ? mn?.ToString() : null,
                    minecraft = context.Meta.TryGetValue("minecraft", out var mc) ? mc?.ToString() : null,
                    loader = context.Meta.TryGetValue("loader", out var ld) ? ld?.ToString() : null,
                    filePath = context.Meta.TryGetValue("filePath", out var fp) ? fp?.ToString() : null,
                    data = dataAware && currentData is not null ? Convert.ToBase64String(currentData) : null
                };
                var stdinJson = JsonSerializer.Serialize(ctxPayload, JsonOptions);

                var mainPath = Path.Combine(plugin.DirectoryPath, plugin.Manifest.Main!);
                if (!File.Exists(mainPath))
                {
                    _logService.Warn($"插件 {plugin.Manifest.Id} 的 main 文件不存在: {mainPath}");
                    continue;
                }

                var result = await RunPluginProcessAsync(mainPath, plugin.DirectoryPath, stdinJson, ct);

                if (!result.Success)
                {
                    _logService.Warn($"插件 {plugin.Manifest.Id} 执行钩子 {hookName} 失败: {result.Error}");
                    continue;
                }

                if (dataAware && result.Data is { Length: > 0 })
                {
                    currentData = result.Data;
                }
            }
            catch (Exception ex)
            {
                _logService.Error($"执行插件 {plugin.Manifest.Id} 的钩子 {hookName} 失败", ex);
            }
        }

        return new HookResult(true, currentData, null, null);
    }

    private async Task<HookResult> RunPluginProcessAsync(string mainPath, string workingDir, string stdinJson, CancellationToken ct)
    {
        var ext = Path.GetExtension(mainPath).ToLowerInvariant();
        string fileName;
        string args;

        if (ext == ".js" || ext == ".mjs")
        {
            fileName = "node";
            args = $"\"{mainPath}\"";
        }
        else if (ext == ".bat" || ext == ".cmd")
        {
            fileName = "cmd.exe";
            args = $"/c \"{mainPath}\"";
        }
        else if (ext == ".exe")
        {
            fileName = mainPath;
            args = "";
        }
        else if (ext == ".sh")
        {
            fileName = "bash";
            args = $"\"{mainPath}\"";
        }
        else
        {
            fileName = mainPath;
            args = "";
        }

        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = args,
            WorkingDirectory = workingDir,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = psi };
        process.Start();

        await process.StandardInput.WriteAsync(stdinJson);
        process.StandardInput.Close();

        var stdoutTask = process.StandardOutput.ReadToEndAsync(ct);
        var stderrTask = process.StandardError.ReadToEndAsync(ct);

        await process.WaitForExitAsync(ct);

        var stderr = await stderrTask;
        if (!string.IsNullOrWhiteSpace(stderr))
        {
            _logService.Warn($"插件进程 stderr: {stderr.Trim()}");
        }

        var stdout = await stdoutTask;
        return ParseHookResult(stdout);
    }

    private static HookResult ParseHookResult(string stdout)
    {
        if (string.IsNullOrWhiteSpace(stdout))
        {
            return HookResult.Ok(null);
        }

        var trimmed = stdout.Trim();
        var firstBrace = trimmed.IndexOf('{');
        var lastBrace = trimmed.LastIndexOf('}');
        if (firstBrace < 0 || lastBrace <= firstBrace)
        {
            return HookResult.Ok(null);
        }

        var jsonText = trimmed.Substring(firstBrace, lastBrace - firstBrace + 1);
        try
        {
            using var doc = JsonDocument.Parse(jsonText);
            var root = doc.RootElement;
            var success = root.TryGetProperty("success", out var s) && s.GetBoolean();
            string? error = root.TryGetProperty("error", out var e) ? e.GetString() : null;
            byte[]? data = null;
            if (root.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.String)
            {
                var b64 = d.GetString();
                if (!string.IsNullOrEmpty(b64))
                {
                    data = Convert.FromBase64String(b64);
                }
            }
            return new HookResult(success, data, null, error);
        }
        catch
        {
            return HookResult.Ok(null);
        }
    }
}
