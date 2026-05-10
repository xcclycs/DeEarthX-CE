import express, { Application } from "express";
import multer from "multer";
import cors from "cors"
import websocket, { WebSocketServer } from "ws"
import { createServer, Server } from "node:http";
import { Config, IConfig } from "./utils/config.js";
import { Dex } from "./Dex.js";
import { logger } from "./utils/logger.js";
import { checkJava, JavaCheckResult, detectJavaPaths } from "./utils/utils.js";
import { Galaxy } from "./galaxy.js";
import { GuardianController } from "./guardian/index.js";
import type { IGuardianConfig } from "./guardian/types.js";
import fs from "node:fs";

export class Core {
    private config: IConfig;
    private readonly app: Application;
    private readonly server: Server;
    public ws!: WebSocketServer;
    private wsx!: websocket;
    private readonly upload: multer.Multer;
    dex: Dex;
    galaxy: Galaxy;
    guardian!: GuardianController;
    
    constructor(config: IConfig) {
        this.config = config
        this.app = express();
        this.server = createServer(this.app);
        this.ws = new WebSocketServer({ server: this.server })
        this.ws.on("connection",(e)=>{
            this.wsx = e
            this.setupGuardianWSHandler(e);
        })
        this.dex = new Dex(this.ws)
        this.galaxy = new Galaxy()
        this.initGuardian();
        const storage = multer.memoryStorage();
        this.upload = multer({ 
            storage: storage,
            limits: {
                fileSize: 2 * 1024 * 1024 * 1024,
                files: 10
            }
        });
    }

    private async javachecker() {
        try {
            const result: JavaCheckResult = await checkJava();
            
            if (result.exists && result.version) {
                logger.info(`检测到 Java: ${result.version.fullVersion} (${result.version.vendor})`);
                
                if (this.wsx) {
                    this.wsx.send(JSON.stringify({
                        type: "info",
                        message: `检测到 Java: ${result.version.fullVersion} (${result.version.vendor})`,
                        data: result.version
                    }));
                }
            } else {
                logger.error("Java 检查失败", result.error);
                
                if (this.wsx) {
                    this.wsx.send(JSON.stringify({
                        type: "error",
                        message: result.error || "未找到 Java 或版本检查失败",
                        data: result
                    }));
                }
            }
        } catch (error) {
            logger.error("Java 检查异常", error as Error);
            
            if (this.wsx) {
                this.wsx.send(JSON.stringify({
                    type: "error",
                    message: "Java 检查遇到异常"
                }));
            }
        }
    }

    private setupExpressRoutes() {
        this.setupMiddleware();
        this.setupHealthRoutes();
        this.setupTaskRoutes();
        this.setupConfigRoutes();
        this.setupModCheckRoutes();
        this.setupGalaxyRoutes();
        this.setupJavaRoutes();
        this.setupTemplateRoutes();
        this.setupGuardianRoutes();
    }

    private setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '2gb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '2gb' }));
        
        // 全局错误处理中间件
        this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
            logger.error("全局错误捕获", err);
            res.status(err.status || 500).json({
                status: err.status || 500,
                message: err.message || "服务器内部错误",
                stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
            });
        });
    }

    private setupHealthRoutes() {
        // 健康检查路由（ping 接口）
        this.app.get('/', (req, res) => {
            const pingTime = new Date().toISOString();
            logger.debug("收到 Ping 请求", { time: pingTime, ip: req.ip });
            res.json({
                status: 200,
                by: "DeEarthX.Core",
                qqg: "559349662",
                bilibili: "https://space.bilibili.com/1728953419  ",
                ping: pingTime
            });
        });
        
        // 版本信息路由
        this.app.get('/version', (req, res) => {
            logger.debug("请求版本信息", { ip: req.ip });
            res.json({
                status: 200,
                version: "1.0.0",
                name: "DeEarthX.Core",
                buildTime: new Date().toISOString()
            });
        });
    }

    private setupTaskRoutes() {
        // 启动任务路由
        this.app.post("/start", this.upload.single("file"), (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ status: 400, message: "未上传文件" });
                }
                if (!req.query.mode) {
                    return res.status(400).json({ status: 400, message: "缺少 mode 参数" });
                }
                
                // 文件类型检查
                const allowedExtensions = ['.zip', '.mrpack'];
                const fileExtension = req.file.originalname.toLowerCase().substring(req.file.originalname.lastIndexOf('.'));
                if (!allowedExtensions.includes(fileExtension)) {
                    return res.status(400).json({ status: 400, message: "只支持 .zip 和 .mrpack 文件" });
                }
                
                const isServerMode = req.query.mode === "server";
                const template = req.query.template as string || "";
                logger.info("正在启动任务", { 是否服务端模式: isServerMode, 文件名: req.file.originalname, 文件大小: req.file.size, 模板: template || "官方模组加载器" });
                
                // 非阻塞执行主要任务
                this.dex.Main(req.file.buffer, isServerMode, req.file.originalname, template).catch(err => {
                    logger.error("任务执行失败", err);
                });
                
                res.json({ status: 200, message: "任务已提交，正在处理中" });
            } catch (err) {
                const error = err as Error;
                logger.error("/start 路由错误", error);
                res.status(500).json({ status: 500, message: "服务器内部错误" });
            }
        });
    }

    private setupConfigRoutes() {
        // 获取配置路由
        this.app.get('/config/get', (req, res) => {
            try {
                this.config = Config.getConfig();
                res.json(this.config);
            } catch (err) {
                const error = err as Error;
                logger.error("/config/get 路由错误", error);
                res.status(500).json({ status: 500, message: "获取配置失败" });
            }
        });

        // 更新配置路由
        this.app.post('/config/post', (req, res) => {
            try {
                Config.writeConfig(req.body);
                this.config = req.body;
                Config.clearCache();
                logger.info("配置已更新");
                res.json({ status: 200 });
            } catch (err) {
                const error = err as Error;
                logger.error("/config/post 路由错误", error);
                res.status(500).json({ status: 500, message: "更新配置失败" });
            }
        });
    }

    private setupModCheckRoutes() {
        // 模组检查路由 - 通过路径检查
        this.app.get('/modcheck', async (req, res) => {
            try {
                const modsPath = req.query.path as string;
                if (!modsPath) {
                    return res.status(400).json({ status: 400, message: "缺少 path 参数" });
                }

                const { ModCheckService } = await import('./dearth/index.js');
                const checkService = new ModCheckService(modsPath);
                const results = await checkService.checkMods();

                res.json(results);
            } catch (err) {
                const error = err as Error;
                logger.error("/modcheck 路由错误", error);
                res.status(500).json({ status: 500, message: "模组检查失败" });
            }
        });



        // 模组检查路由 - 通过文件夹路径和整合包名字检查
        this.app.post('/modcheck/folder', async (req, res) => {
            try {
                const { folderPath, bundleName } = req.body;

                if (!folderPath) {
                    logger.warn("请求中缺少文件夹路径");
                    return res.status(400).json({ status: 400, message: "缺少文件夹路径" });
                }

                if (!bundleName || !bundleName.trim()) {
                    logger.warn("请求中缺少整合包名字");
                    return res.status(400).json({ status: 400, message: "缺少整合包名字" });
                }

                logger.info("收到模组检查文件夹请求", { 
                    folderPath, 
                    bundleName: bundleName.trim() 
                });

                const { ModCheckService } = await import('./dearth/index.js');
                const checkService = new ModCheckService(folderPath);
                const results = await checkService.checkModsWithBundle(bundleName.trim());

                logger.info("模组检查完成", { resultsCount: results.length });
                res.json(results);
            } catch (err) {
                const error = err as Error;
                logger.error("/modcheck/folder 路由错误", error);
                res.status(500).json({ status: 500, message: "模组检查失败: " + error.message });
            }
        });
    }

    private setupGalaxyRoutes() {
        this.app.use("/galaxy", this.galaxy.getRouter());
    }

    private setupJavaRoutes() {
        // 检查Java版本
        this.app.get('/java/check', async (req, res) => {
            try {
                const javaPath = req.query.path as string;
                const result: JavaCheckResult = await checkJava(javaPath);
                
                res.json({
                    status: 200,
                    data: result
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/java/check 路由错误", error);
                res.status(500).json({ status: 500, message: "Java检查失败" });
            }
        });

        // 自动检测Java路径
        this.app.get('/java/detect', async (req, res) => {
            try {
                const paths = await detectJavaPaths();
                
                res.json({
                    status: 200,
                    data: paths
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/java/detect 路由错误", error);
                res.status(500).json({ status: 500, message: "Java路径检测失败" });
            }
        });
    }

    private setupTemplateRoutes() {
        // 获取模板列表
        this.app.get('/templates', async (req, res) => {
            try {
                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                const templates = await templateManager.getTemplates();
                
                res.json({
                    status: 200,
                    data: templates
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/templates 路由错误", error);
                res.status(500).json({ status: 500, message: "获取模板列表失败" });
            }
        });

        // 创建模板
        this.app.post('/templates', async (req, res) => {
            try {
                const { name, version, description, author } = req.body;
                
                if (!name) {
                    res.status(400).json({ status: 400, message: "模板名称不能为空" });
                    return;
                }

                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                
                const templateId = `template-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                
                await templateManager.createTemplate(templateId, {
                    name,
                    version: version || '1.0.0',
                    description: description || '',
                    author: author || '',
                    created: new Date().toISOString().split("T")[0],
                    type: 'template'
                });
                
                res.json({
                    status: 200,
                    message: "模板创建成功",
                    data: { id: templateId }
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/templates POST 路由错误", error);
                res.status(500).json({ status: 500, message: "创建模板失败" });
            }
        });

        // 删除模板
        this.app.delete('/templates/:id', async (req, res) => {
            try {
                const { id } = req.params;
                
                const templateModule = await import('./template/index.js');
                const TemplateService = (templateModule as any).TemplateService;
                const templateService = new TemplateService();
                
                const success = await templateService.deleteTemplate(id);
                
                if (success) {
                    res.json({
                        status: 200,
                        message: "模板删除成功"
                    });
                } else {
                    res.status(404).json({ status: 404, message: "模板不存在" });
                }
            } catch (err) {
                const error = err as Error;
                logger.error(`/templates/${req.params.id} DELETE 路由错误`, error);
                res.status(500).json({ status: 500, message: "删除模板失败" });
            }
        });

        // 修改模板信息
        this.app.put('/templates/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const { name, version, description, author } = req.body;
                
                if (!name) {
                    res.status(400).json({ status: 400, message: "模板名称不能为空" });
                    return;
                }

                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                
                await templateManager.updateTemplate(id, {
                    name,
                    version: version || '1.0.0',
                    description: description || '',
                    author: author || '',
                    type: 'template'
                });
                
                res.json({
                    status: 200,
                    message: "模板更新成功"
                });
            } catch (err) {
                const error = err as Error;
                logger.error(`/templates/${req.params.id} PUT 路由错误`, error);
                res.status(500).json({ status: 500, message: "更新模板失败" });
            }
        });

        // 打开模板文件夹
        this.app.get('/templates/:id/path', async (req, res) => {
            try {
                const { id } = req.params;
                const path = await import('path');
                const { exec } = await import('child_process');
                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                
                const templateManager = new TemplateManager();
                const templatesPath = (templateManager as any).templatesPath;
                const templatePath = path.resolve(templatesPath, id);
                
                const platform = process.platform;
                let command: string;
                
                if (platform === 'win32') {
                    command = `explorer "${templatePath}"`;
                } else if (platform === 'darwin') {
                    command = `open "${templatePath}"`;
                } else {
                    command = `xdg-open "${templatePath}"`;
                }
                
                exec(command, (error) => {
                    res.json({
                        status: 200,
                        message: "文件夹已打开"
                    });
                });
            } catch (err) {
                const error = err as Error;
                logger.error(`/templates/${req.params.id}/path 路由错误`, error);
                res.status(500).json({ status: 500, message: "打开文件夹失败" });
            }
        });

        // 导出模板
        this.app.get('/templates/:id/export', async (req, res) => {
            try {
                const { id } = req.params;
                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                
                // 生成临时文件路径
                const os = await import('os');
                const path = await import('path');
                const tempDir = os.tmpdir();
                const outputPath = path.join(tempDir, `template-${id}.zip`);
                
                // 导出模板
                await templateManager.exportTemplate(id, outputPath);
                
                // 发送文件
                res.download(outputPath, `template-${id}.zip`, (err) => {
                    // 下载完成后删除临时文件
                    fs.unlink(outputPath, () => {});
                    if (err) {
                        logger.error(`导出模板失败: ${err.message}`);
                        res.status(500).json({ status: 500, message: "导出模板失败" });
                    }
                });
            } catch (err) {
                const error = err as Error;
                logger.error(`/templates/${req.params.id}/export 路由错误`, error);
                res.status(500).json({ status: 500, message: "导出模板失败" });
            }
        });

        // 导入模板
        this.app.post('/templates/import', this.upload.single('file'), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ status: 400, message: "未上传文件" });
                }
                
                // 文件类型检查
                const fileExtension = req.file.originalname.toLowerCase().substring(req.file.originalname.lastIndexOf('.'));
                if (fileExtension !== '.zip') {
                    return res.status(400).json({ status: 400, message: "只支持 .zip 文件" });
                }
                
                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                
                // 导入模板
                const templateId = await templateManager.importTemplate(req.file.buffer);
                
                res.json({
                    status: 200,
                    message: "模板导入成功",
                    data: { id: templateId }
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/templates/import 路由错误", error);
                res.status(500).json({ status: 500, message: "导入模板失败" });
            }
        });

        // 存储SSE连接
        const sseConnections = new Map();
        
        // 存储下载状态
        const downloadStates = new Map();
        
        // 从URL安装模板 - POST请求启动下载
        this.app.post('/templates/install-from-url', async (req, res) => {
            try {
                const { url, requestId, resumeFrom = 0 } = req.body;
                
                if (!url) {
                    return res.status(400).json({ status: 400, message: "缺少 url 参数" });
                }
                
                // 下载文件并流式处理
                const { default: got } = await import('got');
                const { createWriteStream, readFileSync, statSync, unlinkSync } = await import('fs');
                const { tmpdir } = await import('os');
                const { join } = await import('path');
                
                // 创建临时文件
                const tempFilePath = join(tmpdir(), `template-${Date.now()}.zip`);
                const writeStream = createWriteStream(tempFilePath, { 
                    flags: resumeFrom > 0 ? 'a' : 'w' // 支持断点续传
                });
                
                // 构建请求选项
                const requestOptions = {
                    headers: {} as Record<string, string>
                };
                
                // 如果是续传，设置Range头
                if (resumeFrom > 0) {
                    requestOptions.headers['Range'] = `bytes=${resumeFrom}-`;
                }
                
                // 流式下载（支持分块）
                const request = await got.stream(url, requestOptions);
                
                let totalSize = 0;
                let downloadedSize = resumeFrom;
                
                // 获取文件大小（如果可用）
                request.on('response', (response) => {
                    // 检查是否支持分块下载
                    const acceptRanges = response.headers['accept-ranges'];
                    console.log(`服务器支持分块下载: ${acceptRanges}`);
                    
                    // 获取文件大小
                    let contentLength = response.headers['content-length'];
                    if (!contentLength) {
                        // 如果没有content-length，尝试从content-range获取
                        const contentRange = response.headers['content-range'];
                        if (contentRange) {
                            const matches = contentRange.match(/bytes \d+-\d+\/(\d+)/);
                            if (matches && matches[1]) {
                                contentLength = matches[1];
                            }
                        }
                    }
                    
                    if (contentLength) {
                        totalSize = parseInt(contentLength);
                        // 发送初始化信息，包含文件大小
                        if (sseConnections.has(requestId)) {
                            const sseRes = sseConnections.get(requestId);
                            sseRes.write(`data: ${JSON.stringify({ 
                                type: 'init', 
                                totalSize, 
                                resumeFrom 
                            })}\n\n`);
                        }
                    }
                });
                
                // 监听数据传输，计算进度
                request.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (totalSize > 0) {
                        const progress = Math.round((downloadedSize / totalSize) * 100);
                        // 向后端日志输出进度
                        console.log(`下载进度: ${progress}%`);
                        // 发送进度信息到SSE连接
                        if (sseConnections.has(requestId)) {
                            const sseRes = sseConnections.get(requestId);
                            sseRes.write(`data: ${JSON.stringify({ 
                                type: 'progress', 
                                progress, 
                                downloadedSize, 
                                totalSize 
                            })}\n\n`);
                        }
                    } else {
                        // 无法计算总大小时，发送假进度
                        const progress = Math.min(90, Math.round((downloadedSize / 1024 / 1024) * 10));
                        if (sseConnections.has(requestId)) {
                            const sseRes = sseConnections.get(requestId);
                            sseRes.write(`data: ${JSON.stringify({ 
                                type: 'progress', 
                                progress, 
                                downloadedSize 
                            })}\n\n`);
                        }
                    }
                });
                
                // 管道到临时文件
                await new Promise((resolve, reject) => {
                    request.pipe(writeStream)
                        .on('finish', resolve)
                        .on('error', reject);
                });
                
                // 读取临时文件
                const buffer = readFileSync(tempFilePath);
                
                // 清理临时文件
                unlinkSync(tempFilePath);
                
                // 导入模板
                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                
                const templateId = await templateManager.importTemplate(buffer);
                
                // 发送完成响应到SSE连接
                if (sseConnections.has(requestId)) {
                    const sseRes = sseConnections.get(requestId);
                    sseRes.write(`data: ${JSON.stringify({ 
                        type: 'complete', 
                        status: 200, 
                        message: "模板安装成功", 
                        data: { id: templateId } 
                    })}\n\n`);
                    sseRes.end();
                    sseConnections.delete(requestId);
                }
                
                // 清理下载状态
                downloadStates.delete(requestId);
                
                // 发送POST响应
                res.json({
                    status: 200,
                    message: "模板安装成功",
                    data: { id: templateId }
                });
            } catch (err) {
                const error = err as Error;
                const { requestId, url } = req.body;
                logger.error("/templates/install-from-url 路由错误", { error: error.message, stack: error.stack, url });
                
                // 发送错误信息到SSE连接
                if (sseConnections.has(requestId)) {
                    const sseRes = sseConnections.get(requestId);
                    sseRes.write(`data: ${JSON.stringify({ 
                        type: 'error', 
                        status: 500, 
                        message: "安装模板失败",
                        details: error.message 
                    })}\n\n`);
                    sseRes.end();
                    sseConnections.delete(requestId);
                }
                
                // 清理下载状态
                downloadStates.delete(requestId);
                
                res.status(500).json({ 
                    status: 500, 
                    message: "安装模板失败",
                    details: error.message 
                });
            }
        });
        
        // SSE连接 - GET请求
        this.app.get('/templates/install-from-url', (req, res) => {
            const { requestId } = req.query;
            
            if (!requestId) {
                return res.status(400).json({ status: 400, message: "缺少 requestId 参数" });
            }
            
            // 设置SSE响应头
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');
            
            // 存储连接
            sseConnections.set(requestId, res);
            
            // 发送初始信息
            res.write(`data: ${JSON.stringify({ type: 'init' })}\n\n`);
            
            // 处理连接关闭
            req.on('close', () => {
                sseConnections.delete(requestId);
                console.log(`SSE连接已关闭: ${requestId}`);
            });
        });

        // 获取模板商店数据
        this.app.get('/templates/store', async (req, res) => {
            try {
                const { default: got } = await import('got');
                
                // 从指定URL获取模板商店数据
                const response = await got('http://git.xcclyc.com.cn/xcclyc/DeEarthX-CE-Tems/raw/branch/main/template_stor.json', {
                    timeout: {
                        request: 10000 // 10秒超时
                    }
                });
                const data = JSON.parse(response.body);
                
                // 确保返回的数据结构符合前端预期
                if (!data.templates) {
                    return res.json({
                        status: 200,
                        data: { templates: [] }
                    });
                }
                
                res.json({
                    status: 200,
                    data: data
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/templates/store 路由错误", error);
                // 即使获取失败，也返回空的模板列表，确保前端能正常加载
                res.json({
                    status: 200,
                    data: { templates: [] }
                });
            }
        });
    }

    // ==================== Guardian (ServerGuardian) ====================

    /**
     * 初始化 Guardian 模块
     */
    private initGuardian(): void {
        const guardianConfig: IGuardianConfig = {
            enabled: this.config.guardian?.enabled ?? false,
            ai: {
                provider: this.config.guardian?.ai?.provider ?? 'openai',
                apiKey: this.config.guardian?.ai?.apiKey ?? '',
                model: this.config.guardian?.ai?.model ?? 'gpt-4.1-mini',
                baseURL: this.config.guardian?.ai?.baseURL ?? 'https://api.openai.com/v1',
                maxTokens: this.config.guardian?.ai?.maxTokens || 1500
            },
            autoAcceptLowRisk: this.config.guardian?.autoAcceptLowRisk ?? true,
            maxConsecutiveCrashes: this.config.guardian?.maxConsecutiveCrashes ?? 5,
            monitoringTimeout: this.config.guardian?.monitoringTimeout ?? 30000,
            maxLogContextLines: 200,
            workDir: '',
            javaCommand: '',
            serverType: 'unknown',
            automationLevel: 'strict'
        };

        this.guardian = new GuardianController(guardianConfig, {
            onStatusChange: (status, data) => {
                this.sendGuardianEvent('guardian_status', { status, data });
            },
            onLogLine: (line, isError) => {
                this.sendGuardianEvent('guardian_log', { line, isError });
            },
            onCrashDetected: (crashInfo) => {
                this.sendGuardianEvent('guardian_crash_detected', crashInfo);
            },
            onAIAnalysis: (diagnosis) => {
                this.sendGuardianEvent('guardian_ai_analysis', diagnosis);
                // 同步推送最新的 AI 对话记录
                if (this.guardian) {
                    this.sendGuardianEvent('guardian_ai_conversation', this.guardian.getAIConversations());
                }
            },
            onActionsRequired: (actions) => {
                this.sendGuardianEvent('guardian_actions_required', actions);
            },
            onActionExecuted: (result) => {
                this.sendGuardianEvent('guardian_action_executed', result);
            },
            onGiveUp: (reason) => {
                this.sendGuardianEvent('guardian_give_up', { reason });
                logger.warn(`ServerGuardian 放弃: ${reason}`);
            },
            onReport: (report) => {
                this.sendGuardianEvent('guardian_report', report);
            },
            onAIConversation: (conversations) => {
                this.sendGuardianEvent('guardian_ai_conversation', conversations);
            }
        });

        logger.info('ServerGuardian 模块已初始化');
    }

    /**
     * 发送 Guardian WebSocket 事件
     */
    private sendGuardianEvent(type: string, data: any): void {
        try {
            if (this.wsx && this.wsx.readyState === websocket.OPEN) {
                this.wsx.send(JSON.stringify({ type, data }));
            }
        } catch (err) {
            logger.error('发送 Guardian 事件失败', err as Error);
        }
    }

    /**
     * 设置 Guardian WebSocket 消息处理器
     */
    private setupGuardianWSHandler(ws: websocket): void {
        if (!this.guardian) return;

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (!msg.type || !msg.type.startsWith('guardian_')) return;

                switch (msg.type) {
                    case 'guardian_start':
                        if (this.guardian) {
                            const { workDir, javaCommand, serverType } = msg.data || {};
                            if (workDir) {
                                this.guardian.updateConfig({
                                    workDir,
                                    javaCommand: javaCommand || '',
                                    serverType: serverType || 'unknown'
                                });
                            }
                            this.guardian.start();
                        }
                        break;

                    case 'guardian_stop':
                        this.guardian?.stop();
                        break;

                    case 'guardian_test_ai':
                        if (this.guardian) {
                            this.guardian.testAI().then(result => {
                                this.sendGuardianEvent('guardian_test_ai_result', result);
                            }).catch((err: Error) => {
                                this.sendGuardianEvent('guardian_test_ai_result', {
                                    success: false,
                                    message: `AI 测试内部错误: ${err.message}`
                                });
                            });
                        } else {
                            this.sendGuardianEvent('guardian_test_ai_result', {
                                success: false,
                                message: 'Guardian 模块未初始化，请检查配置后重试'
                            });
                        }
                        break;

                    case 'guardian_approve':
                        this.guardian?.approveActions(msg.data?.actionIds || []);
                        break;

                    case 'guardian_reject':
                        this.guardian?.rejectActions(msg.data?.actionIds || []);
                        break;

                    case 'guardian_rollback':
                        this.guardian?.rollbackLastFix();
                        break;

                    case 'guardian_command':
                        this.guardian?.sendCommand(msg.data?.command || '');
                        break;

                    case 'guardian_get_ai_conversation':
                        if (this.guardian) {
                            this.sendGuardianEvent('guardian_ai_conversation', this.guardian.getAIConversations());
                        }
                        break;

                    case 'guardian_reset_ai_conversation':
                        if (this.guardian) {
                            this.guardian.resetAIConversations();
                            this.sendGuardianEvent('guardian_ai_conversation', []);
                        }
                        break;

                    case 'guardian_update_config':
                        this.guardian?.updateConfig(msg.data || {});
                        // 同时更新全局配置
                        if (msg.data?.ai) {
                            const current = Config.getConfig();
                            current.guardian = {
                                ...current.guardian!,
                                ai: { ...current.guardian!.ai, ...msg.data.ai }
                            };
                            Config.writeConfig(current);
                            Config.clearCache();
                        }
                        break;
                }
            } catch (err) {
                logger.error('处理 Guardian WebSocket 消息失败', err as Error);
            }
        });
    }

    /**
     * Guardian REST API 路由
     */
    private setupGuardianRoutes(): void {
        // 获取 Guardian 状态
        this.app.get('/guardian/status', (req, res) => {
            if (!this.guardian) {
                return res.json({ status: 200, enabled: false, message: 'Guardian 未初始化' });
            }
            res.json({
                status: 200,
                enabled: true,
                guardianStatus: this.guardian.getStatus(),
                processInfo: this.guardian.getProcessInfo(),
                checkpoints: this.guardian.getCheckpoints(),
                reports: this.guardian.getReportsList()
            });
        });

        // 获取日志缓冲区
        this.app.get('/guardian/logs', (req, res) => {
            if (!this.guardian) {
                return res.json({ status: 200, logs: [] });
            }
            const lines = parseInt(req.query.lines as string) || 100;
            const buffer = this.guardian.getLogBuffer();
            res.json({ status: 200, logs: buffer.slice(-lines) });
        });

        // 获取报告列表
        this.app.get('/guardian/reports', (req, res) => {
            if (!this.guardian) {
                return res.json({ status: 200, reports: [] });
            }
            res.json({ status: 200, reports: this.guardian.getReportsList() });
        });
    }

    public async start() {
        
        this.setupExpressRoutes();
        const port = this.config.port || 37019;
        const host = this.config.host || 'localhost';
        this.server.listen(port, host, async () => {
            logger.info(`服务器正在运行于 http://${host}:${port}`);
            await this.javachecker();
        });
        
        this.server.on('error', (err) => {
            logger.error("服务器错误", err);
        });
    }
}