/**
 * Reporter - 崩溃报告生成器
 * 为每次崩溃生成 Markdown 报告
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CrashInfo, AIDiagnosis, RepairAction, CrashReport } from './types.js';
import { logger } from '../utils/logger.js';

export interface ReportOptions {
  reportsDir: string;
}

export class Reporter {
  private readonly reportsDir: string;

  constructor(workDir: string) {
    this.reportsDir = path.join(workDir, '.guardian_reports');
    
    // 确保报告目录存在
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * 生成崩溃报告
   */
  public async generateReport(params: {
    serverDir: string;
    serverType: string;
    javaVersion: string;
    mcVersion: string;
    crashInfo: CrashInfo;
    diagnosis?: AIDiagnosis;
    executedActions: RepairAction[];
    result: 'fixed' | 'unfixed' | 'user_stopped' | 'give_up';
    restartCount: number;
  }): Promise<CrashReport> {
    const report: CrashReport = {
      id: `report_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      serverDir: params.serverDir,
      serverType: params.serverType as any,
      javaVersion: params.javaVersion,
      mcVersion: params.mcVersion,
      crashInfo: params.crashInfo,
      diagnosis: params.diagnosis,
      executedActions: params.executedActions,
      result: params.result,
      restartCount: params.restartCount
    };

    // 生成 Markdown 内容
    const markdown = this.buildMarkdown(report);
    
    // 保存到文件
    const fileName = `crash_report_${report.id}.md`;
    const filePath = path.join(this.reportsDir, fileName);
    
    await fs.promises.writeFile(filePath, markdown, 'utf-8');
    
    report.reportPath = filePath;
    logger.info(`崩溃报告已保存: ${filePath}`);

    return report;
  }

  /**
   * 构建 Markdown 报告内容
   */
  private buildMarkdown(report: CrashReport): string {
    const { crashInfo, diagnosis, executedActions } = report;
    
    let md = `# 💥 服务端崩溃报告\n\n`;
    md += `> **报告ID**: ${report.id}\n`;
    md += `> **时间**: ${new Date(report.timestamp).toLocaleString('zh-CN')}\n`;
    md += `> **结果**: ${this.formatResult(report.result)}\n\n`;

    md += `---\n\n`;

    // 服务端信息
    md += `## 📋 服务端信息\n\n`;
    md += `| 项目 | 值 |\n`;
    md += `|------|-----|\n`;
    md += `| 服务端类型 | ${report.serverType} |\n`;
    md += `| Minecraft 版本 | ${report.mcVersion} |\n`;
    md += `| Java 版本 | ${report.javaVersion} |\n`;
    md += `| 工作目录 | \`${report.serverDir}\` |\n`;
    md += `| 重启次数 | ${report.restartCount} |\n\n`;

    // 崩溃信息
    md += `## 🚨 崩溃信息\n\n`;
    md += `- **严重等级**: ${this.formatSeverity(crashInfo.severity)}\n`;
    md += `- **退出码**: ${crashInfo.exitCode ?? 'N/A'}\n`;
    md += `- **信号**: ${crashInfo.signal ?? 'N/A'}\n`;
    md += `- **检测模式**: ${crashInfo.detectedPatterns.join(', ') || '无'}\n`;
    md += `- **分类**: ${crashInfo.classification.type}\n\n`;

    // 崩溃原因
    md += `### 崩溃原因\n\n`;
    md += `${crashInfo.classification.reason}\n\n`;

    // 疑似问题
    if (crashInfo.classification.suspectedMods.length > 0) {
      md += `### 疑似问题模组\n\n`;
      for (const mod of crashInfo.classification.suspectedMods) {
        md += `- \`${mod}\`\n`;
      }
      md += `\n`;
    }

    if (crashInfo.classification.suspectedConfigs.length > 0) {
      md += `### 疑似问题配置\n\n`;
      for (const cfg of crashInfo.classification.suspectedConfigs) {
        md += `- \`${cfg}\`\n`;
      }
      md += `\n`;
    }

    // AI 诊断
    if (diagnosis) {
      md += `## 🤖 AI 诊断\n\n`;
      md += `> ${diagnosis.diagnosis}\n\n`;
      
      md += `### 原因分析\n\n`;
      for (const cause of diagnosis.causes) {
        md += `1. ${cause}\n`;
      }
      md += `\n`;
      
      md += `**置信度**: ${Math.round(diagnosis.confidence * 100)}%\n\n`;
    }

    // 执行的操作
    if (executedActions.length > 0) {
      md += `## 🔧 已执行操作\n\n`;
      md += `| 操作 | 目标 | 结果 | 原因 |\n`;
      md += `|------|------|------|------|\n`;
      
      for (const action of executedActions) {
        md += `| ${action.type} | \`${action.target}\` | ${action.approved ? '✅ 已执行' : '⏳ 待确认'} | ${action.reason} |\n`;
      }
      md += `\n`;
    }

    // 日志上下文
    md += `## 📄 日志上下文（最后 ${crashInfo.logContext.length} 行）\n\n`;
    md += `\`\`\`log\n`;
    md += crashInfo.logContext.slice(-30).join('\n');
    md += `\n\`\`\`\n\n`;

    // 页脚
    md += `---\n`;
    md += `*由 ServerGuardian 自动生成*\n`;

    return md;
  }

  /**
   * 格式化结果
   */
  private formatResult(result: string): string {
    const map: Record<string, string> = {
      'fixed': '✅ 已修复',
      'unfixed': '❌ 未修复',
      'user_stopped': '🛑 用户终止',
      'give_up': '⚠️ 已放弃（多次崩溃）'
    };
    return map[result] || result;
  }

  /**
   * 格式化严重等级
   */
  private formatSeverity(severity: string): string {
    const map: Record<string, string> = {
      'fatal': '🔴 致命',
      'error': '🟠 错误',
      'warning': '🟡 警告',
      'info': '🔵 信息'
    };
    return map[severity] || severity;
  }

  /**
   * 获取所有报告列表
   */
  public getReportsList(): Array<{ id: string; timestamp: string; file: string }> {
    try {
      if (!fs.existsSync(this.reportsDir)) return [];

      const files = fs.readdirSync(this.reportsDir);
      const reports: Array<{ id: string; timestamp: string; file: string }> = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        
        const match = file.match(/crash_report_(.+?)\.md/);
        if (match) {
          const filePath = path.join(this.reportsDir, file);
          const stat = fs.statSync(filePath);
          reports.push({
            id: match[1],
            timestamp: stat.mtime.toISOString(),
            file: filePath
          });
        }
      }

      return reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (err) {
      logger.error('获取报告列表失败', err as Error);
      return [];
    }
  }

  /**
   * 获取报告内容
   */
  public getReportContent(reportId: string): string | null {
    try {
      const files = fs.readdirSync(this.reportsDir);
      for (const file of files) {
        if (file.includes(reportId)) {
          return fs.readFileSync(path.join(this.reportsDir, file), 'utf-8');
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
