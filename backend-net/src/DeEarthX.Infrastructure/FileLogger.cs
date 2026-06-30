using System.Collections.Concurrent;
using System.Text.Json;
using DeEarthX.Core;
using DeEarthX.Core.Abstractions;

namespace DeEarthX.Infrastructure;

public sealed class FileLogger : ILogService, IDisposable
{
    private readonly IAppDirectoryProvider _appDirectoryProvider;
    private readonly object _consoleLock = new();
    private readonly object _bufferLock = new();
    private readonly List<string> _buffer = new();
    private readonly Timer _flushTimer;
    private readonly string _logsDir;

    private const int BufferSize = 50;
    private static readonly TimeSpan FlushInterval = TimeSpan.FromSeconds(1);

    private string _currentDate = TodayString();
    private string _logFilePath;

    public FileLogger(IAppDirectoryProvider appDirectoryProvider)
    {
        _appDirectoryProvider = appDirectoryProvider;
        _logsDir = Path.Combine(appDirectoryProvider.GetAppDirectory(), "logs");
        try
        {
            Directory.CreateDirectory(_logsDir);
        }
        catch
        {
        }
        _logFilePath = Path.Combine(_logsDir, $"deearthx-{_currentDate}.log");
        _flushTimer = new Timer(_ => FlushSafe(), null, FlushInterval, FlushInterval);
    }

    public void Debug(string message, object? meta = null) => Log("debug", message, meta);
    public void Info(string message, object? meta = null) => Log("info", message, meta);
    public void Warn(string message, object? meta = null) => Log("warn", message, meta);
    public void Error(string message, object? meta = null) => Log("error", message, meta);

    private void Log(string level, string message, object? meta)
    {
        var timestamp = FormatTime();
        var metaStr = MetaToString(meta);

        WriteToFile(level, timestamp, message, metaStr);
        WriteToConsole(level, timestamp, message, metaStr);
    }

    private void WriteToFile(string level, string timestamp, string message, string metaStr)
    {
        var line = $"{timestamp} [{level.ToUpperInvariant()}] {message}{metaStr}{Environment.NewLine}";
        lock (_bufferLock)
        {
            _buffer.Add(line);
            if (_buffer.Count >= BufferSize)
            {
                FlushLocked();
            }
        }
    }

    private void WriteToConsole(string level, string timestamp, string message, string metaStr)
    {
        var (levelColor, msgColor) = LevelColors(level);
        lock (_consoleLock)
        {
            var prevForeground = Console.ForegroundColor;
            try
            {
                Console.ForegroundColor = ConsoleColor.DarkGray;
                Console.Write(timestamp);
                Console.Write(' ');

                Console.ForegroundColor = levelColor;
                Console.Write($"[{level.ToUpperInvariant()}]");

                Console.ForegroundColor = msgColor;
                Console.Write(' ');
                Console.Write(message);

                if (!string.IsNullOrEmpty(metaStr))
                {
                    Console.ForegroundColor = ConsoleColor.DarkGray;
                    Console.Write(metaStr);
                }

                Console.WriteLine();
            }
            finally
            {
                Console.ForegroundColor = prevForeground;
            }
        }
    }

    private static (ConsoleColor level, ConsoleColor msg) LevelColors(string level) => level switch
    {
        "debug" => (ConsoleColor.DarkGray, ConsoleColor.DarkGray),
        "info" => (ConsoleColor.Green, ConsoleColor.White),
        "warn" => (ConsoleColor.Yellow, ConsoleColor.Yellow),
        "error" => (ConsoleColor.Red, ConsoleColor.Red),
        _ => (ConsoleColor.White, ConsoleColor.White)
    };

    private static string FormatTime()
    {
        return DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss");
    }

    private static string MetaToString(object? meta)
    {
        if (meta is null)
        {
            return string.Empty;
        }

        if (meta is Exception ex)
        {
            return $" {ex.Message} {ex.StackTrace}";
        }

        try
        {
            return " " + JsonSerializer.Serialize(meta, DeEarthXJsonOptions.Default);
        }
        catch
        {
            return " " + meta.ToString();
        }
    }

    private static string TodayString() => DateTime.UtcNow.ToString("yyyy-MM-dd");

    private void UpdateLogFilePath()
    {
        var today = TodayString();
        if (today != _currentDate)
        {
            _currentDate = today;
            _logFilePath = Path.Combine(_logsDir, $"deearthx-{_currentDate}.log");
        }
    }

    private void FlushSafe()
    {
        try
        {
            lock (_bufferLock)
            {
                FlushLocked();
            }
        }
        catch
        {
        }
    }

    private void FlushLocked()
    {
        if (_buffer.Count == 0)
        {
            return;
        }

        UpdateLogFilePath();
        var snapshot = _buffer.ToArray();
        _buffer.Clear();

        try
        {
            File.AppendAllText(_logFilePath, string.Concat(snapshot));
        }
        catch
        {
            lock (_bufferLock)
            {
                for (var i = 0; i < snapshot.Length; i++)
                {
                    _buffer.Insert(i, snapshot[i]);
                }
            }
        }
    }

    public void Dispose()
    {
        try
        {
            _flushTimer.Change(Timeout.Infinite, Timeout.Infinite);
            _flushTimer.Dispose();
        }
        catch
        {
        }
        FlushSafe();
    }
}
