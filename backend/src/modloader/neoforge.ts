import fse from "fs-extra";
import fs from "node:fs";
import { Forge } from "./forge.js";
import { Config } from "../utils/config.js";
import { Got, got } from "got";
import { execPromise, version_compare, fastdownload } from "../utils/utils.js";
import { yauzl_promise } from "../utils/ziplib.js";
import { logger } from "../utils/logger.js";

interface IVersion {
  downloads: {
    server_mappings: {
      url: string;
    };
  };
}

export class NeoForge extends Forge {
  got: Got;

  constructor(minecraft: string, loaderVersion: string, path: string) {
    super(minecraft, loaderVersion, path);
    const config = Config.getConfig();
    this.got = got.extend({
      headers: { "User-Agent": "DeEarthX" },
      hooks: {
        init: [
          (options) => {
            if (config.mirror?.bmclapi) {
              options.prefixUrl = "https://bmclapi2.bangbang93.com/";
            } else {
              options.prefixUrl = "https://maven.neoforged.net/releases/";
            }
          }
        ]
      }
    });
  }

  async setup() {
    await this.installer();
    const config = Config.getConfig();
    if (config.mirror.bmclapi) {
      await this.library();
    }
    await this.install();
    if (version_compare(this.minecraft, "1.18") === -1) {
      await this.wshell();
    }
  }

  async library() {
    const _downlist: [string, string][] = [];
    const data = await fs.promises.readFile(`${this.path}/neoforge-${this.minecraft}-${this.loaderVersion}-installer.jar`);
    const zip = await yauzl_promise(data);

    for (const entry of zip) {
      if (entry.fileName === "version.json" || entry.fileName === "install_profile.json") {
        const entryData = await entry.ReadEntry;
        JSON.parse(entryData.toString()).libraries.forEach(async (e: any) => {
          const t = e.downloads.artifact.path;
          _downlist.push([`https://bmclapi2.bangbang93.com/maven/${t}`, `${this.path}/libraries/${t}`]);
        });
      }
    }

    const downlist = [...new Set(_downlist)];
    await fastdownload(downlist);
  }

  async install() {
    const config = Config.getConfig();
    const javaCmd = config.javaPath || 'java';
    let cmd = `${javaCmd} -jar neoforge-${this.minecraft}-${this.loaderVersion}-installer.jar --installServer`;
    if (config.mirror.bmclapi) {
      cmd += ` --mirror https://bmclapi2.bangbang93.com/maven/`;
    }
    await execPromise(cmd, { cwd: this.path }).catch((e) => {
      logger.error(`NeoForge 安装失败: ${e}`);
      throw e;
    });
  }

  async installer() {
    const config = Config.getConfig();
    let url: string;
    if (config.mirror?.bmclapi) {
      url = `neoforge/version/${this.loaderVersion}/download/installer.jar`;
    } else {
      url = `net/neoforged/neoforge/${this.loaderVersion}/neoforge-${this.loaderVersion}-installer.jar`;
    }
    const res = (await this.got.get(url)).rawBody;
    await fse.outputFile(`${this.path}/neoforge-${this.minecraft}-${this.loaderVersion}-installer.jar`, res);
  }

  protected async wshell() {
    const config = Config.getConfig();
    const javaCmd = config.javaPath || 'java';
    const cmd = `${javaCmd} -jar neoforge-${this.minecraft}-${this.loaderVersion}.jar`;
    await fs.promises.writeFile(`${this.path}/run.bat`, `@echo off\n${cmd}`);
    await fs.promises.writeFile(`${this.path}/run.sh`, `#!/bin/bash\n${cmd}`);
  }
}
