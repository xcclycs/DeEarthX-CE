using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace DeEarthX.Realtime;

internal sealed class SocketIOSession
{
    public string Sid { get; }
    public string SocketIoSid { get; }
    public DateTime LastPing { get; set; }

    private readonly ConcurrentQueue<string> _pollingBuffer = new();
    private readonly ConcurrentDictionary<WebSocket, SemaphoreSlim> _webSockets = new();
    private readonly SemaphoreSlim _pollSignal = new(0);

    public bool IsSocketConnected { get; set; }
    public bool HasWebSocket => !_webSockets.IsEmpty;

    public SocketIOSession(string sid, string socketIoSid)
    {
        Sid = sid;
        SocketIoSid = socketIoSid;
        LastPing = DateTime.UtcNow;
    }

    public async Task DeliverFrameAsync(string frame)
    {
        if (_webSockets.IsEmpty)
        {
            _pollingBuffer.Enqueue(frame);
            try { _pollSignal.Release(); } catch (SemaphoreFullException) { }
            return;
        }

        foreach (var kvp in _webSockets)
        {
            var ws = kvp.Key;
            var sem = kvp.Value;
            try
            {
                await sem.WaitAsync();
                try
                {
                    if (ws.State == WebSocketState.Open)
                    {
                        await ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(frame)),
                            WebSocketMessageType.Text, true, CancellationToken.None);
                    }
                }
                finally { sem.Release(); }
            }
            catch { }
        }
    }

    public async Task AttachWebSocketAsync(WebSocket ws)
    {
        var sem = new SemaphoreSlim(1, 1);
        _webSockets[ws] = sem;

        await sem.WaitAsync();
        try
        {
            while (_pollingBuffer.TryDequeue(out var buffered))
            {
                try
                {
                    if (ws.State == WebSocketState.Open)
                    {
                        await ws.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(buffered)),
                            WebSocketMessageType.Text, true, CancellationToken.None);
                    }
                }
                catch { break; }
            }
        }
        finally { sem.Release(); }
    }

    public void DetachWebSocket(WebSocket ws)
    {
        if (_webSockets.TryRemove(ws, out var sem))
        {
            sem.Dispose();
        }
    }

    public async Task<string?> PollAsync(int timeoutMs, CancellationToken ct)
    {
        if (_pollingBuffer.TryDequeue(out var immediate)) return immediate;

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeoutMs);
            await _pollSignal.WaitAsync(cts.Token);
        }
        catch (OperationCanceledException) { }

        return _pollingBuffer.TryDequeue(out var frame) ? frame : null;
    }
}
