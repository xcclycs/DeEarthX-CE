# 后端 API

## 概述

DeEarthX-CE 的后端模块使用 TypeScript 开发，提供了核心功能和 API 接口。本章节将详细介绍后端模块的 API 接口。

## 模块结构

后端模块包含以下主要目录：

- `dearth/` - 核心功能模块
- `modloader/` - 模组加载器相关功能
- `platform/` - 平台集成模块
- `template/` - 模板管理模块
- `utils/` - 工具函数

## 核心模块

### dearth/strategies

包含各种模组过滤策略：

- `DexpubFilter.ts` - Dexpub 过滤策略
- `HashFilter.ts` - 基于哈希值的过滤策略
- `MixinFilter.ts` - 混合过滤策略
- `ModrinthFilter.ts` - Modrinth 过滤策略

### dearth/ModCheckService.ts

**功能**：负责检查模组的有效性和兼容性

**方法**：

- `checkMod(modPath: string): Promise<ModInfo>`
  - **参数**：`modPath` - 模组文件路径
  - **返回值**：模组信息对象
  - **描述**：检查模组的基本信息和兼容性

- `checkModCompatibility(modInfo: ModInfo, gameVersion: string, modloader: string): Promise<boolean>`
  - **参数**：
    - `modInfo` - 模组信息对象
    - `gameVersion` - 游戏版本
    - `modloader` - 模组加载器
  - **返回值**：是否兼容
  - **描述**：检查模组与指定游戏版本和加载器的兼容性

### dearth/ModFilterService.ts

**功能**：负责根据不同策略过滤模组

**方法**：

- `filterMods(mods: ModInfo[], strategy: FilterStrategy): Promise<ModInfo[]>`
  - **参数**：
    - `mods` - 模组信息数组
    - `strategy` - 过滤策略
  - **返回值**：过滤后的模组数组
  - **描述**：根据指定策略过滤模组

- `registerFilterStrategy(name: string, strategy: FilterStrategy): void`
  - **参数**：
    - `name` - 策略名称
    - `strategy` - 过滤策略对象
  - **返回值**：无
  - **描述**：注册新的过滤策略

## 模组加载器模块

### modloader/fabric.ts

**功能**：处理 Fabric 模组加载器相关操作

**方法**：

- `detectFabricMod(modPath: string): Promise<boolean>`
  - **参数**：`modPath` - 模组文件路径
  - **返回值**：是否为 Fabric 模组
  - **描述**：检测指定文件是否为 Fabric 模组

- `getFabricModInfo(modPath: string): Promise<ModInfo>`
  - **参数**：`modPath` - 模组文件路径
  - **返回值**：模组信息对象
  - **描述**：获取 Fabric 模组的详细信息

### modloader/forge.ts

**功能**：处理 Forge 模组加载器相关操作

**方法**：

- `detectForgeMod(modPath: string): Promise<boolean>`
  - **参数**：`modPath` - 模组文件路径
  - **返回值**：是否为 Forge 模组
  - **描述**：检测指定文件是否为 Forge 模组

- `getForgeModInfo(modPath: string): Promise<ModInfo>`
  - **参数**：`modPath` - 模组文件路径
  - **返回值**：模组信息对象
  - **描述**：获取 Forge 模组的详细信息

### modloader/neoforge.ts

**功能**：处理 NeoForge 模组加载器相关操作

**方法**：

- `detectNeoForgeMod(modPath: string): Promise<boolean>`
  - **参数**：`modPath` - 模组文件路径
  - **返回值**：是否为 NeoForge 模组
  - **描述**：检测指定文件是否为 NeoForge 模组

- `getNeoForgeModInfo(modPath: string): Promise<ModInfo>`
  - **参数**：`modPath` - 模组文件路径
  - **返回值**：模组信息对象
  - **描述**：获取 NeoForge 模组的详细信息

## 平台集成模块

### platform/curseforge.ts

**功能**：与 CurseForge API 交互

**方法**：

- `searchMods(query: string, gameVersion: string): Promise<ModInfo[]>`
  - **参数**：
    - `query` - 搜索关键词
    - `gameVersion` - 游戏版本
  - **返回值**：搜索结果数组
  - **描述**：在 CurseForge 上搜索模组

- `getModDetails(modId: string): Promise<ModInfo>`
  - **参数**：`modId` - 模组ID
  - **返回值**：模组详细信息
  - **描述**：获取模组的详细信息

- `downloadMod(modId: string, fileId: string, destination: string): Promise<boolean>`
  - **参数**：
    - `modId` - 模组ID
    - `fileId` - 文件ID
    - `destination` - 下载目标路径
  - **返回值**：是否下载成功
  - **描述**：下载指定模组文件

### platform/modrinth.ts

**功能**：与 Modrinth API 交互

**方法**：

- `searchMods(query: string, gameVersion: string): Promise<ModInfo[]>`
  - **参数**：
    - `query` - 搜索关键词
    - `gameVersion` - 游戏版本
  - **返回值**：搜索结果数组
  - **描述**：在 Modrinth 上搜索模组

- `getModDetails(modId: string): Promise<ModInfo>`
  - **参数**：`modId` - 模组ID
  - **返回值**：模组详细信息
  - **描述**：获取模组的详细信息

- `downloadMod(modId: string, versionId: string, destination: string): Promise<boolean>`
  - **参数**：
    - `modId` - 模组ID
    - `versionId` - 版本ID
    - `destination` - 下载目标路径
  - **返回值**：是否下载成功
  - **描述**：下载指定模组文件

## 模板管理模块

### template/TemplateManager.ts

**功能**：负责模板的创建、管理和应用

**方法**：

- `createTemplate(name: string, description: string, mods: ModInfo[]): Promise<Template>`
  - **参数**：
    - `name` - 模板名称
    - `description` - 模板描述
    - `mods` - 模组信息数组
  - **返回值**：创建的模板对象
  - **描述**：创建新的模组包模板

- `getTemplate(templateId: string): Promise<Template>`
  - **参数**：`templateId` - 模板ID
  - **返回值**：模板对象
  - **描述**：获取指定模板的详细信息

- `listTemplates(): Promise<Template[]>`
  - **参数**：无
  - **返回值**：模板数组
  - **描述**：获取所有模板列表

- `updateTemplate(templateId: string, updates: Partial<Template>): Promise<Template>`
  - **参数**：
    - `templateId` - 模板ID
    - `updates` - 更新内容
  - **返回值**：更新后的模板对象
  - **描述**：更新模板信息

- `deleteTemplate(templateId: string): Promise<boolean>`
  - **参数**：`templateId` - 模板ID
  - **返回值**：是否删除成功
  - **描述**：删除指定模板

- `applyTemplate(templateId: string, targetDir: string): Promise<boolean>`
  - **参数**：
    - `templateId` - 模板ID
    - `targetDir` - 目标目录
  - **返回值**：是否应用成功
  - **描述**：将模板应用到指定目录

- `exportTemplate(templateId: string, exportPath: string): Promise<boolean>`
  - **参数**：
    - `templateId` - 模板ID
    - `exportPath` - 导出路径
  - **返回值**：是否导出成功
  - **描述**：导出模板为文件

- `importTemplate(templatePath: string): Promise<Template>`
  - **参数**：`templatePath` - 模板文件路径
  - **返回值**：导入的模板对象
  - **描述**：从文件导入模板

## 工具模块

### utils/FileExtractor.ts

**功能**：负责从模组文件中提取信息

**方法**：

- `extractModInfo(jarPath: string): Promise<ModInfo>`
  - **参数**：`jarPath` - 模组JAR文件路径
  - **返回值**：模组信息对象
  - **描述**：从JAR文件中提取模组信息

- `extractManifest(jarPath: string): Promise<any>`
  - **参数**：`jarPath` - 模组JAR文件路径
  - **返回值**：模组清单对象
  - **描述**：从JAR文件中提取模组清单

### utils/FileOperator.ts

**功能**：负责文件操作

**方法**：

- `copyFile(source: string, destination: string): Promise<boolean>`
  - **参数**：
    - `source` - 源文件路径
    - `destination` - 目标文件路径
  - **返回值**：是否复制成功
  - **描述**：复制文件

- `deleteFile(path: string): Promise<boolean>`
  - **参数**：`path` - 文件路径
  - **返回值**：是否删除成功
  - **描述**：删除文件

- `createDirectory(path: string): Promise<boolean>`
  - **参数**：`path` - 目录路径
  - **返回值**：是否创建成功
  - **描述**：创建目录

- `listFiles(path: string): Promise<string[]>`
  - **参数**：`path` - 目录路径
  - **返回值**：文件路径数组
  - **描述**：列出目录中的文件

### utils/jar-parser.ts

**功能**：负责解析JAR文件

**方法**：

- `parseJar(jarPath: string): Promise<JarContent>`
  - **参数**：`jarPath` - JAR文件路径
  - **返回值**：JAR内容对象
  - **描述**：解析JAR文件内容

- `extractFile(jarPath: string, filePath: string, destination: string): Promise<boolean>`
  - **参数**：
    - `jarPath` - JAR文件路径
    - `filePath` - JAR内部文件路径
    - `destination` - 提取目标路径
  - **返回值**：是否提取成功
  - **描述**：从JAR文件中提取指定文件

## 主入口

### main.ts

**功能**：后端应用的主入口

**方法**：

- `startServer(): Promise<void>`
  - **参数**：无
  - **返回值**：无
  - **描述**：启动后端服务器

- `stopServer(): Promise<void>`
  - **参数**：无
  - **返回值**：无
  - **描述**：停止后端服务器

- `getServerStatus(): ServerStatus`
  - **参数**：无
  - **返回值**：服务器状态对象
  - **描述**：获取服务器状态