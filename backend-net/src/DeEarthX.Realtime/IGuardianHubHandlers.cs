using System.Threading.Tasks;

namespace DeEarthX.Realtime;

public interface IGuardianHubHandlers
{
    Task StartAsync(object data);

    Task StopAsync();

    Task TestAiAsync();

    Task ApproveAsync(object data);

    Task RejectAsync(object data);

    Task RollbackAsync();

    Task RestartAsync();

    Task CommandAsync(object data);

    Task GetAiConversationAsync();

    Task ResetAiConversationAsync();

    Task UpdateConfigAsync(object data);
}
