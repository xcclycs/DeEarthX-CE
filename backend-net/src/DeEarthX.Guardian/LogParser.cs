using System.Collections.Concurrent;
using System.Text.RegularExpressions;

namespace DeEarthX.Guardian;

public sealed class LogParser
{
    private readonly ConcurrentQueue<string> _buffer = new();
    private readonly object _bufferLock = new();
    private readonly List<string> _bufferList = new();

    private static readonly CrashPattern[] Patterns =
    {
        new("FATAL_ERROR", new Regex(@"FATAL\s+ERROR", RegexOptions.IgnoreCase), CrashSeverity.Fatal),
        new("FATAL_EXCEPTION", new Regex(@"^FATAL$", RegexOptions.IgnoreCase | RegexOptions.Multiline), CrashSeverity.Fatal),
        new("OUT_OF_MEMORY", new Regex(@"java\.lang\.OutOfMemoryError", RegexOptions.IgnoreCase), CrashSeverity.Fatal, "OOM"),
        new("STACK_OVERFLOW", new Regex(@"java\.lang\.StackOverflowError", RegexOptions.IgnoreCase), CrashSeverity.Fatal),
        new("TICK_EXCEPTION", new Regex(@"Exception in server tick loop", RegexOptions.IgnoreCase), CrashSeverity.Fatal, "TICK"),
        new("TICK_ERROR", new Regex(@"Exception in thread ""(Server thread|main)""", RegexOptions.IgnoreCase), CrashSeverity.Fatal),
        new("MOD_LOAD_ERROR", new Regex(@"The game crashed whilst (ticking block entity|ticking entity|initializing mod)", RegexOptions.IgnoreCase), CrashSeverity.Fatal, "MOD_CONFLICT"),
        new("MOD_CRASH", new Regex(@"Could not load mod", RegexOptions.IgnoreCase), CrashSeverity.Error, "MOD_CONFLICT"),
        new("MOD_MISSING", new Regex(@"Missing mod", RegexOptions.IgnoreCase), CrashSeverity.Error, "MOD_CONFLICT"),
        new("MOD_VERSION_CONFLICT", new Regex(@"Mod version conflict", RegexOptions.IgnoreCase), CrashSeverity.Error, "MOD_CONFLICT"),
        new("NEEDS_LANGUAGE_PROVIDER", new Regex(@"needs language provider", RegexOptions.IgnoreCase), CrashSeverity.Error, "MOD_CONFLICT"),
        new("FORGE_CRASH", new Regex(@"The game crashed whilst", RegexOptions.IgnoreCase), CrashSeverity.Fatal),
        new("FORGE_ERROR", new Regex(@"Encountered an unexpected exception", RegexOptions.IgnoreCase), CrashSeverity.Fatal),
        new("CONFIG_ERROR", new Regex(@"Error loading config", RegexOptions.IgnoreCase), CrashSeverity.Error, "CONFIG_ERROR"),
        new("INVALID_CONFIG", new Regex(@"Configuration error", RegexOptions.IgnoreCase), CrashSeverity.Error, "CONFIG_ERROR"),
        new("GENERAL_ERROR", new Regex(@"^Error:", RegexOptions.IgnoreCase | RegexOptions.Multiline), CrashSeverity.Error),
        new("EXCEPTION", new Regex(@"^\s*at\s+[\w.]+\([\w.]+(\.java:\d+)\)", RegexOptions.Multiline), CrashSeverity.Error),
        new("CAUSED_BY", new Regex(@"Caused by:", RegexOptions.IgnoreCase), CrashSeverity.Error),
        new("SERVER_STARTED", new Regex(@"Done \(.+\)!"), CrashSeverity.Info),
        new("SERVER_STOPPING", new Regex(@"Stopping server", RegexOptions.IgnoreCase), CrashSeverity.Info),
        new("SERVER_STOPPED", new Regex(@"Server stopped", RegexOptions.IgnoreCase), CrashSeverity.Info),
        new("UNCAUGHT_EXCEPTION", new Regex(@"Uncaught exception", RegexOptions.IgnoreCase), CrashSeverity.Fatal),
        new("THREAD_DUMP", new Regex(@"Full thread dump", RegexOptions.IgnoreCase), CrashSeverity.Warning),
        new("EULA", new Regex(@"(EULA|eula\.txt)", RegexOptions.IgnoreCase), CrashSeverity.Warning, "EULA")
    };

    private static readonly Regex[] EulaPatterns =
    {
        new Regex(@"You need to agree to the EULA", RegexOptions.IgnoreCase),
        new Regex(@"(EULA|eula\.txt)", RegexOptions.IgnoreCase)
    };

    private static readonly Regex[] CriticalPatterns =
    {
        new Regex(@"FATAL", RegexOptions.IgnoreCase),
        new Regex(@"Exception in server tick loop", RegexOptions.IgnoreCase),
        new Regex(@"java\.lang\.OutOfMemoryError", RegexOptions.IgnoreCase),
        new Regex(@"The game crashed whilst", RegexOptions.IgnoreCase),
        new Regex(@"Encountered an unexpected exception", RegexOptions.IgnoreCase),
        new Regex(@"Uncaught exception", RegexOptions.IgnoreCase),
        new Regex(@"A problem occurred running the Server launcher", RegexOptions.IgnoreCase),
        new Regex(@"Failed to start the minecraft server", RegexOptions.IgnoreCase),
        new Regex(@"LoadingFailedException", RegexOptions.IgnoreCase),
        new Regex(@"has failed to load correctly", RegexOptions.IgnoreCase)
    };

    private static readonly Regex TimestampRegex = new(@"^\[(\d{2}:\d{2}:\d{2})\]");

    public int MaxBufferSize { get; set; } = 1000;

    public ParsedLogLine ParseLine(string line, bool isStderr = false)
    {
        AddToBuffer(line);

        var matchedPatterns = new List<string>();
        var maxSeverity = isStderr ? CrashSeverity.Error : CrashSeverity.Info;

        foreach (var pattern in Patterns)
        {
            if (pattern.Regex.IsMatch(line))
            {
                matchedPatterns.Add(pattern.Name);
                if (SeverityWeight(pattern.Severity) > SeverityWeight(maxSeverity))
                {
                    maxSeverity = pattern.Severity;
                }
            }
        }

        return new ParsedLogLine
        {
            Raw = line,
            Timestamp = ExtractTimestamp(line),
            Level = MapSeverityToLevel(maxSeverity),
            Content = line,
            Severity = maxSeverity,
            IsError = isStderr || IsFatalMatch(matchedPatterns),
            MatchedPatterns = matchedPatterns
        };
    }

    public bool HasEula()
    {
        lock (_bufferLock)
        {
            foreach (var line in _bufferList)
            {
                foreach (var p in EulaPatterns)
                {
                    if (p.IsMatch(line)) return true;
                }
            }
        }
        return false;
    }

    public bool HasEulaPrompt()
    {
        lock (_bufferLock)
        {
            foreach (var line in _bufferList)
            {
                if (line.Contains("You need to agree to the EULA", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
        }
        return false;
    }

    public IReadOnlyList<string> GetBuffer()
    {
        lock (_bufferLock)
        {
            return _bufferList.ToArray();
        }
    }

    public IReadOnlyList<string> GetLastLines(int count)
    {
        lock (_bufferLock)
        {
            if (_bufferList.Count <= count)
            {
                return _bufferList.ToArray();
            }
            return _bufferList.GetRange(_bufferList.Count - count, count).ToArray();
        }
    }

    public void ClearBuffer()
    {
        lock (_bufferLock)
        {
            _bufferList.Clear();
            while (_buffer.TryDequeue(out _)) { }
        }
    }

    public bool IsCriticalError(string line)
    {
        foreach (var p in CriticalPatterns)
        {
            if (p.IsMatch(line)) return true;
        }
        return false;
    }

    public string? DetectCrashReport(string line)
    {
        var match = Regex.Match(line, @"crash-reports[/\\]([\w.-]+\.txt)", RegexOptions.IgnoreCase);
        return match.Success ? match.Value : null;
    }

    private void AddToBuffer(string line)
    {
        lock (_bufferLock)
        {
            _bufferList.Add(line);
            if (_bufferList.Count > MaxBufferSize)
            {
                _bufferList.RemoveRange(0, _bufferList.Count - MaxBufferSize);
            }
        }
    }

    private static string? ExtractTimestamp(string line)
    {
        var match = TimestampRegex.Match(line);
        return match.Success ? match.Groups[1].Value : null;
    }

    private static string MapSeverityToLevel(CrashSeverity severity) => severity switch
    {
        CrashSeverity.Fatal => "FATAL",
        CrashSeverity.Error => "ERROR",
        CrashSeverity.Warning => "WARN",
        _ => "INFO"
    };

    private static int SeverityWeight(CrashSeverity severity) => severity switch
    {
        CrashSeverity.Fatal => 4,
        CrashSeverity.Error => 3,
        CrashSeverity.Warning => 2,
        _ => 1
    };

    private static bool IsFatalMatch(List<string> matched)
    {
        return matched.Contains("FATAL_ERROR")
               || matched.Contains("FATAL_EXCEPTION")
               || matched.Contains("OUT_OF_MEMORY")
               || matched.Contains("TICK_EXCEPTION")
               || matched.Contains("FORGE_CRASH")
               || matched.Contains("UNCAUGHT_EXCEPTION")
               || matched.Contains("MOD_LOAD_ERROR");
    }

    private sealed record CrashPattern(string Name, Regex Regex, CrashSeverity Severity, string? Category = null);
}
