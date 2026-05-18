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
