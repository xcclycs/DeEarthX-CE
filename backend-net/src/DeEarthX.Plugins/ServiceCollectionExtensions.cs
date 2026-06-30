using Microsoft.Extensions.DependencyInjection;

namespace DeEarthX.Plugins;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddDeEarthXPlugins(this IServiceCollection services)
    {
        services.AddSingleton<PluginManager>();
        services.AddSingleton<IPluginHookExecutor, ProcessHookExecutor>();
        services.AddSingleton<PluginFilterStrategyProvider>();
        return services;
    }
}
