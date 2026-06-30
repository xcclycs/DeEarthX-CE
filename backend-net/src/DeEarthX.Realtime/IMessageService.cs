using System.Threading.Tasks;

namespace DeEarthX.Realtime;

public interface IMessageService
{
    Task SendAsync(string eventName, object? payload);

    Task Finish(long startTime, long endTime);

    Task Unzip(string entryName, int total, int current);

    Task Download(int total, int index, string name);

    Task StatusChange();

    Task HandleError(string message);

    Task Info(string message);

    Task ServerInstallStart(string modpackName, string minecraftVersion, string loaderType, string loaderVersion);

    Task ServerInstallStep(string step, int stepIndex, int totalSteps, string? message = null);

    Task ServerInstallProgress(string step, int progress, string? message = null);

    Task ServerInstallComplete(string installPath, long duration);

    Task ServerInstallError(string error, string? step = null);

    Task FilterModsStart(int totalMods);

    Task FilterModsProgress(int current, int total, string modName);

    Task FilterModsComplete(int filteredCount, int movedCount, long duration);

    Task FilterModsError(string error);
}
