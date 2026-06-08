import { IFilterStrategy, IFileInfo } from "../types.js";
import { logger } from "../../utils/logger.js";

export class McmodFilter implements IFilterStrategy {
  name = "McmodFilter";
  private readonly SEARCH_URL = "https://www.mcmod.cn/s";

  async filter(files: IFileInfo[]): Promise<string[]> {
    const clientMods: string[] = [];

    for (const file of files) {
      const modNames = this.extractModNames(file);
      if (modNames.length === 0) {
        logger.debug(`无法从 ${file.filename} 提取模组名，跳过 mcmod 检查`);
        continue;
      }

      let isClientOnly: boolean | null = null;

      for (const name of modNames) {
        isClientOnly = await this.checkMcmod(name);
        if (isClientOnly !== null) break; // Found result on mcmod
      }

      if (isClientOnly === true) {
        clientMods.push(file.filename);
        logger.info(`Mcmod 判定客户端模组: ${file.filename}`);
      }
      // isClientOnly === false → 服务端需装，不筛选
      // isClientOnly === null → 未在 mcmod 找到，走常规方法
    }

    logger.info("Mcmod 筛选完成", { 客户端模组数: clientMods.length });
    return clientMods;
  }

  /**
   * 从模组文件中提取所有可能的模组名称/ID
   */
  private extractModNames(file: IFileInfo): string[] {
    const names: string[] = [];

    for (const info of file.infos) {
      try {
        if (info.name.endsWith("fabric.mod.json")) {
          const data = JSON.parse(info.data);
          if (data.id) names.push(data.id);
        } else if (info.name.endsWith("mods.toml") || info.name.endsWith("neoforge.mods.toml")) {
          // 从 TOML 中提取 modId（简单的行匹配）
          const lines = info.data.split("\n");
          let inModsSection = false;
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "[[mods]]") {
              inModsSection = true;
              continue;
            }
            if (inModsSection && trimmed.startsWith("[") && !trimmed.startsWith("[[mods]]")) {
              break; // 离开 mods 区域
            }
            if (inModsSection) {
              const match = trimmed.match(/^modId\s*=\s*"([^"]+)"/);
              if (match) {
                names.push(match[1]);
                break; // 取第一个 mod 的 id
              }
            }
          }
        } else if (info.name === "modrinth.index.json" || info.name === "modrinth.json") {
          const data = JSON.parse(info.data);
          if (data.project_id) names.push(data.project_id);
          if (data.name) names.push(data.name);
        }
      } catch {
        continue;
      }
    }

    return names;
  }

  /**
   * 搜索 mcmod.cn 并解析运行环境信息
   * @returns true=客户端模组(需筛选), false=服务端需装(不筛选), null=未在mcmod找到
   */
  private async checkMcmod(name: string): Promise<boolean | null> {
    try {
      const searchUrl = `${this.SEARCH_URL}?key=${encodeURIComponent(name)}&site=class&filter=0`;
      logger.debug(`搜索 mcmod: ${searchUrl}`);

      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "DeEarthX/1.0.0",
          "Accept": "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.warn(`Mcmod 搜索请求失败: ${response.status}`);
        return null;
      }

      const html = await response.text();

      // 在搜索结果中查找运行环境信息
      // 格式: <li class="col-lg-4">运行环境: 客户端需装, 服务端XX</li>
      const envMatch = html.match(/<li class="col-lg-4">运行环境:.*?服务端([^<]+)<\/li>/);

      if (!envMatch) {
        logger.debug(`Mcmod 未找到模组: ${name}`);
        return null; // 未在 mcmod 找到
      }

      const serverSide = envMatch[1].trim();
      logger.debug(`Mcmod 查询 ${name}: 服务端状态=[${serverSide}]`);

      // 如果服务端不需要/无需 → 客户端模组
      if (serverSide.includes("无需") || serverSide.includes("不需要") || serverSide.includes("unsupported")) {
        return true;
      }

      // 服务端需装 → 不是客户端模组
      return false;
    } catch (error) {
      logger.warn(`Mcmod 搜索失败: ${name}`, error);
      return null; // 出错时走常规方法
    }
  }
}