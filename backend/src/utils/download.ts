import pMap from "p-map";
import pRetry from "p-retry";
import got from "got";
import fs from "node:fs";
import fse from "fs-extra";
import crypto from "node:crypto";
import path from "node:path";
import { Config } from "./config.js";
import { sendWS } from "./ws.js";
import { logger } from "./logger.js";

export interface MirrorUrls {
  modrinth_url: string;
  curseforge_url: string;
  modrinth_Durl: string;
  curseforge_Durl: string;
}

const hashCache = new Map<string, { hash: string; mtime: number; size: number }>();
const HASH_CACHE_MAX_SIZE = 500;

export function getMirrorUrls(): MirrorUrls {
  const config = Config.getConfig();
  if (config.mirror?.mcimirror) {
    return {
      modrinth_url: "https://mod.mcimirror.top/modrinth",
      curseforge_url: "https://mod.mcimirror.top/curseforge",
      modrinth_Durl: "https://mod.mcimirror.top",
      curseforge_Durl: "https://mod.mcimirror.top",
    };
  }
  return {
    modrinth_url: "https://api.modrinth.com",
    curseforge_url: "https://api.curseforge.com",
    modrinth_Durl: "https://cdn.modrinth.com",
    curseforge_Durl: "https://edge.forgecdn.net",
  };
}

function isMCIMirrorUrl(url: string): boolean {
  return url.includes('mod.mcimirror.top');
}

function getCacheKey(filePath: string): string {
  return path.resolve(filePath);
}

function isCacheValid(filePath: string, cacheEntry: { hash: string; mtime: number; size: number }): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtimeMs === cacheEntry.mtime && stats.size === cacheEntry.size;
  } catch {
    return false;
  }
}

export function calculateSHA1(filePath: string): string {
  const cacheKey = getCacheKey(filePath);
  const cached = hashCache.get(cacheKey);

  if (cached && isCacheValid(filePath, cached)) {
    logger.debug(`使用缓存的哈希值: ${filePath}`);
    return cached.hash;
  }

  const hash = crypto.createHash('sha1');
  const buffer = Buffer.alloc(65536);
  const fd = fs.openSync(filePath, 'r');
  let bytesRead;

  try {
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }

  const result = hash.digest('hex').toLowerCase();

  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return result;
  }

  if (hashCache.size >= HASH_CACHE_MAX_SIZE) {
    const firstKey = hashCache.keys().next().value;
    if (firstKey) {
      hashCache.delete(firstKey);
    }
  }

  hashCache.set(cacheKey, {
    hash: result,
    mtime: stats.mtimeMs,
    size: stats.size
  });

  return result;
}

export function verifySHA1(filePath: string, expectedHash: string): boolean {
  const actualHash = calculateSHA1(filePath);
  const expectedHashLower = expectedHash.toLowerCase();
  const isMatch = actualHash === expectedHashLower;

  if (!isMatch) {
    logger.error(`文件哈希验证失败: ${filePath}`);
    logger.error(`期望: ${expectedHashLower}`);
    logger.error(`实际: ${actualHash}`);
  } else {
    logger.debug(`文件哈希验证成功: ${filePath} (sha1: ${actualHash})`);
  }

  return isMatch;
}

async function simpleDownload(url: string, filePath: string): Promise<void> {
  const res = await got.get(url, {
    responseType: "buffer",
    headers: { "user-agent": "DeEarthX" },
    followRedirect: true,
  });
  fse.outputFileSync(filePath, res.rawBody);
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function get429WaitTime(headers: Record<string, string | string[] | undefined> | undefined, attempt: number): number {
  const retryAfter = headers?.['retry-after'];
  if (retryAfter && typeof retryAfter === 'string') {
    return parseInt(retryAfter, 10) * 1000;
  }
  return Math.min(5000 * Math.pow(2, attempt), 60000);
}

async function chunkedDownload(
  url: string,
  filePath: string,
  chunkSize = 5 * 1024 * 1024,
  concurrency = 4,
): Promise<void> {
  const useMCIMirror = isMCIMirrorUrl(url);
  if (useMCIMirror) {
    chunkSize = 512 * 1024;
    concurrency = 16;
  }

  const chunkLabel = chunkSize >= 1024 * 1024
    ? `${chunkSize / 1024 / 1024}MB`
    : `${chunkSize / 1024}KB`;
  logger.debug(`开始分块下载 ${url}，块大小: ${chunkLabel}，并发数: ${concurrency}`);

  let fileSize = 0;
  let supportsRange = false;

  try {
    const head = await got.head(url, {
      headers: { "user-agent": "DeEarthX" },
      followRedirect: true,
      timeout: { request: 30000 },
    });
    fileSize = parseInt(head.headers['content-length'] || '0', 10);
    if (useMCIMirror) {
      supportsRange = head.headers['accept-ranges'] === 'bytes' && fileSize > 256 * 1024;
    } else {
      supportsRange = head.headers['accept-ranges'] === 'bytes' && fileSize > chunkSize;
    }
  } catch {
    logger.debug(`HEAD 请求失败，回退到普通下载: ${url}`);
    await simpleDownload(url, filePath);
    return;
  }

  if (!supportsRange) {
    logger.debug(`文件较小或服务器不支持分块下载，使用普通下载: ${url}`);
    await simpleDownload(url, filePath);
    return;
  }

  const totalChunks = Math.ceil(fileSize / chunkSize);
  logger.debug(`文件大小: ${(fileSize / 1024 / 1024).toFixed(2)}MB，分 ${totalChunks} 个块下载`);

  const fd = await fs.promises.open(filePath, 'w');
  await fd.truncate(fileSize);

  let currentConcurrency = Math.min(concurrency, totalChunks);
  let rangeSupported = true;

  const downloadChunk = async (chunkIndex: number): Promise<void> => {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize - 1, fileSize - 1);

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await got.get(url, {
          responseType: "buffer",
          headers: {
            "user-agent": "DeEarthX",
            "Range": `bytes=${start}-${end}`,
          },
          followRedirect: true,
          timeout: { request: 60000 },
        });

        if (res.statusCode === 206) {
          await fd.write(res.rawBody, 0, res.rawBody.length, start);
          return;
        }

        if (res.statusCode === 429) {
          const waitTime = get429WaitTime(res.headers, attempt);
          logger.warn(`遇到 429 错误，等待 ${waitTime / 1000} 秒后重试 (${attempt}/5)`);
          await sleep(waitTime);
          continue;
        }

        rangeSupported = false;
        throw new Error(`服务器返回状态码 ${res.statusCode}`);
      } catch (err: any) {
        if (err.response?.statusCode === 429) {
          const waitTime = get429WaitTime(err.response.headers, attempt);
          logger.warn(`遇到 429 错误，等待 ${waitTime / 1000} 秒后重试 (${attempt}/5)`);
          await sleep(waitTime);
          continue;
        }

        if (err.response?.statusCode) {
          rangeSupported = false;
          throw new Error(`服务器返回状态码 ${err.response.statusCode}，不支持分块下载`);
        }

        throw err;
      }
    }

    throw new Error(`下载块 ${chunkIndex} 失败，已重试 5 次`);
  };

  const tasks = Array.from({ length: totalChunks }, (_, i) => i);

  try {
    await pMap(tasks, downloadChunk, { concurrency: currentConcurrency });
  } catch (err: any) {
    await fd.close();
    try { await fs.promises.unlink(filePath); } catch {}

    if (!rangeSupported) {
      logger.warn(`服务器不支持分块下载，切换到普通下载: ${url}`);
      await simpleDownload(url, filePath);
      return;
    }

    throw err;
  }

  await fd.close();
  logger.debug(`分块下载完成: ${filePath}`);
}

async function downloadFile(
  url: string,
  filePath: string,
  expectedHash?: string,
  forceDownload = false,
  useChunked = false,
) {
  await pRetry(
    async () => {
      if (fs.existsSync(filePath) && !forceDownload) {
        logger.debug(`文件已存在，跳过: ${filePath}`);
        if (expectedHash && !verifySHA1(filePath, expectedHash)) {
          logger.warn(`已存在文件哈希不匹配，将重新下载: ${filePath}`);
          fs.unlinkSync(filePath);
        } else {
          return;
        }
      }

      logger.debug(`正在下载 ${url} 到 ${filePath}`);
      try {
        await fse.ensureDir(path.dirname(filePath));

        if (useChunked) {
          await chunkedDownload(url, filePath);
        } else {
          await simpleDownload(url, filePath);
        }

        logger.debug(`下载 ${url} 成功`);

        if (expectedHash && !verifySHA1(filePath, expectedHash)) {
          throw new Error(`文件哈希验证失败，下载的文件可能已损坏`);
        }
      } catch (error) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        throw error;
      }
    },
    {
      retries: 3,
      onFailedAttempt: (error) => {
        logger.warn(`${url} 下载失败，正在重试 (${error.attemptNumber}/3)`);
      },
    },
  );
}

export async function fastdownload(data: [string, string] | string[][], enableHashVerify = true) {
  let downloadList: Array<[string, string, string?]>;

  if (Array.isArray(data[0]) && typeof data[0][0] === 'string') {
    downloadList = (data as string[][]).map((item): [string, string, string?] =>
      item.length >= 3 ? [item[0], item[1], item[2]] : [item[0], item[1]],
    );
  } else {
    const singleItem = data as [string, string];
    downloadList = [[singleItem[0], singleItem[1]]];
  }

  logger.info(`开始快速下载 ${downloadList.length} 个文件${enableHashVerify ? '（启用 hash 验证）' : ''}`);

  return pMap(
    downloadList,
    async (item: [string, string, string?]) => {
      const [url, filePath, expectedHash] = item;
      try {
        await downloadFile(url, filePath, enableHashVerify ? expectedHash : undefined);
      } catch (error) {
        logger.error(`${url} 下载失败，已重试 3 次`, error);
        throw error;
      }
    },
    { concurrency: 16 },
  );
}

export async function Wfastdownload(
  data: string[][],
  ws: any,
  enableHashVerify = true,
  useChunked = false,
) {
  logger.info(
    `开始 Web 下载 ${data.length} 个文件${enableHashVerify ? '（启用 hash 验证）' : ''}${useChunked ? '（启用分块下载）' : ''}`,
  );
  const completed = new Set<number>();

  return pMap(
    data,
    async (item: string[], index: number) => {
      const [url, filePath, expectedHash] = item;
      try {
        await downloadFile(url, filePath, enableHashVerify ? expectedHash : undefined, false, useChunked);
        if (!completed.has(index)) {
          completed.add(index);
          sendWS('downloading', { index: completed.size, total: data.length, name: filePath });
        }
      } catch (error) {
        logger.error(`${url} 下载失败，已重试 3 次`, error);
        throw error;
      }
    },
    { concurrency: 24 },
  );
}
