using System;
using System.Threading.Tasks;
using DeEarthX.Core.Abstractions;

namespace DeEarthX.Realtime;

public class GuardianBroadcaster : IGuardianBroadcaster
{
    private readonly ISocketIOServer _server;
    private readonly ILogService _log;

    public GuardianBroadcaster(ISocketIOServer server, ILogService log)
    {
        _server = server;
        _log = log;
    }

    public async Task BroadcastAsync(string type, object data)
    {
        try
        {
            await _server.EmitAsync(type, data);
        }
        catch (Exception ex)
        {
            _log.Error($"发送 Guardian 事件失败: {type}", ex);
        }
    }
}
