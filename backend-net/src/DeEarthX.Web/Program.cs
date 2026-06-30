using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using DeEarthX.Core;
using DeEarthX.Core.Abstractions;
using DeEarthX.Core.Configuration;
using DeEarthX.Dearth;
using DeEarthX.Dex;
using DeEarthX.Galaxy;
using DeEarthX.Guardian;
using DeEarthX.Infrastructure;
using DeEarthX.Infrastructure.Crypto;
using DeEarthX.Infrastructure.TextEncoding;
using DeEarthX.Infrastructure.Java;
using DeEarthX.ModLoader;
using DeEarthX.Platform;
using DeEarthX.Plugins;
using DeEarthX.Realtime;
using DeEarthX.Templates;

using DeEarthX.Web;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDeEarthXInfrastructure();
builder.Services.AddDeEarthXRealtime();
builder.Services.AddDeEarthXPlatform();
builder.Services.AddDeEarthXModLoader();
builder.Services.AddDeEarthXDearth();
builder.Services.AddDeEarthXGalaxy();
builder.Services.AddDeEarthXGuardian();
builder.Services.AddDeEarthXPlugins();
builder.Services.AddDeEarthXTemplates();
builder.Services.AddDeEarthXDex();

builder.Services.AddSingleton<DownloadVersionService>();

builder.Services.AddCors(o => o.AddDefaultPolicy(b => b
    .SetIsOriginAllowed(_ => true)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(o =>
{
    o.MultipartBodyLengthLimit = 2L * 1024 * 1024 * 1024;
    o.ValueLengthLimit = int.MaxValue;
});
builder.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MaxRequestBodySize = 2L * 1024 * 1024 * 1024;
});

var app = builder.Build();

EncodingInitializer.Initialize();

var jsonOpts = new JsonSerializerOptions(DeEarthXJsonOptions.Default);

app.UseCors();
app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromSeconds(10)
});
app.UseMiddleware<SocketIOMiddleware>();
app.Use(async (ctx, next) =>
{
    try
    {
        await next();
    }
    catch (Exception ex)
    {
        var logger = ctx.RequestServices.GetRequiredService<ILogService>();
        logger.Error("请求处理异常", ex);
        ctx.Response.StatusCode = 500;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        var payload = new Dictionary<string, object?>
        {
            ["status"] = 500,
            ["message"] = ex.Message
        };
        if (app.Environment.IsDevelopment())
        {
            payload["stack"] = ex.StackTrace;
        }
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(payload, jsonOpts));
    }
});

RegisterRoutes(app, jsonOpts);
RegisterSocketIoHandlers(app);

var configService = app.Services.GetRequiredService<IConfigService>();
var config = configService.Get();
var port = config.Port ?? 37019;
var host = string.IsNullOrWhiteSpace(config.Host) ? "localhost" : config.Host;

app.Urls.Add($"http://{host}:{port}");

var startupLogger = app.Services.GetRequiredService<ILogService>();
startupLogger.Info($"服务器正在运行于 http://{host}:{port}");

_ = Task.Run(async () =>
{
    try
    {
        await Task.Delay(800, app.Lifetime.ApplicationStopping);
        var javaService = app.Services.GetRequiredService<IJavaService>();
        var messageService = app.Services.GetRequiredService<IMessageService>();
        var result = await javaService.CheckJavaAsync(config.JavaPath, app.Lifetime.ApplicationStopping);
        startupLogger.Info($"Java 检查: exists={result.Exists}, version={result.Version?.FullVersion ?? "N/A"}, vendor={result.Version?.Vendor ?? "N/A"}");
        await messageService.Info($"Java 检查: exists={result.Exists}, version={result.Version?.FullVersion ?? "N/A"}, vendor={result.Version?.Vendor ?? "N/A"}");
    }
    catch (Exception ex)
    {
        startupLogger.Error("启动 Java 检查失败", ex);
    }
});

app.Run();

static void RegisterSocketIoHandlers(WebApplication app)
{
    var server = app.Services.GetRequiredService<ISocketIOServer>();
    var handlers = app.Services.GetService<IGuardianHubHandlers>();
    if (handlers is null)
    {
        app.Services.GetRequiredService<ILogService>().Warn("IGuardianHubHandlers 未注册，guardian_* 事件将不会被处理");
        return;
    }

    server.On("guardian_start", arg => handlers.StartAsync(arg!));
    server.On("guardian_stop", _ => handlers.StopAsync());
    server.On("guardian_test_ai", _ => handlers.TestAiAsync());
    server.On("guardian_approve", arg => handlers.ApproveAsync(arg!));
    server.On("guardian_reject", arg => handlers.RejectAsync(arg!));
    server.On("guardian_rollback", _ => handlers.RollbackAsync());
    server.On("guardian_restart", _ => handlers.RestartAsync());
    server.On("guardian_command", arg => handlers.CommandAsync(arg!));
    server.On("guardian_get_ai_conversation", _ => handlers.GetAiConversationAsync());
    server.On("guardian_reset_ai_conversation", _ => handlers.ResetAiConversationAsync());
    server.On("guardian_update_config", arg => handlers.UpdateConfigAsync(arg!));
}

static void RegisterRoutes(WebApplication app, JsonSerializerOptions jsonOpts)
{
    var log = app.Services.GetRequiredService<ILogService>();

    app.MapGet("/", () => Results.Json(new
    {
        status = 200,
        @by = "DeEarthX.Core",
        qqg = "559349662",
        bilibili = "https://space.bilibili.com/1728953419  ",
        ping = DateTime.UtcNow.ToString("o")
    }, jsonOpts));

    app.MapGet("/version", () => Results.Json(new
    {
        status = 200,
        version = "1.0.0",
        name = "DeEarthX.Core",
        buildTime = DateTime.UtcNow.ToString("o")
    }, jsonOpts));

    app.MapPost("/start", async (HttpRequest req, DexService dex, CancellationToken ct) =>
    {
        var form = await req.ReadFormAsync(ct);
        var file = form.Files.FirstOrDefault(f => f.Name == "file");
        if (file is null)
            return Results.Json(new { status = 400, message = "未上传文件" }, jsonOpts);

        var mode = req.Query["mode"].ToString();
        if (string.IsNullOrEmpty(mode))
            return Results.Json(new { status = 400, message = "缺少 mode 参数" }, jsonOpts);

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".zip" && ext != ".mrpack")
            return Results.Json(new { status = 400, message = "只支持 .zip 和 .mrpack 文件" }, jsonOpts);

        var isServerMode = mode == "server";
        var template = req.Query["template"].ToString();

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        var buffer = ms.ToArray();

        log.Info($"正在启动任务: isServerMode={isServerMode}, filename={file.FileName}, size={buffer.Length}, template={template}");

        _ = Task.Run(async () =>
        {
            try { await dex.MainAsync(buffer, isServerMode, file.FileName, template, CancellationToken.None); }
            catch (Exception ex) { log.Error("任务执行失败", ex); }
        }, ct);

        return Results.Json(new { status = 200, message = "任务已提交，正在处理中" }, jsonOpts);
    });

    app.MapGet("/config/get", (IConfigService configService) =>
        Results.Json(configService.Get(), jsonOpts));

    app.MapPost("/config/post", async (HttpRequest req, IConfigService configService, CancellationToken ct) =>
    {
        var body = await JsonSerializer.DeserializeAsync<DeEarthXConfig>(req.Body, jsonOpts, ct);
        if (body is null)
            return Results.Json(new { status = 400, message = "无效的配置" }, jsonOpts);
        configService.Write(body);
        log.Info("配置已更新");
        return Results.Json(new { status = 200 }, jsonOpts);
    });

    app.MapGet("/modcheck", async (HttpRequest req, ModCheckService modCheckService, CancellationToken ct) =>
    {
        var modsPath = req.Query["path"].ToString();
        if (string.IsNullOrEmpty(modsPath))
            return Results.Json(new { status = 400, message = "缺少 path 参数" }, jsonOpts);
        var results = await modCheckService.CheckModsAsync(modsPath, ct);
        return Results.Json(results, jsonOpts);
    });

    app.MapPost("/modcheck/folder", async (HttpRequest req, ModCheckService modCheckService, CancellationToken ct) =>
    {
        var body = await JsonSerializer.DeserializeAsync<ModCheckFolderBody>(req.Body, jsonOpts, ct);
        if (body is null || string.IsNullOrEmpty(body.FolderPath))
            return Results.Json(new { status = 400, message = "缺少文件夹路径" }, jsonOpts);
        if (string.IsNullOrWhiteSpace(body.BundleName))
            return Results.Json(new { status = 400, message = "缺少整合包名字" }, jsonOpts);
        var results = await modCheckService.CheckModsWithBundleAsync(body.FolderPath, body.BundleName.Trim(), ct);
        return Results.Json(results, jsonOpts);
    });

    app.MapGet("/java/check", async (HttpRequest req, IJavaService javaService, CancellationToken ct) =>
    {
        var path = req.Query["path"].ToString();
        var result = await javaService.CheckJavaAsync(string.IsNullOrEmpty(path) ? null : path, ct);
        return Results.Json(new { status = 200, data = result }, jsonOpts);
    });

    app.MapGet("/java/detect", async (IJavaService javaService, CancellationToken ct) =>
    {
        var paths = await javaService.DetectJavaPathsAsync(ct);
        return Results.Json(new { status = 200, data = paths }, jsonOpts);
    });

    RegisterDownloadRoutes(app, jsonOpts, log);
    RegisterGalaxyRoutes(app, jsonOpts, log);
    RegisterTemplateRoutes(app, jsonOpts, log);
    RegisterGuardianRoutes(app, jsonOpts);
    RegisterPluginRoutes(app, jsonOpts, log);
}

static void RegisterDownloadRoutes(WebApplication app, JsonSerializerOptions jsonOpts, ILogService log)
{
    var svc = app.Services.GetRequiredService<DownloadVersionService>();

    app.MapGet("/download/minecraft-versions", async (CancellationToken ct) =>
    {
        try { return Results.Json(await svc.GetMinecraftVersionsAsync(ct), jsonOpts); }
        catch (Exception ex) { log.Error("获取 Minecraft 版本列表失败", ex); return Results.Json(new { error = "获取版本列表失败" }, jsonOpts, null, 500); }
    });

    app.MapGet("/download/forge-promos", async (CancellationToken ct) =>
    {
        try { return Results.Json(await svc.GetForgePromosAsync(ct), jsonOpts); }
        catch (Exception ex) { log.Error("获取 Forge Promos 失败", ex); return Results.Json(new { error = "获取 Forge Promos 失败" }, jsonOpts, null, 500); }
    });

    app.MapGet("/download/forge-versions", async (HttpRequest req, CancellationToken ct) =>
    {
        var mcver = req.Query["mcver"].ToString();
        if (string.IsNullOrEmpty(mcver)) return Results.Json(new { error = "缺少 mcver 参数" }, jsonOpts, null, 400);
        try { return Results.Json(await svc.GetForgeVersionsAsync(mcver, ct), jsonOpts); }
        catch (Exception ex) { log.Error("获取 Forge 版本列表失败", ex); return Results.Json(new { error = "获取 Forge 版本列表失败" }, jsonOpts, null, 500); }
    });

    app.MapGet("/download/neoforge-versions", async (HttpRequest req, CancellationToken ct) =>
    {
        var mcver = req.Query["mcver"].ToString();
        if (string.IsNullOrEmpty(mcver)) return Results.Json(new { error = "缺少 mcver 参数" }, jsonOpts, null, 400);
        try { return Results.Json(await svc.GetNeoForgeVersionsAsync(mcver, ct), jsonOpts); }
        catch (Exception ex) { log.Error("获取 NeoForge 版本列表失败", ex); return Results.Json(new { error = "获取 NeoForge 版本列表失败" }, jsonOpts, null, 500); }
    });

    app.MapGet("/download/fabric-versions", async (HttpRequest req, CancellationToken ct) =>
    {
        var mcver = req.Query["mcver"].ToString();
        if (string.IsNullOrEmpty(mcver)) return Results.Json(new { error = "缺少 mcver 参数" }, jsonOpts, null, 400);
        try { return Results.Json(await svc.GetFabricVersionsAsync(mcver, ct), jsonOpts); }
        catch (Exception ex) { log.Error("获取 Fabric 版本列表失败", ex); return Results.Json(new { error = "获取 Fabric 版本列表失败" }, jsonOpts, null, 500); }
    });

    app.MapPost("/download/install", async (HttpRequest req, IModLoaderService modLoaderService, IMessageService messageService, CancellationToken ct) =>
    {
        var body = await JsonSerializer.DeserializeAsync<DownloadInstallBody>(req.Body, jsonOpts, ct);
        if (body is null || string.IsNullOrEmpty(body.Loader) || string.IsNullOrEmpty(body.McVersion))
            return Results.Json(new { status = 400, message = "缺少必要参数" }, jsonOpts);

        var socketId = req.Query["socketId"].ToString();
        var path = req.Query["path"].ToString();
        if (string.IsNullOrEmpty(path)) path = Path.Combine(Path.GetTempPath(), $"deearthx-server-{Guid.NewGuid():N}");

        var loader = body.Loader;
        var mcVersion = body.McVersion;
        var loaderVersion = body.LoaderVersion ?? "";
        var autoInstall = body.AutoInstall;

        log.Info($"触发服务端安装: loader={loader}, mc={mcVersion}, mlv={loaderVersion}, autoInstall={autoInstall}, socketId={socketId}");

        _ = Task.Run(async () =>
        {
            try
            {
                await modLoaderService.MlSetupAsync(loader, mcVersion, loaderVersion, path, messageService, null, CancellationToken.None);
            }
            catch (Exception ex)
            {
                log.Error("服务端安装失败", ex);
                await messageService.ServerInstallError(ex.Message);
            }
        }, ct);

        return Results.Json(new { status = 200, message = "安装任务已提交" }, jsonOpts);
    });
}

static void RegisterGalaxyRoutes(WebApplication app, JsonSerializerOptions jsonOpts, ILogService log)
{
    var galaxy = app.Services.GetRequiredService<GalaxyService>();

    app.MapPost("/galaxy/upload", async (HttpRequest req, CancellationToken ct) =>
    {
        var form = await req.ReadFormAsync(ct);
        var files = form.Files.Where(f => f.Name == "files").ToList();
        if (files.Count == 0)
            files = form.Files.ToList();
        if (files.Count == 0)
            return Results.Json(new { status = 400, message = "未上传文件" }, jsonOpts);

        var jars = new List<(string FileName, byte[] Content)>();
        foreach (var f in files)
        {
            using var ms = new MemoryStream();
            await f.CopyToAsync(ms, ct);
            jars.Add((f.FileName, ms.ToArray()));
        }

        var results = await galaxy.ParseModIdsAsync(jars, ct);
        var modids = results.Select(r => r.ModId).Where(x => !string.IsNullOrEmpty(x)).ToList()!;
        log.Info($"已上传模组 ID: {string.Join(", ", modids)}");
        return Results.Json(new { modids }, jsonOpts);
    });

    app.MapPost("/galaxy/submit/{type}", async (string type, HttpRequest req, CancellationToken ct) =>
    {
        if (type != "server" && type != "client")
            return Results.Json(new { status = 400, message = "无效的类型参数" }, jsonOpts);

        var body = await JsonSerializer.DeserializeAsync<GalaxySubmitBody>(req.Body, jsonOpts, ct);
        if (body is null || string.IsNullOrEmpty(body.Modids))
            return Results.Json(new { status = 400, message = "未提供 modid" }, jsonOpts);

        try
        {
            var resp = await galaxy.SubmitAsync(type, body.Modids, ct);
            log.Info($"已成功提交 {type} 端模组 ID");
            return Results.Json(resp, jsonOpts);
        }
        catch (Exception ex)
        {
            log.Error($"提交 {type} 端模组 ID 失败", ex);
            return Results.Json(new { status = 500, message = "提交模组 ID 失败" }, jsonOpts, null, 500);
        }
    });
}

static void RegisterTemplateRoutes(WebApplication app, JsonSerializerOptions jsonOpts, ILogService log)
{
    var tm = app.Services.GetRequiredService<TemplateManager>();

    app.MapGet("/templates", async (CancellationToken ct) =>
    {
        var templates = await tm.GetTemplatesAsync(ct);
        return Results.Json(new { status = 200, data = templates }, jsonOpts);
    });

    app.MapPost("/templates", async (HttpRequest req, CancellationToken ct) =>
    {
        var body = await JsonSerializer.DeserializeAsync<CreateTemplateBody>(req.Body, jsonOpts, ct);
        if (body is null || string.IsNullOrWhiteSpace(body.Name))
            return Results.Json(new { status = 400, message = "模板名称不能为空" }, jsonOpts);
        var templateId = $"template-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}".Substring(0, 28);
        var t = await tm.CreateTemplateAsync(templateId, body.Name, ct);
        return Results.Json(new { status = 200, message = "模板创建成功", data = new { id = templateId } }, jsonOpts);
    });

    app.MapDelete("/templates/{id}", async (string id, CancellationToken ct) =>
    {
        try
        {
            await tm.DeleteTemplateAsync(id, ct);
            return Results.Json(new { status = 200, message = "模板删除成功" }, jsonOpts);
        }
        catch
        {
            return Results.Json(new { status = 404, message = "模板不存在" }, jsonOpts, null, 404);
        }
    });

    app.MapPut("/templates/{id}", async (string id, HttpRequest req, CancellationToken ct) =>
    {
        var body = await JsonSerializer.DeserializeAsync<TemplateMetadata>(req.Body, jsonOpts, ct);
        if (body is null || string.IsNullOrWhiteSpace(body.Name))
            return Results.Json(new { status = 400, message = "模板名称不能为空" }, jsonOpts);
        body.Id = id;
        await tm.UpdateTemplateAsync(id, body, ct);
        return Results.Json(new { status = 200, message = "模板更新成功" }, jsonOpts);
    });

    app.MapGet("/templates/{id}/path", (string id) => { tm.OpenTemplateFolderAsync(id); return Results.Json(new { status = 200, message = "文件夹已打开" }, jsonOpts); });

    app.MapGet("/templates/{id}/export", async (string id, CancellationToken ct) =>
    {
        try
        {
            var bytes = await tm.ExportZipAsync(id, ct);
            return Results.File(bytes, "application/zip", $"template-{id}.zip");
        }
        catch (Exception ex)
        {
            log.Error("导出模板失败", ex);
            return Results.Json(new { status = 500, message = "导出模板失败" }, jsonOpts, null, 500);
        }
    });

    app.MapPost("/templates/import", async (HttpRequest req, CancellationToken ct) =>
    {
        var form = await req.ReadFormAsync(ct);
        var file = form.Files.FirstOrDefault();
        if (file is null) return Results.Json(new { status = 400, message = "未上传文件" }, jsonOpts);
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".zip")
            return Results.Json(new { status = 400, message = "只支持 .zip 文件" }, jsonOpts);
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        var t = await tm.ImportZipAsync(ms.ToArray(), ct);
        return Results.Json(new { status = 200, message = "模板导入成功", data = new { id = t?.Metadata?.Id } }, jsonOpts);
    });

    app.MapPost("/templates/install-from-url", async (HttpRequest req, CancellationToken ct) =>
    {
        var body = await JsonSerializer.DeserializeAsync<InstallFromUrlBody>(req.Body, jsonOpts, ct);
        if (body is null || string.IsNullOrWhiteSpace(body.Url))
            return Results.Json(new { status = 400, message = "缺少 url 参数" }, jsonOpts);
        tm.InitInstallFromUrl(body.Url, body.RequestId, body.ResumeFrom);
        return Results.Json(new { status = 200, message = "下载任务已创建" }, jsonOpts);
    });

    app.MapGet("/templates/install-from-url", async (HttpRequest req, HttpResponse response, CancellationToken ct) =>
    {
        var requestId = req.Query["requestId"].ToString();
        response.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-cache";
        response.Headers.Connection = "keep-alive";

        try
        {
            await foreach (var ev in tm.StreamInstallFromUrlAsync(requestId, ct))
            {
                var json = JsonSerializer.Serialize(ev, jsonOpts);
                await response.WriteAsync($"data: {json}\n\n", ct);
                await response.Body.FlushAsync(ct);
            }
        }
        catch (Exception ex)
        {
            log.Error("模板从 URL 安装失败", ex);
            var errJson = JsonSerializer.Serialize(new { type = "error", error = ex.Message }, jsonOpts);
            await response.WriteAsync($"data: {errJson}\n\n", ct);
            await response.Body.FlushAsync(ct);
        }
    });

    app.MapGet("/templates/store", async (CancellationToken ct) =>
    {
        var store = await tm.GetStoreAsync(ct);
        return Results.Json(store, jsonOpts);
    });
}

static void RegisterGuardianRoutes(WebApplication app, JsonSerializerOptions jsonOpts)
{
    var controller = app.Services.GetRequiredService<GuardianController>();

    app.MapGet("/guardian/status", () =>
    {
        var enabled = controller.State != GuardianState.Idle;
        return Results.Json(new
        {
            status = 200,
            enabled,
            guardianStatus = controller.State.ToString(),
            processInfo = controller.GetProcessInfo(),
            checkpoints = controller.GetCheckpoints(),
            reports = controller.GetReportsList()
        }, jsonOpts);
    });

    app.MapGet("/guardian/logs", (HttpRequest req) =>
    {
        var linesStr = req.Query["lines"].ToString();
        int.TryParse(linesStr, out var lines);
        if (lines <= 0) lines = 100;
        var buffer = controller.GetLogBuffer();
        var slice = buffer.Skip(Math.Max(0, buffer.Count - lines)).ToList();
        return Results.Json(new { status = 200, logs = slice }, jsonOpts);
    });

    app.MapGet("/guardian/reports", () =>
        Results.Json(new { status = 200, reports = controller.GetReportsList() }, jsonOpts));
}

static void RegisterPluginRoutes(WebApplication app, JsonSerializerOptions jsonOpts, ILogService log)
{
    var pm = app.Services.GetRequiredService<PluginManager>();

    app.MapGet("/plugins", async (CancellationToken ct) =>
    {
        var plugins = await pm.GetPluginsAsync(ct);
        return Results.Json(new { status = 200, data = plugins }, jsonOpts);
    });

    app.MapGet("/plugins/injections", async (CancellationToken ct) =>
    {
        var injects = await pm.GetInjectsAsync(ct);
        return Results.Json(new { status = 200, data = injects }, jsonOpts);
    });

    app.MapGet("/plugins/{id}", async (string id, CancellationToken ct) =>
    {
        var p = await pm.GetPluginAsync(id, ct);
        if (p is null) return Results.Json(new { status = 404, message = "插件不存在" }, jsonOpts, null, 404);
        return Results.Json(new
        {
            status = 200,
            data = new
            {
                manifest = p.Manifest,
                enabled = p.Config.Enabled,
                config = p.Config
            }
        }, jsonOpts);
    });

    app.MapPost("/plugins/{id}/enable", async (string id, CancellationToken ct) =>
    {
        await pm.EnableAsync(id, ct);
        return Results.Json(new { status = 200, message = "插件已启用" }, jsonOpts);
    });

    app.MapPost("/plugins/{id}/disable", async (string id, CancellationToken ct) =>
    {
        await pm.DisableAsync(id, ct);
        return Results.Json(new { status = 200, message = "插件已禁用" }, jsonOpts);
    });

    app.MapGet("/plugins/{id}/config", async (string id, CancellationToken ct) =>
    {
        try
        {
            var data = await pm.GetPluginConfigForApiAsync(id, ct);
            return Results.Json(new { status = 200, data }, jsonOpts);
        }
        catch
        {
            return Results.Json(new { status = 404, message = "插件不存在" }, jsonOpts, null, 404);
        }
    });

    app.MapPost("/plugins/{id}/config", async (string id, HttpRequest req, CancellationToken ct) =>
    {
        using var doc = await JsonDocument.ParseAsync(req.Body, cancellationToken: ct);
        var node = JsonNode.Parse(doc.RootElement.GetRawText());
        await pm.UpdateSettingsAsync(id, node!, ct);
        return Results.Json(new { status = 200, message = "配置已更新" }, jsonOpts);
    });

    app.MapPost("/plugins/create", async (HttpRequest req, CancellationToken ct) =>
    {
        var body = await JsonSerializer.DeserializeAsync<CreatePluginBody>(req.Body, jsonOpts, ct);
        if (body is null || string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.Author))
            return Results.Json(new { status = 400, message = "插件名称和作者不能为空" }, jsonOpts);
        var p = await pm.CreatePluginAsync(body.Name, body.Author, body.Url ?? "", ct);
        return Results.Json(new { status = 200, message = "插件创建成功", data = p }, jsonOpts);
    });

    app.MapGet("/plugins/folder", () =>
    {
        try
        {
            var pluginsDir = pm.GetPluginsDir();
            if (OperatingSystem.IsWindows())
                System.Diagnostics.Process.Start(new ProcessStartInfo("explorer.exe", $"\"{pluginsDir}\"") { UseShellExecute = true });
            return Results.Json(new { status = 200, message = "文件夹已打开" }, jsonOpts);
        }
        catch (Exception ex)
        {
            log.Error("打开插件文件夹失败", ex);
            return Results.Json(new { status = 500, message = "打开文件夹失败" }, jsonOpts, null, 500);
        }
    });

    app.MapPost("/plugins/install", async (HttpRequest req, CancellationToken ct) =>
    {
        var form = await req.ReadFormAsync(ct);
        var file = form.Files.FirstOrDefault();
        if (file is null) return Results.Json(new { status = 400, message = "未上传文件" }, jsonOpts);
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        var buffer = ms.ToArray();

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".zip" && ext != ".dxp" && ext != ".dexp")
            return Results.Json(new { status = 400, message = "只支持 .zip 或 .dxp 文件" }, jsonOpts);

        try
        {
            var result = await pm.InstallSmartAsync(buffer, ct);
            if (result.RequirePassword)
                return Results.Json(new { status = 400, message = "需要密码解密", requirePassword = true }, jsonOpts);
            if (result.PluginId is null)
                return Results.Json(new { status = 400, message = result.Error ?? "插件安装失败" }, jsonOpts);
            return Results.Json(new { status = 200, message = "插件安装成功", data = new { id = result.PluginId } }, jsonOpts);
        }
        catch (Exception ex)
        {
            log.Error("安装插件失败", ex);
            return Results.Json(new { status = 500, message = "安装插件失败" }, jsonOpts, null, 500);
        }
    });

    app.MapPost("/plugins/install-encrypted", async (HttpRequest req, CancellationToken ct) =>
    {
        var form = await req.ReadFormAsync(ct);
        var file = form.Files.FirstOrDefault();
        if (file is null) return Results.Json(new { status = 400, message = "未上传文件" }, jsonOpts);

        string? password = null;
        if (form.TryGetValue("password", out var pw)) password = pw.ToString();
        if (string.IsNullOrEmpty(password))
            return Results.Json(new { status = 400, message = "请提供解密密码" }, jsonOpts);

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, ct);
        var buffer = ms.ToArray();

        try
        {
            var loaded = await pm.InstallFromEncryptedAsync(buffer, password, ct);
            return Results.Json(new { status = 200, message = "加密插件安装成功", data = new { id = loaded.Manifest.Id } }, jsonOpts);
        }
        catch (Exception ex)
        {
            log.Error("解密失败", ex);
            return Results.Json(new { status = 400, message = "解密失败，请检查密码是否正确" }, jsonOpts, null, 400);
        }
    });

    app.MapDelete("/plugins/{id}", async (HttpRequest req, string id, CancellationToken ct) =>
    {
        var keepConfig = req.Query["keepConfig"].ToString() != "false";
        try
        {
            await pm.UninstallAsync(id, keepConfig, ct);
            return Results.Json(new { status = 200, message = keepConfig ? "插件已卸载（配置已保留）" : "插件已完全删除" }, jsonOpts);
        }
        catch
        {
            return Results.Json(new { status = 404, message = "插件不存在或删除失败" }, jsonOpts, null, 404);
        }
    });

    app.MapGet("/plugins/{id}/export", async (string id, CancellationToken ct) =>
    {
        try
        {
            var bytes = await pm.ExportZipAsync(id, ct);
            return Results.File(bytes, "application/zip", $"{id}.zip");
        }
        catch (Exception ex)
        {
            log.Error("导出插件失败", ex);
            return Results.Json(new { status = 500, message = "导出插件失败" }, jsonOpts, null, 500);
        }
    });

    app.MapPost("/plugins/{id}/export-encrypted", async (HttpRequest req, string id, CancellationToken ct) =>
    {
        var body = await JsonSerializer.DeserializeAsync<ExportEncryptedBody>(req.Body, jsonOpts, ct);
        var mode = body?.Mode ?? "public";
        var password = body?.Password ?? "";

        try
        {
            byte[] encrypted;
            string fileName;
            if (mode == "private")
            {
                if (string.IsNullOrEmpty(password) || !System.Text.RegularExpressions.Regex.IsMatch(password, @"^[a-zA-Z0-9]+$"))
                    return Results.Json(new { status = 400, message = "密码仅能包含大小写字母和数字" }, jsonOpts, null, 400);
                encrypted = await pm.ExportEncryptedAsync(id, password, 1, ct);
                fileName = $"{id}.dxp";
            }
            else
            {
                encrypted = await pm.ExportEncryptedAsync(id, DexpCrypto.PublicPassword, 0, ct);
                fileName = $"{id}.dxp";
            }
            return Results.File(encrypted, "application/octet-stream", fileName);
        }
        catch (Exception ex)
        {
            log.Error("加密导出失败", ex);
            return Results.Json(new { status = 500, message = "加密导出失败" }, jsonOpts, null, 500);
        }
    });

    app.MapGet("/plugins/{id}/sidebar", async (string id, CancellationToken ct) =>
    {
        var p = await pm.GetPluginAsync(id, ct);
        if (p is null) return Results.Json(new { status = 404, message = "插件不存在" }, jsonOpts, null, 404);
        return Results.Json(new
        {
            status = 200,
            data = new
            {
                hasSidebar = p.Manifest.Sidebar,
                sidebarItems = p.Manifest.SidebarItems ?? new List<PluginSidebarItem>()
            }
        }, jsonOpts);
    });

    app.MapGet("/plugins/{pluginId}/files/{**filePath}", (string pluginId, string filePath) =>
    {
        try
        {
            var fullPath = pm.GetPluginFilePath(pluginId, filePath);
            if (!File.Exists(fullPath))
                return Results.Json(new { status = 404, message = "文件不存在" }, jsonOpts, null, 404);
            var contentType = GetContentType(fullPath);
            return Results.File(fullPath, contentType);
        }
        catch (UnauthorizedAccessException)
        {
            return Results.Json(new { status = 403, message = "禁止访问" }, jsonOpts, null, 403);
        }
        catch (Exception ex)
        {
            log.Error("插件文件服务失败", ex);
            return Results.Json(new { status = 500, message = ex.Message }, jsonOpts, null, 500);
        }
    });

    app.MapGet("/plugin-page/{pluginId}/{pageKey}", async (string pluginId, string pageKey, CancellationToken ct) =>
    {
        try
        {
            var html = await pm.ReadPluginPageAsync(pluginId, pageKey, ct);
            return Results.Content(html, "text/html; charset=utf-8");
        }
        catch (Exception ex)
        {
            return Results.Json(new { status = 404, message = ex.Message }, jsonOpts, null, 404);
        }
    });
}

static string GetContentType(string path)
{
    var ext = Path.GetExtension(path).ToLowerInvariant();
    return ext switch
    {
        ".html" or ".htm" => "text/html; charset=utf-8",
        ".js" or ".mjs" => "application/javascript",
        ".css" => "text/css",
        ".json" => "application/json",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".svg" => "image/svg+xml",
        ".ico" => "image/x-icon",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        _ => "application/octet-stream"
    };
}

public record ModCheckFolderBody(string FolderPath, string BundleName);
public record GalaxySubmitBody(string Modids);
public record CreateTemplateBody(string Name);
public record InstallFromUrlBody(string Url, string? RequestId, long ResumeFrom);
public record CreatePluginBody(string Name, string Author, string? Url);
public record ExportEncryptedBody(string? Mode, string? Password, bool? RememberPassword);
public record DownloadInstallBody(string Loader, string McVersion, string? LoaderVersion, bool AutoInstall);
