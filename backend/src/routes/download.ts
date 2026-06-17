import { Request, Response } from "express";
import got from "got";
import { logger } from "../utils/logger.js";

const cache = new Map<string, { data: any; time: number }>();

// 镜像源回退辅助函数
const BMCLAPI_URL = "https://bmclapi2.bangbang93.com";
const ORIGIN_URLS: Record<string, string> = {
  "minecraft-versions": "https://piston-meta.mojang.com/mc/game/version_manifest.json",
  "forge-promos": "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
  "forge": "https://maven.minecraftforge.net/net/minecraftforge/forge",
  "neoforge": "https://maven.neoforged.net/releases/net/neoforged/neoforge",
  "fabric": "https://meta.fabricmc.net/v1/versions/loader",
};

async function fetchWithFallback<T>(
  bmclapiPath: string,
  originUrl: string,
  cacheKey: string,
  options?: { timeout?: number; headers?: Record<string, string> }
): Promise<T> {
  const bmclapiUrl = `${BMCLAPI_URL}${bmclapiPath}`;
  
  try {
    const data = await got.get(bmclapiUrl, {
      headers: { ...options?.headers, "User-Agent": "DeEarthX" },
      timeout: { request: options?.timeout || 30000 },
      dnsCache: true,
    }).json<T>();
    return data;
  } catch (err: any) {
    logger.warn(`BMCLAPI 请求失败 (${bmclapiUrl})，回退到原始源: ${err.message}`);
    try {
      const data = await got.get(originUrl, {
        headers: { ...options?.headers, "User-Agent": "DeEarthX" },
        timeout: { request: options?.timeout || 30000 },
        dnsCache: true,
      }).json<T>();
      return data;
    } catch (originErr: any) {
      logger.error(`原始源也请求失败 (${originUrl}): ${originErr.message}`);
      throw new Error(`所有镜像源均不可用: ${err.message}`);
    }
  }
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry) return entry.data as T;
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, time: Date.now() });
}

interface MinecraftVersionEntry {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
}

interface ForgeBuildFile {
  format: string;
  category: string;
  hash: string;
}

interface ForgeBuild {
  version: string;
  mcversion: string;
  files: ForgeBuildFile[];
}

interface ForgePromoEntry {
  name: string;
  build: {
    mcversion: string;
    version: string;
    files: ForgeBuildFile[];
  };
}

interface NeoForgeBuild {
  version: string;
  mcversion: string;
  installerPath: string;
}

interface FabricLoaderEntry {
  loader: {
    version: string;
    stable: boolean;
  };
}

export function loaderDisplayName(loader: string): string {
  switch (loader) {
    case "forge": return "Forge";
    case "neoforge": return "NeoForge";
    case "fabric":
    case "fabric-loader": return "Fabric";
    default: return loader;
  }
}

export function setupDownloadRoutes(app: any): void {

  app.get("/download/minecraft-versions", async (_req: Request, res: Response) => {
    try {
      const cacheKey = "minecraft-versions";
      const cached = getCached<{ versions: { id: string; type: string }[] }>(cacheKey);
      if (cached) return res.json(cached);

      const data = await fetchWithFallback<{ versions: MinecraftVersionEntry[] }>(
        "/mc/game/version_manifest.json",
        "https://piston-meta.mojang.com/mc/game/version_manifest.json",
        cacheKey
      );

      const result = { versions: data.versions.map(v => ({ id: v.id, type: v.type })) };
      setCache(cacheKey, result);
      res.json(result);
    } catch (err) {
      logger.error("获取 Minecraft 版本列表失败", err as Error);
      res.status(500).json({ error: "获取版本列表失败", details: (err as Error).message });
    }
  });

  app.get("/download/forge-promos", async (_req: Request, res: Response) => {
    try {
      const cacheKey = "forge-promos";
      const cached = getCached<Record<string, { latest?: string; recommended?: string }>>(cacheKey);
      if (cached) return res.json(cached);

      const data = await fetchWithFallback<ForgePromoEntry[]>(
        "/forge/promos",
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
        cacheKey
      );

      const promos: Record<string, { latest?: string; recommended?: string }> = {};
      for (const entry of data) {
        if (!entry.build?.mcversion) continue;
        if (!promos[entry.build.mcversion]) promos[entry.build.mcversion] = {};
        if (entry.name.endsWith("-latest")) promos[entry.build.mcversion].latest = entry.build.version;
        else if (entry.name.endsWith("-recommended")) promos[entry.build.mcversion].recommended = entry.build.version;
      }
      setCache(cacheKey, promos);
      res.json(promos);
    } catch (err) {
      logger.error("获取 Forge Promos 失败", err as Error);
      res.status(500).json({ error: "获取 Forge Promos 失败", details: (err as Error).message });
    }
  });

  app.get("/download/forge-versions", async (req: Request, res: Response) => {
    try {
      const mcver = req.query.mcver as string;
      if (!mcver) return res.status(400).json({ error: "缺少 mcver 参数" });

      const cacheKey = `forge-versions:${mcver}`;
      const cached = getCached<{ version: string; mcversion: string; hash?: string }[]>(cacheKey);
      if (cached) return res.json(cached);

      const data = await fetchWithFallback<ForgeBuild[]>(
        `/forge/minecraft/${mcver}`,
        `https://maven.minecraftforge.net/net/minecraftforge/forge/index_${mcver}.json`,
        cacheKey
      );

      const versions = data.map(v => {
        const installer = v.files?.find(f => f.category === "installer" && f.format === "jar");
        return { version: v.version, mcversion: v.mcversion, hash: installer?.hash };
      });
      setCache(cacheKey, versions);
      res.json(versions);
    } catch (err) {
      logger.error("获取 Forge 版本列表失败", err as Error);
      res.status(500).json({ error: "获取 Forge 版本列表失败", details: (err as Error).message });
    }
  });

  app.get("/download/neoforge-versions", async (req: Request, res: Response) => {
    try {
      const mcver = req.query.mcver as string;
      if (!mcver) return res.status(400).json({ error: "缺少 mcver 参数" });

      const cacheKey = `neoforge-versions:${mcver}`;
      const cached = getCached<any[]>(cacheKey);
      if (cached) return res.json(cached);

      const data = await fetchWithFallback<NeoForgeBuild[]>(
        `/neoforge/list/${mcver}`,
        `https://maven.neoforged.net/releases/net/neoforged/neoforge/index_${mcver}.json`,
        cacheKey
      );

      const versions = data.map((v, i) => ({
        version: v.version, mcversion: v.mcversion,
        installerPath: v.installerPath, latest: i === data.length - 1
      }));
      setCache(cacheKey, versions);
      res.json(versions);
    } catch (err) {
      logger.error("获取 NeoForge 版本列表失败", err as Error);
      res.status(500).json({ error: "获取 NeoForge 版本列表失败", details: (err as Error).message });
    }
  });

  app.get("/download/fabric-versions", async (req: Request, res: Response) => {
    try {
      const mcver = req.query.mcver as string;
      if (!mcver) return res.status(400).json({ error: "缺少 mcver 参数" });

      const cacheKey = `fabric-versions:${mcver}`;
      const cached = getCached<{ version: string; stable: boolean }[]>(cacheKey);
      if (cached) return res.json(cached);

      const data = await fetchWithFallback<FabricLoaderEntry[]>(
        `/fabric-meta/v1/versions/loader/${mcver}`,
        `https://meta.fabricmc.net/v1/versions/loader/${mcver}`,
        cacheKey
      );

      const versions = data.map(v => ({ version: v.loader.version, stable: v.loader.stable }));
      versions.sort((a, b) => (b.stable ? 1 : 0) - (a.stable ? 1 : 0));
      setCache(cacheKey, versions);
      res.json(versions);
    } catch (err) {
      logger.error("获取 Fabric 版本列表失败", err as Error);
      res.status(500).json({ error: "获取 Fabric 版本列表失败", details: (err as Error).message });
    }
  });
}
