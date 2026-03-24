# 核心模块 API

## 概述

DeEarthX-CE 的核心模块提供了应用的基础功能，包括模组管理、模板管理、平台集成等。本章节将详细介绍核心模块的 API 接口、技术实现细节和功能模块说明。

## 核心类

### ModCheckService

**功能**：负责检查模组的有效性和兼容性，是模组处理的核心服务之一

**技术实现**：
- 使用 Java 解析器分析模组 JAR 文件中的元数据
- 利用缓存机制提高重复检查的效率
- 支持并行检查多个模组，提升处理速度

**方法**：

- `checkMod(modPath: string): Promise<ModInfo>`
  - **参数**：`modPath` - 模组文件路径
  - **返回值**：模组信息对象，包含模组的详细信息
  - **描述**：检查模组的基本信息和兼容性，解析模组的元数据、依赖关系等
  - **使用场景**：上传整合包后，系统需要分析每个模组的信息，以确定其类型和兼容性

- `checkModCompatibility(modInfo: ModInfo, gameVersion: string, modloader: string): Promise<boolean>`
  - **参数**：
    - `modInfo` - 模组信息对象
    - `gameVersion` - 游戏版本
    - `modloader` - 模组加载器
  - **返回值**：是否兼容
  - **描述**：检查模组与指定游戏版本和加载器的兼容性
  - **使用场景**：在生成服务端时，需要确保所有模组都与目标游戏版本和加载器兼容

### ModFilterService

**功能**：负责根据不同策略过滤模组，区分客户端和服务端模组

**技术实现**：
- 基于模组元数据和文件结构判断模组类型
- 支持自定义过滤策略，可扩展不同的过滤规则
- 采用管道模式处理模组过滤流程

**方法**：

- `filterMods(mods: ModInfo[], strategy: FilterStrategy): Promise<ModInfo[]>`
  - **参数**：
    - `mods` - 模组信息数组
    - `strategy` - 过滤策略
  - **返回值**：过滤后的模组数组
  - **描述**：根据指定策略过滤模组，保留服务端需要的模组
  - **使用场景**：在转换整合包时，需要过滤掉客户端专用模组（如光影、材质包等）

- `registerFilterStrategy(name: string, strategy: FilterStrategy): void`
  - **参数**：
    - `name` - 策略名称
    - `strategy` - 过滤策略对象
  - **返回值**：无
  - **描述**：注册新的过滤策略，扩展过滤能力
  - **使用场景**：当需要添加新的过滤规则时，如支持新的模组类型判断

### TemplateManager

**功能**：负责模板的创建、管理和应用，是模板系统的核心组件

**技术实现**：
- 使用 JSON 格式存储模板信息
- 支持模板的版本控制和历史记录
- 实现模板的导入/导出功能，便于分享和备份

**方法**：

- `createTemplate(name: string, description: string, mods: ModInfo[]): Promise<Template>`
  - **参数**：
    - `name` - 模板名称
    - `description` - 模板描述
    - `mods` - 模组信息数组
  - **返回值**：创建的模板对象
  - **描述**：创建新的模组包模板
  - **使用场景**：用户需要保存当前模组配置为模板，以便后续重复使用

- `applyTemplate(templateId: string, targetDir: string): Promise<boolean>`
  - **参数**：
    - `templateId` - 模板ID
    - `targetDir` - 目标目录
  - **返回值**：是否应用成功
  - **描述**：将模板应用到指定目录，生成包含模板中所有模组的服务端
  - **使用场景**：用户需要快速基于现有模板创建服务端

- `exportTemplate(templateId: string, exportPath: string): Promise<boolean>`
  - **参数**：
    - `templateId` - 模板ID
    - `exportPath` - 导出路径
  - **返回值**：是否导出成功
  - **描述**：导出模板为文件，便于分享给其他用户
  - **使用场景**：用户需要与他人分享自己创建的模板

## 工具类

### FileExtractor

**功能**：负责从模组文件中提取信息，是模组分析的基础工具

**技术实现**：
- 使用 ZIP 解压技术处理模组 JAR 文件
- 解析模组的 manifest 文件和 mod.info 文件
- 支持不同格式的模组文件解析

**方法**：

- `extractModInfo(jarPath: string): Promise<ModInfo>`
  - **参数**：`jarPath` - 模组JAR文件路径
  - **返回值**：模组信息对象
  - **描述**：从JAR文件中提取模组信息，包括名称、版本、作者等
  - **使用场景**：在分析模组时，需要从模组文件中提取详细信息

### FileOperator

**功能**：负责文件操作，提供文件系统的基础功能

**技术实现**：
- 使用 Node.js 的 fs 模块进行文件操作
- 实现文件的异步操作，避免阻塞主线程
- 支持大文件的分块处理

**方法**：

- `copyFile(source: string, destination: string): Promise<boolean>`
  - **参数**：
    - `source` - 源文件路径
    - `destination` - 目标文件路径
  - **返回值**：是否复制成功
  - **描述**：复制文件，支持大文件的高效复制
  - **使用场景**：在生成服务端时，需要复制模组文件到目标目录

- `deleteFile(path: string): Promise<boolean>`
  - **参数**：`path` - 文件路径
  - **返回值**：是否删除成功
  - **描述**：删除文件
  - **使用场景**：在清理临时文件或移除不需要的模组时使用

## 平台集成

### CurseForgeClient

**功能**：与 CurseForge API 交互，获取模组信息和下载链接

**技术实现**：
- 使用 CurseForge API v1 进行数据交互
- 实现 API 请求的缓存机制，减少重复请求
- 支持处理 API 限流和错误重试

**方法**：

- `searchMods(query: string, gameVersion: string): Promise<ModInfo[]>`
  - **参数**：
    - `query` - 搜索关键词
    - `gameVersion` - 游戏版本
  - **返回值**：搜索结果数组
  - **描述**：在 CurseForge 上搜索模组，返回符合条件的模组列表
  - **使用场景**：用户在模板商店中搜索模组时使用

- `getModDetails(modId: string): Promise<ModInfo>`
  - **参数**：`modId` - 模组ID
  - **返回值**：模组详细信息
  - **描述**：获取模组的详细信息，包括版本、依赖等
  - **使用场景**：在分析整合包中的模组时，需要获取详细的模组信息

### ModrinthClient

**功能**：与 Modrinth API 交互，获取模组信息和下载链接

**技术实现**：
- 使用 Modrinth API v2 进行数据交互
- 实现 API 请求的缓存机制
- 支持处理 API 限流和错误重试

**方法**：

- `searchMods(query: string, gameVersion: string): Promise<ModInfo[]>`
  - **参数**：
    - `query` - 搜索关键词
    - `gameVersion` - 游戏版本
  - **返回值**：搜索结果数组
  - **描述**：在 Modrinth 上搜索模组，返回符合条件的模组列表
  - **使用场景**：用户在模板商店中搜索模组时使用

- `getModDetails(modId: string): Promise<ModInfo>`
  - **参数**：`modId` - 模组ID
  - **返回值**：模组详细信息
  - **描述**：获取模组的详细信息，包括版本、依赖等
  - **使用场景**：在分析整合包中的模组时，需要获取详细的模组信息

## 类型定义

### ModInfo

```typescript
interface ModInfo {
  id: string;              // 模组唯一标识符
  name: string;            // 模组名称
  version: string;         // 模组版本
  description: string;     // 模组描述
  authors: string[];       // 模组作者
  gameVersions: string[];  // 支持的游戏版本
  modLoaders: string[];    // 支持的模组加载器
  dependencies: string[];  // 依赖的模组
  fileSize: number;        // 文件大小（字节）
  hash: string;            // 文件哈希值
  source: string;          // 来源（curseforge, modrinth, local）
  isServerOnly: boolean;   // 是否为服务端专用模组
  isClientOnly: boolean;   // 是否为客户端专用模组
  isRequired: boolean;     // 是否为必需模组
}
```

### Template

```typescript
interface Template {
  id: string;            // 模板唯一标识符
  name: string;          // 模板名称
  description: string;   // 模板描述
  mods: ModInfo[];       // 模板包含的模组
  createdAt: string;     // 创建时间
  updatedAt: string;     // 更新时间
  author: string;        // 模板作者
  version: string;       // 模板版本
  gameVersion: string;   // 适用的游戏版本
  modloader: string;     // 适用的模组加载器
}
```

### FilterStrategy

```typescript
interface FilterStrategy {
  name: string;                    // 策略名称
  filter: (mod: ModInfo) => boolean; // 过滤函数，返回 true 表示保留该模组
  description: string;             // 策略描述
}
```