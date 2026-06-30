using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using DeEarthX.Core;

namespace DeEarthX.Infrastructure.Http;

public interface IDeEarthXHttpService
{
    Task<string> GetStringAsync(string url, CancellationToken ct = default);

    Task<T> GetJsonAsync<T>(string url, CancellationToken ct = default);

    Task<Stream> GetStreamAsync(string url, CancellationToken ct = default);

    Task<HttpResponseMessage> GetAsync(string url, CancellationToken ct = default);

    Task<T> PostJsonAsync<T>(string url, object body, CancellationToken ct = default);
}

public sealed class DeEarthXHttpService : IDeEarthXHttpService
{
    public const string UserAgent = "DeEarthX";

    private readonly HttpClient _httpClient;

    public DeEarthXHttpService(HttpClient httpClient)
    {
        _httpClient = httpClient;
        Configure(_httpClient);
    }

    public static void Configure(HttpClient client)
    {
        if (!client.DefaultRequestHeaders.Contains("User-Agent"))
        {
            client.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
        }
        client.Timeout = TimeSpan.FromMinutes(2);
        client.DefaultRequestHeaders.Accept.Clear();
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    public Task<string> GetStringAsync(string url, CancellationToken ct = default)
    {
        return _httpClient.GetStringAsync(url, ct);
    }

    public async Task<T> GetJsonAsync<T>(string url, CancellationToken ct = default)
    {
        await using var stream = await _httpClient.GetStreamAsync(url, ct).ConfigureAwait(false);
        return (await JsonSerializer.DeserializeAsync<T>(stream, DeEarthXJsonOptions.Default, ct).ConfigureAwait(false))!;
    }

    public Task<Stream> GetStreamAsync(string url, CancellationToken ct = default)
    {
        return _httpClient.GetStreamAsync(url, ct);
    }

    public Task<HttpResponseMessage> GetAsync(string url, CancellationToken ct = default)
    {
        return _httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
    }

    public async Task<T> PostJsonAsync<T>(string url, object body, CancellationToken ct = default)
    {
        using var content = new StringContent(JsonSerializer.Serialize(body, DeEarthXJsonOptions.Default), Encoding.UTF8);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        using var response = await _httpClient.PostAsync(url, content, ct).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        return (await JsonSerializer.DeserializeAsync<T>(stream, DeEarthXJsonOptions.Default, ct).ConfigureAwait(false))!;
    }
}
