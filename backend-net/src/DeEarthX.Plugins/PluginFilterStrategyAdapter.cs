using System.Text.Json;
using DeEarthX.Core;
using DeEarthX.Core.Filter;

namespace DeEarthX.Plugins;

public sealed class PluginFilterStrategyAdapter : IFilterStrategy
{
    private readonly LoadedPlugin _plugin;
    private readonly PluginFilterStrategyDef _def;
    private readonly IPluginHookExecutor _hookExecutor;

    public PluginFilterStrategyAdapter(LoadedPlugin plugin, PluginFilterStrategyDef def, IPluginHookExecutor hookExecutor)
    {
        _plugin = plugin;
        _def = def;
        _hookExecutor = hookExecutor;
    }

    public string Name => string.IsNullOrWhiteSpace(_def.Name) ? $"{_plugin.Manifest.Id}-filter" : _def.Name;

    public async Task<bool> ShouldFilterAsync(FilterContext context)
    {
        return await ShouldFilterAsync(context, CancellationToken.None);
    }

    public async Task<bool> ShouldFilterAsync(FilterContext context, CancellationToken ct)
    {
        var meta = new Dictionary<string, object?>
        {
            ["fileName"] = context.FileName,
            ["filePath"] = context.FilePath,
            ["modId"] = context.ModId,
            ["minecraftVersion"] = context.MinecraftVersion,
            ["loader"] = context.Loader,
            ["strategyName"] = _def.Name,
            ["strategyType"] = _def.Type,
            ["pluginId"] = _plugin.Manifest.Id
        };

        foreach (var kv in context.Extra ?? new Dictionary<string, string>())
        {
            meta[kv.Key] = kv.Value;
        }

        var hookContext = new HookContext("filter_strategy", null, meta);
        var result = await _hookExecutor.ExecuteAsync(PluginHook.BeforeFilterMods, hookContext, ct);

        if (!result.Success || result.Extra is null) return false;

        try
        {
            var json = JsonSerializer.Serialize(result.Extra, DeEarthXJsonOptions.Default);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("filter", out var f) && f.ValueKind == JsonValueKind.True)
            {
                return true;
            }
        }
        catch
        {
        }
        return false;
    }
}

public sealed class PluginFilterStrategyProvider
{
    private readonly PluginManager _pluginManager;
    private readonly IPluginHookExecutor _hookExecutor;

    public PluginFilterStrategyProvider(PluginManager pluginManager, IPluginHookExecutor hookExecutor)
    {
        _pluginManager = pluginManager;
        _hookExecutor = hookExecutor;
    }

    public async Task<List<IFilterStrategy>> GetFilterStrategiesAsync(CancellationToken ct = default)
    {
        var strategies = new List<IFilterStrategy>();
        var plugins = await _pluginManager.GetPluginsAsync(ct);

        foreach (var plugin in plugins)
        {
            if (!plugin.Enabled) continue;
            if (plugin.Manifest.FilterStrategies is null || plugin.Manifest.FilterStrategies.Count == 0) continue;

            foreach (var def in plugin.Manifest.FilterStrategies)
            {
                strategies.Add(new PluginFilterStrategyAdapter(plugin, def, _hookExecutor));
            }
        }

        return strategies;
    }
}
