import { IInfoFile, IMixinFile } from "../dearth/types.js";
import { yauzl_promise } from "./ziplib.js";
import toml from "smol-toml";
import fs from "node:fs";
import yauzl from "yauzl";

export class JarParser {
  static async extractModInfo(jarData: Buffer): Promise<IInfoFile[]> {
    return this.extractModInfoFromBuffer(jarData);
  }

  static async extractMixins(jarData: Buffer): Promise<IMixinFile[]> {
    return this.extractMixinsFromBuffer(jarData);
  }

  static async extractModInfoFromFile(filePath: string): Promise<IInfoFile[]> {
    return new Promise((resolve, reject) => {
      const infos: IInfoFile[] = [];
      
      yauzl.open(filePath, (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }
        
        zipfile.on("entry", (entry) => {
          if (entry.fileName.endsWith("neoforge.mods.toml") || entry.fileName.endsWith("mods.toml") || entry.fileName.endsWith("fabric.mod.json")) {
            zipfile.openReadStream(entry, (err, stream) => {
              if (err) {
                return;
              }
              
              const chunks: Buffer[] = [];
              stream.on("data", (chunk) => {
                chunks.push(chunk);
              });
              
              stream.on("end", () => {
                try {
                  const data = Buffer.concat(chunks);
                  if (entry.fileName.endsWith(".toml")) {
                    infos.push({ name: entry.fileName, data: JSON.stringify(toml.parse(data.toString())) });
                  } else if (entry.fileName.endsWith(".json")) {
                    infos.push({ name: entry.fileName, data: data.toString() });
                  }
                } catch (error) {
                  // 忽略解析错误
                }
              });
            });
          }
        });
        
        zipfile.on("end", () => {
          resolve(infos);
        });
        
        zipfile.on("error", (err) => {
          reject(err);
        });
      });
    });
  }

  static async extractMixinsFromFile(filePath: string): Promise<IMixinFile[]> {
    return new Promise((resolve, reject) => {
      const mixins: IMixinFile[] = [];
      
      yauzl.open(filePath, (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }
        
        zipfile.on("entry", (entry) => {
          if (entry.fileName.endsWith(".mixins.json") && !entry.fileName.includes("/")) {
            zipfile.openReadStream(entry, (err, stream) => {
              if (err) {
                return;
              }
              
              const chunks: Buffer[] = [];
              stream.on("data", (chunk) => {
                chunks.push(chunk);
              });
              
              stream.on("end", () => {
                try {
                  const data = Buffer.concat(chunks);
                  mixins.push({ name: entry.fileName, data: data.toString() });
                } catch (error) {
                  // 忽略解析错误
                }
              });
            });
          }
        });
        
        zipfile.on("end", () => {
          resolve(mixins);
        });
        
        zipfile.on("error", (err) => {
          reject(err);
        });
      });
    });
  }

  private static async extractModInfoFromBuffer(jarData: Buffer): Promise<IInfoFile[]> {
    const infos: IInfoFile[] = [];
    const zipEntries = await yauzl_promise(jarData);
    
    for (const entry of zipEntries) {
      try {
        if (entry.fileName.endsWith("neoforge.mods.toml") || entry.fileName.endsWith("mods.toml")) {
          const data = await entry.ReadEntry;
          infos.push({ name: entry.fileName, data: JSON.stringify(toml.parse(data.toString())) });
        } else if (entry.fileName.endsWith("fabric.mod.json")) {
          const data = await entry.ReadEntry;
          infos.push({ name: entry.fileName, data: data.toString() });
        }
      } catch (error: any) {
        continue;
      }
    }

    return infos;
  }

  private static async extractMixinsFromBuffer(jarData: Buffer): Promise<IMixinFile[]> {
    const mixins: IMixinFile[] = [];
    const zipEntries = await yauzl_promise(jarData);

    for (const entry of zipEntries) {
      if (entry.fileName.endsWith(".mixins.json") && !entry.fileName.includes("/")) {
        try {
          const data = await entry.ReadEntry;
          mixins.push({ name: entry.fileName, data: data.toString() });
        } catch (error: any) {
          continue;
        }
      }
    }

    return mixins;
  }
}
