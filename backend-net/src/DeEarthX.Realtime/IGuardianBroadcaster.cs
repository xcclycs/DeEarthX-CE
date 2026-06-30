using System.Threading.Tasks;

namespace DeEarthX.Realtime;

public interface IGuardianBroadcaster
{
    Task BroadcastAsync(string type, object data);
}
