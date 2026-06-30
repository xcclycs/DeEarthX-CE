using System.Collections.Concurrent;
using System.Text.Json;
using DeEarthX.Core;
using DeEarthX.Core.Abstractions;

namespace DeEarthX.Guardian;

public sealed class RollbackManager
{
    private readonly ILogService _log;
    private readonly ConcurrentDictionary<string, RollbackCheckpoint> _records = new();
    private string _recordsDir = string.Empty;

    public RollbackManager(ILogService log)
    {
        _log = log;
    }

    public void Configure(string workDir)
    {
        _recordsDir = Path.Combine(workDir, ".rubbish", ".rollback");
        Directory.CreateDirectory(_recordsDir);
    }

    public RollbackCheckpoint CreateCheckpoint(string crashId)
    {
        var checkpoint = new RollbackCheckpoint
        {
            Id = $"rollback_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_{Guid.NewGuid():N}".Substring(0, 28),
            Timestamp = DateTime.UtcNow.ToString("o"),
            CrashId = crashId,
            Snapshots = new(),
            Reverted = false
        };
        _records[checkpoint.Id] = checkpoint;
        _log.Info($"创建回滚检查点: {checkpoint.Id} (崩溃: {crashId})");
        return checkpoint;
    }

    public void RecordSnapshot(string checkpointId, string originalPath, string backupPath, string type, string description)
    {
        if (!_records.TryGetValue(checkpointId, out var checkpoint))
        {
            _log.Warn($"检查点不存在: {checkpointId}");
            return;
        }
        checkpoint.Snapshots.Add(new RollbackSnapshot
        {
            OriginalPath = originalPath,
            BackupPath = backupPath,
            Type = type,
            Description = description
        });
        SaveRecord(checkpoint);
    }

    public async Task<RollbackRestoreResult> RestoreAsync(string checkpointId, CancellationToken ct = default)
    {
        if (!_records.TryGetValue(checkpointId, out var checkpoint))
        {
            return new RollbackRestoreResult { Success = false, Errors = new List<string> { $"检查点不存在: {checkpointId}" } };
        }
        if (checkpoint.Reverted)
        {
            return new RollbackRestoreResult { Success = false, Errors = new List<string> { "该检查点已被恢复过" } };
        }

        var errors = new List<string>();
        for (var i = checkpoint.Snapshots.Count - 1; i >= 0; i--)
        {
            try
            {
                await RestoreSnapshotAsync(checkpoint.Snapshots[i], ct);
            }
            catch (Exception ex)
            {
                errors.Add($"恢复失败: {checkpoint.Snapshots[i].Description} - {ex.Message}");
                _log.Error($"恢复失败: {checkpoint.Snapshots[i].Description}", ex);
            }
        }

        checkpoint.Reverted = true;
        SaveRecord(checkpoint);
        _log.Info($"检查点已恢复: {checkpointId} ({checkpoint.Snapshots.Count} 个操作, {errors.Count} 个错误)");
        return new RollbackRestoreResult { Success = errors.Count == 0, Errors = errors };
    }

    public List<CheckpointListItem> GetCheckpoints()
    {
        return _records.Values
            .Select(r => new CheckpointListItem
            {
                Id = r.Id,
                Timestamp = r.Timestamp,
                CrashId = r.CrashId,
                Reverted = r.Reverted,
                OperationCount = r.Snapshots.Count
            })
            .OrderByDescending(c => c.Timestamp)
            .ToList();
    }

    public RollbackCheckpoint? GetLatestRestorableCheckpoint()
    {
        return _records.Values
            .Where(r => !r.Reverted)
            .OrderByDescending(r => r.Timestamp)
            .FirstOrDefault();
    }

    public void LoadRecords()
    {
        if (string.IsNullOrEmpty(_recordsDir) || !Directory.Exists(_recordsDir)) return;
        foreach (var file in Directory.EnumerateFiles(_recordsDir, "*.json"))
        {
            try
            {
                var data = File.ReadAllText(file);
                var checkpoint = JsonSerializer.Deserialize<RollbackCheckpoint>(data, DeEarthXJsonOptions.Default);
                if (checkpoint is not null)
                {
                    _records[checkpoint.Id] = checkpoint;
                }
            }
            catch (Exception ex)
            {
                _log.Warn($"加载回滚记录失败: {Path.GetFileName(file)}", ex);
            }
        }
    }

    public void CleanOldRecords(int maxAgeDays = 7)
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-maxAgeDays);
        foreach (var kv in _records)
        {
            if (DateTimeOffset.TryParse(kv.Value.Timestamp, out var ts) && ts < cutoff)
            {
                _records.TryRemove(kv.Key, out _);
                var path = Path.Combine(_recordsDir, $"{kv.Key}.json");
                if (File.Exists(path)) File.Delete(path);
            }
        }
    }

    private Task RestoreSnapshotAsync(RollbackSnapshot snapshot, CancellationToken ct)
    {
        if (snapshot.Type is "move" or "delete")
        {
            if (File.Exists(snapshot.BackupPath))
            {
                var targetDir = Path.GetDirectoryName(snapshot.OriginalPath);
                if (!string.IsNullOrEmpty(targetDir)) Directory.CreateDirectory(targetDir);
                if (File.Exists(snapshot.OriginalPath)) File.Delete(snapshot.OriginalPath);
                File.Move(snapshot.BackupPath, snapshot.OriginalPath);
                _log.Info($"文件已恢复: {snapshot.BackupPath} -> {snapshot.OriginalPath}");
            }
        }
        else if (snapshot.Type is "edit" or "add_arg")
        {
            if (File.Exists(snapshot.BackupPath))
            {
                File.Copy(snapshot.BackupPath, snapshot.OriginalPath, overwrite: true);
                _log.Info($"配置已恢复: {snapshot.BackupPath} -> {snapshot.OriginalPath}");
            }
        }
        return Task.CompletedTask;
    }

    private void SaveRecord(RollbackCheckpoint checkpoint)
    {
        if (string.IsNullOrEmpty(_recordsDir)) return;
        try
        {
            var path = Path.Combine(_recordsDir, $"{checkpoint.Id}.json");
            File.WriteAllText(path, JsonSerializer.Serialize(checkpoint, DeEarthXJsonOptions.Default));
        }
        catch (Exception ex)
        {
            _log.Error("保存回滚记录失败", ex);
        }
    }
}
