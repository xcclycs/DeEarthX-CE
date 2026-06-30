using System.Diagnostics;
using System.Text;
using DeEarthX.Core.Abstractions;
using DeEarthX.Infrastructure.TextEncoding;

namespace DeEarthX.Guardian;

public sealed class ProcessManager
{
    private readonly ILogService _log;
    private System.Diagnostics.Process? _process;
    private string _workDir = string.Empty;
    private string _javaCommand = string.Empty;
    private readonly ProcessInfo _processInfo = new();
    private Timer? _hangTimer;
    private long _lastOutputTimeTicks;
    private bool _isStopping;
    private DateTime _startTimeUtc;

    public int HangTimeoutMs { get; set; } = 30000;
    public int HangCheckIntervalMs { get; set; } = 5000;

    public event Action<string, bool>? OnOutput;
    public event Action<ProcessStatus, object?>? OnStatusChange;
    public event Action<int, string?>? OnCrash;
    public event Action<TimeSpan>? OnHang;

    public ProcessManager(ILogService log)
    {
        _log = log;
    }

    public void Configure(string workDir, string javaCommand)
    {
        _workDir = workDir;
        _javaCommand = javaCommand;
        _processInfo.WorkDir = workDir;
    }

    public Task<bool> StartAsync(string? command = null, IReadOnlyList<string>? args = null, CancellationToken ct = default)
    {
        return StartCoreAsync(command, args, ct);
    }

    private async Task<bool> StartCoreAsync(string? command, IReadOnlyList<string>? args, CancellationToken ct)
    {
        if (_process is not null && !_process.HasExited)
        {
            _log.Warn("服务端进程已在运行");
            return false;
        }

        string cmd;
        string[] cmdArgs;

        if (!string.IsNullOrEmpty(command))
        {
            cmd = command;
            cmdArgs = args?.ToArray() ?? Array.Empty<string>();
        }
        else if (!string.IsNullOrEmpty(_javaCommand))
        {
            var parsed = ParseCommandLine(_javaCommand);
            cmd = parsed[0];
            cmdArgs = parsed.Skip(1).ToArray();
        }
        else
        {
            var resolved = ResolveStartupScript();
            if (resolved is null)
            {
                _log.Error("未找到启动命令且 start.bat / run.bat 均不存在");
                return false;
            }
            cmd = resolved.Value.command;
            cmdArgs = resolved.Value.args;
        }

        _isStopping = false;
        _processInfo.Status = ProcessStatus.Starting;
        _processInfo.Command = cmd;
        _processInfo.Args = cmdArgs.ToList();
        _processInfo.StartTime = DateTime.UtcNow.ToString("o");
        _processInfo.EndTime = null;
        _processInfo.ExitCode = null;
        _processInfo.Signal = null;
        _lastOutputTimeTicks = DateTime.UtcNow.Ticks;
        _startTimeUtc = DateTime.UtcNow;

        OnStatusChange?.Invoke(ProcessStatus.Starting, null);

        try
        {
            _log.Info($"启动服务端进程: {cmd} {string.Join(' ', cmdArgs)}");
            _log.Info($"工作目录: {_workDir}");

            var psi = new ProcessStartInfo
            {
                FileName = cmd,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                StandardOutputEncoding = ResolveEncoding(),
                StandardErrorEncoding = ResolveEncoding()
            };

            foreach (var a in cmdArgs)
            {
                psi.ArgumentList.Add(a);
            }

            if (!string.IsNullOrEmpty(_workDir) && Directory.Exists(_workDir))
            {
                psi.WorkingDirectory = _workDir;
            }

            _process = new System.Diagnostics.Process { StartInfo = psi, EnableRaisingEvents = true };

            _process.OutputDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                _lastOutputTimeTicks = DateTime.UtcNow.Ticks;
                OnOutput?.Invoke(e.Data.Trim(), false);
            };
            _process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data is null) return;
                _lastOutputTimeTicks = DateTime.UtcNow.Ticks;
                OnOutput?.Invoke(e.Data.Trim(), true);
            };
            _process.Exited += (_, _) => HandleProcessExit();

            if (!_process.Start())
            {
                throw new InvalidOperationException("无法启动进程");
            }

            _processInfo.Pid = _process.Id;
            _processInfo.Status = ProcessStatus.Running;
            OnStatusChange?.Invoke(ProcessStatus.Running, new { pid = _process.Id });

            _process.BeginOutputReadLine();
            _process.BeginErrorReadLine();

            StartHangDetector();
            return true;
        }
        catch (Exception ex)
        {
            _log.Error("启动服务端进程失败", ex);
            _processInfo.Status = ProcessStatus.Crashed;
            OnStatusChange?.Invoke(ProcessStatus.Crashed, new { error = ex.Message });
            return false;
        }
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        if (_process is null) return;

        _isStopping = true;
        StopHangDetector();
        _log.Info("正在停止服务端进程...");
        OnOutput?.Invoke("正在停止服务端...", false);

        try
        {
            if (!_process.HasExited)
            {
                try
                {
                    await _process.StandardInput.WriteLineAsync("stop".AsMemory(), ct);
                    await _process.StandardInput.FlushAsync(ct);
                    _log.Info("已发送 stop 命令，等待服务端关闭...");
                }
                catch (Exception ex)
                {
                    _log.Warn("发送 stop 命令失败，将强制终止", ex);
                }
            }

            var gracefulTimeoutMs = 15000;
            var sw = Stopwatch.StartNew();
            while (_process is not null && !_process.HasExited && sw.ElapsedMilliseconds < gracefulTimeoutMs)
            {
                await Task.Delay(500, ct);
            }

            if (_process is not null && !_process.HasExited)
            {
                _log.Warn("服务端未能在指定时间内关闭，强制终止");
                ForceKillTree();
            }
        }
        catch (OperationCanceledException)
        {
            ForceKillTree();
        }

        _process = null;
        _processInfo.Status = ProcessStatus.Stopped;
        _processInfo.EndTime = DateTime.UtcNow.ToString("o");
        OnStatusChange?.Invoke(ProcessStatus.Stopped, null);
        _log.Info("服务端进程已停止");
    }

    public async Task ForceStopAsync(CancellationToken ct = default)
    {
        if (_process is null) return;
        _isStopping = true;
        StopHangDetector();
        _log.Info("强制终止服务端进程");
        ForceKillTree();
        await Task.Delay(2000, ct);
        _process = null;
        _processInfo.Status = ProcessStatus.Stopped;
        _processInfo.EndTime = DateTime.UtcNow.ToString("o");
        OnStatusChange?.Invoke(ProcessStatus.Stopped, null);
    }

    public bool SendCommand(string command)
    {
        if (_process is null || _process.HasExited) return false;
        try
        {
            _process.StandardInput.WriteLine(command);
            _process.StandardInput.Flush();
            return true;
        }
        catch (Exception ex)
        {
            _log.Error("发送命令失败", ex);
            return false;
        }
    }

    public ProcessInfo GetProcessInfo()
    {
        return new ProcessInfo
        {
            Pid = _processInfo.Pid,
            Status = _processInfo.Status,
            StartTime = _processInfo.StartTime,
            EndTime = _processInfo.EndTime,
            ExitCode = _processInfo.ExitCode,
            Signal = _processInfo.Signal,
            Command = _processInfo.Command,
            Args = _processInfo.Args.ToList(),
            WorkDir = _processInfo.WorkDir
        };
    }

    public bool IsRunning()
    {
        return _process is not null && !_process.HasExited && _processInfo.Status == ProcessStatus.Running;
    }

    public ProcessMetrics? GetMetrics(int restartCount = 0)
    {
        if (_process is null || _process.HasExited) return null;
        return new ProcessMetrics
        {
            Pid = _process.Id,
            UptimeSeconds = (DateTime.UtcNow - _startTimeUtc).TotalSeconds,
            RestartCount = restartCount,
            Status = _processInfo.Status
        };
    }

    private void HandleProcessExit()
    {
        if (_isStopping) return;
        StopHangDetector();

        var proc = _process;
        if (proc is null) return;

        int exitCode;
        try { exitCode = proc.ExitCode; }
        catch { exitCode = -1; }

        _processInfo.Status = ProcessStatus.Crashed;
        _processInfo.EndTime = DateTime.UtcNow.ToString("o");
        _processInfo.ExitCode = exitCode;

        _log.Info($"服务端进程退出: exitCode={exitCode}");
        OnOutput?.Invoke($"服务端进程已退出 (退出码: {exitCode})", false);
        OnStatusChange?.Invoke(ProcessStatus.Crashed, new { exitCode });
        OnCrash?.Invoke(exitCode, null);
    }

    private void StartHangDetector()
    {
        StopHangDetector();
        _hangTimer = new Timer(_ =>
        {
            if (_process is null || _process.HasExited) return;
            var silenceMs = (DateTime.UtcNow.Ticks - _lastOutputTimeTicks) / TimeSpan.TicksPerMillisecond;
            if (silenceMs > HangTimeoutMs)
            {
                var silence = TimeSpan.FromMilliseconds(silenceMs);
                _log.Warn($"检测到服务端可能卡死（{silence.TotalSeconds:F0}s 无输出）");
                _processInfo.Status = ProcessStatus.Hanging;
                OnStatusChange?.Invoke(ProcessStatus.Hanging, new { silenceDurationMs = silenceMs });
                OnHang?.Invoke(silence);
            }
        }, null, HangCheckIntervalMs, HangCheckIntervalMs);
    }

    private void StopHangDetector()
    {
        if (_hangTimer is not null)
        {
            try
            {
                _hangTimer.Change(Timeout.Infinite, Timeout.Infinite);
                _hangTimer.Dispose();
            }
            catch { }
            _hangTimer = null;
        }
    }

    private void ForceKillTree()
    {
        var proc = _process;
        if (proc is null) return;
        try
        {
            if (!proc.HasExited)
            {
                proc.Kill(entireProcessTree: true);
            }
        }
        catch (Exception ex)
        {
            _log.Warn("强制终止进程树失败", ex);
            try { if (!proc.HasExited) proc.Kill(); } catch { }
        }
    }

    private (string command, string[] args)? ResolveStartupScript()
    {
        foreach (var name in new[] { "start.bat", "run.bat", "start.sh" })
        {
            var batPath = Path.Combine(_workDir, name);
            if (File.Exists(batPath))
            {
                return ("cmd.exe", new[] { "/c", batPath });
            }
        }
        return null;
    }

    private static string[] ParseCommandLine(string cmd)
    {
        var args = new List<string>();
        var regex = new System.Text.RegularExpressions.Regex(@"""([^""]*)""|(\S+)");
        foreach (System.Text.RegularExpressions.Match m in regex.Matches(cmd))
        {
            args.Add(m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value);
        }
        return args.Count == 0 ? new[] { cmd } : args.ToArray();
    }

    private static Encoding ResolveEncoding()
    {
        if (EncodingInitializer.TryGetEncoding(EncodingInitializer.GbkEncodingName, out var gbk))
        {
            return gbk;
        }
        return Encoding.UTF8;
    }
}
