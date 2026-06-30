using System.Text.Json.Nodes;

namespace DeEarthX.Plugins;

public sealed class PluginConfig
{
    public string Id { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public Dictionary<string, JsonNode?> Settings { get; set; } = new(StringComparer.Ordinal);
}

public sealed record PluginFilterStrategyDef(
    string Name,
    string? Type,
    string? Label,
    string? Hook);

public sealed class LoadedPlugin
{
    public required PluginManifest Manifest { get; init; }
    public required PluginConfig Config { get; set; }
    public string DirectoryPath { get; init; } = string.Empty;
    public bool Enabled => Config.Enabled;
}
