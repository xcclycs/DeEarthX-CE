using System.Text.Json.Serialization;

namespace DeEarthX.Core.Configuration;

public class DeEarthXConfig
{
    public MirrorConfig Mirror { get; set; } = new();
    public FilterConfig Filter { get; set; } = new();
    public bool Oaf { get; set; }
    public bool AutoZip { get; set; }
    public int? Port { get; set; }
    public string? Host { get; set; }
    public string? JavaPath { get; set; }
    public GuardianConfig? Guardian { get; set; }

    public static DeEarthXConfig CreateDefault() => new()
    {
        Mirror = new MirrorConfig
        {
            Bmclapi = true,
            Mcimirror = true,
            McimirrorModrinthOnly = false
        },
        Filter = new FilterConfig
        {
            Hashes = true,
            Dexpub = true,
            Mixins = true,
            Modrinth = false,
            McmodFilter = false,
            AiFilter = false
        },
        Oaf = true,
        AutoZip = false,
        Port = 37019,
        Host = "localhost",
        JavaPath = null,
        Guardian = new GuardianConfig
        {
            Enabled = false,
            Ai = new GuardianAiConfig
            {
                Provider = "openai",
                ApiKey = "",
                Model = "gpt-4.1-mini",
                BaseUrl = "https://api.openai.com/v1",
                MaxTokens = 1500
            },
            AutoAcceptLowRisk = true,
            MaxConsecutiveCrashes = 5,
            MonitoringTimeout = 30000
        }
    };
}

public class MirrorConfig
{
    public bool Bmclapi { get; set; }
    public bool Mcimirror { get; set; }
    public bool? McimirrorModrinthOnly { get; set; }
}

public class FilterConfig
{
    public bool Hashes { get; set; }
    public bool Dexpub { get; set; }
    public bool Mixins { get; set; }
    public bool Modrinth { get; set; }
    public bool? McmodFilter { get; set; }
    public bool? AiFilter { get; set; }
}

public class GuardianConfig
{
    public bool Enabled { get; set; }
    public GuardianAiConfig Ai { get; set; } = new();
    public bool AutoAcceptLowRisk { get; set; }
    public int MaxConsecutiveCrashes { get; set; }
    public int MonitoringTimeout { get; set; }
}

public class GuardianAiConfig
{
    public string Provider { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    [JsonPropertyName("baseURL")]
    public string BaseUrl { get; set; } = string.Empty;
    public int? MaxTokens { get; set; }
}
