/**
 * RollbackManager - 回滚管理器
 * 记录每一次文件变动的"前状态"，支持一键恢复
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { RollbackCheckpoint, RollbackOperation, RepairAction } from './types.js';
import { logger } from '../utils/logger.js';

interface RollbackRecord {
  checkpoint: RollbackCheckpoint;
  snapshots: Array<{
    originalPath: string;
    backupPath: string;
    type: 'move' | 'delete' | 'edit' | 'add_arg';
    description: string;
  }>;
}

export class RollbackManager {
  private readonly workDir: string;
  private readonly recordsDir: string;
  private records: Map<string, RollbackRecord> = new Map();

  constructor(workDir: string) {
    this.workDir = workDir;
    this.recordsDir = path.join(workDir, '.rubbish', '.rollback');
    
    // 确保记录目录存在
    if (!fs.existsSync(this.recordsDir)) {
      fs.mkdirSync(this.recordsDir, { recursive: true });
    }
  }

  /**
   * 创建新的检查点
   */
  public createCheckpoint(crashId: string): RollbackCheckpoint {
    const checkpoint: RollbackCheckpoint = {
      id: `rollback_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      crashId,
      operations: [],
      reverted: false
    };

    this.records.set(checkpoint.id, {
      checkpoint,
      snapshots: []
    });

    logger.info(`创建回滚检查点: ${checkpoint.id} (崩溃: ${crashId})`);
    return checkpoint;
  }

  /**
   * 记录操作前状态
   */
  public recordSnapshot(
    checkpointId: string,
    originalPath: string,
    backupPath: string,
    type: 'move' | 'delete' | 'edit' | 'add_arg',
    description: string
  ): void {
    const record = this.records.get(checkpointId);
    if (!record) {
      logger.warn(`检查点不存在: ${checkpointId}`);
      return;
    }

    record.snapshots.push({
      originalPath,
      backupPath,
      type,
      description
    });

    record.checkpoint.operations.push({
      type,
      description,
      undo: async () => {} // 占位
    });

    // 持久化记录到磁盘
    this.saveRecord(checkpointId);
    
    logger.debug(`记录快照: ${type} ${originalPath} -> ${backupPath}`);
  }

  /**
   * 恢复到指定检查点
   */
  public async restore(checkpointId: string): Promise<{ success: boolean; errors: string[] }> {
    const record = this.records.get(checkpointId);
    if (!record) {
      return { success: false, errors: [`检查点不存在: ${checkpointId}`] };
    }

    if (record.checkpoint.reverted) {
      return { success: false, errors: ['该检查点已被恢复过'] };
    }

    const errors: string[] = [];

    // 逆序恢复（后操作先恢复）
    const snapshots = [...record.snapshots].reverse();
    
    for (const snapshot of snapshots) {
      try {
        await this.restoreSnapshot(snapshot);
      } catch (err) {
        const errorMsg = `恢复失败: ${snapshot.description} - ${(err as Error).message}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    record.checkpoint.reverted = true;
    this.saveRecord(checkpointId);

    logger.info(`检查点已恢复: ${checkpointId} (${snapshots.length} 个操作, ${errors.length} 个错误)`);

    return {
      success: errors.length === 0,
      errors
    };
  }

  /**
   * 恢复单个快照
   */
  private async restoreSnapshot(snapshot: { originalPath: string; backupPath: string; type: string }): Promise<void> {
    const { originalPath, backupPath, type } = snapshot;

    switch (type) {
      case 'move':
      case 'delete':
        // 从备份恢复原始位置
        if (fs.existsSync(backupPath)) {
          // 确保目标目录存在
          const targetDir = path.dirname(originalPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          await fs.promises.rename(backupPath, originalPath);
          logger.info(`文件已恢复: ${backupPath} -> ${originalPath}`);
        }
        break;

      case 'edit':
      case 'add_arg':
        // 从 .bak 文件恢复
        if (fs.existsSync(backupPath)) {
          await fs.promises.copyFile(backupPath, originalPath);
          logger.info(`配置已恢复: ${backupPath} -> ${originalPath}`);
        }
        break;
    }
  }

  /**
   * 获取检查点列表
   */
  public getCheckpoints(): Array<{ id: string; timestamp: string; crashId: string; reverted: boolean; operationCount: number }> {
    const result: Array<{ id: string; timestamp: string; crashId: string; reverted: boolean; operationCount: number }> = [];
    
    for (const [id, record] of this.records) {
      result.push({
        id,
        timestamp: record.checkpoint.timestamp,
        crashId: record.checkpoint.crashId,
        reverted: record.checkpoint.reverted,
        operationCount: record.snapshots.length
      });
    }

    return result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * 获取最新可恢复的检查点
   */
  public getLatestRestorableCheckpoint(): RollbackCheckpoint | null {
    for (const [, record] of this.records) {
      if (!record.checkpoint.reverted) {
        return record.checkpoint;
      }
    }
    return null;
  }

  /**
   * 持久化记录到磁盘
   */
  private saveRecord(checkpointId: string): void {
    try {
      const record = this.records.get(checkpointId);
      if (!record) return;

      // 只保存元信息，不保存 undo 函数
      const serializable = {
        id: record.checkpoint.id,
        timestamp: record.checkpoint.timestamp,
        crashId: record.checkpoint.crashId,
        reverted: record.checkpoint.reverted,
        snapshots: record.snapshots.map(s => ({
          originalPath: s.originalPath,
          backupPath: s.backupPath,
          type: s.type,
          description: s.description
        }))
      };

      const recordPath = path.join(this.recordsDir, `${checkpointId}.json`);
      fs.writeFileSync(recordPath, JSON.stringify(serializable, null, 2));
    } catch (err) {
      logger.error('保存回滚记录失败', err as Error);
    }
  }

  /**
   * 加载持久化的记录
   */
  public loadRecords(): void {
    try {
      if (!fs.existsSync(this.recordsDir)) return;

      const files = fs.readdirSync(this.recordsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(this.recordsDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          
          const checkpoint: RollbackCheckpoint = {
            id: data.id,
            timestamp: data.timestamp,
            crashId: data.crashId,
            operations: data.snapshots.map((s: any) => ({
              type: s.type,
              description: s.description,
              undo: async () => {}
            })),
            reverted: data.reverted
          };

          this.records.set(data.id, {
            checkpoint,
            snapshots: data.snapshots
          });
        } catch (err) {
          logger.warn(`加载回滚记录失败: ${file}`);
        }
      }
    } catch (err) {
      logger.error('加载回滚记录目录失败', err as Error);
    }
  }

  /**
   * 清理过期记录
   */
  public cleanOldRecords(maxAgeDays: number = 7): void {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    
    for (const [id, record] of this.records) {
      if (new Date(record.checkpoint.timestamp).getTime() < cutoff) {
        this.records.delete(id);
        const recordPath = path.join(this.recordsDir, `${id}.json`);
        if (fs.existsSync(recordPath)) {
          fs.unlinkSync(recordPath);
        }
      }
    }
  }
}
