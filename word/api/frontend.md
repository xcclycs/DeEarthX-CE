# 前端 API

## 概述

DeEarthX-CE 的前端模块使用 Vue 3 + Vite 开发，提供了用户界面和与后端的交互功能。本章节将详细介绍前端模块的 API 接口。

## 项目结构

前端模块包含以下主要目录：

- `src/components/` - 组件目录
- `src/views/` - 页面视图目录
- `src/utils/` - 工具函数目录
- `src/assets/` - 资源文件目录
- `lang/` - 语言文件目录

## 组件

### ModeSelector.vue

**功能**：模式选择组件，用于选择不同的操作模式

**属性**：

- `modes` - 模式数组，包含模式名称和图标
- `selectedMode` - 当前选中的模式
- `@mode-change` - 模式变更事件

**方法**：

- `selectMode(mode: string): void` - 选择指定模式

### ProgressCard.vue

**功能**：进度卡片组件，用于显示操作进度

**属性**：

- `title` - 卡片标题
- `progress` - 进度值（0-100）
- `status` - 状态（loading, success, error）
- `message` - 状态消息

**方法**：

- `updateProgress(progress: number): void` - 更新进度
- `setStatus(status: string, message: string): void` - 更新状态

### StepIndicator.vue

**功能**：步骤指示器组件，用于显示多步骤操作的进度

**属性**：

- `steps` - 步骤数组
- `currentStep` - 当前步骤索引

**方法**：

- `goToStep(step: number): void` - 跳转到指定步骤

### WebSocketHandler.vue

**功能**：WebSocket 处理组件，用于与后端进行实时通信

**属性**：

- `url` - WebSocket 服务器 URL
- `@message` - 接收消息事件
- `@connected` - 连接成功事件
- `@disconnected` - 连接断开事件

**方法**：

- `sendMessage(data: any): void` - 发送消息
- `connect(): void` - 建立连接
- `disconnect(): void` - 断开连接

## 页面视图

### Main.vue

**功能**：主页面组件

**方法**：

- `initializeApp(): void` - 初始化应用
- `loadUserSettings(): void` - 加载用户设置
- `handleModeChange(mode: string): void` - 处理模式变更

### DeEarthView.vue

**功能**：DeEarth 模式页面

**方法**：

- `loadMods(): void` - 加载模组列表
- `addMod(): void` - 添加模组
- `removeMod(modId: string): void` - 移除模组
- `toggleMod(modId: string): void` - 切换模组状态

### GalaxyView.vue

**功能**：Galaxy 模式页面

**方法**：

- `loadTemplates(): void` - 加载模板列表
- `createTemplate(): void` - 创建模板
- `applyTemplate(templateId: string): void` - 应用模板
- `exportTemplate(templateId: string): void` - 导出模板

### SettingView.vue

**功能**：设置页面

**方法**：

- `loadSettings(): void` - 加载设置
- `saveSettings(): void` - 保存设置
- `changeLanguage(language: string): void` - 更改语言

### AboutView.vue

**功能**：关于页面

**方法**：

- `loadVersionInfo(): void` - 加载版本信息
- `checkForUpdates(): void` - 检查更新

### TemplateView.vue

**功能**：模板管理页面

**方法**：

- `loadTemplates(): void` - 加载模板列表
- `createTemplate(): void` - 创建模板
- `editTemplate(templateId: string): void` - 编辑模板
- `deleteTemplate(templateId: string): void` - 删除模板

### ErrorView.vue

**功能**：错误页面

**属性**：

- `error` - 错误信息

**方法**：

- `retry(): void` - 重试操作
- `goHome(): void` - 返回首页

## 工具函数

### axios.ts

**功能**：HTTP 请求工具

**方法**：

- `get<T>(url: string, params?: any): Promise<T>` - 发送 GET 请求
- `post<T>(url: string, data?: any): Promise<T>` - 发送 POST 请求
- `put<T>(url: string, data?: any): Promise<T>` - 发送 PUT 请求
- `delete<T>(url: string): Promise<T>` - 发送 DELETE 请求

### i18n.ts

**功能**：国际化工具

**方法**：

- `loadLanguage(language: string): Promise<void>` - 加载指定语言
- `t(key: string): string` - 翻译指定键
- `getCurrentLanguage(): string` - 获取当前语言

### router.ts

**功能**：路由工具

**方法**：

- `navigateTo(path: string): void` - 导航到指定路径
- `goBack(): void` - 返回上一页
- `getCurrentRoute(): string` - 获取当前路由

## 状态管理

前端使用 Vue 的响应式系统进行状态管理，主要状态包括：

- `mods` - 模组列表
- `templates` - 模板列表
- `settings` - 用户设置
- `currentMode` - 当前模式
- `isLoading` - 加载状态
- `error` - 错误信息

## API 调用

前端通过以下方式与后端进行交互：

1. **HTTP 请求**：使用 axios 发送 RESTful API 请求
2. **WebSocket**：使用 WebSocketHandler 组件进行实时通信
3. **本地存储**：使用 localStorage 存储用户设置和缓存数据

## 语言支持

前端支持多种语言，语言文件位于 `lang/` 目录：

- `zh_cn.json` - 简体中文
- `zh_tw.json` - 繁体中文
- `zh_hk.json` - 香港中文
- `en_us.json` - 英文
- `ja_jp.json` - 日文
- `fr_fr.json` - 法文
- `es_es.json` - 西班牙文
- `de_de.json` - 德文

## 主题与样式

前端使用 Tailwind CSS 进行样式管理，支持响应式布局和主题定制。

## 构建与部署

### 开发模式

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```