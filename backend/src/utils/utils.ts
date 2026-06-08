import pMap from "p-map";
import { Config } from "./config.js";
import got from "got";
import pRetry from "p-retry";
import fs from "node:fs";
import fse from "fs-extra";
import { SpawnOptions, exec, spawn } from "node:child_process";
import path from "node:path";
import { MessageWS } from "./ws.js";
import { logger } from "./logger.js";
import { fastdownload as newFastdownload, Wfastdownload as newWfastdownload, calculateSHA1 as newCalculateSHA1, verifySHA1 as newVerifySHA1, getMirrorUrls, MirrorUrls } from "./download.js";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import yauzl from "yauzl";

export function getAppDir(): string {
  const execPath = process.execPath;
  const cwd = process.cwd();
  
  const isDevelopment = execPath.toLowerCase().includes('node.exe') && 
                        !cwd.toLowerCase().includes('program files') &&
                        !cwd.toLowerCase().includes('nodejs');
  
  if (isDevelopment) {
    return cwd;
  }
  
  return path.dirname(execPath);
}

export interface JavaVersion {
  major: number;
  minor: number;
  patch: number;
  fullVersion: string;
  vendor: string;
  runtimeVersion?: string;
}

export interface JavaCheckResult {
  exists: boolean;
  version?: JavaVersion;
  error?: string;
}

export class Utils {
  public modrinth_url: string;
  public curseforge_url: string;
  public curseforge_Durl: string;
  public modrinth_Durl: string;
  
  constructor() {
    const mirrorUrls = getMirrorUrls();
    this.modrinth_url = mirrorUrls.modrinth_url;
    this.curseforge_url = mirrorUrls.curseforge_url;
    this.modrinth_Durl = mirrorUrls.modrinth_Durl;
    this.curseforge_Durl = mirrorUrls.curseforge_Durl;
  }
}

export function mavenToUrl(
  coordinate: { split: (arg0: string) => [any, any, any, any] },
  base = "maven"
) {
  const [g, a, v, ce] = coordinate.split(":");
  const [c, e = "jar"] = (ce || "").split("@");
  return `${base.replace(/\/$/, "")}/${g.replace(
    /\./g,
    "/"
  )}/${a}/${v}/${a}-${v}${c ? "-" + c : ""}.${e}`;
}

export function version_compare(v1: string, v2: string) {
  const v1_arr = v1.split(".");
  const v2_arr = v2.split(".");
  for (let i = 0; i < v1_arr.length; i++) {
    if (v1_arr[i] !== v2_arr[i]) {
      return v1_arr[i] > v2_arr[i] ? 1 : -1;
    }
  }
  return 0;
}

export async function checkJava(javaPath?: string): Promise<JavaCheckResult> {
  try {
    const javaCmd = javaPath || "java";
    const output = await new Promise<string>((resolve, reject) => {
      exec(`${javaCmd} -version`, (err, stdout, stderr) => {
        if (err) {
          logger.error("Java 检查失败", err);
          reject(new Error("Java not found"));
          return;
        }
        resolve(stderr);
      });
    });

    logger.debug(`Java version output: ${output}`);

    const versionRegex = /version "(\d+)(\.(\d+))?(\.(\d+))?/;
    const vendorRegex = /(Java\(TM\)|OpenJDK).*Runtime Environment.*by (.*)/;

    const versionMatch = output.match(versionRegex);
    const vendorMatch = output.match(vendorRegex);

    if (!versionMatch) {
      return {
        exists: true,
        error: "解析 Java 版本失败"
      };
    }

    const major = parseInt(versionMatch[1], 10);
    const minor = versionMatch[3] ? parseInt(versionMatch[3], 10) : 0;
    const patch = versionMatch[5] ? parseInt(versionMatch[5], 10) : 0;

    const versionInfo: JavaVersion = {
      major,
      minor,
      patch,
      fullVersion: versionMatch[0].replace("version ", ""),
      vendor: vendorMatch ? vendorMatch[2] : "Unknown"
    };

    logger.info(`检测到 Java: ${JSON.stringify(versionInfo)}`);

    return {
      exists: true,
      version: versionInfo
    };
  } catch (error) {
    logger.error("Java 检查异常", error as Error);
    return {
      exists: false,
      error: (error as Error).message
    };
  }
}

export async function detectJavaPaths(): Promise<string[]> {
  const javaPaths: string[] = [];

  const windowsPaths = [
    "C:\\Program Files\\Java\\",
    "C:\\Program Files (x86)\\Java\\",
    "C:\\Program Files\\Eclipse Adoptium\\",
    "C:\\Program Files\\Eclipse Foundation\\",
    "C:\\Program Files\\Microsoft\\",
    "C:\\Program Files\\Amazon Corretto\\",
    "C:\\Program Files\\BellSoft\\",
    "C:\\Program Files\\Zulu\\",
    "C:\\Program Files\\Semeru\\",
    "C:\\Program Files\\Oracle\\",
    "C:\\Program Files\\RedHat\\",
  ];

  for (const basePath of windowsPaths) {
    try {
      if (fs.existsSync(basePath)) {
        const versions = fs.readdirSync(basePath);
        for (const version of versions) {
          const javaExe = `${basePath}${version}\\bin\\java.exe`;
          if (fs.existsSync(javaExe)) {
            javaPaths.push(javaExe);
          }
        }
      }
    } catch (error) {
    }
  }

  try {
    const pathOutput = await new Promise<string>((resolve, reject) => {
      exec("where java", (err, stdout, stderr) => {
        if (err) {
          resolve("");
          return;
        }
        resolve(stdout);
      });
    });

    const wherePaths = pathOutput.split('\n').filter(p => p.trim() !== '');
    for (const path of wherePaths) {
      if (!javaPaths.includes(path.trim())) {
        javaPaths.push(path.trim());
      }
    }
  } catch (error) {
  }

  return [...new Set(javaPaths)];
}

export interface JavaInstallProgress {
  stage: 'downloading' | 'extracting' | 'completed' | 'error';
  progress: number;
  message: string;
  javaPath?: string;
  error?: string;
}

type ProgressCallback = (progress: JavaInstallProgress) => void;

export async function installJava21(onProgress?: ProgressCallback): Promise<string | null> {
  const appDir = getAppDir();
  const javaDir = path.join(appDir, "runtime", "java21");
  const platform = process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'aarch64' : process.arch;

  logger.info(`开始自动安装 Java 21 (${platform}/${arch})`);

  try {
    // 1. 查询 Adoptium API 获取下载链接
    onProgress?.({ stage: 'downloading', progress: 0, message: '正在获取 Java 21 下载信息...' });

    const apiUrl = `https://api.adoptium.net/v3/assets/latest/21/hotspot?vendor=eclipse`;
    const response = await got(apiUrl, { responseType: 'json', timeout: { request: 15000 } });
    const assets: any[] = (response.body as any) || [];

    if (!Array.isArray(assets) || assets.length === 0) {
      throw new Error('无法获取 Java 21 版本信息');
    }

    // 找到匹配平台的二进制包
    let downloadUrl = '';
    let checksum = '';
    let packageName = '';

    for (const asset of assets) {
      const binaries = asset.binaries || [];
      for (const binary of binaries) {
        const os = binary.os;
        const binaryArch = binary.architecture;
        const imageType = binary.image_type;

        let osMatch = false;
        if (platform === 'win32' && os === 'windows') osMatch = true;
        if (platform === 'darwin' && os === 'mac') osMatch = true;
        if (platform === 'linux' && os === 'linux') osMatch = true;

        if (osMatch && binaryArch === arch && imageType === 'jdk') {
          const pkg = binary.package || binary.installer;
          if (pkg) {
            downloadUrl = pkg.link || '';
            checksum = pkg.checksum || '';
            packageName = pkg.name || '';
            break;
          }
        }
      }
      if (downloadUrl) break;
    }

    if (!downloadUrl) {
      throw new Error(`未找到适用于 ${platform}/${arch} 的 Java 21`);
    }

    logger.info(`Java 21 下载链接: ${downloadUrl}`);

    // 2. 下载 Java 21
    onProgress?.({ stage: 'downloading', progress: 10, message: '正在下载 Java 21...' });

    // 确保目录存在
    if (!fs.existsSync(javaDir)) {
      fs.mkdirSync(javaDir, { recursive: true });
    }

    const downloadPath = path.join(javaDir, packageName || `java21-${platform}.${platform === 'win32' ? 'zip' : 'tar.gz'}`);

    // 使用 got 流式下载，带进度回调
    const downloadStream = got.stream(downloadUrl, { timeout: { request: 600000 } });
    const fileStream = createWriteStream(downloadPath);

    let downloadedBytes = 0;
    let totalBytes = 0;

    downloadStream.on('downloadProgress', (progress: any) => {
      downloadedBytes = progress.transferred;
      totalBytes = progress.total || 0;
      if (totalBytes > 0) {
        const percent = Math.round(10 + (downloadedBytes / totalBytes) * 70);
        const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
        const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
        onProgress?.({ stage: 'downloading', progress: percent, message: `正在下载 Java 21 (${mb}MB / ${totalMb}MB)...` });
      }
    });

    await pipeline(downloadStream, fileStream);

    // 3. 解压 Java 21
    onProgress?.({ stage: 'extracting', progress: 80, message: '正在解压 Java 21...' });

    const extractDir = path.join(javaDir, "jdk");

    // 清理旧解压目录
    if (fs.existsSync(extractDir)) {
      fse.removeSync(extractDir);
    }
    fs.mkdirSync(extractDir, { recursive: true });

    if (platform === 'win32') {
      // Windows: 使用 yauzl 解压 zip
      await new Promise<void>((resolve, reject) => {
        yauzl.open(downloadPath, { lazyEntries: true }, (err, zipfile) => {
          if (err) { reject(err); return; }
          zipfile!.readEntry();
          zipfile!.on('entry', (entry: yauzl.Entry) => {
            if (/\/$/.test(entry.fileName)) {
              // 目录
              const dirPath = path.join(extractDir, entry.fileName);
              if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
              }
              zipfile!.readEntry();
            } else {
              zipfile!.openReadStream(entry, (err, readStream) => {
                if (err) { reject(err); return; }
                const filePath = path.join(extractDir, entry.fileName);
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                  fs.mkdirSync(dir, { recursive: true });
                }
                const writeStream = createWriteStream(filePath);
                readStream!.pipe(writeStream);
                writeStream.on('close', () => zipfile!.readEntry());
                writeStream.on('error', reject);
              });
            }
          });
          zipfile!.on('end', () => resolve());
          zipfile!.on('error', reject);
        });
      });
    } else {
      // Linux/macOS: 使用 tar 命令解压
      await new Promise<void>((resolve, reject) => {
        exec(`tar -xzf "${downloadPath}" -C "${extractDir}"`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    onProgress?.({ stage: 'extracting', progress: 90, message: '正在查找 Java 可执行文件...' });

    // 4. 查找 java 可执行文件路径
    let javaExePath = '';
    const javaExeName = platform === 'win32' ? 'java.exe' : 'java';

    function findJavaExe(dir: string): string | null {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // 检查 bin 目录
            const binPath = path.join(fullPath, 'bin', javaExeName);
            if (fs.existsSync(binPath)) {
              return binPath;
            }
            // 递归查找（限制深度）
            const found = findJavaExe(fullPath);
            if (found) return found;
          }
        }
      } catch {}
      return null;
    }

    javaExePath = findJavaExe(extractDir) || '';

    if (!javaExePath) {
      throw new Error('解压完成但未找到 Java 可执行文件');
    }

    // 5. 清理下载文件
    try {
      fs.unlinkSync(downloadPath);
    } catch {}

    onProgress?.({ stage: 'completed', progress: 100, message: 'Java 21 安装完成', javaPath: javaExePath });

    logger.info(`Java 21 自动安装完成: ${javaExePath}`);
    return javaExePath;
  } catch (error) {
    const errMsg = (error as Error).message;
    logger.error(`Java 21 自动安装失败: ${errMsg}`);
    onProgress?.({ stage: 'error', progress: 0, message: `Java 21 安装失败: ${errMsg}`, error: errMsg });
    return null;
  }
}

function safeLog(level: 'debug' | 'error', message: string): void {
  try {
    if (level === 'debug') {
      logger.debug(message);
    } else {
      logger.error(message);
    }
  } catch (err) {
    console.error(`[logger fallback] ${level}: ${message}`, err);
  }
}

export function execPromise(cmd: string, options?: SpawnOptions): Promise<number> {
  safeLog('debug', `执行命令: ${cmd}`);

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, {
      ...options,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout?.on('data', (chunk: unknown) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      safeLog('debug', text.trim());
    });

    child.stderr?.on('data', (chunk: unknown) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      safeLog('error', text.trim());
    });

    child.on('error', (err) => {
      safeLog('error', `命令执行错误: ${cmd}`);
      reject(err);
    });

    child.on('close', (code) => {
      safeLog('debug', `命令执行完成，退出码: ${code}`);
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

export function calculateSHA1(filePath: string): string {
  return newCalculateSHA1(filePath);
}

export function verifySHA1(filePath: string, expectedHash: string): boolean {
  return newVerifySHA1(filePath, expectedHash);
}

export async function fastdownload(data: [string, string] | string[][], enableHashVerify = true) {
  return newFastdownload(data, enableHashVerify);
}

export async function Wfastdownload(data: string[][], ws: any, enableHashVerify = true, useChunked = false) {
  return newWfastdownload(data, ws, enableHashVerify, useChunked);
}
