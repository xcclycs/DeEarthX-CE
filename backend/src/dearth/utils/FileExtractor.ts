import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { JarParser } from "../../utils/jar-parser.js";
import { logger } from "../../utils/logger.js";
import { IFileInfo } from "../types.js";

export class FileExtractor {
  private readonly modsPath: string;

  constructor(modsPath: string) {
    this.modsPath = path.isAbsolute(modsPath) ? modsPath : path.resolve(modsPath);
  }

  async extractFilesInfo(): Promise<IFileInfo[]> {
    const jarFiles = this.getJarFiles();
    const files: IFileInfo[] = [];
    
    logger.info("获取文件信息", { 文件数量: jarFiles.length });

    for (const jarFilename of jarFiles) {
      const fullPath = path.join(this.modsPath, jarFilename);

      try {
        const hash = await this.calculateFileHash(fullPath);
        const mixins = await JarParser.extractMixinsFromFile(fullPath);
        const infos = await JarParser.extractModInfoFromFile(fullPath);

        files.push({
          filename: fullPath,
          hash,
          mixins,
          infos,
        });

        logger.debug("文件已处理", { 文件名: fullPath, 绝对路径: path.resolve(fullPath), Mixin数量: mixins.length });
      } catch (error: any) {
        logger.error("处理文件时出错", { 文件名: fullPath, 错误: error.message });
      }
    }

    logger.debug("文件信息收集完成", { 已处理文件: files.length });
    return files;
  }

  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha1');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (chunk) => {
        hash.update(chunk);
      });
      
      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  private getJarFiles(): string[] {
    if (!fs.existsSync(this.modsPath)) {
      fs.mkdirSync(this.modsPath, { recursive: true });
    }
    return fs.readdirSync(this.modsPath).filter(f => f.endsWith(".jar"));
  }
}
