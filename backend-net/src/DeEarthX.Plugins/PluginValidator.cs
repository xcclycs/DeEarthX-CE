namespace DeEarthX.Plugins;

public sealed class PluginValidator
{
    public PluginValidationResult Validate(PluginManifest manifest)
    {
        var errors = new List<string>();
        var warnings = new List<string>();

        if (string.IsNullOrWhiteSpace(manifest.Id))
            errors.Add("插件 ID 不能为空");
        if (string.IsNullOrWhiteSpace(manifest.Name))
            errors.Add("插件名称不能为空");
        if (string.IsNullOrWhiteSpace(manifest.Version))
            errors.Add("插件版本不能为空");
        if (string.IsNullOrWhiteSpace(manifest.Author))
            warnings.Add("建议填写插件作者");

        if (manifest.Id?.Length > 50)
            errors.Add("插件 ID 长度不能超过 50 个字符");
        if (manifest.Name?.Length > 100)
            errors.Add("插件名称长度不能超过 100 个字符");
        if (manifest.Version?.Contains(' ') == true)
            errors.Add("插件版本不能包含空格");

        if (manifest.Dependencies?.Count > 50)
            warnings.Add("插件依赖过多，建议控制在 50 个以内");

        if (manifest.Permissions != null)
        {
            foreach (var perm in manifest.Permissions)
            {
                if (string.IsNullOrWhiteSpace(perm.Key) || string.IsNullOrWhiteSpace(perm.Value))
                    errors.Add($"权限声明不完整: {perm.Key}");
            }
        }

        if (manifest.FilterStrategies != null)
        {
            foreach (var fs in manifest.FilterStrategies)
            {
                if (string.IsNullOrWhiteSpace(fs.Name))
                    errors.Add("过滤策略名称不能为空");
            }
        }

        return new PluginValidationResult
        {
            IsValid = errors.Count == 0,
            Errors = errors,
            Warnings = warnings
        };
    }

    public PluginValidationResult ValidateConfig(PluginManifest manifest, PluginConfig config)
    {
        var errors = new List<string>();
        var warnings = new List<string>();

        if (config.Id != manifest.Id)
            errors.Add("配置 ID 与插件清单 ID 不匹配");

        if (manifest.DefaultConfig is System.Text.Json.Nodes.JsonObject dc)
        {
            foreach (var kv in dc)
            {
                if (!config.Settings.ContainsKey(kv.Key))
                    warnings.Add($"配置中缺少默认设置项: {kv.Key}");
            }
        }

        return new PluginValidationResult
        {
            IsValid = errors.Count == 0,
            Errors = errors,
            Warnings = warnings
        };
    }
}

public sealed class PluginValidationResult
{
    public bool IsValid { get; set; }
    public List<string> Errors { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
}