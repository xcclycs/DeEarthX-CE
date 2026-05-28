import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, ChildProcess } from "node:child_process";
import { logger } from "../utils/logger.js";
import { getAppDir } from "../utils/utils.js";
import type { Router } from "express";
import type { Server as SocketIOServer } from "socket.io";
import {
  PluginManifest,
  PluginConfig,
  PluginHooks,
  LoadedPlugin,
  PluginHookContext,
  PluginHookName,
  PLUGIN_HOOK_NAMES
} from "./types.js";

const PLUGINS_DIR = path.join(getAppDir(), "plugins");
const PLUGIN_CONFIG_FILE = "plugin-configs.json";

export class PluginManager {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginRoutes: Router[] = [];
  private io: SocketIOServer | null = null;

  async initialize(io?: SocketIOServer): Promise<void> {
    this.io = io || null;
    await fsp.mkdir(PLUGINS_DIR, { recursive: true });
    await this.loadAllPlugins();
    logger.info(`插件系统初始化完成，已加载 ${this.plugins.size} 个插件`);
  }

  async loadAllPlugins(): Promise<void> {
    const globalConfigs = this.readGlobalPluginConfigs();

    try {
      const entries = await fsp.readdir(PLUGINS_DIR, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          await this.loadPlugin(entry.name, globalConfigs);
        }
      }
    } catch (err) {
      logger.error("读取插件目录失败", err as Error);
    }
  }

  private async loadPlugin(pluginId: string, globalConfigs: Record<string, any>): Promise<boolean> {
    const pluginDir = path.join(PLUGINS_DIR, pluginId);
    const manifestPath = path.join(pluginDir, "manifest.json");

    try {
      await fsp.access(manifestPath);
    } catch {
      return false;
    }

    try {
      const manifestContent = await fsp.readFile(manifestPath, "utf-8");
      const manifest: PluginManifest = JSON.parse(manifestContent);

      if (!manifest.id || !manifest.name || !manifest.version || !manifest.author) {
        logger.warn(`插件 ${pluginId} 的 manifest.json 缺少必要字段`);
        return false;
      }

      manifest.id = pluginId;

      const pluginConfig = this.readPluginConfig(pluginId, manifest, globalConfigs);

      let hooks: PluginHooks = {};
      if (manifest.main) {
        const mainPath = path.resolve(pluginDir, manifest.main);
        if (fs.existsSync(mainPath)) {
          try {
            const pluginModule = await import(mainPath);
            hooks = pluginModule.default || pluginModule.hooks || {};
          } catch (err) {
            logger.error(`加载插件 ${pluginId} 的主模块失败`, err as Error);
          }
        }
      }

      const loadedPlugin: LoadedPlugin = {
        manifest,
        config: pluginConfig,
        hooks,
        enabled: pluginConfig.enabled
      };

      this.plugins.set(pluginId, loadedPlugin);

      if (loadedPlugin.enabled) {
        await this.executeHookOnPlugin(loadedPlugin, 'onLoad');
        await this.executeHookOnPlugin(loadedPlugin, 'onEnable');

        this.startPluginPrograms(loadedPlugin);
      }

      logger.info(`插件已加载: ${manifest.name} v${manifest.version} (${loadedPlugin.enabled ? '已启用' : '已禁用'})`);
      return true;
    } catch (err) {
      logger.error(`加载插件 ${pluginId} 失败`, err as Error);
      return false;
    }
  }

  async unloadPlugin(pluginId: string, keepConfig: boolean = true): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    if (plugin.enabled) {
      await this.executeHookOnPlugin(plugin, 'onDisable');
      await this.executeHookOnPlugin(plugin, 'onUnload');
      this.stopPluginPrograms(plugin);
    }

    this.plugins.delete(pluginId);

    if (!keepConfig) {
      this.deletePluginConfig(pluginId);
    }

    logger.info(`插件已卸载: ${plugin.manifest.name}`);
    return true;
  }

  async enablePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    if (plugin.enabled) return true;

    plugin.enabled = true;
    plugin.config.enabled = true;
    this.savePluginConfig(pluginId, plugin.config);

    await this.executeHookOnPlugin(plugin, 'onEnable');
    this.startPluginPrograms(plugin);

    logger.info(`插件已启用: ${plugin.manifest.name}`);
    return true;
  }

  async disablePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    if (!plugin.enabled) return true;

    plugin.enabled = false;
    plugin.config.enabled = false;
    this.savePluginConfig(pluginId, plugin.config);

    await this.executeHookOnPlugin(plugin, 'onDisable');
    this.stopPluginPrograms(plugin);

    logger.info(`插件已禁用: ${plugin.manifest.name}`);
    return true;
  }

  async executeHooks(hookName: PluginHookName, context: Partial<PluginHookContext>): Promise<void> {
    for (const [pluginId, plugin] of this.plugins) {
      if (!plugin.enabled) continue;

      try {
        await this.executeHookOnPlugin(plugin, hookName, context);
      } catch (err) {
        logger.error(`执行插件 ${pluginId} 的钩子 ${hookName} 失败`, err as Error);
      }
    }
  }

  async executeHooksWithTransform(
    hookName: 'beforeModpackProcess' | 'afterModpackProcess' | 'onOutputZip',
    context: Partial<PluginHookContext>,
    initialBuffer: Buffer
  ): Promise<Buffer> {
    let currentBuffer = initialBuffer;

    for (const [pluginId, plugin] of this.plugins) {
      if (!plugin.enabled) continue;

      try {
        const hookCtx: PluginHookContext = {
          pluginId,
          manifest: plugin.manifest,
          config: plugin.config,
          ...context,
          buffer: currentBuffer
        };

        const hook = plugin.hooks[hookName];
        if (hook) {
          const result = await hook(hookCtx);
          if (result instanceof Buffer) {
            currentBuffer = result;
          }
        }
      } catch (err) {
        logger.error(`执行插件 ${pluginId} 的钩子 ${hookName} 失败`, err as Error);
      }
    }

    return currentBuffer;
  }

  private async executeHookOnPlugin(
    plugin: LoadedPlugin,
    hookName: string,
    context?: Partial<PluginHookContext>
  ): Promise<void> {
    const hook = (plugin.hooks as any)[hookName];
    if (!hook) return;

    const hookCtx: PluginHookContext = {
      pluginId: plugin.manifest.id,
      manifest: plugin.manifest,
      config: plugin.config,
      ...context
    };

    await hook(hookCtx);
  }

  setupPluginRoutes(router: Router): void {
    for (const [pluginId, plugin] of this.plugins) {
      if (!plugin.enabled) continue;

      try {
        const setupFn = plugin.hooks.setupRoutes;
        if (setupFn) {
          setupFn(router);
        }
      } catch (err) {
        logger.error(`设置插件 ${pluginId} 的路由失败`, err as Error);
      }
    }
  }

  setupPluginSocketHandlers(io: SocketIOServer): void {
    for (const [pluginId, plugin] of this.plugins) {
      if (!plugin.enabled) continue;

      try {
        const setupFn = plugin.hooks.setupSocketHandlers;
        if (setupFn) {
          setupFn(io);
        }
      } catch (err) {
        logger.error(`设置插件 ${pluginId} 的 Socket 处理器失败`, err as Error);
      }
    }
  }

  getPlugins(): Array<{ manifest: PluginManifest; enabled: boolean; config: PluginConfig }> {
    const result: Array<{ manifest: PluginManifest; enabled: boolean; config: PluginConfig }> = [];
    for (const [_, plugin] of this.plugins) {
      result.push({
        manifest: plugin.manifest,
        enabled: plugin.enabled,
        config: plugin.config
      });
    }
    return result;
  }

  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getPluginConfig(pluginId: string): PluginConfig | null {
    const plugin = this.plugins.get(pluginId);
    return plugin ? plugin.config : null;
  }

  async updatePluginConfig(pluginId: string, settings: Record<string, any>): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;

    plugin.config.settings = { ...plugin.config.settings, ...settings };
    this.savePluginConfig(pluginId, plugin.config);
    return true;
  }

  generatePluginId(): string {
    const chars = '0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async createPlugin(options: {
    name: string;
    author: string;
    url?: string;
    withTutorial?: boolean;
  }): Promise<{ id: string }> {
    const id = this.generatePluginId();
    const pluginDir = path.join(PLUGINS_DIR, id);
    await fsp.mkdir(pluginDir, { recursive: true });

    const version = "1.0.0";

    const manifest: PluginManifest = {
      id,
      name: options.name,
      version,
      author: options.author,
      url: options.url || "",
      description: options.withTutorial
        ? "这是一个教程插件，展示了 DeEarthX 插件系统的基础功能"
        : "",
      openSource: false,
      hasSidebar: options.withTutorial,
      sidebarItems: options.withTutorial
        ? [{ key: "tutorial-page", label: "教程页面", route: "/plugin-tutorial" }]
        : [],
      defaultConfig: options.withTutorial
        ? {
            enableCustomFilter: true,
            outputMessage: "Hello from plugin!",
            maxItems: 50
          }
        : {}
    };

    const manifestPath = path.join(pluginDir, "manifest.json");
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    if (options.withTutorial) {
      const mainJsPath = path.join(pluginDir, "main.js");
      const tutorialCode = this.generateTutorialCode(id, options.name, options.author);
      await fsp.writeFile(mainJsPath, tutorialCode);

      const programsDir = path.join(pluginDir, "programs");
      await fsp.mkdir(programsDir, { recursive: true });

      const readmePath = path.join(programsDir, "README.txt");
      await fsp.writeFile(readmePath, "在此目录放置插件启动时自动运行的程序文件（.js, .exe, .bat 等）");
    }

    const config: PluginConfig = {
      enabled: true,
      settings: { ...(manifest.defaultConfig || {}) }
    };
    this.savePluginConfig(id, config);

    await this.loadAllPlugins();
    this.writeGlobalPluginConfigs();

    logger.info(`插件已创建: ${options.name} (${id})`);
    return { id };
  }

  private generateTutorialCode(pluginId: string, pluginName: string, pluginAuthor: string): string {
    return `// ============================================================
//  插件名称: ${pluginName}
//  插件 ID:   ${pluginId}
//  作者:     ${pluginAuthor}
//  版本:     1.0.0
//
//  这是 DeEarthX 插件系统的教程插件
//  包含了所有可用的钩子函数和基础功能演示
// ============================================================

// ============================================================
//  导出方式：
//  插件管理器会加载此文件，并寻找 default 导出或 hooks 导出
//  推荐使用 export const hooks = { ... } 的方式
// ============================================================

// ===================== 辅助函数 =====================

/**
 * 安全的日志输出函数
 * 在插件代码中请使用此函数代替 console.log
 */
function pluginLog(message: string, data?: any) {
  const prefix = \`[\${pluginId}]\`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

/**
 * 获取当前时间戳
 */
function now(): string {
  return new Date().toISOString();
}

// ===================== 生命周期钩子 =====================

export const hooks = {

  // ------------------------------------------------------
  //  插件加载时触发
  //  用途：初始化插件所需的资源、读取配置、建立连接等
  // ------------------------------------------------------
  onLoad: async (ctx) => {
    pluginLog(\`插件正在加载... 当前配置:\`, ctx.config.settings);
  },

  // ------------------------------------------------------
  //  插件卸载时触发
  //  用途：清理资源、关闭连接、保存状态等
  // ------------------------------------------------------
  onUnload: async (ctx) => {
    pluginLog(\`插件正在卸载...\`);
  },

  // ------------------------------------------------------
  //  插件启用时触发
  //  用途：启动定时任务、注册事件监听器等
  // ------------------------------------------------------
  onEnable: async (ctx) => {
    pluginLog(\`插件已启用！\`);
  },

  // ------------------------------------------------------
  //  插件禁用时触发
  //  用途：停止定时任务、移除事件监听器等
  // ------------------------------------------------------
  onDisable: async (ctx) => {
    pluginLog(\`插件已禁用！\`);
  },

  // ===================== 整合包处理钩子 =====================

  // ------------------------------------------------------
  //  处理整合包之前触发
  //  参数：ctx.buffer 是上传文件的原始数据（Buffer）
  //  返回值：可以返回修改后的 Buffer，或返回 null/undefined 保持原样
  //  用途：对上传的整合包文件进行预处理（解密、解包、格式转换等）
  //  示例：解包嵌套的压缩文件
  // ------------------------------------------------------
  beforeModpackProcess: async (ctx) => {
    pluginLog(\`准备处理整合包: \${ctx.modpackName || "未知"}\`);
    pluginLog(\`文件大小: \${ctx.buffer ? ctx.buffer.length + " bytes" : "未知"}\`);
    // 如果需要修改 buffer，返回新的 Buffer
    // return modifiedBuffer;
  },

  // ------------------------------------------------------
  //  处理整合包之后触发
  //  参数：ctx.buffer 是经过基本处理后的整合包数据
  //  返回值：可以返回修改后的 Buffer
  //  用途：对解析后的整合包数据进行二次处理
  // ------------------------------------------------------
  afterModpackProcess: async (ctx) => {
    pluginLog(\`整合包处理完成，准备解析清单文件\`);
  },

  // ------------------------------------------------------
  //  筛选模组之前触发
  //  参数：ctx.filePath 是整合包解压后的目录路径
  //  用途：在 DeEarthX 开始筛选模组前，可以预先处理模组文件
  //  示例：添加自定义的模组黑名单
  // ------------------------------------------------------
  beforeFilterMods: async (ctx) => {
    pluginLog(\`准备筛选模组，目录: \${ctx.filePath}\`);
  },

  // ------------------------------------------------------
  //  筛选模组之后触发
  //  参数：ctx.filePath 是整合包解压后的目录路径
  //  用途：在 DeEarthX 筛选完成后，进行额外的模组处理
  //  示例：对筛选结果执行自定义逻辑、记录日志
  // ------------------------------------------------------
  afterFilterMods: async (ctx) => {
    pluginLog(\`模组筛选完成！\`);
  },

  // ------------------------------------------------------
  //  安装模组加载器之前触发
  //  用途：在安装 Forge/Fabric/NeoForge 等加载器前执行操作
  //  示例：修改安装参数、准备额外文件
  // ------------------------------------------------------
  beforeInstallModLoader: async (ctx) => {
    pluginLog(\`准备安装模组加载器\`);
  },

  // ------------------------------------------------------
  //  安装模组加载器之后触发
  //  用途：加载器安装完成后执行额外操作
  //  示例：安装补丁、修改配置文件
  // ------------------------------------------------------
  afterInstallModLoader: async (ctx) => {
    pluginLog(\`模组加载器安装完成！\`);
  },

  // ------------------------------------------------------
  //  完成任务之前触发
  //  用途：在最终输出前对服务端目录进行操作
  //  示例：添加额外的文件、修改配置、生成报告
  // ------------------------------------------------------
  beforeCompleteTask: async (ctx) => {
    pluginLog(\`任务即将完成，执行最终处理...\`);
  },

  // ------------------------------------------------------
  //  完成任务之后触发
  //  用途：任务完全结束后执行收尾工作
  //  示例：发送通知、记录统计信息、触发后续流程
  // ------------------------------------------------------
  afterCompleteTask: async (ctx) => {
    pluginLog(\`任务完成！耗时: \${ctx.data?.duration || "未知"}\`);
  },

  // ------------------------------------------------------
  //  输出 ZIP 打包时触发
  //  参数：ctx.buffer 是即将输出的 ZIP 文件数据
  //  返回值：可以返回修改后的 Buffer
  //  用途：修改最终的整合包输出文件
  //  示例：向打包文件中注入额外的文件内容
  // ------------------------------------------------------
  onOutputZip: async (ctx) => {
    pluginLog(\`准备输出整合包，大小: \${ctx.buffer ? ctx.buffer.length : 0} bytes\`);
    // 如果需要修改输出的 ZIP，返回新的 Buffer
    // return modifiedZipBuffer;
  },

  // ===================== 高级功能 =====================

  // ------------------------------------------------------
  //  添加自定义 HTTP 路由
  //  用途：为插件提供 HTTP API 接口
  //  示例：添加一个 /tutorial-plugin/data 接口
  //  注意：路由会自动挂载到 /plugins 下
  // ------------------------------------------------------
  setupRoutes: (router) => {
    // 添加一个 GET 接口
    router.get("/tutorial-data", (req, res) => {
      res.json({
        status: 200,
        plugin: pluginId,
        message: "这是教程插件的自定义路由！",
        time: now()
      });
    });

    // 添加一个 POST 接口
    router.post("/tutorial-action", (req, res) => {
      const body = req.body || {};
      pluginLog(\`收到自定义请求:\`, body);
      res.json({
        status: 200,
        received: body,
        echo: "请求已收到！"
      });
    });
  },

  // ------------------------------------------------------
  //  添加 Socket.IO 事件处理器
  //  用途：处理实时通信事件
  //  示例：监听客户端发送的自定义事件
  // ------------------------------------------------------
  setupSocketHandlers: (io) => {
    io.on("connection", (socket) => {
      pluginLog(\`新客户端连接: \${socket.id}\`);

      // 监听插件自定义事件
      socket.on("tutorial-event", (data) => {
        pluginLog(\`收到客户端事件:\`, data);
        socket.emit("tutorial-response", {
          received: true,
          message: "服务器已收到你的消息！"
        });
      });
    });
  }
};
`;
  }

  async installPlugin(zipBuffer: Buffer): Promise<string | null> {
    const { default: yauzl } = await import("yauzl");
    const { pipeline } = await import("node:stream/promises");
    const { createWriteStream } = await import("node:fs");

    let pluginId: string = "";

    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, async (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }

        const extractPromises: Promise<void>[] = [];
        let manifestFound = false;

        zipfile.on("entry", (entry) => {
          const fileName = entry.fileName.replace(/^[^/]+\//, "");

          if (entry.fileName.endsWith("/")) {
            zipfile.readEntry();
            return;
          }

          if (entry.fileName.endsWith("manifest.json")) {
            manifestFound = true;
          }

          const extractPromise = new Promise<void>((resolveEntry, rejectEntry) => {
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                rejectEntry(err);
                return;
              }

              const targetPath = path.join(PLUGINS_DIR, fileName);
              const targetDir = path.dirname(targetPath);

              fsp.mkdir(targetDir, { recursive: true }).then(() => {
                const writeStream = createWriteStream(targetPath);
                pipeline(readStream, writeStream)
                  .then(() => resolveEntry())
                  .catch(rejectEntry);
              }).catch(rejectEntry);
            });
          });

          extractPromises.push(extractPromise);
          zipfile.readEntry();
        });

        zipfile.on("end", async () => {
          if (!manifestFound) {
            await this.cleanupExtraction(pluginId);
            reject(new Error("插件包中未找到 manifest.json"));
            return;
          }

          try {
            await this.loadAllPlugins();
            resolve(pluginId || null);
          } catch (err) {
            reject(err);
          }
        });

        zipfile.on("error", reject);
        zipfile.readEntry();
      });
    });
  }

  async uninstallPlugin(pluginId: string, keepConfig: boolean = true): Promise<boolean> {
    await this.unloadPlugin(pluginId, keepConfig);

    const pluginDir = path.join(PLUGINS_DIR, pluginId);
    try {
      await fsp.rm(pluginDir, { recursive: true, force: true });
      logger.info(`插件已删除: ${pluginId}`);
      return true;
    } catch (err) {
      logger.error(`删除插件 ${pluginId} 目录失败`, err as Error);
      return false;
    }
  }

  async exportPlugin(pluginId: string): Promise<Buffer | null> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return null;

    const pluginDir = path.join(PLUGINS_DIR, pluginId);
    const { default: yazl } = await import("yazl");

    return new Promise((resolve, reject) => {
      const zipfile = new yazl.ZipFile();
      const chunks: Buffer[] = [];

      zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
      zipfile.outputStream.on("error", reject);

      const addDirToZip = (dirPath: string, basePath: string) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(basePath, fullPath);
          if (entry.isDirectory()) {
            addDirToZip(fullPath, basePath);
          } else {
            zipfile.addFile(fullPath, relativePath);
          }
        }
      };

      addDirToZip(pluginDir, pluginDir);
      zipfile.end();
    });
  }

  private startPluginPrograms(plugin: LoadedPlugin): void {
    const pluginDir = path.join(PLUGINS_DIR, plugin.manifest.id);
    const programsDir = path.join(pluginDir, "programs");

    if (!fs.existsSync(programsDir)) return;

    try {
      const entries = fs.readdirSync(programsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const programPath = path.join(programsDir, entry.name);
          const ext = path.extname(entry.name).toLowerCase();

          try {
            if (ext === ".js" || ext === ".mjs") {
              const child = spawn("node", [programPath], {
                stdio: ["pipe", "pipe", "pipe"],
                detached: false
              });

              child.stdout?.on("data", (data) => {
                logger.info(`[插件:${plugin.manifest.id}] ${data.toString().trim()}`);
              });

              child.stderr?.on("data", (data) => {
                logger.error(`[插件:${plugin.manifest.id}] ${data.toString().trim()}`);
              });

              child.on("exit", (code) => {
                logger.info(`插件程序 ${entry.name} 已退出 (code: ${code})`);
              });

              plugin.programProcess = child;
              logger.info(`插件程序已启动: ${plugin.manifest.id}/${entry.name}`);
            } else if (ext === ".exe" || ext === ".bat" || ext === ".cmd") {
              const child = spawn(programPath, [], {
                stdio: ["pipe", "pipe", "pipe"],
                detached: false,
                shell: ext === ".bat" || ext === ".cmd"
              });

              child.stdout?.on("data", (data) => {
                logger.info(`[插件:${plugin.manifest.id}] ${data.toString().trim()}`);
              });

              child.stderr?.on("data", (data) => {
                logger.error(`[插件:${plugin.manifest.id}] ${data.toString().trim()}`);
              });

              child.on("exit", (code) => {
                logger.info(`插件程序 ${entry.name} 已退出 (code: ${code})`);
              });

              plugin.programProcess = child;
              logger.info(`插件程序已启动: ${plugin.manifest.id}/${entry.name}`);
            }
          } catch (err) {
            logger.error(`启动插件程序 ${entry.name} 失败`, err as Error);
          }
        }
      }
    } catch (err) {
      logger.error(`读取插件程序目录失败`, err as Error);
    }
  }

  private stopPluginPrograms(plugin: LoadedPlugin): void {
    if (plugin.programProcess) {
      try {
        if (plugin.programProcess.pid) {
          process.kill(-plugin.programProcess.pid);
        }
        plugin.programProcess.kill();
      } catch {
        // 进程可能已经退出
      }
      plugin.programProcess = undefined;
    }
  }

  private readPluginConfig(pluginId: string, manifest: PluginManifest, globalConfigs: Record<string, any>): PluginConfig {
    const configDir = path.join(PLUGINS_DIR, pluginId);
    const configPath = path.join(configDir, "config.json");

    const defaults: PluginConfig = {
      enabled: true,
      settings: manifest.defaultConfig || {}
    };

    const globalEnabled = globalConfigs[pluginId];
    if (globalEnabled !== undefined) {
      defaults.enabled = globalEnabled;
    }

    if (fs.existsSync(configPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        return {
          enabled: existing.enabled ?? defaults.enabled,
          settings: { ...defaults.settings, ...(existing.settings || {}) }
        };
      } catch {
        return defaults;
      }
    }

    this.savePluginConfig(pluginId, defaults);
    return defaults;
  }

  private savePluginConfig(pluginId: string, config: PluginConfig): void {
    const configDir = path.join(PLUGINS_DIR, pluginId);
    const configPath = path.join(configDir, "config.json");

    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      logger.error(`保存插件 ${pluginId} 配置失败`, err as Error);
    }
  }

  private deletePluginConfig(pluginId: string): void {
    const configPath = path.join(PLUGINS_DIR, pluginId, "config.json");
    try {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    } catch (err) {
      logger.error(`删除插件 ${pluginId} 配置失败`, err as Error);
    }
  }

  private readGlobalPluginConfigs(): Record<string, any> {
    const configPath = path.join(getAppDir(), PLUGIN_CONFIG_FILE);
    try {
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    } catch {
      // ignore
    }
    return {};
  }

  writeGlobalPluginConfigs(): void {
    const configs: Record<string, boolean> = {};
    for (const [id, plugin] of this.plugins) {
      configs[id] = plugin.enabled;
    }
    const configPath = path.join(getAppDir(), PLUGIN_CONFIG_FILE);
    try {
      fs.writeFileSync(configPath, JSON.stringify(configs, null, 2));
    } catch (err) {
      logger.error("保存全局插件配置失败", err as Error);
    }
  }

  private async cleanupExtraction(pluginId: string): Promise<void> {
    if (!pluginId) return;
    const pluginDir = path.join(PLUGINS_DIR, pluginId);
    try {
      await fsp.rm(pluginDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  getPluginsDir(): string {
    return PLUGINS_DIR;
  }
}