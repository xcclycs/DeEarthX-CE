using DeEarthX.Core.Configuration;
using DeEarthX.Core.Filter;

namespace DeEarthX.Dearth;

public sealed class DeEarthXFilterConfig : IFilterConfig
{
    public bool Hashes { get; }
    public bool Dexpub { get; }
    public bool Mixins { get; }
    public bool Modrinth { get; }
    public bool? McmodFilter { get; }
    public bool? AiFilter { get; }

    public DeEarthXFilterConfig(FilterConfig filter)
    {
        Hashes = filter.Hashes;
        Dexpub = filter.Dexpub;
        Mixins = filter.Mixins;
        Modrinth = filter.Modrinth;
        McmodFilter = filter.McmodFilter;
        AiFilter = filter.AiFilter;
    }

    public DeEarthXFilterConfig(DeEarthXConfig config)
        : this(config.Filter)
    {
    }
}
