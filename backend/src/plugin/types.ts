import type { Router, Request, Response, NextFunction } from "express";
import type { Server as SocketIOServer } from "socket.io";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  url?: string;
  description?: string;
  openSource?: boolean;
  sourceUrl?: string;
  minAppVersion?: string;
  main?: string;
  frontend?: string;
  hooks?: string[];
  hasSidebar?: boolean;
  sidebarItems?: PluginSidebarItem[];
  defaultConfig?: Record<string, any>;
}

export interface PluginSidebarItem {
  key: string;
  label: string;
  icon?: string;
  route: string;
}

export interface PluginConfig {
  enabled: boolean;
  settings: Record<string, any>;
}

export interface PluginHookContext {
  pluginId: string;
  manifest: PluginManifest;
  config: PluginConfig;
  buffer?: Buffer;
  filePath?: string;
  modpackName?: string;
  serverMode?: boolean;
  template?: string;
  data?: any;
}

export interface PluginHooks {
  onLoad?: (context: PluginHookContext) => void | Promise<void>;
  onUnload?: (context: PluginHookContext) => void | Promise<void>;
  onEnable?: (context: PluginHookContext) => void | Promise<void>;
  onDisable?: (context: PluginHookContext) => void | Promise<void>;

  beforeModpackProcess?: (context: PluginHookContext) => Promise<Buffer | null | undefined>;
  afterModpackProcess?: (context: PluginHookContext) => Promise<Buffer | null | undefined>;
  beforeFilterMods?: (context: PluginHookContext) => Promise<void>;
  afterFilterMods?: (context: PluginHookContext) => Promise<void>;
  beforeInstallModLoader?: (context: PluginHookContext) => Promise<void>;
  afterInstallModLoader?: (context: PluginHookContext) => Promise<void>;
  beforeCompleteTask?: (context: PluginHookContext) => Promise<void>;
  afterCompleteTask?: (context: PluginHookContext) => Promise<void>;
  onOutputZip?: (context: PluginHookContext) => Promise<Buffer | null | undefined>;

  setupRoutes?: (router: Router) => void;
  setupSocketHandlers?: (io: SocketIOServer) => void;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  config: PluginConfig;
  hooks: PluginHooks;
  programProcess?: any;
  enabled: boolean;
}

export interface PluginAPI {
  getManifest(): PluginManifest;
  getHooks(): PluginHooks;
  getConfigDir(): string;
  getDataDir(): string;
}

export const PLUGIN_HOOK_NAMES = [
  'onLoad', 'onUnload', 'onEnable', 'onDisable',
  'beforeModpackProcess', 'afterModpackProcess',
  'beforeFilterMods', 'afterFilterMods',
  'beforeInstallModLoader', 'afterInstallModLoader',
  'beforeCompleteTask', 'afterCompleteTask',
  'onOutputZip',
  'setupRoutes', 'setupSocketHandlers'
] as const;

export type PluginHookName = typeof PLUGIN_HOOK_NAMES[number];