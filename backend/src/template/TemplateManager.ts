import fs from "node:fs/promises";
import path from "node:path";
import { getAppDir } from "../utils/utils.js";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";

interface TemplateMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  created: string;
  type: string;
}

export class TemplateManager {
  private readonly templatesPath: string;

  constructor(templatesPath?: string) {
    this.templatesPath = templatesPath || path.join(getAppDir(), "templates");
  }

  async ensureDefaultTemplate(): Promise<void> {
    // 确保templates文件夹存在
    await fs.mkdir(this.templatesPath, { recursive: true });
    
    const examplePath = path.join(this.templatesPath, "example");
    const metadataPath = path.join(examplePath, "metadata.json");
    const dataPath = path.join(examplePath, "data");

    try {
      await fs.access(metadataPath);
    } catch {
      await this.createTemplate("example", {
        name: "example",
        version: "1.0.0",
        description: "Example template for DeEarthX",
        author: "DeEarthX",
        created: new Date().toISOString().split("T")[0],
        type: "template",
      });
      
      await fs.mkdir(dataPath, { recursive: true });
      
      const readmePath = path.join(dataPath, "README.txt");
      await fs.writeFile(readmePath, "This is an example template for DeEarthX.\nPlace your server files in this data folder.");
    }
  }

  async createTemplate(name: string, metadata: Partial<TemplateMetadata>): Promise<void> {
    const templatePath = path.join(this.templatesPath, name);

    await fs.mkdir(templatePath, { recursive: true });

    const defaultMetadata: TemplateMetadata = {
      name,
      version: "1.0.0",
      description: "",
      author: "",
      created: new Date().toISOString().split("T")[0],
      type: "template",
      ...metadata,
    };

    const metadataPath = path.join(templatePath, "metadata.json");
    await fs.writeFile(metadataPath, JSON.stringify(defaultMetadata, null, 2));
    
    const dataPath = path.join(templatePath, "data");
    await fs.mkdir(dataPath, { recursive: true });
  }

  async getTemplates(): Promise<Array<{ id: string; metadata: TemplateMetadata }>> {
    try {
      // 确保templates文件夹存在
      await fs.mkdir(this.templatesPath, { recursive: true });
      
      const entries = await fs.readdir(this.templatesPath, { withFileTypes: true });
      const templates: Array<{ id: string; metadata: TemplateMetadata }> = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const templateId = entry.name;
          const metadataPath = path.join(this.templatesPath, templateId, "metadata.json");

          try {
            const metadataContent = await fs.readFile(metadataPath, "utf-8");
            const metadata: TemplateMetadata = JSON.parse(metadataContent);
            templates.push({ id: templateId, metadata });
          } catch (error) {
            console.warn(`Failed to read metadata for template ${templateId}:`, error);
          }
        }
      }

      return templates;
    } catch (error) {
      console.error("Failed to read templates directory:", error);
      return [];
    }
  }

  async updateTemplate(templateId: string, metadata: Partial<TemplateMetadata>): Promise<void> {
    const templatePath = path.join(this.templatesPath, templateId);
    const metadataPath = path.join(templatePath, "metadata.json");

    try {
      await fs.access(metadataPath);
    } catch {
      throw new Error(`Template ${templateId} does not exist`);
    }

    const existingMetadataContent = await fs.readFile(metadataPath, "utf-8");
    const existingMetadata: TemplateMetadata = JSON.parse(existingMetadataContent);

    const updatedMetadata: TemplateMetadata = {
      ...existingMetadata,
      ...metadata,
    };

    await fs.writeFile(metadataPath, JSON.stringify(updatedMetadata, null, 2));
  }

  async exportTemplate(templateId: string, outputPath: string): Promise<void> {
    const templatePath = path.join(this.templatesPath, templateId);
    const metadataPath = path.join(templatePath, "metadata.json");

    try {
      await fs.access(metadataPath);
    } catch {
      throw new Error(`Template ${templateId} does not exist`);
    }

    const zipfile = new yazl.ZipFile();
    
    // 读取并添加metadata.json
    const metadataContent = await fs.readFile(metadataPath, "utf-8");
    zipfile.addBuffer(Buffer.from(metadataContent), "metadata.json");

    // 添加data目录
    const dataPath = path.join(templatePath, "data");
    try {
      await fs.access(dataPath);
      const dataFiles = await this.getFilesRecursively(dataPath);
      
      for (const file of dataFiles) {
        const relativePath = path.relative(templatePath, file);
        zipfile.addFile(file, relativePath);
      }
    } catch {
      // data目录不存在，跳过
    }

    // 生成zip文件
    return new Promise((resolve, reject) => {
      zipfile.outputStream.pipe(createWriteStream(outputPath))
        .on("close", () => resolve())
        .on("error", (err) => reject(err));
      zipfile.end();
    });
  }

  async importTemplate(zipBuffer: Buffer, templateId?: string): Promise<string> {
    const newTemplateId = templateId || `template-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const templatePath = path.join(this.templatesPath, newTemplateId);

    // 确保模板目录存在
    await fs.mkdir(templatePath, { recursive: true });

    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }

        zipfile.on("entry", async (entry) => {
          if (entry.fileName.endsWith("/")) {
            // 目录，跳过
            zipfile.readEntry();
            return;
          }

          const entryPath = path.join(templatePath, entry.fileName);
          const entryDir = path.dirname(entryPath);

          // 确保目录存在
          await fs.mkdir(entryDir, { recursive: true });

          // 读取并写入文件
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }

            const writeStream = createWriteStream(entryPath);
            pipeline(readStream, writeStream)
              .then(() => zipfile.readEntry())
              .catch((err) => reject(err));
          });
        });

        zipfile.on("end", () => resolve(newTemplateId));
        zipfile.on("error", (err) => reject(err));

        zipfile.readEntry();
      });
    });
  }

  private async getFilesRecursively(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.getFilesRecursively(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }
}