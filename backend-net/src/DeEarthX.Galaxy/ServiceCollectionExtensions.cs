using Microsoft.Extensions.DependencyInjection;

namespace DeEarthX.Galaxy;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddDeEarthXGalaxy(this IServiceCollection services)
    {
        services.AddSingleton<GalaxyService>();
        return services;
    }
}
