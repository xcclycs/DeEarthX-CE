import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logger } from './logger.js';

/**
 * 应用配置接口
 */
export interface IConfig {
  mirror: {
    bmclapi: boolean;
    mcimirror: boolean;
    mcimirrorModrinthOnly?: boolean;
  };
  filter: {
    hashes: boolean;
    dexpub: boolean;
    mixins: boolean;
    modrinth: boolean;
    mcmodFilter?: boolean;
    aiFilter?: boolean;
  };
  oaf: boolean;
  autoZip: boolean;
  port?: number;
  host?: string;
  javaPath?: string;
  guardian?: {
    enabled: boolean;
    ai: {
      provider: 'openai' | 'ollama' | 'none';
      apiKey: string;
      model: string;
      baseURL: string;
      maxTokens?: number;
    };
    autoAcceptLowRisk: boolean;
    maxConsecutiveCrashes: number;
    monitoringTimeout: number;
  };
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: IConfig = {
  mirror: {
    bmclapi: true,
    mcimirror: true,
    mcimirrorModrinthOnly: false,
  },
  filter: {
    hashes: true,
    dexpub: true,
    mixins: true,
    modrinth: false,
    mcmodFilter: false,
    aiFilter: false,
  },
  oaf: true,
  autoZip: false,
  port: 37019,
  host: 'localhost',
  javaPath: undefined,
  guardian: {
    enabled: false,
    ai: {
      provider: 'openai' as const,
      apiKey: '',
      model: 'gpt-4.1-mini',
      baseURL: 'https://api.openai.com/v1',
      maxTokens: 1500
    },
    autoAcceptLowRisk: true,
    maxConsecutiveCrashes: 5,
    monitoringTimeout: 30000
  }
};

/**
 * 获取应用数据目录
 * 在开发环境返回当前目录,在生产环境返回用户数据目录
 */
function getAppDir(): string {
  const execPath = process.execPath;
  const cwd = process.cwd();
  
  // 检查是否在开发环境中运行
  // 如果 execPath 指向 node.exe 且当前目录不是 node 安装目录，说明是开发环境
  const isDevelopment = execPath.toLowerCase().includes('node.exe') && 
                        !cwd.toLowerCase().includes('program files') &&
                        !cwd.toLowerCase().includes('nodejs');
  
  if (isDevelopment) {
    return cwd;
  }
  
  // 在生产环境中使用用户数据目录，避免C盘权限问题
  const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'DeEarthX');
  
  // 确保目录存在
  if (!fs.existsSync(appDataDir)) {
    try {
      fs.mkdirSync(appDataDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create app data directory', error as Error);
      // 如果创建失败，回退到可执行文件所在目录
      return path.dirname(execPath);
    }
  }
  
  return appDataDir;
}

/**
 * 配置文件路径 - 使用应用数据目录
 */
const CONFIG_PATH = path.join(getAppDir(), "config.json");

/**
 * 从环境变量获取配置
 * @param key 环境变量键
 * @param defaultValue 默认值
 * @returns 环境变量值或默认值
 */
function getEnv<T>(key: string, defaultValue: T): T {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  
  if (typeof defaultValue === 'boolean') {
    return (value.toLowerCase() === 'true') as unknown as T;
  }
  
  if (typeof defaultValue === 'number') {
    const num = parseInt(value, 10);
    return (isNaN(num) ? defaultValue : num) as unknown as T;
  }
  
  return value as unknown as T;
}

/**
 * 配置管理器
 */
export class Config {
  private static cachedConfig: IConfig | null = null;

  /**
   * 获取配置
   * @returns 配置对象
   */
  public static getConfig(): IConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    let config: IConfig;
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
      config = DEFAULT_CONFIG;
    } else {
      try {
        const content = fs.readFileSync(CONFIG_PATH, "utf-8");
        config = JSON.parse(content);
      } catch (err) {
        logger.error("Failed to read config file, using defaults", err as Error);
        config = DEFAULT_CONFIG;
      }
    }
    
    // 从环境变量覆盖配置
    const envConfig: IConfig = {
      mirror: {
        bmclapi: getEnv('DEEARTHX_MIRROR_BMCLAPI', config.mirror.bmclapi),
        mcimirror: getEnv('DEEARTHX_MIRROR_MCIMIRROR', config.mirror.mcimirror),
        mcimirrorModrinthOnly: getEnv('DEEARTHX_MIRROR_MCIMIRROR_MODRINTH_ONLY', config.mirror.mcimirrorModrinthOnly ?? false)
      },
      filter: {
        hashes: getEnv('DEEARTHX_FILTER_HASHES', config.filter.hashes),
        dexpub: getEnv('DEEARTHX_FILTER_DEXPUB', config.filter.dexpub),
        mixins: getEnv('DEEARTHX_FILTER_MIXINS', config.filter.mixins),
        modrinth: getEnv('DEEARTHX_FILTER_MODRINTH', config.filter.modrinth),
        mcmodFilter: getEnv('DEEARTHX_FILTER_MCMOD', config.filter.mcmodFilter || false),
        aiFilter: getEnv('DEEARTHX_FILTER_AI', config.filter.aiFilter || false),
      },
      oaf: getEnv('DEEARTHX_OAF', config.oaf),
      autoZip: getEnv('DEEARTHX_AUTO_ZIP', config.autoZip),
      port: getEnv('DEEARTHX_PORT', config.port || DEFAULT_CONFIG.port),
      host: getEnv('DEEARTHX_HOST', config.host || DEFAULT_CONFIG.host),
      javaPath: getEnv('DEEARTHX_JAVA_PATH', config.javaPath),
      guardian: {
        enabled: getEnv('DEEARTHX_GUARDIAN_ENABLED', config.guardian?.enabled ?? DEFAULT_CONFIG.guardian!.enabled),
        ai: {
          provider: getEnv('DEEARTHX_GUARDIAN_AI_PROVIDER', config.guardian?.ai?.provider ?? DEFAULT_CONFIG.guardian!.ai.provider) as any,
          apiKey: getEnv('DEEARTHX_GUARDIAN_API_KEY', config.guardian?.ai?.apiKey ?? ''),
          model: getEnv('DEEARTHX_GUARDIAN_AI_MODEL', config.guardian?.ai?.model ?? DEFAULT_CONFIG.guardian!.ai.model),
          baseURL: getEnv('DEEARTHX_GUARDIAN_AI_BASE_URL', config.guardian?.ai?.baseURL ?? DEFAULT_CONFIG.guardian!.ai.baseURL),
          maxTokens: getEnv('DEEARTHX_GUARDIAN_AI_MAX_TOKENS', config.guardian?.ai?.maxTokens ?? DEFAULT_CONFIG.guardian!.ai.maxTokens)
        },
        autoAcceptLowRisk: getEnv('DEEARTHX_GUARDIAN_AUTO_ACCEPT', config.guardian?.autoAcceptLowRisk ?? DEFAULT_CONFIG.guardian!.autoAcceptLowRisk),
        maxConsecutiveCrashes: getEnv('DEEARTHX_GUARDIAN_MAX_CRASHES', config.guardian?.maxConsecutiveCrashes ?? DEFAULT_CONFIG.guardian!.maxConsecutiveCrashes),
        monitoringTimeout: getEnv('DEEARTHX_GUARDIAN_TIMEOUT', config.guardian?.monitoringTimeout ?? DEFAULT_CONFIG.guardian!.monitoringTimeout)
      }
    };
    
    this.cachedConfig = envConfig;
    logger.debug("Loaded config", envConfig);
    return envConfig;
  }

  /**
   * 写入配置
   * @param config 配置对象
   */
  public static writeConfig(config: IConfig): void {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      this.cachedConfig = config;
      logger.info("Config file written successfully");
    } catch (err) {
      logger.error("Failed to write config file", err as Error);
    }
  }

  /**
   * 清除配置缓存（强制下次读取时重新从文件加载）
   */
  public static clearCache(): void {
    this.cachedConfig = null;
  }
}
