/**
 * ProcessManager - 服务端进程生命周期管理
 * 负责启动、停止、监控 Java 服务端进程
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import iconv from 'iconv-lite';
import { logger } from '../utils/logger.js';
import type { GuardianWSEvent, ProcessStatus } from './types.js';

export interface ProcessInfo {
  pid?: number;
  status: ProcessStatus;
  startTime?: string;
  endTime?: string;
  exitCode?: number;
  signal?: string;
  command: string;
  args: string[];
  workDir: string;
}

export class ProcessManager {
  private process: ChildProcess | null = null;
  private workDir: string = '';
  private javaCommand: string = '';
  private processInfo: ProcessInfo;
  private readonly onOutput: (line: string, isError: boolean) => void;
  private readonly onStatusChange: (status: ProcessStatus, data?: any) => void;
  private readonly onCrash: (exitCode: number, signal: string | null) => void;
  private hangTimer: NodeJS.Timeout | null = null;
  private readonly hangTimeoutMs: number = 30000; // 30秒无输出视为可能卡死
  private lastOutputTime: number = 0;
  private isStopping: boolean = false;

  constructor(options: {
    onOutput: (line: string, isError: boolean) => void;
    onStatusChange: (status: ProcessStatus, data?: any) => void;
    onCrash: (exitCode: number, signal: string | null) => void;
    hangTimeoutMs?: number;
  }) {
    this.onOutput = options.onOutput;
    this.onStatusChange = options.onStatusChange;
    this.onCrash = options.onCrash;
    if (options.hangTimeoutMs) {
      this.hangTimeoutMs = options.hangTimeoutMs;
    }
    this.processInfo = {
      status: 'stopped',
      command: '',
      args: [],
      workDir: ''
    };
  }

  /**
   * 设置工作目录和 Java 命令
   */
  public configure(workDir: string, javaCommand: string): void {
    this.workDir = workDir;
    this.javaCommand = javaCommand;
    this.processInfo.workDir = workDir;
  }

  /**
   * 从 .bat 文件中解析 Java 启动命令
   */
  public parseStartBat(batPath: string): { command: string; args: string[] } | null {
    try {
      if (!fs.existsSync(batPath)) {
        logger.warn(`启动批处理文件不存在: ${batPath}`);
        return null;
      }
      const content = fs.readFileSync(batPath, 'utf-8');
      // 查找 java/javaw 命令
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // 跳过注释和空行
        if (trimmed.startsWith('@echo') || trimmed.startsWith('echo') || trimmed === '') {
          continue;
        }
        // 查找包含 java 的行
        if (trimmed.includes('java') && (trimmed.includes('-jar') || trimmed.includes('-X'))) {
          // 解析命令和参数
          const parts = this.parseCommandLine(trimmed);
          if (parts.length > 0) {
            return {
              command: parts[0],
              args: parts.slice(1)
            };
          }
        }
      }
      logger.warn(`无法从 ${path.basename(batPath)} 中解析 Java 命令`);
      return null;
    } catch (err) {
      logger.error(`解析 ${path.basename(batPath)} 失败`, err as Error);
      return null;
    }
  }

  /**
   * 简单的命令行解析（处理引号）
   */
  private parseCommandLine(cmd: string): string[] {
    const args: string[] = [];
    const regex = /"([^"]*)"|(\S+)/g;
    let match;
    while ((match = regex.exec(cmd)) !== null) {
      args.push(match[1] || match[2]);
    }
    return args;
  }

  /**
   * 启动服务端进程
   */
  public async start(command?: string, args?: string[]): Promise<boolean> {
    if (this.process !== null) {
      logger.warn('服务端进程已在运行');
      return false;
    }

    let cmd: string;
    let cmdArgs: string[];

    if (command && args) {
      cmd = command;
      cmdArgs = args;
    } else if (this.javaCommand) {
      // 尝试解析 javaCommand（可能是完整命令行）
      const parsed = this.parseCommandLine(this.javaCommand);
      if (parsed.length > 0) {
        cmd = parsed[0];
        cmdArgs = parsed.slice(1);
      } else {
        cmd = this.javaCommand;
        cmdArgs = [];
      }
    } else {
      // 默认尝试检测 start.bat / run.bat
      const batNames = ['start.bat', 'run.bat'];
      let found = false;
      for (const name of batNames) {
        const batPath = path.join(this.workDir, name);
        if (fs.existsSync(batPath)) {
          const parsed = this.parseStartBat(batPath);
          if (parsed) {
            cmd = parsed.command;
            cmdArgs = parsed.args;
          } else {
            // 直接执行 bat
            cmd = 'cmd.exe';
            cmdArgs = ['/c', batPath];
          }
          found = true;
          break;
        }
      }
      if (!found) {
        logger.error('未找到启动命令且 start.bat / run.bat 均不存在');
        return false;
      }
    }

    this.isStopping = false;
    this.javaPids = null; // 重置 Java 进程缓存，下次 getMetrics 重新扫描
    this.processInfo.status = 'starting';
    this.processInfo.command = cmd!;
    this.processInfo.args = cmdArgs!;
    this.processInfo.startTime = new Date().toISOString();
    this.processInfo.exitCode = undefined;
    this.processInfo.signal
 = undefined;
    this.lastOutputTime = Date.now();

    this.onStatusChange('starting');

    try {
      logger.info(`启动服务端进程: ${cmd!} ${cmdArgs!.join(' ')}`);
      logger.info(`工作目录: ${this.workDir}`);

      this.process = spawn(cmd!, cmdArgs!, {
        cwd: this.workDir,
        shell: true,
        windowsHide: true,
        env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME },
        // 不继承敏感环境变量
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.processInfo.pid = this.process.pid;
      this.processInfo.status = 'running';
      this.onStatusChange('running', { pid: this.process.pid });

      // 处理标准输出
      this.process.stdout?.on('data', (data: Buffer) => {
        const lines = iconv.decode(data, 'gbk').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            this.lastOutputTime = Date.now();
            this.onOutput(trimmed, false);
          }
        }
      });

      // 处理标准错误
      this.process.stderr?.on('data', (data: Buffer) => {
        const lines = iconv.decode(data, 'gbk').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            this.lastOutputTime = Date.now();
            this.onOutput(trimmed, true);
          }
        }
      });

      // 进程退出事件
      this.process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        this.handleProcessExit(code, signal);
      });

      // 进程错误事件
      this.process.on('error', (err: Error) => {
        logger.error('服务端进程错误', err);
        this.onOutput(`进程错误: ${err.message}`, true);
        if (!this.isStopping) {
          this.handleProcessExit(-1, null);
        }
      });

      // 启动挂起检测定时器
      this.startHangDetector();

      return true;
    } catch (err) {
      logger.error('启动服务端进程失败', err as Error);
      this.processInfo.status = 'crashed';
      this.onStatusChange('crashed', { error: (err as Error).message });
      return false;
    }
  }

  /**
   * 处理进程退出
   */
  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.isStopping) {
      return; // 主动停止，不视为崩溃
    }

    this.stopHangDetector();

    const exitCode = code ?? -1;
    const sig = signal ?? undefined;

    this.processInfo.status = 'crashed';
    this.processInfo.endTime = new Date().toISOString();
    this.processInfo.exitCode = exitCode;
    this.processInfo.signal = sig;

    logger.info(`服务端进程退出: exitCode=${exitCode}, signal=${sig}`);
    this.onOutput(`服务端进程已退出 (退出码: ${exitCode}${sig ? `, 信号: ${sig}` : ''})`, false);

    this.process = null;
    this.onStatusChange('crashed', { exitCode, signal: sig });
    this.onCrash(exitCode, sig ?? null);
  }

  /**
   * 停止服务端（优雅停止 - 发送 stop 命令）
   */
  public async stop(): Promise<void> {
    if (this.process === null) {
      return;
    }

    this.isStopping = true;
    this.stopHangDetector();

    logger.info('正在停止服务端进程...');
    this.onOutput('正在停止服务端...', false);

    // 尝试优雅停止：向进程发送 "stop" 命令（通过 stdin）
    // 注意：大部分 Minecraft 服务端支持通过控制台输入 "stop" 命令
    if (this.process.stdin) {
      try {
        this.process.stdin.write('stop\n');
        logger.info('已发送 stop 命令，等待服务端关闭...');
      } catch (err) {
        logger.warn('发送 stop 命令失败，将强制终止', err as Error);
      }
    }

    // 等待一段时间让服务端优雅关闭
    const gracefulTimeout = 15000; // 15秒
    const startTime = Date.now();

    while (this.process !== null && (Date.now() - startTime < gracefulTimeout)) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 如果仍未停止，强制终止
    if (this.process !== null) {
      logger.warn('服务端未能在指定时间内关闭，强制终止');
      // Windows: taskkill /F /T 杀死整个进程树
      let killed = false;
      for (let attempt = 0; attempt < 3 && !killed; attempt++) {
        try {
          execSync(`taskkill /F /T /PID ${this.process.pid}`, { stdio: 'ignore', timeout: 5000 });
        } catch {
          try { execSync(`taskkill /F /PID ${this.process.pid}`, { stdio: 'ignore', timeout: 5000 }); } catch {}
        }
        // 等待进程退出事件
        await new Promise(resolve => setTimeout(resolve, 3000));
        killed = this.process.exitCode !== null;
      }

      if (!killed) {
        // 终极方案：wmic 强制删除
        try {
          execSync(`wmic process where "processid=${this.process.pid}" delete`, { stdio: 'ignore', timeout: 5000 });
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch { /* 放弃 */ }
      }

      try {
        this.process.kill('SIGKILL');
      } catch { /* 进程可能已死 */ }
    }

    // 安全兜底：清理所有残留的 java 进程
    this.killAllJavaProcesses();
    this.javaPids = null;
    this.process = null;
    this.processInfo.status = 'stopped';
    this.processInfo.endTime = new Date().toISOString();
    this.onStatusChange('stopped');
    logger.info('服务端进程已停止');
  }

  /**
   * 强制终止服务端
   */
  public async forceStop(): Promise<void> {
    if (this.process === null) {
      return;
    }

    this.isStopping = true;
    this.stopHangDetector();
    logger.info('强制终止服务端进程');
    // 使用 /T 级联杀死整个进程树（包括内层 cmd 和 java.exe）
    if (this.process?.pid) {
      try {
        execSync(`taskkill /F /T /PID ${this.process.pid}`, { stdio: 'ignore', timeout: 5000 });
      } catch {
        try { execSync(`taskkill /F /PID ${this.process.pid}`, { stdio: 'ignore', timeout: 5000 }); } catch {}
      }
    }
    // 清理所有残留的 java 进程作为安全兜底
    this.killAllJavaProcesses();
    // 尝试 kill 信号
    try { this.process?.kill('SIGKILL'); } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));
    this.process = null;
    this.processInfo.status = 'stopped';
    this.processInfo.endTime = new Date().toISOString();
    this.onStatusChange('stopped');
  }

  /**
   * 启动挂起检测器
   */
  private startHangDetector(): void {
    this.stopHangDetector();
    this.hangTimer = setInterval(() => {
      if (this.process === null) return;
      
      const timeSinceLastOutput = Date.now() - this.lastOutputTime;
      if (timeSinceLastOutput > this.hangTimeoutMs) {
        logger.warn(`检测到服务端可能卡死（${timeSinceLastOutput}ms 无输出）`);
        this.onStatusChange('hanging', { 
          lastOutputTime: new Date(this.lastOutputTime).toISOString(),
          silenceDuration: timeSinceLastOutput 
        });
        // 不自动处理，让 CrashDetector 决定
      }
    }, 5000); // 每 5 秒检查一次
  }

  /**
   * 停止挂起检测器
   */
  private stopHangDetector(): void {
    if (this.hangTimer !== null) {
      clearInterval(this.hangTimer);
      this.hangTimer = null;
    }
  }

  /**
   * 获取当前进程信息
   */
  public getProcessInfo(): ProcessInfo {
    return { ...this.processInfo };
  }

  /**
   * 检查进程是否在运行
   */
  public isRunning(): boolean {
    return this.process !== null && this.processInfo.status === 'running';
  }

  /** 缓存已知的 Java 进程 PID（区分大小写：java.exe + java/javaw） */
  private javaPids: number[] | null = null;

  /**
   * 获取进程资源占用（CPU%、内存%）
   * 首次调用搜索所有名称含 "java" 的进程并缓存 PID，后续实时累加
   */
  public getMetrics(): { cpuPercent: number; memPercent: number } | null {
    if (!this.process || !this.process.pid) return null;
    try {
      // 缓存为空 → 首次/重启后扫描
      if (this.javaPids === null || this.javaPids.length === 0) {
        this.javaPids = this.findAllJavaPids();
        if (this.javaPids.length === 0) return null;
      }

      let totalCpuRaw = 0;
      let totalMemKb = 0;
      const validPids: number[] = [];
      const coreCount = os.cpus().length;

      for (const pid of this.javaPids) {
        try {
          const memOut = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf-8', timeout: 3000 }).trim();
          if (!memOut || memOut.includes('INFO: No tasks')) continue;

          // 内存（KB）
          const memKb = parseInt(memOut.split('","')[4]?.replace(/[^\d]/g, '') || '0', 10);
          totalMemKb += memKb;
          validPids.push(pid);

          // CPU（PowerShell）
          try {
            const psOut = execSync(
              `powershell -NoProfile -Command "(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -eq ${pid} }).PercentProcessorTime"`,
              { encoding: 'utf-8', timeout: 3000 }
            ).trim();
            const rawCpu = parseFloat(psOut);
            if (!isNaN(rawCpu) && rawCpu > 0) {
              totalCpuRaw += rawCpu;
            }
          } catch { /* 跳过 */ }
        } catch { /* 进程已退出 */ }
      }

      // 更新缓存（过滤已退出的 PID）
      this.javaPids = validPids.length > 0 ? validPids : this.findAllJavaPids();

      const totalMem = os.totalmem();
      const cpuPercent = totalCpuRaw > 0 ? Math.min(100, Math.round(totalCpuRaw / coreCount)) : 0;
      const memPercent = totalMem > 0 ? Math.min(100, Math.round((totalMemKb * 1024 / totalMem) * 100)) : 0;

      return { cpuPercent, memPercent };
    } catch {
      return null;
    }
  }

  /**
   * 查找所有名称以 "java" 开头的进程 PID（不区分大小写）
   * 依次尝试：wmic → tasklist/java.exe → tasklist/javaw.exe → PowerShell
   * 直到搜到至少一个 PID 为止；每次调用独立搜索，不缓存进度——getMetrics
   * 的每 2s 轮询会自动 retry
   */
  private findAllJavaPids(): number[] {
    const pids = new Set<number>();

    // ---------- Method 1: wmic (broad like match) ----------
    try {
      const out = execSync(
        `wmic process where "name like '%java%'" get processid /format:csv`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      for (const line of out.split(/\r?\n/).filter(l => l.trim())) {
        const parts = line.split(',');
        const pid = parseInt(parts[parts.length - 1]?.replace(/"/g, ''), 10);
        if (!isNaN(pid) && pid > 0) pids.add(pid);
      }
    } catch { /* wmic 可能已被弃用，继续 fallback */ }

    // ---------- Method 2: tasklist for java.exe ----------
    if (pids.size === 0) {
      try {
        for (const name of ['java.exe', 'javaw.exe']) {
          const out = execSync(
            `tasklist /FI "IMAGENAME eq ${name}" /FO CSV /NH`,
            { encoding: 'utf-8', timeout: 3000 }
          ).trim();
          for (const line of out.split(/\r?\n/).filter(l => l.trim())) {
            const pid = parseInt(line.split('","')[1]?.replace(/"/g, ''), 10);
            if (!isNaN(pid) && pid > 0) pids.add(pid);
          }
          if (pids.size > 0) break;
        }
      } catch { /* 继续 fallback */ }
    }

    // ---------- Method 3: PowerShell Get-Process ----------
    if (pids.size === 0) {
      try {
        const psOut = execSync(
          `powershell -NoProfile -Command "(Get-Process java,javaw -ErrorAction SilentlyContinue).Id"`,
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        for (const line of psOut.split(/\r?\n/).filter(l => l.trim())) {
          const pid = parseInt(line, 10);
          if (!isNaN(pid) && pid > 0) pids.add(pid);
        }
      } catch { /* 放弃 */ }
    }

    if (pids.size > 0) {
      logger.debug(`findAllJavaPids: 找到 ${pids.size} 个 Java 进程, PIDs: [${[...pids].join(', ')}]`);
    } else {
      logger.warn('findAllJavaPids: 三次尝试均未找到任何 Java 进程（wmic → tasklist → PowerShell）');
    }

    return [...pids];
  }

  /**
   * 强制杀死所有名称含 "java" 的进程（停止时的安全兜底）
   */
  private killAllJavaProcesses(): void {
    try {
      const pids = this.findAllJavaPids();
      if (pids.length === 0) return;
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 3000 });
        } catch { /* 可能已被其他方式杀死 */ }
      }
    } catch { /* 放弃 */ }
  }

  /**
   * 发送命令到服务端控制台
   */
  public sendCommand(command: string): boolean {
    if (this.process === null || !this.process.stdin) {
      return false;
    }
    try {
      this.process.stdin.write(command + '\n');
      return true;
    } catch (err) {
      logger.error('发送命令失败', err as Error);
      return false;
    }
  }

  /**
   * 清理资源
   */
  public async cleanup(): Promise<void> {
    await this.stop();
    this.stopHangDetector();
  }
}
