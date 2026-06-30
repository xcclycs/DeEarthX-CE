using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using DeEarthX.Core;
using DeEarthX.Core.Abstractions;
using DeEarthX.Core.Configuration;
using DeEarthX.Infrastructure.Http;

namespace DeEarthX.Guardian;

public sealed class AIAdvisor
{
    private readonly IDeEarthXHttpService _http;
    private readonly ILogService _log;
    private GuardianAiConfig _ai;
    private readonly List<AiConversationEntry> _conversations = new();
    private readonly object _convLock = new();

    private static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(60) };

    private static readonly JsonSerializerOptions AiJsonOptions = new(DeEarthXJsonOptions.Default)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) }
    };

    private const string CheckCompletionPrompt = """
你是一个严格的 Minecraft 服务端运行情况分析专家。

不绝对等于运行正常！请仔细检查日志的最后部分，确认服务端是否真的正常完成。并且不是崩溃！

## 语言要求
**请分析用户提供的日志的语言，并使用完全相同的语言进行所有输出！**
- 如果大部分内容是中文，使用中文
- 如果大部分内容是英文，使用英文
- 如果是其他语言，请使用相同语言
- **所有判断、诊断、解释都必须使用相同语言**

【最近日志片段（最后部分，行号为倒序编号）】

{logContext}

【判断规则（优先级从高到低）】
1. 如果日志尾部最后若干行中包含 "Failed to start the minecraft server"、"LoadingFailedException"、"has failed to load correctly"、"ERROR"、"Exception"、"Caused by"、"FATAL" 等错误，即使退出码为 0，也必须判定为崩溃。
2. 特别注意：ModLauncher、BootstrapLauncher 中任何 mod 加载错误、LoadingFailedException 都属于严重崩溃，绝不能判定为完成。
3. 特别注意："has failed to load correctly" 表示模组加载失败，属于严重错误，绝不能判定为完成。
4. 只有日志尾部最后若干行完全没有任何错误（全部是 INFO 级别消息，且包含 Done! / Forge 启动成功关键字），才能返回 type: "complete"。

【输出要求】
- 如果判定为正常完成：actions 中只包含 { type: "complete", target: "", reason: "..." }，其中 reason 用与用户语言一致的文字说明
- 如果判定为崩溃：按标准崩溃诊断格式输出 diagnosis、causes、actions（修复建议），并在 diagnosis 末尾标注出问题的行号
- 严格返回 JSON 格式，不要添加任何额外说明。
- **确保使用与用户相同的语言进行所有说明和解释！**
""";

    private const string DiagnosisPrompt = """
你是一个 Minecraft 服务端崩溃诊断专家。
请分析以下服务端崩溃信息，并按严格 JSON 格式输出。

## 语言要求
**请分析用户提供的日志、模组列表、错误信息等所有内容的语言，并使用完全相同的语言进行所有输出！**

## 服务端信息
- 类型: {serverType}
- Minecraft 版本: {mcVersion}
- Java 版本: {javaVersion}

## 已安装模组
{modList}

## 崩溃日志（最后部分，每行前有行号，从 1 开始编号）
```
{logContext}
```

## 崩溃分类
- 类型: {crashType}
- 初步原因: {crashReason}

## 上次修复操作（如有）
{previousActions}

## 输出要求
仅返回一个 JSON 对象（不要用 markdown 代码块包裹，只输出纯 JSON），包含以下字段：

- "diagnosis": 简短诊断，客观描述崩溃原因和定位。
- "causes": 字符串数组，列出可能的原因。
- "actions": 修复操作列表，每个操作包含：
  - "type": 操作类型，可选值：move_file / delete_file / edit_config / add_jvm_arg / remove_mod / download_file
  - "target": 目标文件路径（相对于服务端根目录）
  - "destination": 移动目标路径（仅 move_file / remove_mod 需要）
  - "file": 配置文件路径（仅 edit_config 需要）
  - "key_path": 配置键路径，用点分隔（仅 edit_config 需要）
  - "new_value": 新值（仅 edit_config / add_jvm_arg 需要）
  - "jvm_arg": JVM 参数（仅 add_jvm_arg 需要）
  - "reason": 操作原因

## 注意事项
- 所有操作路径必须相对于服务端根目录。
- 不要建议直接删除模组文件，而应使用 remove_mod 操作将其移动到 .rubbish/ 目录。
- 仅生成合理、必要的操作，不要添加无意义的步骤。
""";

    public AIAdvisor(IDeEarthXHttpService http, ILogService log, GuardianAiConfig aiConfig)
    {
        _http = http;
        _log = log;
        _ai = CloneAiConfig(aiConfig);
    }

    public AiProvider Provider => NormalizeProvider(_ai.Provider);

    public IReadOnlyList<AiConversationEntry> GetConversations()
    {
        lock (_convLock)
        {
            return _conversations.ToArray();
        }
    }

    public void UpdateConfig(GuardianAiConfig aiConfig)
    {
        _ai = CloneAiConfig(aiConfig);
    }

    public void ResetConversations()
    {
        lock (_convLock)
        {
            _conversations.Clear();
        }
    }

    public async Task<AiDiagnosisResult?> AnalyzeCrashAsync(CrashInfo crash, ServerContext ctx, CancellationToken ct = default)
    {
        if (Provider == AiProvider.None)
        {
            return null;
        }

        try
        {
            var prompt = BuildDiagnosisPrompt(crash, ctx);
            var (text, latency) = await CallChatAsync(prompt, maxTokens: _ai.MaxTokens ?? 1500, temperature: 0.3, ct);
            var diagnosis = ParseAiResponse(text);
            diagnosis = ValidateDiagnosis(diagnosis);
            RecordConversation(AiConversationType.Diagnosis, prompt, text, diagnosis, latency);
            return diagnosis;
        }
        catch (Exception ex)
        {
            _log.Error("AI 分析失败", ex);
            return null;
        }
    }

    public async Task<bool> CheckCompletionAsync(string recentLogs, CancellationToken ct = default)
    {
        if (Provider == AiProvider.None)
        {
            return false;
        }

        try
        {
            var lines = recentLogs.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            var last = lines.Length > 60 ? lines.Skip(lines.Length - 60).ToArray() : lines;
            var start = lines.Length - last.Length;
            var formatted = string.Join('\n', last.Select((line, i) => $"{(start + i + 1).ToString().PadLeft(4)}|{line}"));
            var prompt = FillTemplate(CheckCompletionPrompt, new Dictionary<string, string> { ["logContext"] = formatted });

            var (text, latency) = await CallChatAsync(prompt, maxTokens: 1000, temperature: 0.1, ct);
            var diagnosis = ParseAiResponse(text);
            RecordConversation(AiConversationType.Diagnosis, prompt, text, diagnosis, latency);
            return diagnosis.Actions.Any(a => a.Type == ActionType.Complete);
        }
        catch (Exception ex)
        {
            _log.Error("AI 完成确认失败", ex);
            return false;
        }
    }

    public Task<bool> TestConnectionAsync(CancellationToken ct = default)
    {
        return TestConnectionDetailedAsync(ct).ContinueWith(t => t.Result.Success, ct);
    }

    public async Task<TestAiResult> TestConnectionDetailedAsync(CancellationToken ct = default)
    {
        if (Provider == AiProvider.None)
        {
            return new TestAiResult { Success = false, Message = "当前为纯规则模式，无需测试 AI 连接" };
        }

        var testMessage = "Reply with exactly \"OK ServerGuardian\" (just that phrase, no extra words).";
        const int maxRetries = 5;

        TestAiResult last = new() { Success = false, Message = "未执行测试" };
        for (var attempt = 1; attempt <= maxRetries; attempt++)
        {
            last = await DoTestOnceAsync(testMessage, ct);
            if (last.Success) return last;
            if (attempt < maxRetries) await Task.Delay(500, ct);
        }
        return last;
    }

    private async Task<TestAiResult> DoTestOnceAsync(string testMessage, CancellationToken ct)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            string text;
            if (Provider == AiProvider.Ollama)
            {
                var baseUrl = string.IsNullOrEmpty(_ai.BaseUrl) ? "http://localhost:11434" : _ai.BaseUrl;
                var body = new
                {
                    model = string.IsNullOrEmpty(_ai.Model) ? "qwen2.5:7b" : _ai.Model,
                    messages = new[] { new { role = "user", content = testMessage } },
                    stream = false,
                    options = new { temperature = 0.1 }
                };
                var resp = await _http.PostJsonAsync<OllamaChatResponse>($"{baseUrl}/api/chat", body, ct);
                text = resp?.Message?.Content ?? string.Empty;
            }
            else
            {
                var body = new
                {
                    model = _ai.Model,
                    messages = new[] { new { role = "user", content = testMessage } },
                    max_tokens = 50,
                    temperature = 0.1
                };
                text = await CallOpenAiChatAsync(_ai.BaseUrl, _ai.ApiKey, body, ct);
            }

            sw.Stop();
            if (string.IsNullOrWhiteSpace(text))
            {
                return new TestAiResult { Success = false, Message = "AI 返回内容为空", Latency = sw.ElapsedMilliseconds };
            }
            return new TestAiResult
            {
                Success = true,
                Message = $"连接成功！AI 响应: \"{(text.Length > 80 ? text[..80] : text)}\"",
                Latency = sw.ElapsedMilliseconds
            };
        }
        catch (OperationCanceledException)
        {
            return new TestAiResult { Success = false, Message = "连接超时（10 秒），请检查 API 地址是否正确", Latency = 10000 };
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new TestAiResult { Success = false, Message = $"连接失败: {ex.Message}", Latency = sw.ElapsedMilliseconds };
        }
    }

    private async Task<(string text, long latencyMs)> CallChatAsync(string prompt, int maxTokens, double temperature, CancellationToken ct)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        string text;
        if (Provider == AiProvider.Ollama)
        {
            var baseUrl = string.IsNullOrEmpty(_ai.BaseUrl) ? "http://localhost:11434" : _ai.BaseUrl;
            var body = new
            {
                model = string.IsNullOrEmpty(_ai.Model) ? "qwen2.5:7b" : _ai.Model,
                messages = new[] { new { role = "user", content = prompt } },
                stream = false,
                options = new { temperature }
            };
            var resp = await _http.PostJsonAsync<OllamaChatResponse>($"{baseUrl}/api/chat", body, ct);
            text = resp?.Message?.Content ?? string.Empty;
        }
        else
        {
            var body = new
            {
                model = _ai.Model,
                messages = new[] { new { role = "user", content = prompt } },
                max_tokens = maxTokens,
                temperature,
                response_format = new { type = "json_object" }
            };
            text = await CallOpenAiChatAsync(_ai.BaseUrl, _ai.ApiKey, body, ct);
        }
        sw.Stop();
        return (text, sw.ElapsedMilliseconds);
    }

    private static async Task<string> CallOpenAiChatAsync(string baseUrl, string apiKey, object body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl.TrimEnd('/')}/chat/completions");
        request.Content = new StringContent(JsonSerializer.Serialize(body, DeEarthXJsonOptions.Default), Encoding.UTF8);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        if (!string.IsNullOrEmpty(apiKey))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        }

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(30));

        using var response = await HttpClient.SendAsync(request, cts.Token);
        var raw = await response.Content.ReadAsStringAsync(cts.Token);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OpenAI API 错误: {response.StatusCode} {raw}");
        }
        var parsed = JsonSerializer.Deserialize<OpenAiChatResponse>(raw, DeEarthXJsonOptions.Default);
        return parsed?.Choices?.FirstOrDefault()?.Message?.Content ?? string.Empty;
    }

    private string BuildDiagnosisPrompt(CrashInfo crash, ServerContext ctx)
    {
        var logLines = crash.LogContext.Count > 100
            ? crash.LogContext.GetRange(crash.LogContext.Count - 100, 100)
            : crash.LogContext;
        var numbered = string.Join('\n', logLines.Select((line, i) => $"{(i + 1).ToString().PadLeft(4)}|{line}"));
        var modListStr = ctx.ModList.Count > 0 ? string.Join('\n', ctx.ModList) : "（无）";
        var prevActionsStr = "（无）";

        return FillTemplate(DiagnosisPrompt, new Dictionary<string, string>
        {
            ["serverType"] = string.IsNullOrEmpty(ctx.ServerType) ? "未知" : ctx.ServerType,
            ["mcVersion"] = string.IsNullOrEmpty(ctx.McVersion) ? "未知" : ctx.McVersion,
            ["javaVersion"] = string.IsNullOrEmpty(ctx.JavaVersion) ? "未知" : ctx.JavaVersion,
            ["modList"] = modListStr,
            ["logContext"] = numbered,
            ["crashType"] = crash.Classification.Type.ToString(),
            ["crashReason"] = crash.Classification.Reason,
            ["previousActions"] = prevActionsStr
        });
    }

    private AiDiagnosisResult ParseAiResponse(string content)
    {
        var jsonStr = content.Trim();
        var fenceMatch = System.Text.RegularExpressions.Regex.Match(jsonStr, "```(?:json)?\\s*([\\s\\S]*?)```");
        if (fenceMatch.Success)
        {
            jsonStr = fenceMatch.Groups[1].Value.Trim();
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<AiDiagnosisResult>(jsonStr, AiJsonOptions);
            if (parsed is null)
            {
                return new AiDiagnosisResult
                {
                    Diagnosis = "AI 返回为空",
                    Causes = new List<string> { "AI 响应解析失败" },
                    Actions = new List<AiAction>(),
                    Confidence = 0.3,
                    RawResponse = content
                };
            }
            parsed.RawResponse = content;
            if (string.IsNullOrEmpty(parsed.Diagnosis)) parsed.Diagnosis = "AI 分析完成";
            if (parsed.Causes.Count == 0) parsed.Causes.Add("未知原因");
            if (parsed.Confidence <= 0) parsed.Confidence = 0.8;
            return parsed;
        }
        catch (Exception ex)
        {
            _log.Error("解析 AI 响应失败: " + ex.Message);
            return new AiDiagnosisResult
            {
                Diagnosis = "AI 分析的返回格式有问题，但根据日志可以推断一些信息。",
                Causes = new List<string> { "AI 响应解析失败，请查看原始日志" },
                Actions = new List<AiAction>(),
                Confidence = 0.3,
                RawResponse = content
            };
        }
    }

    private AiDiagnosisResult ValidateDiagnosis(AiDiagnosisResult diagnosis)
    {
        var allowed = new HashSet<ActionType>
        {
            ActionType.MoveFile, ActionType.DeleteFile, ActionType.EditConfig,
            ActionType.AddJvmArg, ActionType.RemoveMod, ActionType.DownloadFile
        };

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var validated = new List<AiAction>();
        var idx = 0;
        foreach (var action in diagnosis.Actions)
        {
            idx++;
            if (!allowed.Contains(action.Type))
            {
                _log.Warn($"过滤非法操作类型: {action.Type}");
                continue;
            }
            if (string.IsNullOrEmpty(action.Target) && action.Type != ActionType.Complete)
            {
                _log.Warn("过滤空目标路径的操作");
                continue;
            }
            if (!string.IsNullOrEmpty(action.Target) && action.Target.IndexOfAny(new[] { '<', '>', '|', ':', '"' }) >= 0)
            {
                _log.Warn($"过滤含非法字符的路径: {action.Target}");
                continue;
            }
            if (string.IsNullOrEmpty(action.Id)) action.Id = $"ai_action_{now}_{idx}";
            action.RiskLevel = SafeExecutor.GetActionRiskLevel(action.Type);
            validated.Add(action);
        }
        diagnosis.Actions = validated;
        return diagnosis;
    }

    private void RecordConversation(AiConversationType type, string prompt, string rawResponse, AiDiagnosisResult? diagnosis, long latencyMs)
    {
        var entry = new AiConversationEntry
        {
            Id = $"conv_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_{Guid.NewGuid():N}".Substring(0, 24),
            Timestamp = DateTime.UtcNow.ToString("o"),
            Type = type,
            Prompt = prompt,
            RawResponse = rawResponse,
            Diagnosis = diagnosis,
            LatencyMs = latencyMs
        };
        lock (_convLock)
        {
            _conversations.Add(entry);
        }
    }

    private static string FillTemplate(string template, Dictionary<string, string> vars)
    {
        var result = template;
        foreach (var kv in vars)
        {
            result = result.Replace("{" + kv.Key + "}", kv.Value);
        }
        return result;
    }

    private static AiProvider NormalizeProvider(string? provider) => provider?.ToLowerInvariant() switch
    {
        "openai" => AiProvider.OpenAI,
        "ollama" => AiProvider.Ollama,
        _ => AiProvider.None
    };

    private static GuardianAiConfig CloneAiConfig(GuardianAiConfig src)
    {
        return new GuardianAiConfig
        {
            Provider = src.Provider,
            ApiKey = src.ApiKey,
            Model = src.Model,
            BaseUrl = src.BaseUrl,
            MaxTokens = src.MaxTokens
        };
    }

    private sealed class OpenAiChatResponse
    {
        public List<OpenAiChoice>? Choices { get; set; }
    }

    private sealed class OpenAiChoice
    {
        public OpenAiMessage? Message { get; set; }
    }

    private sealed class OpenAiMessage
    {
        public string? Content { get; set; }
    }

    private sealed class OllamaChatResponse
    {
        public OllamaMessage? Message { get; set; }
    }

    private sealed class OllamaMessage
    {
        public string? Content { get; set; }
    }
}
