# 开发者指南

## 概述

本指南旨在帮助开发者理解 DeEarthX-CE 项目的架构和开发流程，以便能够顺利地为项目做出贡献。

## 项目架构

DeEarthX-CE 采用前后端分离架构：

- **后端**：使用 TypeScript 开发，提供核心功能和 API
- **前端**：使用 Vue 3 + Vite 开发，提供用户界面
- **打包工具**：使用 Tauri 打包为桌面应用

## 目录结构

### 后端目录结构

```
backend/
├── src/
│   ├── dearth/            # 核心功能模块
│   │   ├── strategies/    # 模组过滤策略
│   │   ├── utils/         # 工具函数
│   │   ├── ModCheckService.ts    # 模组检查服务
│   │   ├── ModFilterService.ts   # 模组过滤服务
│   │   └── index.ts      # 核心模块入口
│   ├── modloader/         # 模组加载器相关功能
│   ├── platform/          # 平台集成模块
│   ├── template/          # 模板管理模块
│   ├── utils/             # 通用工具函数
│   ├── Dex.ts             # 核心类
│   ├── core.ts            # 核心功能
│   ├── galaxy.ts          # Galaxy 模式功能
│   └── main.ts            # 主入口
├── package.json           # 后端依赖
└── tsconfig.json          # TypeScript 配置
```

### 前端目录结构

```
front/
├── src/
│   ├── components/        # 组件
│   ├── views/             # 页面视图
│   ├── utils/             # 工具函数
│   ├── assets/            # 资源文件
│   ├── App.vue            # 根组件
│   └── main.ts            # 主入口
├── lang/                  # 语言文件
├── public/                # 静态资源
├── src-tauri/             # Tauri 配置
├── package.json           # 前端依赖
└── vite.config.ts         # Vite 配置
```

## 开发环境设置

### 前提条件

- **Node.js**：v16.0+（推荐使用最新稳定版）
- **pnpm**：v8.0+（包管理器）
- **Rust**：最新稳定版（用于 Tauri 构建）
- **Git**：用于版本控制

### 安装依赖

```bash
# 安装项目依赖
pnpm install

# 安装后端依赖
cd backend
pnpm install

# 安装前端依赖
cd ../front
pnpm install
```

### 启动开发服务器

```bash
# 启动前端开发服务器
cd front
pnpm run dev

# 启动后端开发服务器
cd ../backend
pnpm run dev
```

## 核心模块开发

### 模组检查服务

`ModCheckService` 负责检查模组的有效性和兼容性：

- **主要功能**：检查模组文件、验证模组信息、检测兼容性
- **关键方法**：
  - `checkMod()`：检查模组的基本信息
  - `checkModCompatibility()`：检查模组与游戏版本的兼容性

### 模组过滤服务

`ModFilterService` 负责根据不同策略过滤模组：

- **主要功能**：注册过滤策略、执行模组过滤
- **关键方法**：
  - `filterMods()`：根据策略过滤模组
  - `registerFilterStrategy()`：注册新的过滤策略

### 模板管理服务

`TemplateManager` 负责模板的创建、管理和应用：

- **主要功能**：创建模板、应用模板、导出模板
- **关键方法**：
  - `createTemplate()`：创建新模板
  - `applyTemplate()`：应用模板到指定目录
  - `exportTemplate()`：导出模板为文件

## 平台集成开发

### CurseForge 集成

- **功能**：与 CurseForge API 交互，搜索和下载模组
- **关键方法**：
  - `searchMods()`：搜索模组
  - `getModDetails()`：获取模组详情
  - `downloadMod()`：下载模组文件

### Modrinth 集成

- **功能**：与 Modrinth API 交互，搜索和下载模组
- **关键方法**：
  - `searchMods()`：搜索模组
  - `getModDetails()`：获取模组详情
  - `downloadMod()`：下载模组文件

## 前端开发

### 组件开发

- **组件结构**：使用 Vue 3 Composition API
- **样式管理**：使用 Tailwind CSS
- **状态管理**：使用 Vue 的响应式系统

### 页面开发

- **Main.vue**：主页面，包含模式选择
- **DeEarthView.vue**：DeEarth 模式页面，用于模组管理
- **GalaxyView.vue**：Galaxy 模式页面，用于模板管理
- **SettingView.vue**：设置页面
- **AboutView.vue**：关于页面

## API 开发

### 后端 API

- **RESTful API**：提供模组管理、模板管理等功能
- **WebSocket API**：提供实时通信功能

### 前端 API 调用

- **HTTP 请求**：使用 axios 发送 API 请求
- **WebSocket**：使用 WebSocketHandler 组件进行实时通信

## 测试

### 单元测试

```bash
# 运行后端单元测试
cd backend
pnpm run test

# 运行前端单元测试
cd ../front
pnpm run test
```

### 集成测试

- **API 测试**：测试后端 API 的功能
- **端到端测试**：测试完整的用户流程

## 构建与部署

### 构建应用

```bash
# 构建前端
cd front
pnpm run build

# 构建后端
cd ../backend
pnpm run build

# 构建桌面应用
cd ..
pnpm run tauri build
```

### 部署

- **桌面应用**：分发构建后的安装包
- **文档**：部署到 GitHub Pages 或其他静态网站托管服务

## 代码规范

### TypeScript 规范

- 使用 TypeScript 官方推荐的代码风格
- 为所有函数和变量添加类型注解
- 使用接口定义复杂类型

### Vue 规范

- 遵循 Vue 3 风格指南
- 使用 Composition API
- 组件命名使用 PascalCase

### Rust 规范

- 遵循 Rust 官方代码风格
- 使用 `cargo fmt` 格式化代码
- 为公共 API 添加文档注释

## 调试技巧

### 后端调试

- 使用 VS Code 的 TypeScript 调试功能
- 查看日志输出
- 使用 `console.log()` 或 `debugger` 语句

### 前端调试

- 使用浏览器的开发者工具
- 查看控制台输出
- 使用 Vue DevTools 扩展

### Tauri 调试

- 使用 `tauri dev` 启动开发模式
- 查看 Tauri 日志
- 使用 Rust 调试工具

## 常见问题

### 依赖冲突

- 检查 package.json 中的依赖版本
- 使用 pnpm 管理依赖
- 运行 `pnpm dedupe` 解决依赖冲突

### 构建失败

- 检查 Node.js 和 Rust 版本
- 确保所有依赖都已正确安装
- 查看构建日志获取详细错误信息

### API 调用失败

- 检查网络连接
- 验证 API 端点是否正确
- 查看服务器日志获取详细错误信息

## 贡献流程

1. ** Fork 仓库**：在 GitHub 上 fork 项目仓库
2. **克隆仓库**：克隆 fork 后的仓库到本地
3. **创建分支**：从 develop 分支创建新的功能分支
4. **开发代码**：实现功能或修复 bug
5. **运行测试**：确保代码通过所有测试
6. **提交代码**：使用规范的提交信息
7. **创建 PR**：向 develop 分支提交 Pull Request
8. **代码审查**：等待项目维护者的代码审查
9. **合并代码**：审查通过后，代码将被合并到 develop 分支

## 技术栈

- **后端**：TypeScript、Node.js
- **前端**：Vue 3、Vite、Tailwind CSS
- **打包**：Tauri
- **测试**：Jest、Vitest
- **版本控制**：Git
- **包管理**：pnpm

## 学习资源

- **Vue 3 文档**：https://v3.vuejs.org/
- **TypeScript 文档**：https://www.typescriptlang.org/docs/
- **Tauri 文档**：https://tauri.studio/docs/
- **Rust 文档**：https://doc.rust-lang.org/
- **Tailwind CSS 文档**：https://tailwindcss.com/docs/

## 联系方式

- **GitHub Issues**：用于问题报告和功能请求
- **Discord**：用于实时讨论和社区交流
- **Email**：用于重要事项的沟通