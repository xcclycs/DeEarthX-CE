namespace DeEarthX.Plugins;

public enum PluginHook
{
    BeforeModpackProcess,
    AfterModpackProcess,
    BeforeFilterMods,
    AfterFilterMods,
    BeforeDownloadFiles,
    AfterDownloadFiles,
    BeforeInstallLoader,
    AfterInstallLoader,
    OnOutputZip
}

public sealed record HookContext(
    string Hook,
    byte[]? Data,
    Dictionary<string, object?> Meta)
{
    public static readonly IReadOnlySet<PluginHook> DataAwareHooks = new HashSet<PluginHook>
    {
        PluginHook.BeforeModpackProcess,
        PluginHook.AfterModpackProcess,
        PluginHook.OnOutputZip
    };
}

public sealed record HookResult(
    bool Success,
    byte[]? Data,
    object? Extra,
    string? Error)
{
    public static HookResult Ok(byte[]? data = null, object? extra = null)
        => new(true, data, extra, null);

    public static HookResult Fail(string error)
        => new(false, null, null, error);
}

public interface IPluginHookExecutor
{
    Task<HookResult> ExecuteAsync(PluginHook hook, HookContext context, CancellationToken ct);
}
