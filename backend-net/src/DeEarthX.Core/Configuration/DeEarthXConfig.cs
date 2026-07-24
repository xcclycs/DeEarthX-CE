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
            McmodFilter = false
        },
        Oaf = true,
        AutoZip = false,
        Port = 37019,
        Host = "localhost",
        JavaPath = null
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
}
