/**
 * SafeExecutor - 安全沙盒执行器
 * 解析 AI 返回的操作列表，校验是否在白名单内、是否涉及文件路径越权
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { RepairAction, ActionRiskLevel } from './types.js';
import { logger } from '../utils/logger.js';

export interface ExecutionResult {
  actionId: string;
  success: boolean;
  error?: string;
  snapshot?: string; // 回滚快照路径
}

export class SafeExecutor {
  private readonly workDir: string;
  private readonly rubbishDir: string;
  private readonly trustedDomains: string[] = [
    'modrinth.com',
    'curseforge.com',
    'bmclapi.com',
    'mcim.cn',
    'github.com'
  ];

  constructor(workDir: string) {
    this.workDir = path.resolve(workDir);
    this.rubbishDir = path.join(this.workDir, '.rubbish');
    
    // 确保 rubbish 目录存在
    if (!fs.existsSync(this.rubbishDir)) {
      fs.mkdirSync(this.rubbishDir, { recursive: true });
    }
  }

  /**
   * 检查路径是否安全（在 workDir 范围内）
   */
  public isPathSafe(targetPath: string): { safe: boolean; resolved: string; reason?: string } {
    const resolved = path.resolve(this.workDir, targetPath);
    
    // 规范化路径以防止 `../` 逃逸
    const normalizedTarget = path.normalize(resolved);
    const normalizedWorkDir = path.normalize(this.workDir);
    
    if (!normalizedTarget.startsWith(normalizedWorkDir + path.sep) && 
        normalizedTarget !== normalizedWorkDir) {
      return {
        safe: false,
        resolved: normalizedTarget,
        reason: `路径越权: ${normalizedTarget} 不在工作目录 ${normalizedWorkDir} 内`
      };
    }

    return { safe: true, resolved: normalizedTarget };
  }

  /**
   * 执行单个修复操作
   */
  public async executeAction(action: RepairAction): Promise<ExecutionResult> {
    try {
      // complete 操作无需路径检查
      if (action.type === 'complete') {
        logger.info(`✅ 服务端运行完成: ${action.reason || '服务端已完成运行'}`);
        return { actionId: action.id, success: true, error: '' };
      }

      // 前置安全检查
      const pathCheck = this.isPathSafe(action.target);
      if (!pathCheck.safe) {
        return {
          actionId: action.id,
          success: false,
          error: pathCheck.reason || '路径安全检查失败'
        };
      }

      switch (action.type) {
        case 'move_file':
        case 'remove_mod':
          return await this.executeMove(pathCheck.resolved, action);
        case 'delete_file':
          return await this.executeDelete(pathCheck.resolved, action);
        case 'edit_config':
          return await this.executeEditConfig(pathCheck.resolved, action);
        case 'add_jvm_arg':
          return await this.executeAddJvmArg(action);
        case 'download_file':
          return {
            actionId: action.id,
            success: false,
            error: '下载文件操作需要用户手动确认并验证来源'
          };
        default:
          return {
            actionId: action.id,
            success: false,
            error: `不支持的操作类型: ${action.type}`
          };
      }
    } catch (err) {
      const error = err as Error;
      logger.error(`执行操作失败: ${action.type} ${action.target}`, error);
      return {
        actionId: action.id,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 执行文件移动（备份到 .rubbish/）
   */
  private async executeMove(resolvedPath: string, action: RepairAction): Promise<ExecutionResult> {
    if (!fs.existsSync(resolvedPath)) {
      return {
        actionId: action.id,
        success: false,
        error: `文件不存在: ${resolvedPath}`
      };
    }

    // 确定目标路径
    let destPath: string;
    if (action.destination) {
      const destCheck = this.isPathSafe(action.destination);
      if (!destCheck.safe) {
        return {
          actionId: action.id,
          success: false,
          error: destCheck.reason || '目标路径不安全'
        };
      }
      destPath = destCheck.resolved;
    } else {
      // 默认移动到 .rubbish/
      const fileName = path.basename(resolvedPath);
      const timestamp = Date.now();
      destPath = path.join(this.rubbishDir, `${timestamp}_${fileName}`);
    }

    // 确保目标目录存在
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // 执行移动
    await fs.promises.rename(resolvedPath, destPath);
    
    logger.info(`文件已移动: ${resolvedPath} -> ${destPath} (原因: ${action.reason})`);
    
    return {
      actionId: action.id,
      success: true,
      snapshot: destPath
    };
  }

  /**
   * 执行文件删除（先备份）
   */
  private async executeDelete(resolvedPath: string, action: RepairAction): Promise<ExecutionResult> {
    if (!fs.existsSync(resolvedPath)) {
      return {
        actionId: action.id,
        success: false,
        error: `文件不存在: ${resolvedPath}`
      };
    }

    // 先备份到 .rubbish/
    const fileName = path.basename(resolvedPath);
    const timestamp = Date.now();
    const backupPath = path.join(this.rubbishDir, `${timestamp}_DELETE_${fileName}`);
    
    await fs.promises.rename(resolvedPath, backupPath);
    
    logger.info(`文件已删除（备份）: ${resolvedPath} -> ${backupPath} (原因: ${action.reason})`);
    
    return {
      actionId: action.id,
      success: true,
      snapshot: backupPath
    };
  }

  /**
   * 执行配置文件修改
   */
  private async executeEditConfig(resolvedPath: string, action: RepairAction): Promise<ExecutionResult> {
    if (!fs.existsSync(resolvedPath)) {
      return {
        actionId: action.id,
        success: false,
        error: `配置文件不存在: ${resolvedPath}`
      };
    }

    // 读取原文件
    const content = await fs.promises.readFile(resolvedPath, 'utf-8');
    
    // 备份原文件
    const backupPath = `${resolvedPath}.bak`;
    await fs.promises.writeFile(backupPath, content, 'utf-8');

    // 根据文件类型执行修改
    const ext = path.extname(resolvedPath).toLowerCase();
    let newContent: string;

    if (ext === '.json') {
      newContent = this.editJsonConfig(content, action);
    } else if (ext === '.toml') {
      newContent = this.editTomlConfig(content, action);
    } else if (ext === '.yml' || ext === '.yaml') {
      newContent = this.editYamlConfig(content, action);
    } else if (ext === '.properties') {
      newContent = this.editPropertiesConfig(content, action);
    } else {
      return {
        actionId: action.id,
        success: false,
        error: `不支持的配置文件格式: ${ext}`
      };
    }

    // 写入新内容
    await fs.promises.writeFile(resolvedPath, newContent, 'utf-8');
    
    logger.info(`配置文件已修改: ${resolvedPath} (原因: ${action.reason})`);
    
    return {
      actionId: action.id,
      success: true,
      snapshot: backupPath
    };
  }

  /**
   * 编辑 JSON 配置
   */
  private editJsonConfig(content: string, action: RepairAction): string {
    try {
      const obj = JSON.parse(content);
      if (action.keyPath) {
        this.setNestedValue(obj, action.keyPath, action.newValue);
      }
      return JSON.stringify(obj, null, 2);
    } catch {
      return content;
    }
  }

  /**
   * 编辑 TOML 配置（简单行替换）
   */
  private editTomlConfig(content: string, action: RepairAction): string {
    if (!action.keyPath) return content;
    
    const lines = content.split('\n');
    const keyParts = action.keyPath.split('.');
    const lastKey = keyParts[keyParts.length - 1];
    
    const newLines = lines.map(line => {
      const trimmed = line.trim();
      // 匹配键名（支持 = 和 : 分隔）
      const match = trimmed.match(new RegExp(`^${lastKey}\\s*[=:]`));
      if (match && !trimmed.startsWith('#')) {
        const indent = line.match(/^\s*/)?.[0] || '';
        return `${indent}${lastKey} = ${action.newValue || ''}`;
      }
      return line;
    });
    
    return newLines.join('\n');
  }

  /**
   * 编辑 YAML 配置（简单行替换）
   */
  private editYamlConfig(content: string, action: RepairAction): string {
    if (!action.keyPath) return content;
    // 同 TOML 类似处理
    return this.editTomlConfig(content, action);
  }

  /**
   * 编辑 Properties 配置
   */
  private editPropertiesConfig(content: string, action: RepairAction): string {
    if (!action.keyPath) return content;
    
    const lines = content.split('\n');
    const newLines = lines.map(line => {
      const match = line.match(new RegExp(`^${action.keyPath}\\s*=`));
      if (match && !line.trim().startsWith('#')) {
        return `${action.keyPath}=${action.newValue || ''}`;
      }
      return line;
    });
    
    return newLines.join('\n');
  }

  /**
   * 设置嵌套对象的值
   */
  private setNestedValue(obj: any, keyPath: string, value: any): void {
    const keys = keyPath.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }
    
    const lastKey = keys[keys.length - 1];
    // 尝试解析 value 为原生类型
    try {
      current[lastKey] = JSON.parse(value);
    } catch {
      current[lastKey] = value;
    }
  }

  /**
   * 修改 JVM 参数
   */
  private async executeAddJvmArg(action: RepairAction): Promise<ExecutionResult> {
    // 查找 start.bat / run.bat / start.sh
    let startPath: string | null = null;
    for (const name of ['start.bat', 'run.bat', 'start.sh']) {
      const p = path.join(this.workDir, name);
      if (fs.existsSync(p)) { startPath = p; break; }
    }
    
    if (!startPath) {
      return {
        actionId: action.id,
        success: false,
        error: '未找到启动脚本 (start.bat / run.bat / start.sh)'
      };
    }

    const content = await fs.promises.readFile(startPath, 'utf-8');
    const backupPath = `${startPath}.bak`;
    
    // 备份
    await fs.promises.writeFile(backupPath, content, 'utf-8');

    if (action.jvmArg) {
      // 在 java 命令所在行添加参数（在 -jar 之前）
      const newContent = content.replace(
        /(java\s+(?:-[X\w]+\s+)*)/i,
        (match, prefix) => {
          // 如果参数已存在，不重复添加
          if (content.includes(action.jvmArg!)) {
            return match;
          }
          return `${prefix}${action.jvmArg} `;
        }
      );

      await fs.promises.writeFile(startPath, newContent, 'utf-8');
      logger.info(`JVM 参数已添加: ${action.jvmArg} (原因: ${action.reason})`);
    }

    return {
      actionId: action.id,
      success: true,
      snapshot: backupPath
    };
  }

  /**
   * 获取操作的风险等级
   */
  public getActionRiskLevel(type: string): ActionRiskLevel {
    switch (type) {
      case 'move_file':
      case 'remove_mod':
        return 'medium';
      case 'delete_file':
        return 'high';
      case 'edit_config':
      case 'add_jvm_arg':
        return 'low';
      case 'download_file':
        return 'critical';
      default:
        return 'medium';
    }
  }

  /**
   * 批量执行操作
   */
  public async executeActions(actions: RepairAction[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    for (const action of actions) {
      const result = await this.executeAction(action);
      results.push(result);
    }
    return results;
  }
}
