---
title: 技术架构
icon: server
order: 1
---

# 技术架构

本文档详细介绍了 DeEarthX-CE 项目的技术架构、代码结构和开发流程。

## 项目结构

```
DeEarthX-CE/
├── backend             # 后端代码 文件夹
├── front               # 前端代码 文件夹
├── word                # 文档 文件夹
├── .gitignore          # Git 忽略文件
├── LICENSE             # 许可证
├── README.md           # 项目说明
├── README-EN.md        # 英文项目说明
├── b2f.js              # 构建脚本
├── package.json        # 根项目配置
├── pnpm-lock.yaml      # pnpm 依赖锁文件
└── pnpm-workspace.yaml # pnpm 工作区配置
```

## 技术栈

### 后端

- **语言**：TypeScript 5.0+
- **运行环境**：Node.js 16+
- **打包工具**：
  - Rollup：打包为单个文件
  - Node.js SEA (Single Executable Application)：打包为可执行文件
- **依赖管理**：pnpm 8.0+
- **核心依赖**：
  - express：Web 服务
  - ws：WebSocket 通信
  - yauzl：ZIP 文件处理
  - axios：HTTP 请求
  - fs-extra：文件系统操作
- **核心功能**：
  - 整合包分析与处理
  - 模组筛选
  - 服务端下载与配置
  - 模板管理
  - WebSocket 通信

### 前端

- **框架**：Vue 3 + TypeScript
- **构建工具**：Vite 4.0+
- **桌面框架**：Tauri 2.0+
- **UI 组件**：Ant Design Vue 4.0+
- **样式**：Tailwind CSS 3.0+
- **状态管理**：Vue 3 Composition API
- **路由**：Vue Router 4.0+
- **国际化**：i18n 9.0+
- **核心依赖**：
  - vue：前端框架
  - vue-router：路由管理
  - ant-design-vue：UI 组件库
  - tailwindcss：样式框架
  - axios：HTTP 请求
  - i18n：国际化支持

## 核心模块

### 1. 后端核心模块

#### 1.1 dearth 模块

- **ModCheckService.ts**：模组检查服务，负责分析模组的客户端/服务端属性，通过解析模组 JAR 文件和 manifest 文件，判断模组是否为客户端专用
- **ModFilterService.ts**：模组筛选服务，根据筛选策略和规则，对模组进行筛选，保留服务端需要的模组，剔除客户端专用模组
- **strategies/**：筛选策略，包含不同平台的模组筛选逻辑
  - **DexpubFilter.ts**：Dexpub 平台的模组筛选策略
  - **HashFilter.ts**：基于哈希值的模组筛选策略
  - **MixinFilter.ts**：混合多种筛选策略的综合筛选
  - **ModrinthFilter.ts**：Modrinth 平台的模组筛选策略

#### 1.2 modloader 模块

- **fabric.ts**：Fabric 加载器支持，处理 Fabric 模组加载器的服务端文件下载和配置
- **forge.ts**：Forge 加载器支持，处理 Forge 模组加载器的服务端文件下载和配置
- **neoforge.ts**：NeoForge 加载器支持，处理 NeoForge 模组加载器的服务端文件下载和配置
- **minecraft.ts**：Minecraft 核心支持，处理 Minecraft 原版服务端的下载和配置

#### 1.3 platform 模块

- **curseforge.ts**：CurseForge 平台支持，处理 CurseForge 平台的模组信息获取和下载
- **modrinth.ts**：Modrinth 平台支持，处理 Modrinth 平台的模组信息获取和下载

#### 1.4 template 模块

- **TemplateManager.ts**：模板管理，负责模板的创建、编辑、删除、导入/导出等操作，管理本地模板和模板商店

#### 1.5 utils 模块

- **FileExtractor.ts**：文件提取工具，用于提取 ZIP 文件和 JAR 文件
- **FileOperator.ts**：文件操作工具，用于文件的复制、移动、删除等操作
- **jar-parser.ts**：JAR 文件解析工具，用于解析模组 JAR 文件的内容
- **logger.ts**：日志工具，用于记录系统运行日志
- **config.ts**：配置管理，用于管理系统配置和用户配置
- **ws.ts**：WebSocket 工具，用于处理 WebSocket 连接和通信
- **utils.ts**：通用工具函数，提供各种辅助功能

### 2. 前端核心模块

#### 2.1 页面

- **DeEarthView.vue**：主功能页面，用于处理整合包，包含模式选择、文件上传、处理进度显示等功能
- **GalaxyView.vue**：模板管理页面，用于管理本地模板和浏览模板商店
- **SettingView.vue**：设置页面，用于配置软件的各项参数
- **AboutView.vue**：关于页面，显示软件版本、版权信息和开发团队
- **ErrorView.vue**：错误页面，显示错误信息和解决方案

#### 2.2 组件

- **ModeSelector.vue**：模式选择组件，用于选择开服模式或上传模式
- **ProgressCard.vue**：进度显示组件，用于显示处理进度和状态
- **StepIndicator.vue**：步骤指示组件，用于显示处理流程的当前步骤
- **WebSocketHandler.vue**：WebSocket 处理组件，用于处理与后端的实时通信

#### 2.3 工具

- **axios.ts**：HTTP 请求工具，用于与后端 API 通信
- **errorCodes.ts**：错误码定义，包含系统所有错误码和错误信息
- **i18n.ts**：国际化支持，处理多语言翻译
- **router.ts**：路由配置，管理前端页面路由

## 开发界面

### 1. 后端开发界面

#### 1.1 API 接口

| 接口路径 | 方法 | 功能描述 | 请求体 | 响应体 |
|---------|------|----------|--------|--------|
| `/api/upload` | POST | 上传整合包文件 | `multipart/form-data` | `{ success: boolean, data: { taskId: string } }` |
| `/api/process` | POST | 处理整合包 | `{ taskId: string, mode: string, templateId?: string }` | `{ success: boolean, data: { taskId: string } }` |
| `/api/status` | GET | 获取处理状态 | `{ taskId: string }` | `{ success: boolean, data: { status: string, progress: number, log: string } }` |
| `/api/download` | GET | 下载处理结果 | `{ taskId: string }` | 服务端文件（ZIP） |
| `/api/templates` | GET | 获取本地模板列表 | N/A | `{ success: boolean, data: Template[] }` |
| `/api/templates` | POST | 创建模板 | `Template` | `{ success: boolean, data: { templateId: string } }` |
| `/api/templates/:id` | PUT | 更新模板 | `Template` | `{ success: boolean }` |
| `/api/templates/:id` | DELETE | 删除模板 | N/A | `{ success: boolean }` |
| `/api/templates/:id/export` | GET | 导出模板 | N/A | 模板文件（.dextpl） |
| `/api/templates/import` | POST | 导入模板 | `multipart/form-data` | `{ success: boolean, data: { templateId: string } }` |
| `/api/template-store` | GET | 获取模板商店列表 | N/A | `{ success: boolean, data: Template[] }` |
| `/api/template-store/:id/download` | GET | 下载模板商店模板 | N/A | 模板文件（.dextpl） |
| `/api/settings` | GET | 获取系统设置 | N/A | `{ success: boolean, data: Settings }` |
| `/api/settings` | PUT | 更新系统设置 | `Settings` | `{ success: boolean }` |

#### 1.2 WebSocket 接口

| 事件类型 | 方向 | 数据结构 | 描述 |
|---------|------|----------|------|
| `progress` | 后端 → 前端 | `{ taskId: string, progress: number, status: string, log: string }` | 处理进度更新 |
| `complete` | 后端 → 前端 | `{ taskId: string, success: boolean, message: string, downloadUrl?: string }` | 处理完成通知 |
| `error` | 后端 → 前端 | `{ taskId: string, error: string, code: number }` | 错误通知 |
| `ping` | 双向 | `{ timestamp: number }` | 心跳检测 |

### 2. 前端开发界面

#### 2.1 页面结构

- **主布局**：
  - 左侧导航栏：包含 DeEarth、Galaxy、Setting、About 四个主要选项
  - 右侧内容区：根据选择的功能显示相应的内容
  - 顶部状态栏：显示软件版本、当前状态等信息
  - 底部状态栏：显示处理进度、网络状态等信息

#### 2.2 DeEarth 页面

- **模式选择**：选择开服模式或上传模式
- **文件上传**：上传整合包文件（支持拖拽上传）
- **处理选项**：选择模板、配置处理参数
- **处理进度**：实时显示处理进度和日志
- **结果下载**：处理完成后提供下载链接

#### 2.3 Galaxy 页面

- **本地模板**：显示本地模板列表，支持创建、编辑、删除、导出模板
- **模板商店**：浏览和下载远程模板，支持按类别筛选
- **模板详情**：查看模板的详细信息和配置

#### 2.4 Setting 页面

- **基本设置**：语言、主题、下载目录等
- **网络设置**：镜像源、下载线程数、超时设置等
- **高级设置**：后端端口、日志级别、清理缓存等
- **筛选设置**：自定义筛选规则、智能筛选配置等

#### 2.5 About 页面

- **软件信息**：版本号、版权信息、许可证等
- **开发团队**：开发人员列表和贡献者
- **联系方式**：QQ群、GitHub 仓库等
- **更新日志**：最近的更新内容

## 工作流程

### 1. 整合包处理流程

1. **文件上传**：用户通过前端界面上传整合包文件
2. **任务创建**：后端创建处理任务，返回任务 ID
3. **文件分析**：后端分析整合包内容，识别模组加载器类型和版本
4. **模组筛选**：根据筛选策略和规则，区分客户端和服务端模组
5. **服务端下载**（开服模式）：根据整合包的版本和加载器类型，下载对应的服务端和模组加载器
6. **服务端配置**：生成服务端配置文件，包括服务器属性、模组配置等
7. **打包生成**：将处理后的文件打包成服务端
8. **结果通知**：通过 WebSocket 通知前端处理完成
9. **结果下载**：用户通过前端界面下载生成的服务端

### 2. 模板管理流程

1. **模板创建**：用户通过前端界面创建新模板，设置模板信息和配置
2. **模板存储**：后端将模板保存到本地存储
3. **模板编辑**：用户编辑现有模板的信息和配置
4. **模板导出**：用户导出模板为 .dextpl 文件
5. **模板导入**：用户导入 .dextpl 文件到本地模板列表
6. **模板商店**：用户浏览和下载远程模板
7. **模板应用**：用户在处理整合包时应用模板配置

## 通信机制

- **前端 → 后端**：
  - HTTP 请求：用于上传文件、提交任务、获取数据等
  - WebSocket 消息：用于发送控制命令、心跳检测等
- **后端 → 前端**：
  - WebSocket 消息：用于推送实时进度、处理结果、错误信息等
- **WebSocket 端口**：37019
- **通信协议**：JSON 格式

## 依赖管理

项目使用 pnpm 管理依赖，分为三个主要部分：

1. **根项目**：管理整个项目的依赖和脚本，包括构建、测试、发布等
2. **backend**：后端依赖，包括 express、ws、yauzl 等
3. **front**：前端依赖，包括 vue、vue-router、ant-design-vue 等

### 依赖安装

```bash
# 安装所有依赖
pnpm install

# 安装后端依赖
cd backend && pnpm install

# 安装前端依赖
cd front && pnpm install
```

## 构建流程

### 1. 后端构建

1. **编译 TypeScript**：使用 tsc 编译 TypeScript 源代码
2. **打包**：使用 Rollup 打包为单个文件
3. **构建可执行文件**：使用 Node.js SEA 打包为可执行文件

```bash
# 后端构建
cd backend && pnpm build
```

### 2. 前端构建

1. **构建 Vue 应用**：使用 Vite 构建 Vue 应用
2. **打包桌面应用**：使用 Tauri 打包为桌面应用

```bash
# 前端构建
cd front && pnpm build

# 构建桌面应用
cd front && pnpm tauri build
```

### 3. 完整构建

```bash
# 完整构建
pnpm build
```

## 开发环境设置

### 1. 后端开发

1. **安装依赖**：
   - Node.js 16+ 
   - pnpm 8+

2. **设置开发环境**：
   ```bash
   # 安装依赖
   cd backend && pnpm install
   
   # 启动开发服务器
   pnpm dev
   ```

3. **开发服务器**：
   - 地址：http://localhost:37019
   - API 文档：http://localhost:37019/api/docs

### 2. 前端开发

1. **安装依赖**：
   - Node.js 16+ 
   - pnpm 8+
   - Rust 1.60+（用于 Tauri）

2. **设置开发环境**：
   ```bash
   # 安装依赖
   cd front && pnpm install
   
   # 启动开发服务器
   pnpm dev
   
   # 启动 Tauri 开发模式
   pnpm tauri dev
   ```

3. **开发服务器**：
   - Vite 开发服务器：http://localhost:5173
   - Tauri 应用：桌面应用窗口

## 代码规范

### 1. TypeScript 规范

- **严格模式**：使用 `strict: true` 配置
- **类型定义**：完整的类型定义，避免 `any` 类型
- **命名规范**：
  - 类名：PascalCase
  - 函数名：camelCase
  - 变量名：camelCase
  - 常量名：UPPER_CASE
  - 接口名：PascalCase

### 2. ESLint 规范

- **规则配置**：使用 @typescript-eslint/recommended 规则
- **代码风格**：
  - 缩进：2 个空格
  - 分号：使用分号
  - 引号：单引号
  - 空格：在操作符前后添加空格

### 3. Prettier 配置

- **代码格式化**：使用 Prettier 自动格式化代码
- **配置**：
  - 单行长度：120 字符
  - 缩进：2 个空格
  - 分号：使用分号
  - 引号：单引号

### 4. Git 规范

- **提交信息**：使用语义化提交格式
  ```
  <type>(<scope>): <description>
  
  <body>
  
  <footer>
  ```
- **分支管理**：
  - main：主分支
  - develop：开发分支
  - feature/xxx：功能分支
  - fix/xxx：修复分支

## API 文档

### 1. 后端 API

#### 1.1 文件上传 API

- **路径**：`/api/upload`
- **方法**：POST
- **描述**：上传整合包文件
- **请求体**：`multipart/form-data`，包含文件字段 `file`
- **响应**：
  ```json
  {
    "success": true,
    "data": {
      "taskId": "task_123456"
    }
  }
  ```

#### 1.2 处理整合包 API

- **路径**：`/api/process`
- **方法**：POST
- **描述**：处理上传的整合包
- **请求体**：
  ```json
  {
    "taskId": "task_123456",
    "mode": "server", // server 或 upload
    "templateId": "template_123456" // 可选
  }
  ```
- **响应**：
  ```json
  {
    "success": true,
    "data": {
      "taskId": "task_123456"
    }
  }
  ```

#### 1.3 获取处理状态 API

- **路径**：`/api/status`
- **方法**：GET
- **描述**：获取处理状态和进度
- **查询参数**：`taskId` - 任务 ID
- **响应**：
  ```json
  {
    "success": true,
    "data": {
      "status": "processing", // pending, processing, completed, failed
      "progress": 50,
      "log": "正在分析整合包..."
    }
  }
  ```

#### 1.4 下载处理结果 API

- **路径**：`/api/download`
- **方法**：GET
- **描述**：下载处理完成的服务端
- **查询参数**：`taskId` - 任务 ID
- **响应**：服务端文件（ZIP 格式）

#### 1.5 模板管理 API

- **获取模板列表**：`GET /api/templates`
- **创建模板**：`POST /api/templates`
- **更新模板**：`PUT /api/templates/:id`
- **删除模板**：`DELETE /api/templates/:id`
- **导出模板**：`GET /api/templates/:id/export`
- **导入模板**：`POST /api/templates/import`

### 2. 前端 API

#### 2.1 组件 API

- **ModeSelector**：
  - `v-model:mode`：当前选择的模式
  - `@change`：模式改变事件

- **ProgressCard**：
  - `:progress`：进度值（0-100）
  - `:status`：状态信息
  - `:log`：日志信息

- **WebSocketHandler**：
  - `:taskId`：任务 ID
  - `@progress`：进度更新事件
  - `@complete`：处理完成事件
  - `@error`：错误事件

#### 2.2 工具 API

- **axios.ts**：
  - `apiClient`：配置好的 axios 实例
  - `uploadFile`：上传文件的方法
  - `processFile`：处理文件的方法
  - `getStatus`：获取处理状态的方法
  - `downloadResult`：下载处理结果的方法

- **errorCodes.ts**：
  - `ErrorCode`：错误码枚举
  - `errorMessages`：错误信息映射
  - `errorSuggestions`：错误解决方案映射
  - `getErrorMessage`：获取错误信息的方法
  - `getErrorSuggestions`：获取错误解决方案的方法

## 开发流程

### 1. 新功能开发

1. **创建分支**：从 develop 分支创建 feature 分支
2. **开发功能**：实现新功能，编写代码
3. **测试**：测试功能是否正常
4. **提交代码**：使用语义化提交格式提交代码
5. **创建 PR**：向 develop 分支创建 Pull Request
6. **代码审查**：团队成员审查代码
7. **合并**：合并到 develop 分支

### 2.  bug 修复

1. **创建分支**：从 develop 分支创建 fix 分支
2. **修复 bug**：定位并修复 bug
3. **测试**：测试修复是否有效
4. **提交代码**：使用语义化提交格式提交代码
5. **创建 PR**：向 develop 分支创建 Pull Request
6. **代码审查**：团队成员审查代码
7. **合并**：合并到 develop 分支

### 3. 版本发布

1. **准备发布**：从 develop 分支创建 release 分支
2. **版本号更新**：更新版本号，修改 CHANGELOG
3. **测试**：进行最终测试
4. **提交代码**：提交版本更新
5. **合并**：合并到 main 分支
6. **打标签**：为 main 分支打版本标签
7. **构建**：构建发布版本
8. **发布**：发布到 GitHub Releases

## 未来发展

- **多平台支持**：扩展到 macOS 和 Linux
- **更多加载器支持**：支持更多模组加载器
- **更智能的模组筛选**：提高模组筛选的准确性
- **更多模板功能**：增强模板系统的功能
- **插件系统**：支持第三方插件扩展功能
- **API 文档**：完善 API 文档
- **测试覆盖**：增加单元测试和集成测试
- **性能优化**：优化处理速度和内存使用
- **安全性**：增强系统安全性
- **用户体验**：改善用户界面和交互体验