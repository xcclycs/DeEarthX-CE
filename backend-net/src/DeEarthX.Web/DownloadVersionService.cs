using System.Collections.Concurrent;
using System.Text.Json;
using DeEarthX.Core;
using DeEarthX.Infrastructure.Http;

namespace DeEarthX.Web;

public sealed class DownloadVersionService
{
    private readonly IDeEarthXHttpService _http;
    private readonly ConcurrentDictionary<string, object> _cache = new();

    public DownloadVersionService(IDeEarthXHttpService http)
    {
        _http = http;
    }

    public async Task<object> GetMinecraftVersionsAsync(CancellationToken ct = default)
    {
        const string key = "minecraft-versions";
        if (_cache.TryGetValue(key, out var cached)) return cached;

        var url = "https://bmclapi2.bangbang93.com/mc/game/version_manifest.json";
        var data = await _http.GetJsonAsync<JsonElement>(url, ct);
        var versions = new List<object>();
        if (data.TryGetProperty("versions", out var vers))
        {
            foreach (var v in vers.EnumerateArray())
            {
                var id = v.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                var type = v.TryGetProperty("type", out var typeEl) ? typeEl.GetString() : null;
                if (id is not null)
                {
                    versions.Add(new { id, type });
                }
            }
        }
        var result = new { versions };
        _cache[key] = result;
        return result;
    }

    public async Task<object> GetForgePromosAsync(CancellationToken ct = default)
    {
        const string key = "forge-promos";
        if (_cache.TryGetValue(key, out var cached)) return cached;

        var url = "https://bmclapi2.bangbang93.com/forge/promos";
        var data = await _http.GetJsonAsync<JsonElement>(url, ct);
        var promos = new Dictionary<string, Dictionary<string, string?>>();
        if (data.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in data.EnumerateArray())
            {
                string? mcversion = null;
                if (entry.TryGetProperty("build", out var build))
                {
                    if (build.TryGetProperty("mcversion", out var mcv)) mcversion = mcv.GetString();
                    if (build.TryGetProperty("version", out var ver) && mcversion is not null)
                    {
                        var version = ver.GetString();
                        var name = entry.TryGetProperty("name", out var nameEl) ? nameEl.GetString() : null;
                        if (mcversion is null || version is null) continue;
                        if (!promos.ContainsKey(mcversion)) promos[mcversion] = new Dictionary<string, string?>();
                        if (name is not null && name.EndsWith("-latest")) promos[mcversion]["latest"] = version;
                        else if (name is not null && name.EndsWith("-recommended")) promos[mcversion]["recommended"] = version;
                    }
                }
            }
        }
        _cache[key] = promos;
        return promos;
    }

    public async Task<object> GetForgeVersionsAsync(string mcver, CancellationToken ct = default)
    {
        var key = $"forge-versions:{mcver}";
        if (_cache.TryGetValue(key, out var cached)) return cached;

        var url = $"https://bmclapi2.bangbang93.com/forge/minecraft/{mcver}";
        var data = await _http.GetJsonAsync<JsonElement>(url, ct);
        var versions = new List<object>();
        if (data.ValueKind == JsonValueKind.Array)
        {
            foreach (var v in data.EnumerateArray())
            {
                var version = v.TryGetProperty("version", out var ve) ? ve.GetString() : null;
                var mcversion = v.TryGetProperty("mcversion", out var mc) ? mc.GetString() : null;
                string? hash = null;
                if (v.TryGetProperty("files", out var files) && files.ValueKind == JsonValueKind.Array)
                {
                    foreach (var f in files.EnumerateArray())
                    {
                        var category = f.TryGetProperty("category", out var c) ? c.GetString() : null;
                        var format = f.TryGetProperty("format", out var fmt) ? fmt.GetString() : null;
                        if (category == "installer" && format == "jar")
                        {
                            hash = f.TryGetProperty("hash", out var h) ? h.GetString() : null;
                            break;
                        }
                    }
                }
                if (version is not null && mcversion is not null)
                {
                    versions.Add(new { version, mcversion, hash });
                }
            }
        }
        _cache[key] = versions;
        return versions;
    }

    public async Task<object> GetNeoForgeVersionsAsync(string mcver, CancellationToken ct = default)
    {
        var key = $"neoforge-versions:{mcver}";
        if (_cache.TryGetValue(key, out var cached)) return cached;

        var url = $"https://bmclapi2.bangbang93.com/neoforge/list/{mcver}";
        var data = await _http.GetJsonAsync<JsonElement>(url, ct);
        var versions = new List<object>();
        if (data.ValueKind == JsonValueKind.Array)
        {
            var arr = data.EnumerateArray().ToList();
            for (var i = 0; i < arr.Count; i++)
            {
                var v = arr[i];
                var version = v.TryGetProperty("version", out var ve) ? ve.GetString() : null;
                var mcversion = v.TryGetProperty("mcversion", out var mc) ? mc.GetString() : null;
                var installerPath = v.TryGetProperty("installerPath", out var ip) ? ip.GetString() : null;
                var latest = i == arr.Count - 1;
                if (version is not null && mcversion is not null)
                {
                    versions.Add(new { version, mcversion, installerPath, latest });
                }
            }
        }
        _cache[key] = versions;
        return versions;
    }

    public async Task<object> GetFabricVersionsAsync(string mcver, CancellationToken ct = default)
    {
        var key = $"fabric-versions:{mcver}";
        if (_cache.TryGetValue(key, out var cached)) return cached;

        var url = $"https://meta.fabricmc.net/v1/versions/loader/{mcver}";
        var data = await _http.GetJsonAsync<JsonElement>(url, ct);
        var versions = new List<dynamic>();
        if (data.ValueKind == JsonValueKind.Array)
        {
            foreach (var v in data.EnumerateArray())
            {
                if (v.TryGetProperty("loader", out var loader))
                {
                    var version = loader.TryGetProperty("version", out var ve) ? ve.GetString() : null;
                    var stable = loader.TryGetProperty("stable", out var s) && s.GetBoolean();
                    if (version is not null)
                    {
                        versions.Add(new { version, stable });
                    }
                }
            }
        }
        var sorted = versions.OrderByDescending(x => x.stable ? 1 : 0).ToList();
        _cache[key] = sorted;
        return sorted;
    }
}
