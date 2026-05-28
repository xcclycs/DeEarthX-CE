/**
 * AIAdvisor - AI 分析与建议模块
 * 调用 LLM API（OpenAI/Ollama），分析崩溃原因并返回结构化修复指令
 */

import { AIDiagnosis, RepairAction, IGuardianConfig, CrashInfo, CrashClassification, AIConversationEntry } from './types.js';
import { logger } from '../utils/logger.js';

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

const CHECK_COMPLETION_PROMPT = `你是一个严格的 Minecraft 服务端运行情况分析专家。

不绝对等于运行正常！请仔细检查日志的最后部分，确认服务端是否真的正常完成。并且不是崩溃！

## 语言要求
**请分析用户提供的日志的语言，并使用完全相同的语言进行所有输出！**
- 如果大部分内容是中文，使用中文
- 如果大部分内容是英文，使用英文
- 如果是其他语言，请使用相同语言
- **所有判断、诊断、解释都必须使用相同语言**

【最近日志片段（最后部分，行号为倒序编号）】

{logContext}

【判断规则（优先级从高到低）】
1. 如果日志尾部最后若干行中包含 "Failed to start the minecraft server"、"LoadingFailedException"、"has failed to load correctly"、"ERROR"、"Exception"、"Caused by"、"FATAL" 等错误，即使退出码为 0，也必须判定为崩溃。
2. 特别注意：ModLauncher、BootstrapLauncher 中任何 mod 加载错误、LoadingFailedException 都属于严重崩溃，绝不能判定为完成。
3. 特别注意："has failed to load correctly" 表示模组加载失败，属于严重错误，绝不能判定为完成。
4. 只有日志尾部最后若干行完全没有任何错误（全部是 INFO 级别消息，且包含 Done! / Forge 启动成功关键字），才能返回 type: "complete"。

【输出要求】
- 如果判定为正常完成：actions 中只包含 { type: "complete", target: "", reason: "..." }，其中 reason 用与用户语言一致的文字说明
- 如果判定为崩溃：按标准崩溃诊断格式输出 diagnosis、causes、actions（修复建议），并在 diagnosis 末尾标注出问题的行号（如"（问题出现在日志第 23-35 行）" / "(Issue occurs at log lines 23-35)"）
- 严格返回 JSON 格式，不要添加任何额外说明。
- **确保使用与用户相同的语言进行所有说明和解释！**`;

const DIAGNOSIS_PROMPT = `你是一个 Minecraft 服务端崩溃诊断专家。
请分析以下服务端崩溃信息，并按严格 JSON 格式输出。

## 语言要求
**请分析用户提供的日志、模组列表、错误信息等所有内容的语言，并使用完全相同的语言进行所有输出！**
- 如果大部分内容是中文，使用中文
- 如果大部分内容是英文，使用英文
- 如果是其他语言，请使用相同语言
- **所有诊断、原因、解释都必须使用相同语言**

## 服务端信息
- 类型: {serverType}
- Minecraft 版本: {mcVersion}
- Java 版本: {javaVersion}

## 已安装模组
{modList}

## 崩溃日志（最后部分，每行前有行号，从 1 开始编号）
\`\`\`
{logContext}
\`\`\`

## 崩溃分类
- 类型: {crashType}
- 初步原因: {crashReason}

## 上次修复操作（如有）
{previousActions}

## 输出要求
仅返回一个 JSON 对象（不要用 markdown 代码块包裹，只输出纯 JSON），包含以下字段：

- "diagnosis": 用与用户语言一致的简短诊断，客观描述崩溃原因和定位，在末尾标明错误所在的行号（如"（日志第 23-35 行出现错误）" / "(Error occurs at log lines 23-35)"）。
- "causes": 字符串数组，用与用户语言一致的文字列出可能的原因。
- "actions": 修复操作列表，每个操作包含：
  - "type": 操作类型，可选值：move_file / delete_file / edit_config / add_jvm_arg / remove_mod / download_file
  - "target": 目标文件路径（相对于服务端根目录）
  - "destination": 移动目标路径（仅 move_file / remove_mod 需要）
  - "file": 配置文件路径（仅 edit_config 需要）
  - "key_path": 配置键路径，用点分隔（仅 edit_config 需要）
  - "new_value": 新值（仅 edit_config / add_jvm_arg 需要）
  - "jvm_arg": JVM 参数（仅 add_jvm_arg 需要）
  - "reason": 操作原因，用与用户语言一致的文字解释

## 注意事项
- 所有操作路径必须相对于服务端根目录。
- 不要建议直接删除模组文件，而应使用 remove_mod 操作将其移动到 .rubbish/ 目录。
- 仅生成合理、必要的操作，不要添加无意义的步骤。
- **确保使用与用户相同的语言进行所有诊断、原因和操作解释！**`;

/** AI 配置 */
export interface AIConfig {
  provider: 'openai' | 'ollama' | 'none';
  apiKey: string;
  model: string;
  baseURL: string;
  maxTokens: number;
}

export class AIAdvisor {
  private config: AIConfig;
  private diagnosisCache: Map<string, AIDiagnosis> = new Map();
  private readonly cacheTTL = 5 * 60 * 1000; // 5分钟缓存

  /** AI 对话记录（供前端 AI 对话面板展示） */
  public conversations: AIConversationEntry[] = [];

  constructor(aiConfig: AIConfig) {
    this.config = aiConfig;
  }

  /** 获取所有 AI 对话记录 */
  public getConversations(): AIConversationEntry[] {
    return [...this.conversations];
  }

  /**
   * 检查服务端是否正常完成运行（非崩溃退出）
   * 将最近日志发给 AI，让 AI 判断是正常完成还是存在未检测到的崩溃
   */
  public async checkCompletion(logContext: string): Promise<AIDiagnosis> {
    if (this.config.provider === 'none') {
      return {
        diagnosis: '服务端已退出（纯规则模式，无法确认是否正常完成）',
        causes: [],
        actions: [{ id: `complete-${Date.now()}`, type: 'complete', target: '', riskLevel: 'low', reason: '纯规则模式直接确认完成' }],
        confidence: 0.5
      };
    }

    const lines = logContext.split('\n');
    const lastLines = lines.slice(-60);
    const formattedLogContext = lastLines.map((line, i) => `${String(lines.length - lastLines.length + i + 1).padStart(4)}|${line}`).join('\n');
    const prompt = fillTemplate(CHECK_COMPLETION_PROMPT, {
      logContext: formattedLogContext
    });

    const convId = `check-${Date.now()}`;

    try {
      const res = await fetch(
        this.config.provider === 'ollama'
          ? `${this.config.baseURL || 'http://localhost:11434'}/api/chat`
          : `${this.config.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(this.config.provider !== 'ollama' ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}) },
          body: JSON.stringify(
            this.config.provider === 'ollama'
              ? { model: this.config.model || 'qwen2.5:7b', messages: [{ role: 'user', content: prompt }], stream: false, options: { temperature: 0.1 } }
              : { model: this.config.model, messages: [{ role: 'user', content: prompt }], max_tokens: 1000, temperature: 0.1 }
          )
        }
      );

      if (res.ok) {
        const data = await res.json() as any;
        const text = this.config.provider === 'ollama'
          ? data.message?.content || ''
          : data.choices?.[0]?.message?.content || '';
        const parsed = this.parseAIResponse(text);
        this.conversations.push({ id: convId, timestamp: new Date().toISOString(), type: 'diagnosis', prompt, rawResponse: text, diagnosis: parsed });
        return parsed;
      }
    } catch { /* fall through to fallback */ }

    // AI 确认失败时，返回空 actions（不自动确认完成），由调用方通过关键字规则决定
    return {
      diagnosis: '服务端进程已退出，AI 分析失败，无法确认是否正常完成',
      causes: ['AI 连接失败或响应格式异常'],
      actions: [],
      confidence: 0.3
    };
  }

  /**
   * 更新 AI 配置
   */
  public updateConfig(aiConfig: AIConfig): void {
    this.config = aiConfig;
    this.diagnosisCache.clear();
  }

  /**
   * 分析崩溃原因
   */
  public async analyzeCrash(
    crashInfo: CrashInfo,
    serverContext: {
      serverType: string;
      mcVersion: string;
      javaVersion: string;
      modList: string[];
      previousActions?: RepairAction[];
    }
  ): Promise<AIDiagnosis> {
    // 缓存检查
    const cacheKey = this.buildCacheKey(crashInfo);
    const cached = this.diagnosisCache.get(cacheKey);
    if (cached && (Date.now() - this.getCacheTimestamp(cacheKey)) < this.cacheTTL) {
      return cached;
    }

    if (this.config.provider === 'none') {
      return this.fallbackDiagnosis(crashInfo, serverContext);
    }

    try {
      const diagnosis = await this.callLLMApi(crashInfo, serverContext);
      
      // 校验和修正 AI 返回的操作
      diagnosis.actions = this.validateActions(diagnosis.actions);

      // 写入缓存
      this.diagnosisCache.set(cacheKey, diagnosis);
      setTimeout(() => this.diagnosisCache.delete(cacheKey), this.cacheTTL);

      return diagnosis;
    } catch (err) {
      console.error('AI 分析失败，使用规则回退:', (err as Error).message);
      return this.fallbackDiagnosis(crashInfo, serverContext);
    }
  }

  /**
   * 测试 AI 连接是否可用
   * 发送 "Hello" 消息，检查是否有正常响应
   */
  public async testConnection(): Promise<{ success: boolean; message: string; latency?: number }> {
    if (this.config.provider === 'none') {
      return { success: false, message: '当前为纯规则模式，无需测试 AI 连接' };
    }

    const testMessage = 'Reply with exactly "OK ServerGuardian" (just that phrase, no extra words).';
    const timeoutMs = 10000;
    const maxRetries = 5;

    /** 单次尝试 */
    const doTest = async (): Promise<{ success: boolean; message: string; latency?: number }> => {
      const startTime = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let response: Response;
        if (this.config.provider === 'ollama') {
          const baseURL = this.config.baseURL || 'http://localhost:11434';
          response = await fetch(`${baseURL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              model: this.config.model || 'qwen2.5:7b',
              messages: [{ role: 'user', content: testMessage }],
              stream: false,
              options: { temperature: 0.1 }
            })
          });
        } else {
          response = await fetch(`${this.config.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.config.apiKey}`
            },
            signal: controller.signal,
            body: JSON.stringify({
              model: this.config.model,
              messages: [{ role: 'user', content: testMessage }],
              max_tokens: 50,
              temperature: 0.1
            })
          });
        }

        clearTimeout(timeout);

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          return {
            success: false,
            message: `API 返回错误 (${response.status}): ${errBody.slice(0, 200)}`,
            latency: Date.now() - startTime
          };
        }

        const data = await response.json() as any;
        const reply =
          this.config.provider === 'ollama'
            ? data.message?.content || ''
            : data.choices?.[0]?.message?.content || '';

        if (!reply.trim()) {
          return {
            success: false,
            message: 'AI 返回内容为空',
            latency: Date.now() - startTime
          };
        }

        return {
          success: true,
          message: `连接成功！AI 响应: "${reply.slice(0, 80)}"`,
          latency: Date.now() - startTime
        };
      } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
          return { success: false, message: '连接超时（10 秒），请检查 API 地址是否正确', latency: 10000 };
        }
        return {
          success: false,
          message: `连接失败: ${err.message || String(err)}`,
          latency: Date.now() - startTime
        };
      }
    };

    // 自动重试逻辑
    let lastResult: { success: boolean; message: string; latency?: number } | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      lastResult = await doTest();
      if (lastResult.success) return lastResult;
      if (attempt < maxRetries) {
        // 失败时等待 500ms 后重试
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return lastResult!;
  }

  /**
   * 规则回退诊断（不调用 AI）
   */
  private fallbackDiagnosis(crashInfo: CrashInfo, context: any): AIDiagnosis {
    const cls = crashInfo.classification;
    
    // 根据已有分类生成诊断
    const diagnosisMap: Record<string, { diagnosis: string; causes: string[] }> = {
      'OOM': {
        diagnosis: '内存不足！服务端吃撑了，给它多分点内存或者少装几个模组吧。',
        causes: ['Java 堆内存不足（OutOfMemoryError）', '分配的内存（-Xmx）太小', '模组数量过多占用大量内存']
      },
      'MOD_CONFLICT': {
        diagnosis: '模组打架了！两个或多个模组在一起不兼容，先把怀疑对象移走看看。',
        causes: cls.suspectedMods.length > 0 
          ? [`模组 ${cls.suspectedMods.join('、')} 可能存在问题`]
          : ['模组版本不兼容', '缺少模组依赖', '模组加载顺序冲突']
      },
      'CONFIG_ERROR': {
        diagnosis: '配置文件搞事情！你的配置文件中可能有错误的设置。',
        causes: cls.suspectedConfigs.length > 0
          ? [`配置文件 ${cls.suspectedConfigs.join('、')} 可能损坏或错误`]
          : ['配置文件语法错误', '配置项值超出有效范围']
      },
      'HANG': {
        diagnosis: '服务端卡死了！可能某个模组或任务占用了太多时间，需要检查一下。',
        causes: ['服务端长时间无响应', '可能某个模组的 Tick 事件卡死', '计算机资源不足']
      }
    };

    const fallback = diagnosisMap[cls.type] || {
      diagnosis: '服务端崩溃了！具体原因需要进一步分析，建议查看日志后手动排查。',
      causes: ['未知崩溃原因', `检测到模式: ${crashInfo.detectedPatterns.join(', ')}`]
    };

    const actions: RepairAction[] = [];

    // 根据分类生成建议操作
    if (cls.type === 'OOM') {
      actions.push({
        id: `action_${Date.now()}_1`,
        type: 'add_jvm_arg',
        riskLevel: 'low',
        target: 'start.bat',
        jvmArg: '-Xmx4G',
        reason: '增加 JVM 最大内存到 4GB 以解决内存不足'
      });
    }

    if (cls.type === 'MOD_CONFLICT' && cls.suspectedMods.length > 0) {
      for (const mod of cls.suspectedMods) {
        actions.push({
          id: `action_${Date.now()}_${mod}`,
          type: 'remove_mod',
          riskLevel: 'medium',
          target: `mods/${mod}.jar`,
          destination: `.rubbish/${mod}.jar`,
          reason: `${mod} 模组可能导致崩溃，移除以测试`
        });
      }
    }

    if (cls.type === 'CONFIG_ERROR' && cls.suspectedConfigs.length > 0) {
      for (const cfg of cls.suspectedConfigs) {
        actions.push({
          id: `action_${Date.now()}_cfg`,
          type: 'move_file',
          riskLevel: 'medium',
          target: `config/${cfg}`,
          destination: `.rubbish/${cfg}`,
          reason: `${cfg} 配置文件可能损坏，备份后让服务端重新生成`
        });
      }
    }

    const result: AIDiagnosis = {
      diagnosis: fallback.diagnosis,
      causes: fallback.causes,
      actions,
      confidence: 0.6,
    };

    // 记录回退诊断
    this.conversations.push({
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      type: 'fallback',
      prompt: `[规则回退] 崩溃类型: ${cls.type}\n检测模式: ${crashInfo.detectedPatterns.join(', ')}`,
      rawResponse: JSON.stringify(result),
      diagnosis: result
    });

    return result;
  }

  /**
   * 调用 LLM API
   */
  private async callLLMApi(
    crashInfo: CrashInfo,
    context: any
  ): Promise<AIDiagnosis> {
    const prompt = this.buildPrompt(crashInfo, context);

    // 记录发送给 AI 的前 10 行和后 10 行
    const promptLines = prompt.split('\n');
    const promptLog = [
      ...promptLines.slice(0, 10),
      '...（中间省略）...',
      ...promptLines.slice(-10)
    ].join('\n');
    logger.info(`[AI 诊断] 发送给 AI 的 Prompt（前 10 行 + 后 10 行）:\n${promptLog}`);

    let diagnosis: AIDiagnosis;
    if (this.config.provider === 'ollama') {
      diagnosis = await this.callOllama(prompt);
    } else {
      diagnosis = await this.callOpenAI(prompt);
    }

    // 记录 AI 返回的前 10 行
    const responseLines = (diagnosis.diagnosis || '').split('\n');
    const responseLog = responseLines.slice(0, 10).join('\n');
    logger.info(`[AI 诊断] AI 返回（前 10 行）:\n${responseLog || '(空)'}`);

    return diagnosis;
  }

  /**
   * 调用 OpenAI 兼容 API
   */
  private async callOpenAI(prompt: string): Promise<AIDiagnosis> {
    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: this.config.maxTokens || 1500,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API 错误: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI 返回为空');
    }

    const diagnosis = this.parseAIResponse(content);

    // 记录对话
    this.conversations.push({
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      type: 'diagnosis',
      prompt,
      rawResponse: content,
      diagnosis
    });

    return diagnosis;
  }

  /**
   * 调用 Ollama API
   */
  private async callOllama(prompt: string): Promise<AIDiagnosis> {
    const baseURL = this.config.baseURL || 'http://localhost:11434';
    const response = await fetch(`${baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model || 'qwen2.5:7b',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.3 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API 错误: ${response.status}`);
    }

    const data = await response.json() as any;
    const rawResponse = data.message?.content || '';
    const diagnosis = this.parseAIResponse(rawResponse);

    // 记录对话
    this.conversations.push({
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      type: 'diagnosis',
      prompt,
      rawResponse,
      diagnosis
    });

    return diagnosis;
  }

  /**
   * 构建 AI Prompt
   */
  private buildPrompt(crashInfo: CrashInfo, context: any): string {
    const logContext = crashInfo.logContext.slice(-100).join('\n');
    const logWithLineNums = logContext.split('\n').map((line, i) => `${String(i + 1).padStart(4)}|${line}`).join('\n');
    const modListStr = context.modList?.join('\n') || '（无）';
    const prevActionsStr = context.previousActions?.length
      ? context.previousActions.map((a: RepairAction) => `- ${a.type}: ${a.target} (${a.reason})`).join('\n')
      : '（无）';

    return fillTemplate(DIAGNOSIS_PROMPT, {
      serverType: context.serverType || '未知',
      mcVersion: context.mcVersion || '未知',
      javaVersion: context.javaVersion || '未知',
      modList: modListStr,
      logContext: logWithLineNums,
      crashType: crashInfo.classification.type,
      crashReason: crashInfo.classification.reason,
      previousActions: prevActionsStr
    });
  }

  /**
   * 解析 AI 返回的 JSON
   */
  private parseAIResponse(content: string): AIDiagnosis {
    // 清理可能存在的 markdown 代码块
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      
      // 确保 actions 数组存在
      const actions: RepairAction[] = (parsed.actions || []).map((a: any, i: number) => ({
        id: `ai_action_${Date.now()}_${i}`,
        type: a.type || 'move_file',
        riskLevel: this.determineRiskLevel(a.type),
        target: a.target || '',
        destination: a.destination,
        file: a.file,
        keyPath: a.key_path || a.keyPath,
        newValue: a.new_value || a.newValue,
        jvmArg: a.jvm_arg || a.jvmArg,
        url: a.url,
        reason: a.reason || 'AI 建议',
        approved: false
      }));

      return {
        diagnosis: parsed.diagnosis || 'AI 分析完成',
        causes: parsed.causes || ['未知原因'],
        actions,
        confidence: 0.8,
        rawResponse: content
      };
    } catch (err) {
      console.error('解析 AI 响应失败:', (err as Error).message);
      return {
        diagnosis: 'AI 分析的返回格式有问题，但根据日志可以推断一些信息。',
        causes: ['AI 响应解析失败，请查看原始日志'],
        actions: [],
        confidence: 0.3,
        rawResponse: content
      };
    }
  }

  /**
   * 确定操作风险等级
   */
  private determineRiskLevel(type: string): 'low' | 'medium' | 'high' | 'critical' {
    switch (type) {
      case 'move_file':
      case 'remove_mod':
        return 'medium';
      case 'delete_file':
        return 'high';
      case 'edit_config':
        return 'low';
      case 'add_jvm_arg':
        return 'low';
      case 'download_file':
        return 'critical';
      default:
        return 'medium';
    }
  }

  /**
   * 校验和修正 AI 返回的操作
   */
  private validateActions(actions: RepairAction[]): RepairAction[] {
    const allowedTypes = ['move_file', 'delete_file', 'edit_config', 'add_jvm_arg', 'remove_mod', 'download_file'];
    
    return actions.filter(action => {
      // 校验操作类型
      if (!allowedTypes.includes(action.type)) {
        console.warn(`过滤非法操作类型: ${action.type}`);
        return false;
      }
      // 校验目标路径不为空
      if (!action.target) {
        console.warn('过滤空目标路径的操作');
        return false;
      }
      // 校验文件名不含危险字符
      if (/[<>|:"]/.test(action.target)) {
        console.warn(`过滤含非法字符的路径: ${action.target}`);
        return false;
      }
      return true;
    });
  }

  /**
   * 构建缓存 key
   */
  private buildCacheKey(crashInfo: CrashInfo): string {
    return `${crashInfo.classification.type}_${crashInfo.detectedPatterns.join('_')}`;
  }

  /**
   * 获取缓存时间戳
   */
  private getCacheTimestamp(key: string): number {
    return Date.now(); // 简化处理
  }
}
