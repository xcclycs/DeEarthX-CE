using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DeEarthX.Core;
using DeEarthX.Core.Abstractions;
using DeEarthX.Infrastructure.Crypto;
using DeEarthX.Infrastructure.Zip;

namespace DeEarthX.Plugins;

public sealed class PluginManager
{
    private const string ManifestFileName = "manifest.json";
    private const string GlobalConfigsFileName = "plugin-configs.json";

    private readonly IAppDirectoryProvider _appDirectoryProvider;
    private readonly ILogService _logService;
    private readonly IDexpCrypto _dexpCrypto;
    private readonly IZipService _zipService;

    private readonly ConcurrentDictionary<string, LoadedPlugin> _plugins = new();

    public PluginManager(
        IAppDirectoryProvider appDirectoryProvider,
        ILogService logService,
        IDexpCrypto dexpCrypto,
        IZipService zipService)
    {
        _appDirectoryProvider = appDirectoryProvider;
        _logService = logService;
        _dexpCrypto = dexpCrypto;
        _zipService = zipService;
    }

    private string PluginsDir => Path.Combine(_appDirectoryProvider.GetAppDirectory(), "plugins");

    private string GlobalConfigsPath => Path.Combine(_appDirectoryProvider.GetAppDirectory(), GlobalConfigsFileName);

    public async Task<List<LoadedPlugin>> GetPluginsAsync(CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        return _plugins.Values.ToList();
    }

    public async Task<LoadedPlugin?> GetPluginAsync(string id, CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        return _plugins.TryGetValue(id, out var p) ? p : null;
    }

    public async Task EnableAsync(string id, CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        if (_plugins.TryGetValue(id, out var p))
        {
            p.Config.Enabled = true;
            await SavePluginConfigAsync(id, p.Config, ct);
            WriteGlobalPluginConfigs();
            _logService.Info($"插件已启用: {p.Manifest.Name}");
        }
    }

    public async Task DisableAsync(string id, CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        if (_plugins.TryGetValue(id, out var p))
        {
            p.Config.Enabled = false;
            await SavePluginConfigAsync(id, p.Config, ct);
            WriteGlobalPluginConfigs();
            _logService.Info($"插件已禁用: {p.Manifest.Name}");
        }
    }

    public async Task UpdateSettingsAsync(string id, JsonNode settings, CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        if (_plugins.TryGetValue(id, out var p))
        {
            if (settings is JsonObject obj)
            {
                foreach (var kv in obj)
                {
                    p.Config.Settings[kv.Key] = kv.Value;
                }
            }
            await SavePluginConfigAsync(id, p.Config, ct);
        }
    }

    public async Task<LoadedPlugin> CreatePluginAsync(string name, string author, string url = "", CancellationToken ct = default)
    {
        return await CreatePluginAsync(name, author, url, true, ct);
    }

    public async Task<LoadedPlugin> CreatePluginAsync(string name, string author, string url, bool withTemplate, CancellationToken ct = default)
    {
        Directory.CreateDirectory(PluginsDir);
        var id = $"plugin-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}".Substring(0, 24);
        var pluginDir = Path.Combine(PluginsDir, id);
        Directory.CreateDirectory(pluginDir);

        var manifest = new PluginManifest
        {
            Id = id,
            Name = name,
            Version = "1.0.0",
            Author = string.IsNullOrEmpty(author) ? "Unknown" : author,
            Homepage = url,
            Runtime = "none",
            Sidebar = false,
            Page = false,
            Resources = new PluginResources
            {
                Files = new List<string>(),
                Scripts = new List<string>()
            }
        };
        await WriteManifestAsync(pluginDir, manifest, ct);

        var config = new PluginConfig { Id = id, Enabled = true };
        await SavePluginConfigAsync(id, config, ct);

        if (withTemplate)
        {
            await GeneratePluginTemplateAsync(pluginDir, manifest, ct);
        }

        var loaded = new LoadedPlugin
        {
            Manifest = manifest,
            Config = config,
            DirectoryPath = pluginDir
        };
        _plugins[id] = loaded;
        WriteGlobalPluginConfigs();
        _logService.Info($"插件已创建: {name} ({id})");
        return loaded;
    }

    public async Task GeneratePluginTemplateAsync(string pluginDir, PluginManifest manifest, CancellationToken ct)
    {
        var frontendDir = Path.Combine(pluginDir, "frontend");
        var assetsDir = Path.Combine(frontendDir, "assets");
        var scriptsDir = Path.Combine(pluginDir, "scripts");
        var hooksDir = Path.Combine(pluginDir, "hooks");

        Directory.CreateDirectory(frontendDir);
        Directory.CreateDirectory(assetsDir);
        Directory.CreateDirectory(scriptsDir);
        Directory.CreateDirectory(hooksDir);

        await File.WriteAllTextAsync(Path.Combine(pluginDir, "README.md"),
            $"# {manifest.Name}\n\n## 描述\n\n请输入插件描述。\n\n## 版本\n\n{manifest.Version}\n\n## 作者\n\n{manifest.Author}\n",
            ct);

        await File.WriteAllTextAsync(Path.Combine(frontendDir, "index.html"),
            $"<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>{manifest.Name}</title>\n  <link rel=\"stylesheet\" href=\"assets/style.css\">\n</head>\n<body>\n  <div class=\"plugin-container\">\n    <h1>{manifest.Name}</h1>\n    <p>欢迎使用 {manifest.Name} 插件！</p>\n  </div>\n</body>\n</html>\n",
            ct);

        await File.WriteAllTextAsync(Path.Combine(assetsDir, "style.css"),
            ".plugin-container {\n  padding: 24px;\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n}\n",
            ct);

        await File.WriteAllTextAsync(Path.Combine(scriptsDir, "main.js"),
            "// 插件脚本入口\nconsole.log('Plugin loaded:', manifest.name);\n\n// 插件 API 示例\n// 可以通过 window.addEventListener('deearthx:event', handler) 监听事件\n// 可以通过 window.dispatchEvent(new CustomEvent('deearthx:action', { detail: ... })) 触发动作\n",
            ct);

        await File.WriteAllTextAsync(Path.Combine(hooksDir, "example.json"),
            "{\n  \"onLoad\": \"main.js\",\n  \"onUnload\": \"\",\n  \"onConfigChange\": \"\"\n}\n",
            ct);

        _logService.Info($"插件模板已生成: {manifest.Name}");
    }

    public PluginValidationResult ValidatePlugin(string id)
    {
        if (_plugins.TryGetValue(id, out var p))
        {
            var validator = new PluginValidator();
            var result = validator.Validate(p.Manifest);
            if (result.IsValid)
            {
                result = validator.ValidateConfig(p.Manifest, p.Config);
            }
            return result;
        }
        return new PluginValidationResult
        {
            IsValid = false,
            Errors = new List<string> { "插件不存在" }
        };
    }

    public async Task<List<string>> ListPluginFilesAsync(string id, CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        var dir = Path.Combine(PluginsDir, id);
        if (!Directory.Exists(dir))
            throw new DirectoryNotFoundException($"插件目录不存在: {id}");

        var files = new List<string>();
        foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
        {
            files.Add(Path.GetRelativePath(dir, file).Replace('\\', '/'));
        }
        return files.OrderBy(f => f).ToList();
    }

    public async Task ReloadPluginAsync(string id, CancellationToken ct = default)
    {
        _plugins.TryRemove(id, out _);
        var dir = Path.Combine(PluginsDir, id);
        if (!Directory.Exists(dir))
            throw new DirectoryNotFoundException($"插件目录不存在: {id}");

        var manifestPath = Path.Combine(dir, ManifestFileName);
        if (!File.Exists(manifestPath))
            throw new FileNotFoundException("插件清单不存在");

        var manifest = await ReadManifestAsync(manifestPath, ct);
        manifest.Id = id;
        var config = await ReadPluginConfigAsync(id, manifest, ct);

        _plugins[id] = new LoadedPlugin
        {
            Manifest = manifest,
            Config = config,
            DirectoryPath = dir
        };
        _logService.Info($"插件已重新加载: {manifest.Name} ({id})");
    }

    public async Task<PluginInstallResult> InstallSmartAsync(byte[] buffer, CancellationToken ct = default)
    {
        if (_dexpCrypto.IsDexp(buffer))
        {
            var header = _dexpCrypto.ParseHeader(buffer);
            if (header is null)
            {
                return new PluginInstallResult(null, "无效的 DEXP 文件", false);
            }

            if (header.Mode == 0)
            {
                var decrypted = _dexpCrypto.Decrypt(buffer, DexpCrypto.PublicPassword);
                if (decrypted is null)
                {
                    return new PluginInstallResult(null, "DEXP 解密失败", false);
                }
                var loaded = await InstallFromZipAsync(decrypted, ct);
                WriteGlobalPluginConfigs();
                return new PluginInstallResult(loaded.Manifest.Id, null, false);
            }
            else
            {
                return new PluginInstallResult(null, "需要密码解密", true);
            }
        }

        var plugin = await InstallFromZipAsync(buffer, ct);
        WriteGlobalPluginConfigs();
        return new PluginInstallResult(plugin.Manifest.Id, null, false);
    }

    public async Task<LoadedPlugin> GetPluginForApiAsync(string id, CancellationToken ct = default)
    {
        var p = await GetPluginAsync(id, ct) ?? throw new FileNotFoundException("插件不存在");
        return p;
    }

    public async Task<LoadedPlugin> InstallFromZipAsync(byte[] zipBytes, CancellationToken ct = default)
    {
        Directory.CreateDirectory(PluginsDir);

        string? topLevelDir = null;
        string? detectedId = null;

        using var ms = new MemoryStream(zipBytes);
        using var archive = new ZipArchive(ms, ZipArchiveMode.Read);
        foreach (var entry in archive.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name)) continue;
            if (topLevelDir == null)
            {
                var slash = entry.FullName.IndexOf('/');
                topLevelDir = slash >= 0 ? entry.FullName.Substring(0, slash) : null;
            }
        }

        var tempDir = Path.Combine(PluginsDir, $"_install_{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        try
        {
            await _zipService.ExtractToDirectoryAsync(zipBytes, tempDir, ct);

            string sourceDir = tempDir;
            if (topLevelDir != null && Directory.Exists(Path.Combine(tempDir, topLevelDir)))
            {
                sourceDir = Path.Combine(tempDir, topLevelDir);
            }

            var manifestPath = Path.Combine(sourceDir, ManifestFileName);
            if (!File.Exists(manifestPath))
            {
                throw new FileNotFoundException("插件包中未找到 manifest.json");
            }

            var manifest = await ReadManifestAsync(manifestPath, ct);
            detectedId = string.IsNullOrWhiteSpace(manifest.Id) ? Guid.NewGuid().ToString("N").Substring(0, 10) : manifest.Id;
            manifest.Id = detectedId;

            var destDir = Path.Combine(PluginsDir, detectedId);
            if (Directory.Exists(destDir)) Directory.Delete(destDir, true);
            CopyDirectory(sourceDir, destDir);

            var config = await ReadPluginConfigAsync(detectedId, manifest, ct);
            var loaded = new LoadedPlugin
            {
                Manifest = manifest,
                Config = config,
                DirectoryPath = destDir
            };
            _plugins[detectedId] = loaded;
            WriteGlobalPluginConfigs();
            _logService.Info($"插件已安装: {manifest.Name} ({detectedId})");
            return loaded;
        }
        finally
        {
            if (Directory.Exists(tempDir))
            {
                try { Directory.Delete(tempDir, true); } catch { }
            }
        }
    }

    public async Task<LoadedPlugin> InstallFromEncryptedAsync(byte[] encryptedBytes, string password, CancellationToken ct = default)
    {
        var decrypted = _dexpCrypto.Decrypt(encryptedBytes, password)
            ?? throw new InvalidOperationException("解密失败：密码错误或数据损坏");
        return await InstallFromZipAsync(decrypted, ct);
    }

    public async Task UninstallAsync(string id, bool keepConfig = true, CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        var dir = Path.Combine(PluginsDir, id);
        if (Directory.Exists(dir))
        {
            Directory.Delete(dir, true);
        }
        _plugins.TryRemove(id, out _);
        if (keepConfig)
        {
            WriteGlobalPluginConfigs();
        }
        else
        {
            var configs = ReadGlobalPluginConfigs();
            configs.Remove(id);
            try
            {
                var json = JsonSerializer.Serialize(configs, DeEarthXJsonOptions.Default);
                File.WriteAllText(GlobalConfigsPath, json);
            }
            catch (Exception ex)
            {
                _logService.Error("保存全局插件配置失败", ex);
            }
        }
        _logService.Info($"插件已卸载: {id} (keepConfig={keepConfig})");
    }

    public async Task<byte[]> ExportZipAsync(string id, CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        var dir = Path.Combine(PluginsDir, id);
        if (!Directory.Exists(dir))
        {
            throw new DirectoryNotFoundException($"插件目录不存在: {id}");
        }

        var tempFile = Path.Combine(Path.GetTempPath(), $"deearthx_plugin_{id}_{Guid.NewGuid():N}.zip");
        try
        {
            await _zipService.CreateZipAsync(dir, tempFile, 9, ct);
            return await File.ReadAllBytesAsync(tempFile, ct);
        }
        finally
        {
            if (File.Exists(tempFile))
            {
                try { File.Delete(tempFile); } catch { }
            }
        }
    }

    public async Task<byte[]> ExportEncryptedAsync(string id, string password, byte mode, CancellationToken ct = default)
    {
        var zip = await ExportZipAsync(id, ct);
        return _dexpCrypto.Encrypt(zip, password, mode);
    }

    public async Task<List<object>> GetSidebarsAsync(CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        var result = new List<object>();
        foreach (var p in _plugins.Values)
        {
            if (!p.Enabled || !p.Manifest.Sidebar) continue;
            result.Add(new
            {
                id = p.Manifest.Id,
                name = p.Manifest.Name,
                icon = p.Manifest.Icon,
                items = p.Manifest.SidebarItems ?? new List<PluginSidebarItem>()
            });
        }
        return result;
    }

    public async Task<List<object>> GetInjectsAsync(CancellationToken ct = default)
    {
        await EnsureLoadedAsync(ct);
        var result = new List<object>();
        foreach (var p in _plugins.Values)
        {
            if (!p.Enabled) continue;
            var js = p.Manifest.InjectJS ?? new List<string>();
            var css = p.Manifest.InjectCSS ?? new List<string>();
            if (js.Count == 0 && css.Count == 0) continue;

            result.Add(new
            {
                pluginId = p.Manifest.Id,
                css = css.Select(f => $"/plugins/{p.Manifest.Id}/files/{f}").ToList(),
                js = js.Select(f => $"/plugins/{p.Manifest.Id}/files/{f}").ToList()
            });
        }
        return result;
    }

    public string GetPluginFilePath(string id, string relativePath)
    {
        var pluginDir = Path.GetFullPath(Path.Combine(PluginsDir, id));
        var resolved = Path.GetFullPath(Path.Combine(pluginDir, relativePath));
        var normalizedPluginDir = pluginDir.EndsWith(Path.DirectorySeparatorChar) ? pluginDir : pluginDir + Path.DirectorySeparatorChar;
        if (!resolved.StartsWith(normalizedPluginDir, StringComparison.OrdinalIgnoreCase))
        {
            throw new UnauthorizedAccessException("路径越权访问被拒绝");
        }
        return resolved;
    }

    public async Task<string> ReadPluginPageAsync(string pluginId, string pageKey, CancellationToken ct = default)
    {
        var candidates = new[]
        {
            Path.Combine(PluginsDir, pluginId, "frontend", $"{pageKey}.html"),
            Path.Combine(PluginsDir, pluginId, $"{pageKey}.html"),
            Path.Combine(PluginsDir, pluginId, "frontend", "index.html")
        };
        foreach (var c in candidates)
        {
            if (File.Exists(c))
            {
                return await File.ReadAllTextAsync(c, ct);
            }
        }
        throw new FileNotFoundException($"未找到插件页面: {pluginId}/{pageKey}");
    }

    public string GetPluginsDir() => PluginsDir;

    private async Task EnsureLoadedAsync(CancellationToken ct)
    {
        if (_plugins.IsEmpty)
        {
            await LoadAllPluginsAsync(ct);
        }
    }

    private async Task LoadAllPluginsAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(PluginsDir);
        var globalConfigs = ReadGlobalPluginConfigs();

        foreach (var dir in Directory.EnumerateDirectories(PluginsDir))
        {
            var manifestPath = Path.Combine(dir, ManifestFileName);
            if (!File.Exists(manifestPath)) continue;

            try
            {
                var manifest = await ReadManifestAsync(manifestPath, ct);
                var id = manifest.Id;
                if (string.IsNullOrWhiteSpace(id))
                {
                    id = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar));
                    manifest.Id = id;
                }
                var config = await ReadPluginConfigAsync(id, manifest, ct);

                if (globalConfigs.TryGetValue(id, out var enabled) && bool.TryParse(enabled?.ToString(), out var g))
                {
                    config.Enabled = g;
                }

                _plugins[id] = new LoadedPlugin
                {
                    Manifest = manifest,
                    Config = config,
                    DirectoryPath = dir
                };
            }
            catch (Exception ex)
            {
                _logService.Error($"加载插件失败: {dir}", ex);
            }
        }
    }

    private async Task<PluginManifest> ReadManifestAsync(string path, CancellationToken ct)
    {
        var json = await File.ReadAllTextAsync(path, ct);
        var manifest = JsonSerializer.Deserialize<PluginManifest>(json, DeEarthXJsonOptions.Default)
            ?? throw new InvalidDataException("manifest.json 解析失败");
        return manifest;
    }

    private async Task WriteManifestAsync(string dir, PluginManifest manifest, CancellationToken ct)
    {
        var path = Path.Combine(dir, ManifestFileName);
        var json = JsonSerializer.Serialize(manifest, DeEarthXJsonOptions.Default);
        await File.WriteAllTextAsync(path, json, ct);
    }

    private async Task<PluginConfig> ReadPluginConfigAsync(string id, PluginManifest manifest, CancellationToken ct)
    {
        var configPath = Path.Combine(PluginsDir, id, "config.json");
        var defaults = new PluginConfig { Id = id, Enabled = true };
        if (manifest.DefaultConfig is JsonObject dc)
        {
            foreach (var kv in dc)
            {
                defaults.Settings[kv.Key] = kv.Value;
            }
        }

        if (File.Exists(configPath))
        {
            try
            {
                var json = await File.ReadAllTextAsync(configPath, ct);
                var existing = JsonSerializer.Deserialize<PluginConfig>(json, DeEarthXJsonOptions.Default);
                if (existing != null)
                {
                    existing.Id = id;
                    foreach (var kv in defaults.Settings)
                    {
                        existing.Settings.TryAdd(kv.Key, kv.Value);
                    }
                    return existing;
                }
            }
            catch
            {
            }
        }

        await SavePluginConfigAsync(id, defaults, ct);
        return defaults;
    }

    private async Task SavePluginConfigAsync(string id, PluginConfig config, CancellationToken ct)
    {
        var dir = Path.Combine(PluginsDir, id);
        Directory.CreateDirectory(dir);
        config.Id = id;
        var path = Path.Combine(dir, "config.json");
        var json = JsonSerializer.Serialize(config, DeEarthXJsonOptions.Default);
        await File.WriteAllTextAsync(path, json, ct);
    }

    private Dictionary<string, string> ReadGlobalPluginConfigs()
    {
        if (!File.Exists(GlobalConfigsPath)) return new Dictionary<string, string>();
        try
        {
            var json = File.ReadAllText(GlobalConfigsPath);
            var dict = JsonSerializer.Deserialize<Dictionary<string, string>>(json, DeEarthXJsonOptions.Default);
            return dict ?? new Dictionary<string, string>();
        }
        catch
        {
            return new Dictionary<string, string>();
        }
    }

    public void WriteGlobalPluginConfigs()
    {
        var configs = new Dictionary<string, string>();
        foreach (var kv in _plugins)
        {
            configs[kv.Key] = kv.Value.Config.Enabled.ToString().ToLowerInvariant();
        }
        try
        {
            var json = JsonSerializer.Serialize(configs, DeEarthXJsonOptions.Default);
            File.WriteAllText(GlobalConfigsPath, json);
        }
        catch (Exception ex)
        {
            _logService.Error("保存全局插件配置失败", ex);
        }
    }

    private static void CopyDirectory(string source, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(source, file);
            var target = Path.Combine(dest, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, true);
        }
    }

    public async Task<object> GetPluginConfigForApiAsync(string id, CancellationToken ct = default)
    {
        var p = await GetPluginAsync(id, ct);
        if (p is null) throw new FileNotFoundException("插件不存在");

        var defaults = new Dictionary<string, object?>();
        if (p.Manifest.DefaultConfig is JsonObject dc)
        {
            foreach (var kv in dc)
            {
                defaults[kv.Key] = kv.Value;
            }
        }
        return new { settings = p.Config.Settings, defaults };
    }
}

public sealed record PluginInstallResult(string? PluginId, string? Error, bool RequirePassword);
