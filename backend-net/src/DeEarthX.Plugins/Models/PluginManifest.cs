using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace DeEarthX.Plugins;

public sealed class PluginManifest
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Main { get; set; }
    public string? Author { get; set; }
    public string? Homepage { get; set; }
    public string? License { get; set; }
    public string? Icon { get; set; }
    public bool Sidebar { get; set; }
    public bool Page { get; set; }
    public List<string> Injects { get; set; } = new();
    public List<PluginFilterStrategyDef>? FilterStrategies { get; set; }
    public List<string>? Hooks { get; set; }
    public List<PluginSidebarItem>? SidebarItems { get; set; }
    public JsonNode? DefaultConfig { get; set; }

    [JsonPropertyName("injectCSS")]
    public List<string>? InjectCSS { get; set; }

    [JsonPropertyName("injectJS")]
    public List<string>? InjectJS { get; set; }
}

public sealed class PluginSidebarItem
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string? Icon { get; set; }
    public string Route { get; set; } = string.Empty;
}
