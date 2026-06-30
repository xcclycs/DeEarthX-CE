using DeEarthX.Core.Abstractions;
using DeEarthX.Core.Configuration;
using DeEarthX.Infrastructure.Http;
using DeEarthX.Realtime;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace DeEarthX.Guardian;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddDeEarthXGuardian(this IServiceCollection services)
    {
        services.TryAddSingleton(_ => DeEarthXConfig.CreateDefault());
        services.TryAddSingleton(sp => sp.GetRequiredService<DeEarthXConfig>().Guardian?.Ai ?? new GuardianAiConfig());

        services.AddSingleton<LogParser>();
        services.AddSingleton<CrashDetector>();
        services.AddSingleton<ProcessManager>();
        services.AddSingleton<SafeExecutor>();
        services.AddSingleton<RollbackManager>();
        services.AddSingleton<Reporter>();
        services.AddSingleton<AIAdvisor>();
        services.AddSingleton<GuardianController>();
        services.AddSingleton<IGuardianHubHandlers>(sp => sp.GetRequiredService<GuardianController>());

        return services;
    }
}
