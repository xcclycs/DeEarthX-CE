# 核心模块 API

## 概述

DeEarthX-CE 的核心模块提供了应用的基础功能，包括模组管理、模板管理、平台集成等。本章节将详细介绍核心模块的 API 接口。

## 核心类

### ModCheckService

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

### ModFilterService

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

### TemplateManager

**功能**：负责模板的创建、管理和应用

**方法**：

- `createTemplate(name: string, description: string, mods: ModInfo[]): Promise<Template>`
  - **参数**：
    - `name` - 模板名称
    - `description` - 模板描述
    - `mods` - 模组信息数组
  - **返回值**：创建的模板对象
  - **描述**：创建新的模组包模板

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

## 工具类

### FileExtractor

**功能**：负责从模组文件中提取信息

**方法**：

- `extractModInfo(jarPath: string): Promise<ModInfo>`
  - **参数**：`jarPath` - 模组JAR文件路径
  - **返回值**：模组信息对象
  - **描述**：从JAR文件中提取模组信息

### FileOperator

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

## 平台集成

### CurseForgeClient

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

### ModrinthClient

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

## 类型定义

### ModInfo

```typescript
interface ModInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  authors: string[];
  gameVersions: string[];
  modLoaders: string[];
  dependencies: string[];
  fileSize: number;
  hash: string;
  source: string; // curseforge, modrinth, local
}
```

### Template

```typescript
interface Template {
  id: string;
  name: string;
  description: string;
  mods: ModInfo[];
  createdAt: string;
  updatedAt: string;
}
```

### FilterStrategy

```typescript
interface FilterStrategy {
  name: string;
  filter: (mod: ModInfo) => boolean;
}
```