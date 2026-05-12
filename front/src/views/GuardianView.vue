<script lang="ts" setup>
import { h, ref, onMounted, onUnmounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  message, notification, Modal, Tag, Card, Button, Switch, Select,
  Input, Tooltip, Collapse, CollapsePanel, Badge, Timeline, Divider, Alert
} from 'ant-design-vue';
import {
  PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined,
  AlertOutlined, RobotOutlined, FileTextOutlined,
  RollbackOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SettingOutlined, ConsoleSqlOutlined, WarningOutlined,
  BugOutlined, ThunderboltOutlined, UndoOutlined, ApiOutlined
} from '@ant-design/icons-vue';

const { t } = useI18n();

// ============== 模块级持久连接（跨路由切换保活） ==============
let _ws: WebSocket | null = null;
let _logIdCounter = 0;
let _statusRefreshTimer: number | null = null;

// ============== 状态定义 ==============
const wsConnected = ref(false);
const guardianStatus = ref<string>('idle');
const processRunning = ref(false);
const logLines = ref<Array<{ line: string; isError: boolean; id: number }>>([]);
const logContainer = ref<HTMLDivElement | null>(null);

// 启动配置
const launchWorkDir = ref<string>('');
const launchJavaCmd = ref<string>('');
const launchServerType = ref<string>('forge');
const launchModalVisible = ref(false);

// 从 localStorage 读取存储的 AI 配置，失败时使用默认值
function loadStoredConfig<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}

// AI 模式配置
const aiProvider = ref<string>(loadStoredConfig('guardian_aiProvider', 'openai'));
const aiApiKey = ref<string>(loadStoredConfig('guardian_aiApiKey', ''));
const aiModel = ref<string>(loadStoredConfig('guardian_aiModel', 'gpt-5.4-mini'));
const aiBaseUrl = ref<string>(loadStoredConfig('guardian_aiBaseUrl', 'https://ai.xcclyc.com.cn/v1'));
const autoAcceptLowRisk = ref<boolean>(loadStoredConfig('guardian_autoAcceptLowRisk', true));
const maxCrashes = ref<number>(loadStoredConfig('guardian_maxCrashes', 5));

// 崩溃诊断状态
const crashDiagnosis = ref<{
  diagnosis: string;
  causes: string[];
  confidence: number;
} | null>(null);

// 待执行操作
const pendingActions = ref<Array<{
  id: string;
  type: string;
  target: string;
  riskLevel: string;
  reason: string;
  approved?: boolean;
}>>([]);

// 操作执行结果
const actionResults = ref<Array<{
  actionId: string;
  success: boolean;
  error?: string;
}>>([]);

// 修复全部执行完成后是否需要等待用户手动重启
const restartNeeded = ref(false);

// 统计数据
const stats = ref({
  crashCount: 0,
  restartCount: 0,
  maxCrashes: 5,
  reportsCount: 0
});

// 报告列表
const reports = ref<Array<{ id: string; timestamp: string; file: string }>>([]);

// 进程指标
const currentMetrics = ref<{ cpuPercent: number; memPercent: number }>({ cpuPercent: 0, memPercent: 0 });

// AI 对话记录
const aiConversations = ref<Array<{
  id: string; timestamp: string; type: string;
  prompt: string; rawResponse: string;
  diagnosis?: { diagnosis?: string; causes?: string[]; actions?: Array<{ type: string; target: string; reason: string }> };
  latencyMs?: number;
}>>([]);
const showAIConversation = ref(false);
const aiConvActiveKey = computed(() => showAIConversation.value ? ['ai-conv'] : []);

// 设置面板可见
const showSettings = ref(false);
const activeSettingsKey = computed(() => showSettings.value ? ['settings'] : []);

// AI 测试
const testingAI = ref(false);
const testAIResult = ref<{ success: boolean; message: string; latency?: number } | null>(null);

// ============== WebSocket 连接 ==============
function connectWebSocket() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
    // 已有活跃连接，直接更新状态并拉取数据
    wsConnected.value = true;
    fetchGuardianStatus();
    return;
  }
  try {
    const wsHost = import.meta.env.VITE_WS_HOST || 'localhost';
    const wsPort = import.meta.env.VITE_WS_PORT || '37019';
    _ws = new WebSocket(`ws://${wsHost}:${wsPort}/`);

    _ws.addEventListener('open', () => {
      wsConnected.value = true;
      fetchGuardianStatus();
      sendGuardianMessage('guardian_get_ai_conversation');
    });

    _ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        handleGuardianMessage(data);
      } catch { /* ignore non-JSON */ }
    });

    _ws.addEventListener('close', () => {
      wsConnected.value = false;
      _ws = null;
    });

    _ws.addEventListener('error', () => {
      wsConnected.value = false;
    });
  } catch (err) {
    console.error('WebSocket 连接失败:', err);
  }
}

function handleGuardianMessage(data: any) {
  switch (data.type) {
    case 'guardian_status':
      guardianStatus.value = data.data?.status || 'idle';
      if (data.data?.data?.crashCount !== undefined) {
        stats.value.crashCount = data.data.data.crashCount;
      }
      if (data.data?.data?.restartCount !== undefined) {
        stats.value.restartCount = data.data.data.restartCount;
      }
      // 状态变为非 awaiting_user 时清除重启等待标志
      if (data.data?.status !== 'awaiting_user') {
        restartNeeded.value = false;
      }
      restartNeeded.value = data.data?.data?.restartNeeded === true;
      break;

    case 'guardian_log':
      logLines.value.push({
        line: data.data.line,
        isError: data.data.isError,
        id: _logIdCounter++
      });
      // 保持最多 200 行
      if (logLines.value.length > 200) {
        logLines.value = logLines.value.slice(-200);
      }
      // 自动滚动到底部
      setTimeout(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight;
        }
      }, 50);
      break;

    case 'guardian_crash_detected': {
      const crash = data.data;
      crashDiagnosis.value = null;
      notification.warning({
        message: '检测到服务端崩溃',
        description: `崩溃类型: ${crash.classification?.type || '未知'}\n${crash.classification?.reason || ''}`,
        duration: 0,
        placement: 'topRight'
      });
      break;
    }

    case 'guardian_ai_analysis':
      crashDiagnosis.value = {
        diagnosis: data.data.diagnosis,
        causes: data.data.causes || [],
        confidence: data.data.confidence || 0
      };
      break;

    case 'guardian_actions_required':
      pendingActions.value = data.data || [];
      notification.info({
        message: '需要确认修复操作',
        description: `有 ${(data.data || []).length} 个修复操作等待您的确认`,
        duration: 0,
        placement: 'topRight'
      });
      break;

    case 'guardian_action_executed':
      actionResults.value.push(data.data);
      if (data.data.success) {
        message.success(`操作成功: ${data.data.actionId}`);
      } else {
        message.error(`操作失败: ${data.data.error}`);
      }
      break;

    case 'guardian_give_up':
      Modal.warning({
        title: 'ServerGuardian 已放弃',
        content: `原因: ${data.data?.reason || '连续崩溃超限'}\n建议手动排查问题。`,
        okText: '知道了'
      });
      break;

    case 'guardian_metrics':
      if (data.data) {
        currentMetrics.value = {
          cpuPercent: data.data.cpuPercent || 0,
          memPercent: data.data.memPercent || 0
        };
      }
      break;

    case 'guardian_report':
      fetchGuardianStatus();
      break;

    case 'guardian_test_ai_result':
      testingAI.value = false;
      testAIResult.value = data.data;
      break;

    case 'guardian_ai_conversation':
      if (Array.isArray(data.data)) {
        aiConversations.value = data.data;
        if (data.data.length > 0) showAIConversation.value = true;
      }
      break;
  }
}

// ============== API 请求 ==============
function getApiHost(): string {
  return `http://${import.meta.env.VITE_API_HOST || 'localhost'}:${import.meta.env.VITE_API_PORT || '37019'}`;
}

async function fetchGuardianStatus() {
  try {
    const response = await fetch(`${getApiHost()}/guardian/status`);
    const data = await response.json();
    if (data.enabled) {
      guardianStatus.value = data.guardianStatus || 'idle';
      processRunning.value = data.processInfo?.status === 'running';
      stats.value.reportsCount = data.reports?.length || 0;
      reports.value = data.reports || [];
    }
  } catch { /* ignore */ }
}

// ============== 操作 ==============
function sendGuardianMessage(type: string, data?: any) {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type, data }));
  } else {
    message.error('WebSocket 未连接');
  }
}

// ============== 文件夹选择（Tauri 或 Web 方式） ==============
const dirPicker = ref<HTMLInputElement | null>(null);
let dirInputEl: HTMLInputElement | null = null;

function openDirPicker() {
  // 尝试用 webkitdirectory 选文件夹
  if (!dirInputEl) {
    dirInputEl = document.createElement('input');
    dirInputEl.type = 'file';
    dirInputEl.setAttribute('webkitdirectory', '');
    dirInputEl.setAttribute('directory', '');
    dirInputEl.style.display = 'none';
    dirInputEl.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      const files = target.files;
      if (files && files.length > 0) {
        // 取第一个文件的路径，去掉文件名得到目录
        const fullPath = files[0].webkitRelativePath || files[0].name;
        // 用最后一级目录名反推路径（浏览器安全限制只能拿相对路径）
        // 只能让用户手动粘贴完整路径了
        message.info('浏览器安全限制，请手动粘贴完整路径');
      }
    });
    document.body.appendChild(dirInputEl);
  }
  dirInputEl.click();
}

function startGuardian() {
  if (aiProvider.value === 'openai' && !aiApiKey.value.trim()) {
    message.warning('请先配置 AI 密钥（点击右上角齿轮图标），或在设置中将 AI 模式切换为"纯规则"后重试');
    return;
  }
  if (aiProvider.value === 'ollama' && !aiBaseUrl.value.trim()) {
    message.warning('Ollama 模式下请先填写服务地址（点击右上角齿轮图标），或在设置中切换为其他模式后重试');
    return;
  }
  launchModalVisible.value = true;
}

function confirmLaunch() {
  if (!launchWorkDir.value.trim()) {
    message.warning('请填写服务端目录');
    return;
  }
  // 检查 AI 配置
  if (aiProvider.value === 'openai' && !aiApiKey.value.trim()) {
    message.warning('AI 模式为 OpenAI 但未填写 API Key，请先点击齿轮图标进行配置');
    return;
  }
  if (aiProvider.value === 'ollama' && !aiBaseUrl.value.trim()) {
    message.warning('AI 模式为 Ollama 但未填写服务地址，请先点击齿轮图标进行配置');
    return;
  }
  sendGuardianMessage('guardian_start', {
    workDir: launchWorkDir.value,
    javaCommand: launchJavaCmd.value,
    serverType: launchServerType.value
  });
  message.loading('正在启动服务端...');
  launchModalVisible.value = false;
}

function stopGuardian() {
  Modal.confirm({
    title: '停止 ServerGuardian',
    content: '确定要停止监控吗？正在运行的服务端也会被关闭。',
    okText: '停止',
    cancelText: '取消',
    okType: 'danger',
    onOk: () => {
      sendGuardianMessage('guardian_stop');
      message.info('已停止监控');
      guardianStatus.value = 'stopped';
    }
  });
}

function approveAction(actionId: string) {
  sendGuardianMessage('guardian_approve', { actionIds: [actionId] });
}

function approveAllActions() {
  const ids = pendingActions.value.map(a => a.id);
  if (ids.length > 0) {
    sendGuardianMessage('guardian_approve', { actionIds: ids });
    pendingActions.value = [];
  }
}

function rejectAction(actionId: string) {
  sendGuardianMessage('guardian_reject', { actionIds: [actionId] });
  pendingActions.value = pendingActions.value.filter(a => a.id !== actionId);
}

function confirmRestart() {
  sendGuardianMessage('guardian_restart');
  restartNeeded.value = false;
  message.info('正在重启服务端...');
}

function rollbackLastFix() {
  Modal.confirm({
    title: '撤销上次修复',
    content: '确定要撤销上一个修复操作吗？这会恢复被移动或修改的文件。',
    okText: '撤销',
    cancelText: '取消',
    onOk: () => {
      sendGuardianMessage('guardian_rollback');
      message.info('正在撤销...');
    }
  });
}

function saveSettings() {
  // 持久化到 localStorage
  localStorage.setItem('guardian_aiProvider', JSON.stringify(aiProvider.value));
  localStorage.setItem('guardian_aiApiKey', JSON.stringify(aiApiKey.value));
  localStorage.setItem('guardian_aiModel', JSON.stringify(aiModel.value));
  localStorage.setItem('guardian_aiBaseUrl', JSON.stringify(aiBaseUrl.value));
  localStorage.setItem('guardian_autoAcceptLowRisk', JSON.stringify(autoAcceptLowRisk.value));
  localStorage.setItem('guardian_maxCrashes', JSON.stringify(maxCrashes.value));

  sendGuardianMessage('guardian_update_config', {
    ai: {
      provider: aiProvider.value,
      apiKey: aiApiKey.value,
      model: aiModel.value,
      baseURL: aiBaseUrl.value
    },
    autoAcceptLowRisk: autoAcceptLowRisk.value,
    maxConsecutiveCrashes: maxCrashes.value
  });
  message.success('设置已保存');
  showSettings.value = false;
}

function testAIConnection() {
  testAIResult.value = null;
  testingAI.value = true;
  // 先把当前 AI 配置同步到后端，再发送测试请求
  sendGuardianMessage('guardian_update_config', {
    ai: {
      provider: aiProvider.value,
      apiKey: aiApiKey.value,
      model: aiModel.value,
      baseURL: aiBaseUrl.value
    },
    autoAcceptLowRisk: autoAcceptLowRisk.value,
    maxConsecutiveCrashes: maxCrashes.value
  });
  // 给后端一个微小的 tick 消化配置更新
  setTimeout(() => {
    sendGuardianMessage('guardian_test_ai');
    // 15 秒安全超时：若后端未返回结果则自动停止转圈
    setTimeout(() => {
      if (testingAI.value) {
        testingAI.value = false;
        testAIResult.value = {
          success: false,
          message: '连接超时（15 秒），请检查后端是否运行、AI 地址和密钥是否正确'
        };
      }
    }, 15000);
  }, 50);
}

function clearLog() {
  logLines.value = [];
}

function copyLog() {
  const text = logLines.value.map(l => l.line).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    message.success(`已复制 ${logLines.value.length} 行日志`);
  }).catch(() => {
    message.error('复制失败');
  });
}

function exportLog() {
  const text = logLines.value.map(l => l.line).join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `server-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  message.success('日志已导出');
}

function exportFullReport() {
  const now = new Date().toISOString();
  const logText = logLines.value.map(l => l.line).join('\n');
  const convText = aiConversations.value.map(c =>
    `### ${c.type === 'diagnosis' ? 'AI 诊断' : c.type === 'test' ? '测试' : '规则回退'} (${formatTime(c.timestamp)})\n\n` +
    `**发送给 AI:**\n\`\`\`\n${c.prompt.slice(0, 1000)}\n\`\`\`\n\n` +
    `**AI 回复:**\n\`\`\`json\n${c.rawResponse.slice(0, 2000)}\n\`\`\`\n\n`
  ).join('---\n');

  const report = `# ServerGuardian 完整报告\n\n` +
    `**生成时间:** ${now}\n` +
    `**状态:** ${statusTextMap[guardianStatus.value] || guardianStatus.value}\n` +
    `**进程:** ${processRunning.value ? '运行中' : '已停止'}\n` +
    `**崩溃次数:** ${stats.value.crashCount}\n` +
    `**重启次数:** ${stats.value.restartCount}\n\n` +
    `## 崩溃诊断\n\n` +
    (crashDiagnosis.value
      ? `- **诊断:** ${crashDiagnosis.value.diagnosis}\n- **置信度:** ${Math.round(crashDiagnosis.value.confidence * 100)}%\n- **原因:**\n${crashDiagnosis.value.causes.map(c => `  - ${c}`).join('\n')}\n\n`
      : '（暂无崩溃诊断）\n\n') +
    `## 日志内容\n\n\`\`\`\n${logText.slice(0, 10000)}${logText.length > 10000 ? '\n...（日志过长已截断）' : ''}\n\`\`\`\n\n` +
    `## AI 对话\n\n${convText || '（暂无 AI 对话记录）'}\n\n` +
    `## 总结\n\n本次处理由 ServerGuardian 自动完成。\n`;

  const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `guardian-report-${now.slice(0, 19).replace(/:/g, '-')}.md`;
  a.click();
  URL.revokeObjectURL(url);
  message.success('完整报告已导出');
}

function resetAIConversations() {
  aiConversations.value = [];
  sendGuardianMessage('guardian_reset_ai_conversation');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============== 计算属性 ==============
const statusColorMap: Record<string, string> = {
  idle: 'default',
  starting: 'processing',
  monitoring: 'success',
  crash_detected: 'error',
  analyzing: 'processing',
  awaiting_user: 'warning',
  fixing: 'processing',
  restarting: 'processing',
  stopped: 'default',
  give_up: 'error'
};

const statusTextMap: Record<string, string> = {
  idle: '空闲',
  starting: '启动中',
  monitoring: '监控中',
  crash_detected: '崩溃检测',
  analyzing: 'AI 分析中',
  awaiting_user: '等待确认',
  fixing: '修复中',
  restarting: '重启中',
  stopped: '已停止',
  give_up: '已放弃'
};

const guardianActive = computed(() => 
  ['starting', 'monitoring', 'crash_detected', 'analyzing', 'awaiting_user', 'fixing', 'restarting'].includes(guardianStatus.value)
);

const riskColorMap: Record<string, string> = {
  low: 'green',
  medium: 'orange',
  high: 'red',
  critical: 'red'
};

// ============== 生命周期 ==============
onMounted(() => {
  connectWebSocket();
  if (!_statusRefreshTimer) {
    _statusRefreshTimer = window.setInterval(fetchGuardianStatus, 5000);
  }
});

onUnmounted(() => {
  // 不关闭 WS 连接，给下次进入时复用，避免刷新闪烁
  if (_statusRefreshTimer) {
    clearInterval(_statusRefreshTimer);
    _statusRefreshTimer = null;
  }
});
</script>

<template>
  <div class="guardian-container">
    <!-- 顶部状态栏 -->
    <div class="status-bar">
      <div class="status-left">
        <span class="status-icon">
          <Badge :status="statusColorMap[guardianStatus] || 'default'" />
        </span>
        <span class="status-text">
          <strong>ServerGuardian</strong>
          <span class="status-detail">— {{ statusTextMap[guardianStatus] || '未知' }}</span>
        </span>
        <Tag v-if="processRunning" color="green">进程运行中</Tag>
        <Tag v-else color="default">进程已停止</Tag>
        <span v-if="processRunning" class="metrics-display">
          <Tag>CPU {{ currentMetrics.cpuPercent }}%</Tag>
          <Tag>内存 {{ currentMetrics.memPercent }}%</Tag>
        </span>
      </div>
      <div class="status-right">
        <Tag v-if="wsConnected" color="green">已连接</Tag>
        <Tag v-else color="red">未连接</Tag>

        <Tooltip title="启动">
          <Button type="primary" shape="circle"
                  @click="startGuardian" :disabled="guardianActive">
            <template #icon><PlayCircleOutlined /></template>
          </Button>
        </Tooltip>
        <Tooltip title="停止">
          <Button danger shape="circle"
                  @click="stopGuardian" :disabled="!guardianActive">
            <template #icon><PauseCircleOutlined /></template>
          </Button>
        </Tooltip>
        <Tooltip title="撤销修复">
          <Button shape="circle"
                  @click="rollbackLastFix" :disabled="!guardianActive">
            <template #icon><UndoOutlined /></template>
          </Button>
        </Tooltip>
        <Tooltip title="设置">
          <Button shape="circle" @click="showSettings = !showSettings"
                  :type="showSettings ? 'primary' : 'default'">
            <template #icon><SettingOutlined /></template>
          </Button>
        </Tooltip>
      </div>
    </div>

    <!-- 设置面板（折叠） -->
    <Collapse :activeKey="activeSettingsKey" ghost>
      <CollapsePanel key="settings" :showArrow="false">
        <Card title="AI 模式配置" size="small" class="settings-card">
          <div class="settings-grid">
            <div class="setting-item">
              <label>AI 提供商</label>
              <Select v-model:value="aiProvider" style="width: 100%">
                <SelectOption value="openai">OpenAI（云端）</SelectOption>
                <SelectOption value="ollama">Ollama（本地）</SelectOption>
                <SelectOption value="none">纯规则（不调用 AI）</SelectOption>
              </Select>
            </div>
            <div class="setting-item">
              <label>API Key</label>
              <Input v-model:value="aiApiKey" type="password" placeholder="sk-..." />
            </div>
            <div class="setting-item">
              <label>模型</label>
              <Input v-model:value="aiModel" placeholder="gpt-4.1-mini" />
            </div>
            <div class="setting-item">
              <label>API 地址</label>
              <Input v-model:value="aiBaseUrl" placeholder="https://api.openai.com/v1" />
            </div>
            <div class="setting-item setting-item-row">
              <label>自动执行低风险操作</label>
              <Switch v-model:checked="autoAcceptLowRisk" style="flex-shrink: 0" />
            </div>
            <div class="setting-item">
              <label>最大连续崩溃次数</label>
              <Input v-model:value="maxCrashes" type="number" min="1" max="20" />
            </div>
          </div>
          <div class="settings-actions">
            <Button :loading="testingAI" @click="testAIConnection" :disabled="aiProvider === 'none'" :icon="h(ApiOutlined)">
              测试 AI 连接
            </Button>
            <Button type="primary" @click="saveSettings">保存设置</Button>
          </div>
          <div v-if="testAIResult" class="test-ai-result">
            <Alert
              :type="testAIResult.success ? 'success' : 'error'"
              :message="testAIResult.success ? '连接测试通过' : '连接测试失败'"
              :description="testAIResult.message + (testAIResult.latency ? ` (耗时 ${testAIResult.latency}ms)` : '')"
              showIcon
              closable
              @close="testAIResult = null"
            />
          </div>
        </Card>
      </CollapsePanel>
    </Collapse>


    <!-- 启动配置对话框 -->
    <Modal v-model:visible="launchModalVisible"
           title="启动 ServerGuardian"
           okText="启动"
           cancelText="取消"
           @ok="confirmLaunch">
      <div class="launch-form">
        <div class="launch-field">
          <label class="launch-label">服务端目录 <span class="required">*</span></label>
          <div class="launch-dir-row">
            <Input v-model:value="launchWorkDir" placeholder="D:/servers/my-server" />
            <Button @click="openDirPicker" :disabled="true" title="浏览器限制，请直接粘贴路径">
              浏览
            </Button>
          </div>
          <div class="launch-hint">服务端根目录（包含 start.bat、server.jar 等文件）</div>
        </div>
        <div class="launch-field">
          <label class="launch-label">启动命令</label>
          <Input v-model:value="launchJavaCmd" placeholder="" />
          <div class="launch-hint">留空则自动识别 start.bat 或 run.bat 中的 Java 命令</div>
          <div class="launch-hint">一般来说使用DeEarthX-CE生成的服务端运行install.bat以后会生成run.bat</div>
        </div>
        <div class="launch-field">
          <label class="launch-label">服务端类型</label>
          <Select v-model:value="launchServerType" style="width: 100%">
            <SelectOption value="forge">Forge</SelectOption>
            <SelectOption value="neoforge">NeoForge</SelectOption>
            <SelectOption value="fabric">Fabric</SelectOption>
            <SelectOption value="vanilla">Vanilla</SelectOption>
          </Select>
        </div>
      </div>
    </Modal>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧：日志流 -->
      <div class="log-panel">
        <div class="panel-header">
          <span><ConsoleSqlOutlined /> 实时日志</span>
          <div class="panel-actions">
            <Button size="small" @click="copyLog" :disabled="logLines.length === 0">复制</Button>
            <Button size="small" @click="exportLog" :disabled="logLines.length === 0">导出日志</Button>
            <Button size="small" @click="exportFullReport">完整报告</Button>
            <Button size="small" @click="clearLog">清空</Button>
            <Tag>{{ logLines.length }} 行</Tag>
          </div>
        </div>
        <div class="log-output" ref="logContainer">
          <div v-for="log in logLines" :key="log.id"
               :class="['log-line', { 'log-error': log.isError }]">
            <span class="log-prefix">{{ log.isError ? '⚠' : '▶' }}</span>
            <span class="log-text">{{ log.line }}</span>
          </div>
          <div v-if="logLines.length === 0" class="log-empty">
            等待日志输出...
          </div>
        </div>
      </div>

      <!-- 右侧：诊断与操作 -->
      <div class="diagnostic-panel">
        <!-- 崩溃诊断 -->
        <Card title="崩溃诊断" size="small" class="diagnostic-card"
              v-if="crashDiagnosis">
          <div class="diagnosis-content">
            <Alert type="error" :message="crashDiagnosis.diagnosis" show-icon />
            <Divider>原因分析</Divider>
            <ul class="cause-list">
              <li v-for="(cause, i) in crashDiagnosis.causes" :key="i">
                <BugOutlined /> {{ cause }}
              </li>
            </ul>
            <div class="confidence">
              置信度: {{ Math.round(crashDiagnosis.confidence * 100) }}%
            </div>
          </div>
        </Card>

        <!-- 待执行操作 -->
        <Card title="🔧 待执行修复操作" size="small" class="actions-card"
              v-if="pendingActions.length > 0">
          <div v-for="action in pendingActions" :key="action.id" class="action-item">
            <div class="action-header">
              <Tag :color="riskColorMap[action.riskLevel] || 'default'">
                {{ action.riskLevel === 'low' ? '低风险' : action.riskLevel === 'medium' ? '中风险' : '高风险' }}
              </Tag>
              <Tag>{{ action.type }}</Tag>
            </div>
            <div class="action-target">{{ action.target }}</div>
            <div class="action-reason">{{ action.reason }}</div>
            <div class="action-buttons">
              <Button size="small" type="primary" @click="approveAction(action.id)">
                <CheckCircleOutlined /> 批准
              </Button>
              <Button size="small" danger @click="rejectAction(action.id)">
                <CloseCircleOutlined /> 拒绝
              </Button>
            </div>
          </div>
          <div class="action-bulk">
            <Button type="primary" block @click="approveAllActions">
              <ThunderboltOutlined /> 批准全部安全操作
            </Button>
          </div>
        </Card>

        <!-- 确认重启（所有修复操作已执行完毕，等待用户手动确认） -->
        <Card v-if="restartNeeded && pendingActions.length === 0"
              title="🚀 等待确认重启" size="small"
              class="restart-card">
          <div class="restart-info">
            <Alert type="info" show-icon :message="'修复操作已全部执行完毕'" />
            <div class="restart-hint">请确认是否重新启动服务端以应用修复</div>
          </div>
          <div class="restart-buttons">
            <Button type="primary" size="large" block @click="confirmRestart">
              <ReloadOutlined /> 确认重启服务端
            </Button>
          </div>
        </Card>

        <!-- 统计数据 -->
        <Card title="监控统计" size="small" class="stats-card">
          <div v-if="guardianStatus === 'idle' || guardianStatus === 'stopped'" class="stats-placeholder">
            <PlayCircleOutlined />
            <span>点击「启动」开始统计</span>
          </div>
          <div v-else class="stats-grid">
            <div class="stat-item">
              <div class="stat-value">{{ stats.crashCount }}</div>
              <div class="stat-label">崩溃次数</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ stats.restartCount }}</div>
              <div class="stat-label">重启次数</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ stats.maxCrashes }}</div>
              <div class="stat-label">最大崩溃</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ stats.reportsCount }}</div>
              <div class="stat-label">报告数</div>
            </div>
          </div>
        </Card>

        <!-- AI 对话记录 -->
        <Collapse :activeKey="aiConvActiveKey" @change="(keys: string | string[]) => showAIConversation = (Array.isArray(keys) ? keys : [keys]).includes('ai-conv')">
          <CollapsePanel key="ai-conv" header="AI 对话">
            <div v-if="aiConversations.length" style="display:flex;justify-content:flex-end;margin-bottom:8px">
              <Button size="small" @click="resetAIConversations">重置对话</Button>
            </div>
            <div v-if="aiConversations.length === 0" style="color:#999;text-align:center;padding:16px">
              暂无对话记录<br/>
              <small>服务端发生崩溃时，AI 会进行分析并记录在此</small>
            </div>
            <div v-else class="ai-conv-list">
              <div v-for="conv in [...aiConversations].reverse()" :key="conv.id" class="ai-conv-entry">
                <div class="conv-header">
                  <Tag :color="conv.type === 'fallback' ? 'orange' : 'blue'">
                    {{ conv.type === 'diagnosis' ? '诊断' : conv.type === 'test' ? '测试' : '规则回退' }}
                  </Tag>
                  <span class="conv-time">{{ formatTime(conv.timestamp) }}</span>
                  <span v-if="conv.latencyMs" class="conv-latency">{{ conv.latencyMs }}ms</span>
                </div>
                <div class="conv-bubble conv-bubble-sent">
                  <div class="bubble-label">→ 发送给 AI</div>
                  <pre class="conv-code">{{ conv.prompt.slice(0, 600) }}{{ conv.prompt.length > 600 ? '...' : '' }}</pre>
                </div>
                <div class="conv-bubble conv-bubble-received">
                  <div class="bubble-label">← AI 回复</div>
                  <div class="conv-diagnosis" v-if="conv.diagnosis">
                    <div class="diag-text">{{ conv.diagnosis.diagnosis }}</div>
                    <div v-if="conv.diagnosis.causes?.length" class="diag-causes">
                      <div v-for="(cause, ci) in conv.diagnosis.causes" :key="ci" class="diag-cause">• {{ cause }}</div>
                    </div>
                  </div>
                  <pre class="conv-code">{{ conv.rawResponse.slice(0, 500) }}{{ conv.rawResponse.length > 500 ? '...' : '' }}</pre>
                </div>
                <div v-if="conv.diagnosis?.actions?.length" class="conv-tools">
                  <div class="bubble-label">计划执行的修复操作</div>
                  <div v-for="(act, ai) in conv.diagnosis.actions" :key="ai" class="conv-tool-item">
                    <Tag :color="act.type === 'remove_mod' ? 'red' : act.type === 'edit_config' ? 'green' : 'orange'">
                      {{ act.type }}
                    </Tag>
                    <code>{{ act.target }}</code>
                    <span class="tool-reason">{{ act.reason }}</span>
                  </div>
                </div>
              </div>
            </div>
          </CollapsePanel>
        </Collapse>
      </div>
    </div>
  </div>
</template>

<style scoped>
.guardian-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
  background: #f8fafc;
}

.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.status-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-icon {
  display: flex;
  align-items: center;
}

.status-text strong {
  font-size: 15px;
  color: #1a1a1a;
}

.status-detail {
  font-size: 13px;
  color: #666;
  margin-left: 4px;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 确保圆角按钮图标居中 */
.status-right :deep(.ant-btn.ant-btn-circle) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.settings-card {
  margin: 8px 0;
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-item label {
  font-size: 12px;
  color: #666;
  font-weight: 500;
}

.setting-item-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.settings-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.test-ai-result {
  margin-top: 12px;
}

.main-content {
  flex: 1;
  display: flex;
  gap: 12px;
  overflow: hidden;
}

.log-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 500;
  font-size: 13px;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.log-output {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.5;
  background: #1e1e2e;
  color: #cdd6f4;
}

.log-line {
  display: flex;
  gap: 6px;
  padding: 1px 0;
  word-break: break-all;
}

.log-line.log-error {
  background: rgba(255, 69, 58, 0.15);
  color: #f38ba8;
}

.log-prefix {
  flex-shrink: 0;
  color: #585b70;
  width: 16px;
  text-align: center;
}

.log-error .log-prefix {
  color: #f38ba8;
}

.log-text {
  white-space: pre-wrap;
}

.log-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #585b70;
  font-style: italic;
}

.diagnostic-panel {
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.diagnostic-card,
.actions-card,
.stats-card,
.restart-card {
  flex-shrink: 0;
}

.diagnosis-content {
  font-size: 13px;
}

.cause-list {
  padding-left: 20px;
  margin: 8px 0;
}

.cause-list li {
  margin: 4px 0;
  color: #444;
}

.confidence {
  text-align: right;
  font-size: 11px;
  color: #999;
  margin-top: 8px;
}

.action-item {
  padding: 8px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  margin-bottom: 8px;
}

.action-header {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.action-target {
  font-family: monospace;
  font-size: 12px;
  color: #333;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  display: inline-block;
  margin-bottom: 4px;
}

.action-reason {
  font-size: 12px;
  color: #666;
  margin-bottom: 6px;
}

.action-buttons {
  display: flex;
  gap: 6px;
}

.action-bulk {
  margin-top: 8px;
}

/* 确认重启卡片 */
.restart-card {
  border: 2px solid #1890ff;
}
.restart-info {
  margin-bottom: 12px;
}
.restart-hint {
  font-size: 13px;
  color: #666;
  margin-top: 8px;
  text-align: center;
}
.restart-buttons {
  margin-top: 4px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.stat-item {
  text-align: center;
  padding: 6px;
  background: #f8fafc;
  border-radius: 6px;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #10b981;
}

.stat-label {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
}

/* 启动配置表单 */
.launch-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.launch-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.launch-label {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}
.launch-label .required {
  color: #f5222d;
}
.launch-dir-row {
  display: flex;
  gap: 8px;
}
.launch-dir-row .ant-input {
  flex: 1;
}
.launch-hint {
  font-size: 11px;
  color: #999;
}

/* AI 对话面板 */
.ai-conv-list {
  max-height: 500px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ai-conv-entry {
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 10px;
  background: #fafbfc;
}
.conv-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.conv-time {
  font-size: 11px;
  color: #999;
}
.conv-latency {
  font-size: 11px;
  color: #666;
  margin-left: auto;
}
.conv-bubble {
  margin: 4px 0;
  padding: 6px 8px;
  border-radius: 6px;
}
.conv-bubble-sent {
  background: #e6f7ff;
  border-left: 3px solid #1890ff;
}
.conv-bubble-received {
  background: #f6ffed;
  border-left: 3px solid #52c41a;
}
.bubble-label {
  font-size: 11px;
  font-weight: 600;
  color: #666;
  margin-bottom: 3px;
}
.conv-code {
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
  margin: 0;
  background: transparent;
  border: none;
  padding: 0;
}
.conv-diagnosis {
  margin-bottom: 4px;
}
.diag-text {
  font-size: 13px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}
.diag-causes {
  margin: 2px 0;
}
.diag-cause {
  font-size: 12px;
  color: #555;
  padding: 1px 0;
}
.conv-tools {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed #d9d9d9;
}
.conv-tool-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
}
.conv-tool-item code {
  font-size: 11px;
  color: #333;
}
.tool-reason {
  font-size: 11px;
  color: #888;
}
</style>
