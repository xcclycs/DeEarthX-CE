using DeEarthX.Dex;
using Microsoft.Extensions.DependencyInjection;

namespace DeEarthX.Dex;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddDeEarthXDex(this IServiceCollection services)
    {
        services.AddSingleton<DexService>();
        return services;
    }
}
