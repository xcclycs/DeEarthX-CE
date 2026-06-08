import express, { Application, Router } from "express";
import multer from "multer";
import cors from "cors"
import { createServer, Server as HTTPServer } from "node:http";
import { Config, IConfig } from "./utils/config.js";
import { Dex } from "./Dex.js";
import { logger, getLogFilePath, getLogsDir, getLogFileContent, listLogFiles } from "./utils/logger.js";
import { checkJava, JavaCheckResult, detectJavaPaths, getAppDir } from "./utils/utils.js";
import { Galaxy } from "./galaxy.js";
import { GuardianController } from "./guardian/index.js";
import type { IGuardianConfig } from "./guardian/types.js";
import { initializeIO, getIO, getCurrentSocket, sendToSocket, MessageIO } from "./utils/socket.io.js";
import type { Socket, Server as SocketIOServer } from "socket.io";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PluginManager } from "./plugin/index.js";

export class Core {
    private config: IConfig;
    private readonly app: Application;
    private readonly server: HTTPServer;
    public io: SocketIOServer;
    private currentSocket: Socket | null = null;
    private readonly upload: multer.Multer;
    dex: Dex;
    galaxy: Galaxy;
    guardian!: GuardianController;
    pluginManager: PluginManager;
    private pluginRouter: Router;
    
    constructor(config: IConfig) {
        this.config = config
        this.app = express();
        this.server = createServer(this.app);
        this.io = initializeIO(this.server);
        this.app.set("io", this.io);
        
        this.setupSocketIOHandlers();
        this.dex = new Dex(this.io);
        this.galaxy = new Galaxy();
        this.pluginManager = new PluginManager();
        this.dex.setPluginManager(this.pluginManager);
        this.pluginRouter = Router();
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

    private setupSocketIOHandlers() {
        const io = getIO();
        if (!io) return;

        io.on("connection", (socket: Socket) => {
            this.currentSocket = socket;
            logger.info(`Socket.IO 客户端连接: ${socket.id}`);

            socket.on("disconnect", (reason) => {
                logger.info(`Socket.IO 客户端断开: ${socket.id}, 原因: ${reason}`);
                if (this.currentSocket?.id === socket.id) {
                    this.currentSocket = null;
                }
            });
        });
    }

    private async javachecker() {
        try {
            const result: JavaCheckResult = await checkJava();
            
            if (result.exists && result.version) {
                logger.info(`检测到 Java: ${result.version.fullVersion} (${result.version.vendor})`);
                
                if (this.currentSocket) {
                    this.currentSocket.emit("info", JSON.stringify({
                        type: "info",
                        message: `检测到 Java: ${result.version.fullVersion} (${result.version.vendor})`,
                        data: result.version
                    }));
                }
            } else {
                logger.error("Java 检查失败", result.error);
                
                if (this.currentSocket) {
                    this.currentSocket.emit("error", JSON.stringify({
                        type: "error",
                        message: result.error || "未找到 Java 或版本检查失败",
                        data: result
                    }));
                }
            }
        } catch (error) {
            logger.error("Java 检查异常", error as Error);
            
            if (this.currentSocket) {
                this.currentSocket.emit("error", JSON.stringify({
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
        this.setupPluginRoutes();
        this.setupDownloadRoutes();
        this.setupLogRoutes();
    }

    private setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json({ limit: '2gb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '2gb' }));
        
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
        this.app.post("/start", this.upload.single("file"), (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ status: 400, message: "未上传文件" });
                }
                if (!req.query.mode) {
                    return res.status(400).json({ status: 400, message: "缺少 mode 参数" });
                }
                
                const allowedExtensions = ['.zip', '.mrpack'];
                const fileExtension = req.file.originalname.toLowerCase().substring(req.file.originalname.lastIndexOf('.'));
                if (!allowedExtensions.includes(fileExtension)) {
                    return res.status(400).json({ status: 400, message: "只支持 .zip 和 .mrpack 文件" });
                }
                
                const isServerMode = req.query.mode === "server";
                const template = req.query.template as string || "";
                logger.info("正在启动任务", { 是否服务端模式: isServerMode, 文件名: req.file.originalname, 文件大小: req.file.size, 模板: template || "官方模组加载器" });
                
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

        this.app.get('/templates/:id/export', async (req, res) => {
            try {
                const { id } = req.params;
                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                
                const os = await import('os');
                const path = await import('path');
                const tempDir = os.tmpdir();
                const outputPath = path.join(tempDir, `template-${id}.zip`);
                
                await templateManager.exportTemplate(id, outputPath);
                
                res.download(outputPath, `template-${id}.zip`, (err) => {
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

        this.app.post('/templates/import', this.upload.single('file'), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ status: 400, message: "未上传文件" });
                }
                
                const fileExtension = req.file.originalname.toLowerCase().substring(req.file.originalname.lastIndexOf('.'));
                if (fileExtension !== '.zip') {
                    return res.status(400).json({ status: 400, message: "只支持 .zip 文件" });
                }
                
                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                
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

        const sseConnections = new Map();
        const downloadStates = new Map();
        
        this.app.post('/templates/install-from-url', async (req, res) => {
            const { url: requestUrl, requestId, resumeFrom = 0 } = req.body;
            
            try {
                if (!requestUrl) {
                    return res.status(400).json({ status: 400, message: "缺少 url 参数" });
                }
                
                const { default: got } = await import('got');
                const { createWriteStream, readFileSync, unlinkSync } = await import('fs');
                const { tmpdir } = await import('os');
                const { join } = await import('path');
                
                const tempFilePath = join(tmpdir(), `template-${Date.now()}.zip`);
                const writeStream = createWriteStream(tempFilePath, { 
                    flags: resumeFrom > 0 ? 'a' : 'w'
                });
                
                const requestOptions = {
                    headers: {} as Record<string, string>
                };
                
                if (resumeFrom > 0) {
                    requestOptions.headers['Range'] = `bytes=${resumeFrom}-`;
                }
                
                const request = await got.stream(requestUrl, requestOptions);
                
                let totalSize = 0;
                let downloadedSize = resumeFrom;
                
                request.on('response', (response) => {
                    const acceptRanges = response.headers['accept-ranges'];
                    console.log(`服务器支持分块下载: ${acceptRanges}`);
                    
                    let contentLength = response.headers['content-length'];
                    if (!contentLength) {
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
                
                request.on('data', (chunk: Buffer) => {
                    downloadedSize += chunk.length;
                    if (totalSize > 0) {
                        const progress = Math.round((downloadedSize / totalSize) * 100);
                        console.log(`下载进度: ${progress}%`);
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
                
                await new Promise((resolve, reject) => {
                    request.pipe(writeStream)
                        .on('finish', resolve)
                        .on('error', reject);
                });
                
                const buffer = readFileSync(tempFilePath);
                unlinkSync(tempFilePath);
                
                const templateModule = await import('./template/index.js');
                const TemplateManager = (templateModule as any).TemplateManager;
                const templateManager = new TemplateManager();
                
                const templateId = await templateManager.importTemplate(buffer);
                
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
                
                downloadStates.delete(requestId);
                
                res.json({
                    status: 200,
                    message: "模板安装成功",
                    data: { id: templateId }
                });
            } catch (err) {
                const error = err as Error;
                const { requestId } = req.body;
                logger.error("/templates/install-from-url 路由错误", { error: error.message, stack: error.stack, url: requestUrl });
                
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
                
                downloadStates.delete(requestId);
                
                res.status(500).json({ 
                    status: 500,
                    message: "安装模板失败",
                    details: error.message 
                });
            }
        });
        
        this.app.get('/templates/install-from-url', (req, res) => {
            const { requestId } = req.query;
            
            if (!requestId) {
                return res.status(400).json({ status: 400, message: "缺少 requestId 参数" });
            }
            
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');
            
            sseConnections.set(requestId, res);
            
            res.write(`data: ${JSON.stringify({ type: 'init' })}\n\n`);
            
            req.on('close', () => {
                sseConnections.delete(requestId);
                console.log(`SSE连接已关闭: ${requestId}`);
            });
        });

        this.app.get('/templates/store', async (req, res) => {
            try {
                const { default: got } = await import('got');
                
                const response = await got('http://git.xcclyc.com.cn/xcclyc/DeEarthX-CE-Tems/raw/branch/main/template_stor.json', {
                    timeout: {
                        request: 10000
                    }
                });
                const data = JSON.parse(response.body);
                
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
                res.json({
                    status: 200,
                    data: { templates: [] }
                });
            }
        });
    }

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
            },
            onMetrics: (metrics) => {
                this.sendGuardianEvent('guardian_metrics', metrics);
            }
        });

        logger.info('ServerGuardian 模块已初始化');
    }

    private sendGuardianEvent(type: string, data: any): void {
        try {
            const io = getIO();
            if (io) {
                io.emit(type, { type, data });
            }
        } catch (err) {
            logger.error('发送 Guardian 事件失败', err as Error);
        }
    }

    private registerBuiltinGuardianPlugin(): void {
        this.pluginManager.registerBuiltinPlugin(
            {
                id: "guardian",
                name: "AI 模式",
                version: "1.0.0",
                author: "DeEarthX",
                description: "AI 驱动的 Minecraft 服务端崩溃检测与自动修复系统。监控服务端运行状态，智能识别崩溃原因，自动执行修复操作。",
                openSource: true,
                sourceUrl: "https://github.com/DeEarthX-CE",
                hasSidebar: true,
                sidebarItems: [
                    { key: "guardian-main", label: "AI 模式", route: "guardian-main" }
                ],
                defaultConfig: {
                    aiProvider: "openai",
                    aiApiKey: "",
                    aiModel: "gpt-4.1-mini",
                    aiBaseURL: "https://api.openai.com/v1",
                    aiMaxTokens: 1500
                },
                configLabels: {
                    aiProvider: "AI 提供商",
                    aiApiKey: "API 密钥",
                    aiModel: "模型",
                    aiBaseURL: "API 地址",
                    aiMaxTokens: "最大 Token 数"
                }
            },
            {
                setupRoutes: (_router, app) => {
                    if (!this.guardian || !app) return;

                    app.get('/guardian/status', (_req: any, res: any) => {
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

                    app.get('/guardian/logs', (req: any, res: any) => {
                        if (!this.guardian) {
                            return res.json({ status: 200, logs: [] });
                        }
                        const lines = parseInt(req.query.lines as string) || 100;
                        const buffer = this.guardian.getLogBuffer();
                        res.json({ status: 200, logs: buffer.slice(-lines) });
                    });

                    app.get('/guardian/reports', (_req: any, res: any) => {
                        if (!this.guardian) {
                            return res.json({ status: 200, reports: [] });
                        }
                        res.json({ status: 200, reports: this.guardian.getReportsList() });
                    });
                },
                setupSocketHandlers: (io) => {
                    if (!this.guardian) return;

                    io.on('connection', (socket) => {
                        socket.on('guardian_start', (data: any) => {
                            if (!this.guardian) return;
                            const { workDir, javaCommand, serverType } = data || {};
                            if (workDir) {
                                this.guardian.updateConfig({
                                    workDir,
                                    javaCommand: javaCommand || '',
                                    serverType: serverType || 'unknown'
                                });
                            }
                            this.guardian.start();
                        });

                        socket.on('guardian_stop', () => {
                            this.guardian?.stop();
                        });

                        socket.on('guardian_test_ai', () => {
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
                        });

                        socket.on('guardian_approve', (data: any) => {
                            this.guardian?.approveActions(data?.actionIds || []);
                        });

                        socket.on('guardian_reject', (data: any) => {
                            this.guardian?.rejectActions(data?.actionIds || []);
                        });

                        socket.on('guardian_rollback', () => {
                            this.guardian?.rollbackLastFix();
                        });

                        socket.on('guardian_restart', () => {
                            this.guardian?.confirmRestart();
                        });

                        socket.on('guardian_command', (data: any) => {
                            this.guardian?.sendCommand(data?.command || '');
                        });

                        socket.on('guardian_get_ai_conversation', () => {
                            if (this.guardian) {
                                this.sendGuardianEvent('guardian_ai_conversation', this.guardian.getAIConversations());
                            }
                        });

                        socket.on('guardian_reset_ai_conversation', () => {
                            if (this.guardian) {
                                this.guardian.resetAIConversations();
                                this.sendGuardianEvent('guardian_ai_conversation', []);
                            }
                        });

                        socket.on('guardian_update_config', (data: any) => {
                            if (!this.guardian) return;
                            this.guardian.updateConfig(data || {});
                            if (data?.ai) {
                                const current = Config.getConfig();
                                current.guardian = {
                                    ...current.guardian!,
                                    ai: { ...current.guardian!.ai, ...data.ai }
                                };
                                Config.writeConfig(current);
                                Config.clearCache();
                            }
                        });
                    });
                },
                onDisable: async () => {
                    if (this.guardian) {
                        await this.guardian.stop();
                    }
                }
            }
        );
    }

    private setupPluginRoutes(): void {
        this.app.use((req, res, next) => {
            const match = req.path.match(/^\/plugins\/([^/]+)\/files\/(.+)/);
            if (match) {
                try {
                    const [, pluginId, filePath] = match;
                    const pluginDir = this.pluginManager.getPluginsDir();
                    const fullPath = path.join(pluginDir, decodeURIComponent(pluginId), decodeURIComponent(filePath));
                    if (fs.existsSync(fullPath)) {
                        const realPath = path.resolve(fullPath);
                        const pluginRoot = path.resolve(path.join(pluginDir, decodeURIComponent(pluginId)));
                        if (!realPath.startsWith(pluginRoot)) {
                            return res.status(403).json({ status: 403, message: "禁止访问" });
                        }
                        const ext = path.extname(fullPath).toLowerCase();
                        const mimeMap: Record<string, string> = {
                            '.css': 'text/css; charset=utf-8',
                            '.js': 'application/javascript; charset=utf-8',
                            '.json': 'application/json; charset=utf-8',
                            '.html': 'text/html; charset=utf-8',
                            '.png': 'image/png',
                            '.jpg': 'image/jpeg',
                            '.svg': 'image/svg+xml',
                        };
                        res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
                        return res.sendFile(fullPath);
                    }
                } catch {}
            }
            next();
        });

        this.app.use("/plugins", this.pluginRouter);

        this.pluginRouter.get("/", (req, res) => {
            try {
                const plugins = this.pluginManager.getPlugins();
                res.json({ status: 200, data: plugins });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins 路由错误", error);
                res.status(500).json({ status: 500, message: "获取插件列表失败" });
            }
        });

        this.pluginRouter.get("/injections", (req, res) => {
            try {
                const plugins = this.pluginManager.getPlugins();
                const injections: Array<{ pluginId: string; css: string[]; js: string[] }> = [];
                for (const p of plugins) {
                    if (!p.enabled) continue;
                    const m = p.manifest;
                    if ((m.injectCSS && m.injectCSS.length > 0) || (m.injectJS && m.injectJS.length > 0)) {
                        injections.push({
                            pluginId: m.id,
                            css: (m.injectCSS || []).map(f => `/plugins/${m.id}/files/${f}`),
                            js: (m.injectJS || []).map(f => `/plugins/${m.id}/files/${f}`),
                        });
                    }
                }
                res.json({ status: 200, data: injections });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/injections 路由错误", error);
                res.status(500).json({ status: 500, message: "获取注入列表失败" });
            }
        });

        this.pluginRouter.get("/:id", (req, res) => {
            try {
                const { id } = req.params;

                const plugin = this.pluginManager.getPlugin(id);
                if (!plugin) {
                    return res.status(404).json({ status: 404, message: "插件不存在" });
                }
                res.json({
                    status: 200,
                    data: {
                        manifest: plugin.manifest,
                        enabled: plugin.enabled,
                        config: plugin.config
                    }
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id 路由错误", error);
                res.status(500).json({ status: 500, message: "获取插件信息失败" });
            }
        });

        this.pluginRouter.post("/:id/enable", async (req, res) => {
            try {
                const { id } = req.params;
                const success = await this.pluginManager.enablePlugin(id);
                if (!success) {
                    return res.status(404).json({ status: 404, message: "插件不存在" });
                }
                this.pluginManager.writeGlobalPluginConfigs();
                res.json({ status: 200, message: "插件已启用" });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id/enable 路由错误", error);
                res.status(500).json({ status: 500, message: "启用插件失败" });
            }
        });

        this.pluginRouter.post("/:id/disable", async (req, res) => {
            try {
                const { id } = req.params;
                const success = await this.pluginManager.disablePlugin(id);
                if (!success) {
                    return res.status(404).json({ status: 404, message: "插件不存在" });
                }
                this.pluginManager.writeGlobalPluginConfigs();
                res.json({ status: 200, message: "插件已禁用" });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id/disable 路由错误", error);
                res.status(500).json({ status: 500, message: "禁用插件失败" });
            }
        });

        this.pluginRouter.get("/:id/config", (req, res) => {
            try {
                const { id } = req.params;
                const plugin = this.pluginManager.getPlugin(id);
                if (!plugin) {
                    return res.status(404).json({ status: 404, message: "插件不存在" });
                }
                res.json({
                    status: 200,
                    data: {
                        settings: plugin.config.settings,
                        defaults: plugin.manifest.defaultConfig || {}
                    }
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id/config 路由错误", error);
                res.status(500).json({ status: 500, message: "获取插件配置失败" });
            }
        });

        this.pluginRouter.post("/:id/config", async (req, res) => {
            try {
                const { id } = req.params;
                const { settings } = req.body;
                const success = await this.pluginManager.updatePluginConfig(id, settings || {});
                if (!success) {
                    return res.status(404).json({ status: 404, message: "插件不存在" });
                }
                res.json({ status: 200, message: "配置已更新" });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id/config POST 路由错误", error);
                res.status(500).json({ status: 500, message: "更新插件配置失败" });
            }
        });

        this.pluginRouter.post("/create", async (req, res) => {
            try {
                const { name, author, url, withTutorial } = req.body;
                if (!name || !author) {
                    return res.status(400).json({ status: 400, message: "插件名称和作者不能为空" });
                }
                const result = await this.pluginManager.createPlugin({
                    name,
                    author,
                    url: url || "",
                    withTutorial: !!withTutorial
                });
                res.json({ status: 200, message: "插件创建成功", data: result });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/create 路由错误", error);
                res.status(500).json({ status: 500, message: "创建插件失败" });
            }
        });

        this.pluginRouter.get("/folder", async (req, res) => {
            try {
                const { exec } = await import('child_process');
                const pluginsDir = this.pluginManager.getPluginsDir();
                const platform = process.platform;
                let command: string;

                if (platform === 'win32') {
                    command = `explorer "${pluginsDir}"`;
                } else if (platform === 'darwin') {
                    command = `open "${pluginsDir}"`;
                } else {
                    command = `xdg-open "${pluginsDir}"`;
                }

                exec(command, (error) => {
                    if (error) {
                        logger.error("打开插件文件夹失败", error);
                        return res.status(500).json({ status: 500, message: "打开文件夹失败" });
                    }
                    res.json({
                        status: 200,
                        message: "文件夹已打开"
                    });
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/folder 路由错误", error);
                res.status(500).json({ status: 500, message: "打开文件夹失败" });
            }
        });

        // DEXP 加密插件文件格式：
        // [4 bytes] MAGIC "DEXP"
        // [1 byte]  模式 (0=公开, 1=私有)
        // [16 bytes] IV
        // [N bytes] AES-256-CBC 加密数据
        const DEXP_MAGIC = Buffer.from("DEXP");
        const DEXP_HEADER_SIZE = 4 + 1 + 16; // 21

        function parseDexpHeader(buffer: Buffer): { mode: number; iv: Buffer; data: Buffer } | null {
            if (buffer.length < DEXP_HEADER_SIZE) return null;
            if (!buffer.subarray(0, 4).equals(DEXP_MAGIC)) return null;
            const mode = buffer[4];
            const iv = buffer.subarray(5, 5 + 16);
            const data = buffer.subarray(DEXP_HEADER_SIZE);
            return { mode, iv, data };
        }

        function deriveDexpKey(password: string): Buffer {
            return crypto.createHash("sha256").update(password, "utf-8").digest();
        }

        function decryptDexp(buffer: Buffer, password: string): Buffer | null {
            const header = parseDexpHeader(buffer);
            if (!header) return null;

            const key = deriveDexpKey(password);
            const decipher = crypto.createDecipheriv("aes-256-cbc", key, header.iv);
            decipher.setAutoPadding(true);

            try {
                const decrypted = Buffer.concat([decipher.update(header.data), decipher.final()]);
                if (decrypted.length < 4 || decrypted.readUInt16BE(0) !== 0x504b) {
                    return null; // 不是有效的 ZIP
                }
                return decrypted;
            } catch {
                return null;
            }
        }

        function encryptDexp(buffer: Buffer, password: string, mode: number): Buffer {
            const key = deriveDexpKey(password);
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
            const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);

            const header = Buffer.alloc(DEXP_HEADER_SIZE);
            DEXP_MAGIC.copy(header, 0);
            header[4] = mode;
            iv.copy(header, 5);

            return Buffer.concat([header, encrypted]);
        }

        this.pluginRouter.post("/install", this.upload.single("file"), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ status: 400, message: "未上传文件" });
                }

                const buffer = req.file.buffer;

                // 检查是否为 DEXP 加密格式
                if (buffer.length >= 4 && buffer.subarray(0, 4).equals(DEXP_MAGIC)) {
                    const header = parseDexpHeader(buffer);
                    if (!header) {
                        return res.status(400).json({ status: 400, message: "无效的 DEXP 文件" });
                    }

                    if (header.mode === 0) {
                        // 公开加密：自动解密
                        const decrypted = decryptDexp(buffer, "DeEarthX-CE");
                        if (!decrypted) {
                            return res.status(400).json({ status: 400, message: "DEXP 解密失败" });
                        }

                        const pluginId = await this.pluginManager.installPlugin(decrypted);
                        if (!pluginId) {
                            return res.status(400).json({ status: 400, message: "插件安装失败" });
                        }
                        this.pluginManager.writeGlobalPluginConfigs();
                        return res.json({ status: 200, message: "插件安装成功", data: { id: pluginId } });
                    } else {
                        // 私有加密：返回需要密码
                        return res.json({ status: 400, message: "需要密码解密", requirePassword: true });
                    }
                }

                // 普通 ZIP 安装
                const fileExtension = req.file.originalname.toLowerCase().substring(req.file.originalname.lastIndexOf('.'));
                if (fileExtension !== '.zip') {
                    return res.status(400).json({ status: 400, message: "只支持 .zip 或 .dxp 文件" });
                }

                const pluginId = await this.pluginManager.installPlugin(buffer);
                if (!pluginId) {
                    return res.status(400).json({ status: 400, message: "插件安装失败，请检查插件包格式" });
                }

                this.pluginManager.writeGlobalPluginConfigs();
                res.json({ status: 200, message: "插件安装成功", data: { id: pluginId } });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/install 路由错误", error);
                res.status(500).json({ status: 500, message: "安装插件失败" });
            }
        });

        this.pluginRouter.post("/install-encrypted", this.upload.single("file"), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ status: 400, message: "未上传文件" });
                }

                const password = req.body?.password as string;
                if (!password) {
                    return res.status(400).json({ status: 400, message: "请提供解密密码" });
                }

                const decrypted = decryptDexp(req.file.buffer, password);
                if (!decrypted) {
                    return res.status(400).json({ status: 400, message: "解密失败，请检查密码是否正确" });
                }

                const pluginId = await this.pluginManager.installPlugin(decrypted);
                if (!pluginId) {
                    return res.status(400).json({ status: 400, message: "插件安装失败" });
                }

                this.pluginManager.writeGlobalPluginConfigs();
                res.json({ status: 200, message: "加密插件安装成功", data: { id: pluginId } });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/install-encrypted 路由错误", error);
                res.status(500).json({ status: 500, message: "导入加密插件失败" });
            }
        });

        this.pluginRouter.delete("/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const keepConfig = req.query.keepConfig !== 'false';

                const success = await this.pluginManager.uninstallPlugin(id, keepConfig);
                if (!success) {
                    return res.status(404).json({ status: 404, message: "插件不存在或删除失败" });
                }

                this.pluginManager.writeGlobalPluginConfigs();
                res.json({ status: 200, message: keepConfig ? "插件已卸载（配置已保留）" : "插件已完全删除" });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id DELETE 路由错误", error);
                res.status(500).json({ status: 500, message: "删除插件失败" });
            }
        });

        this.pluginRouter.get("/:id/export", async (req, res) => {
            try {
                const { id } = req.params;
                const buffer = await this.pluginManager.exportPlugin(id);
                if (!buffer) {
                    return res.status(404).json({ status: 404, message: "插件不存在" });
                }
                const plugin = this.pluginManager.getPlugin(id);
                const name = plugin ? plugin.manifest.name : id;
                const tempPath = path.join(getAppDir(), `${name}-${Date.now()}.zip`);
                fs.writeFileSync(tempPath, buffer);
                res.download(tempPath, `${name}.zip`, (err) => {
                    fs.unlink(tempPath, () => {});
                    if (err) {
                        logger.error(`导出插件失败: ${err.message}`);
                    }
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id/export 路由错误", error);
                res.status(500).json({ status: 500, message: "导出插件失败" });
            }
        });

        this.pluginRouter.post("/:id/export-encrypted", async (req, res) => {
            try {
                const { id } = req.params;
                const { mode, password, rememberPassword } = req.body || {};

                const zipBuffer = await this.pluginManager.exportPlugin(id);
                if (!zipBuffer) {
                    return res.status(404).json({ status: 404, message: "插件不存在" });
                }

                if (mode === 'private') {
                    if (!password || !/^[a-zA-Z0-9]+$/.test(password)) {
                        return res.status(400).json({ status: 400, message: "密码仅能包含大小写字母和数字" });
                    }
                    const encrypted = encryptDexp(zipBuffer, password, 1);
                    const plugin = this.pluginManager.getPlugin(id);
                    const name = plugin ? plugin.manifest.name : id;
                    const tempPath = path.join(getAppDir(), `${name}-encrypted-${Date.now()}.dxp`);
                    fs.writeFileSync(tempPath, encrypted);
                    res.download(tempPath, `${name}.dxp`, (err) => {
                        fs.unlink(tempPath, () => {});
                        if (err) logger.error(`加密导出失败: ${err.message}`);
                    });
                } else {
                    const encrypted = encryptDexp(zipBuffer, "DeEarthX-CE", 0);
                    const plugin = this.pluginManager.getPlugin(id);
                    const name = plugin ? plugin.manifest.name : id;
                    const tempPath = path.join(getAppDir(), `${name}-public-${Date.now()}.dxp`);
                    fs.writeFileSync(tempPath, encrypted);
                    res.download(tempPath, `${name}.dxp`, (err) => {
                        fs.unlink(tempPath, () => {});
                        if (err) logger.error(`公开加密导出失败: ${err.message}`);
                    });
                }
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id/export-encrypted 路由错误", error);
                res.status(500).json({ status: 500, message: "加密导出失败" });
            }
        });

        this.pluginRouter.get("/:id/sidebar", (req, res) => {
            try {
                const { id } = req.params;
                const plugin = this.pluginManager.getPlugin(id);
                if (!plugin) {
                    return res.status(404).json({ status: 404, message: "插件不存在" });
                }
                res.json({
                    status: 200,
                    data: {
                        hasSidebar: plugin.manifest.hasSidebar || false,
                        sidebarItems: plugin.manifest.sidebarItems || []
                    }
                });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugins/:id/sidebar 路由错误", error);
                res.status(500).json({ status: 500, message: "获取插件侧边栏信息失败" });
            }
        });

        this.pluginManager.setupPluginRoutes(this.pluginRouter, this.app);

        this.app.get("/plugin-page/:pluginId/:pageKey", async (req, res) => {
            try {
                const { pluginId, pageKey } = req.params;
                const pluginDir = this.pluginManager.getPluginsDir();
                const plugin = this.pluginManager.getPlugin(pluginId);

                if (!plugin) {
                    return res.status(404).json({ status: 404, message: "插件不存在", data: { pluginId, pageKey } });
                }

                const possiblePaths = [
                    path.join(pluginDir, pluginId, "frontend", `${pageKey}.html`),
                    path.join(pluginDir, pluginId, "frontend", pageKey, "index.html"),
                ];

                for (const filePath of possiblePaths) {
                    if (fs.existsSync(filePath)) {
                        const ext = path.extname(filePath).toLowerCase();
                        const mimeMap: Record<string, string> = {
                            '.html': 'text/html; charset=utf-8',
                            '.htm': 'text/html; charset=utf-8',
                        };
                        res.setHeader('Content-Type', mimeMap[ext] || 'text/html; charset=utf-8');
                        res.sendFile(filePath);
                        return;
                    }
                }

                const manifest = plugin.manifest;
                const sidebarItem = (manifest.sidebarItems || []).find((s: any) => s.key === pageKey || s.route === pageKey);

                const pageInfo = {
                    title: sidebarItem?.label || manifest.name,
                    pluginId: manifest.id,
                    pluginName: manifest.name,
                    pluginAuthor: manifest.author,
                    pluginVersion: manifest.version,
                    pageKey,
                    description: manifest.description || "",
                    hasFrontend: false,
                    defaultConfig: manifest.defaultConfig || {}
                };

                res.json({ status: 200, data: pageInfo });
            } catch (err) {
                const error = err as Error;
                logger.error("/plugin-page 路由错误", error);
                res.status(500).json({ status: 500, message: "加载插件页面失败" });
            }
        });
    }

    private setupLogRoutes(): void {
        // 获取日志文件列表
        this.app.get('/logs/list', async (req, res) => {
            try {
                const files = await listLogFiles();
                res.json({ status: 200, data: files });
            } catch (err) {
                const error = err as Error;
                logger.error("/logs/list 路由错误", error);
                res.status(500).json({ status: 500, message: "获取日志列表失败" });
            }
        });

        // 获取日志内容（支持 ?lines=100 参数）
        this.app.get('/logs/content', async (req, res) => {
            try {
                const lines = parseInt(req.query.lines as string) || 0;
                const content = await getLogFileContent(lines > 0 ? lines : undefined);
                res.json({ status: 200, data: content });
            } catch (err) {
                const error = err as Error;
                logger.error("/logs/content 路由错误", error);
                res.status(500).json({ status: 500, message: "获取日志内容失败" });
            }
        });

        // 下载日志文件
        this.app.get('/logs/download', async (req, res) => {
            try {
                const filename = req.query.file as string;
                const logFilePath = filename 
                    ? path.join(getLogsDir(), filename)
                    : getLogFilePath();

                // 安全检查：确保文件在日志目录内
                const resolvedPath = path.resolve(logFilePath);
                const resolvedLogsDir = path.resolve(getLogsDir());
                if (!resolvedPath.startsWith(resolvedLogsDir)) {
                    return res.status(403).json({ status: 403, message: "禁止访问" });
                }

                if (!fs.existsSync(logFilePath)) {
                    return res.status(404).json({ status: 404, message: "日志文件不存在" });
                }

                const downloadName = filename || path.basename(getLogFilePath());
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
                res.sendFile(logFilePath);
            } catch (err) {
                const error = err as Error;
                logger.error("/logs/download 路由错误", error);
                res.status(500).json({ status: 500, message: "下载日志失败" });
            }
        });

        // 获取日志目录路径
        this.app.get('/logs/path', (req, res) => {
            try {
                res.json({ status: 200, data: { path: getLogsDir(), currentFile: getLogFilePath() } });
            } catch (err) {
                res.status(500).json({ status: 500, message: "获取日志路径失败" });
            }
        });
    }

    private setupDownloadRoutes(): void {
        import("./routes/download.js").then(({ setupDownloadRoutes }) => {
            setupDownloadRoutes(this.app);
        });
        import("./routes/download-install.js").then(({ setupInstallRoute }) => {
            setupInstallRoute(this.app);
        });
    }

    public async start() {
        
        this.setupExpressRoutes();
        const port = this.config.port || 37019;
        const host = this.config.host || 'localhost';
        this.server.listen(port, host, async () => {
            logger.info(`服务器正在运行于 http://${host}:${port}`);
            await this.pluginManager.initialize(this.io);
            this.registerBuiltinGuardianPlugin();
            this.pluginManager.setupPluginRoutes(this.pluginRouter, this.app);
            this.pluginManager.setupPluginSocketHandlers(this.io);
            await this.javachecker();
        });
        
        this.server.on('error', (err) => {
            logger.error("服务器错误", err);
        });
    }
}
