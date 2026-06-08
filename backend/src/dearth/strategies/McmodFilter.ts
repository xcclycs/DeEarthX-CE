import { IFilterStrategy, IFileInfo } from "../types.js";
import { logger } from "../../utils/logger.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class McmodFilter implements IFilterStrategy {
  name = "McmodFilter";
  private readonly MODDATA_PATH: string;
  /** slug → MC百科 ID 映射 */
  private slugToId: Map<string, number> | null = null;

  constructor() {
    // 尝试定位 moddata.txt（相对于项目根目录或可执行文件目录）
    const dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
    this.MODDATA_PATH = path.resolve(dirname, "../../../moddata.txt");
  }

  async filter(files: IFileInfo[]): Promise<string[]> {
    const slugMap = this.loadModData();
    if (!slugMap) {
      logger.warn("moddata.txt 加载失败，跳过 Mcmod 检查");
      return [];
    }

    const clientMods: string[] = [];

    for (const file of files) {
      const modIds = this.extractModIds(file);
      if (modIds.length === 0) {
        logger.debug(`无法从 ${file.filename} 提取模组 ID，跳过 mcmod 检查`);
        continue;
      }

      let mcmodId: number | null = null;
      for (const modId of modIds) {
        mcmodId = slugMap.get(modId) ?? null;
        if (mcmodId !== null) break;
      }

      if (mcmodId === null) {
        logger.debug(`未在 moddata.txt 中找到 ${file.filename} 的映射，走常规方法`);
        continue;
      }

      const isClientOnly = await this.checkMcmodPage(mcmodId);
      if (isClientOnly === true) {
        clientMods.push(file.filename);
        logger.info(`Mcmod 判定客户端模组: ${file.filename} (ID=${mcmodId})`);
      }
      // isClientOnly === false → 服务端需装，不筛选
      // isClientOnly === null → 查询失败，走常规方法
    }

    logger.info("Mcmod 筛选完成", { 客户端模组数: clientMods.length });
    return clientMods;
  }

  /**
   * 加载并解析 moddata.txt，建立 slug → MC百科 ID 映射
   */
  private loadModData(): Map<string, number> | null {
    if (this.slugToId) return this.slugToId;

    try {
      if (!fs.existsSync(this.MODDATA_PATH)) {
        logger.warn(`moddata.txt 不存在: ${this.MODDATA_PATH}`);
        return null;
      }

      const content = fs.readFileSync(this.MODDATA_PATH, "utf-8");
      const lines = content.split(/\r?\n/);
      // 最后一行是排名数据，移除
      lines.pop();
      // 移除最后的空行
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
      }

      const map = new Map<string, number>();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const lineNumber = i + 1; // 行号 = MC百科 ID

        // 处理 `¨` 分隔的同行多条记录
        for (const entry of line.split("¨")) {
          const trimmed = entry.trim();
          if (!trimmed) continue;

          // 格式: curseforge-slug@modrinth-slug|中文名
          const pipeIdx = trimmed.indexOf("|");
          const slugPart = pipeIdx >= 0 ? trimmed.substring(0, pipeIdx) : trimmed;

          if (!slugPart) continue;

          const atIdx = slugPart.indexOf("@");

          if (atIdx < 0) {
            // 无 @ → 仅有 CurseForge slug
            if (slugPart) map.set(slugPart, lineNumber);
          } else {
            const cfSlug = slugPart.substring(0, atIdx);
            const mrSlug = slugPart.substring(atIdx + 1);

            if (cfSlug) map.set(cfSlug, lineNumber);
            if (mrSlug) map.set(mrSlug, lineNumber);
          }
        }
      }

      this.slugToId = map;
      logger.info(`moddata.txt 加载完成，共 ${map.size} 条映射`);
      return map;
    } catch (error) {
      logger.error("加载 moddata.txt 失败", error);
      return null;
    }
  }

  /**
   * 从模组文件中提取所有可能的模组 ID（用于匹配 slug）
   */
  private extractModIds(file: IFileInfo): string[] {
    const ids: string[] = [];

    for (const info of file.infos) {
      try {
        if (info.name.endsWith("fabric.mod.json")) {
          const data = JSON.parse(info.data);
          if (data.id) ids.push(data.id);
        } else if (info.name.endsWith("mods.toml") || info.name.endsWith("neoforge.mods.toml")) {
          const lines = info.data.split("\n");
          let inModsSection = false;
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "[[mods]]") {
              inModsSection = true;
              continue;
            }
            if (inModsSection && trimmed.startsWith("[") && !trimmed.startsWith("[[mods]]")) {
              break;
            }
            if (inModsSection) {
              const match = trimmed.match(/^modId\s*=\s*"([^"]+)"/);
              if (match) {
                ids.push(match[1]);
                break;
              }
            }
          }
        } else if (info.name === "modrinth.index.json" || info.name === "modrinth.json") {
          const data = JSON.parse(info.data);
          if (data.project_id) ids.push(data.project_id);
        }
      } catch {
        continue;
      }
    }

    return ids;
  }

  /**
   * 访问 MCMOD 详情页，解析运行环境信息
   * @param mcmodId MC百科 ID（行号）
   * @returns true=客户端模组, false=服务端需装, null=查询失败
   */
  private async checkMcmodPage(mcmodId: number): Promise<boolean | null> {
    const url = `https://www.mcmod.cn/class/${mcmodId}.html`;
    logger.debug(`获取 MCMOD 页面: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "DeEarthX/1.0.0",
          "Accept": "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.warn(`MCMOD 页面请求失败: ${url} (${response.status})`);
        return null;
      }

      const html = await response.text();

      // 格式: <li class="col-lg-4">运行环境: 客户端需装, 服务端XX</li>
      const envMatch = html.match(/<li class="col-lg-4">运行环境:.*?服务端([^<]+)<\/li>/);

      if (!envMatch) {
        logger.debug(`MCMOD 页面无运行环境信息: ${url}`);
        return null;
      }

      const serverSide = envMatch[1].trim();
      logger.debug(`MCMOD ID=${mcmodId}: 服务端状态=[${serverSide}]`);

      // 如果服务端不需要/无需 → 客户端模组
      if (serverSide.includes("无需") || serverSide.includes("不需要") || serverSide.includes("unsupported")) {
        return true;
      }

      // 服务端需装 → 不是客户端模组
      return false;
    } catch (error) {
      logger.warn(`MCMOD 页面访问失败: ${url}`, error);
      return null;
    }
  }
}