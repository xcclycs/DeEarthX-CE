<script lang="ts" setup>
import { h, ref, onMounted, onUnmounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  message, notification, Modal, Tag, Card, Button, Switch, Select,
  Input, Tooltip, Collapse, CollapsePanel, Badge, Divider, Alert
} from 'ant-design-vue';
import {
  PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
  SettingOutlined, ConsoleSqlOutlined,
  BugOutlined, ThunderboltOutlined, UndoOutlined, ApiOutlined
} from '@ant-design/icons-vue';
import { getSocketIO, disconnectSocket } from '../utils/socket';

const { t } = useI18n();
const route = useRoute();

let _logIdCounter = 0;
let _statusRefreshTimer: number | null = null;
let _socket: ReturnType<typeof getSocketIO> | null = null;

const wsConnected = ref(false);
const guardianStatus = ref<string>('idle');
const processRunning = ref(false);
const logLines = ref<Array<{ line: string; isError: boolean; id: number }>>([]);
const logContainer = ref<HTMLDivElement | null>(null);

const launchWorkDir = ref<string>('');
const launchJavaCmd = ref<string>('');
const launchServerType = ref<string>('forge');
const launchModalVisible = ref(false);
const checkingJava = ref(false);
const javaCheckResult = ref<{ available: boolean; version?: string; error?: string } | null>(null);

function loadStoredConfig<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}

const aiProvider = ref<string>(loadStoredConfig('guardian_aiProvider', 'openai'));
const aiApiKey = ref<string>(loadStoredConfig('guardian_aiApiKey', ''));
const aiModel = ref<string>(loadStoredConfig('guardian_aiModel', 'gpt-5.4-mini'));
const aiBaseUrl = ref<string>(loadStoredConfig('guardian_aiBaseUrl', 'https://ai.xcclyc.com.cn/v1'));
const autoAcceptLowRisk = ref<boolean>(loadStoredConfig('guardian_autoAcceptLowRisk', true));
const maxCrashes = ref<number>(loadStoredConfig('guardian_maxCrashes', 5));

const crashDiagnosis = ref<{
  diagnosis: string;
  causes: string[];
  confidence: number;
} | null>(null);

const pendingActions = ref<Array<{
  id: string;
  type: string;
  target: string;
  riskLevel: string;
  reason: string;
  approved?: boolean;
}>>([]);

const actionResults = ref<Array<{
  actionId: string;
  success: boolean;
  error?: string;
}>>([]);

const restartNeeded = ref(false);

const stats = ref({
  crashCount: 0,
  restartCount: 0,
  maxCrashes: 5,
  reportsCount: 0
});

const reports = ref<Array<{ id: string; timestamp: string; file: string }>>([]);

const currentMetrics = ref<{ cpuPercent: number; memPercent: number }>({ cpuPercent: 0, memPercent: 0 });

const aiConversations = ref<Array<{
  id: string; timestamp: string; type: string;
  prompt: string; rawResponse: string;
  diagnosis?: { diagnosis?: string; causes?: string[]; actions?: Array<{ type: string; target: string; reason: string }> };
  latencyMs?: number;
}>>([]);
const showAIConversation = ref(false);
const aiConvActiveKey = computed(() => showAIConversation.value ? ['ai-conv'] : []);

const showSettings = ref(false);
const activeSettingsKey = computed(() => showSettings.value ? ['settings'] : []);

const testingAI = ref(false);
const testAIResult = ref<{ success: boolean; message: string; latency?: number } | null>(null);

function connectSocketIO() {
  if (_socket && _socket.connected) {
    wsConnected.value = true;
    fetchGuardianStatus();
    return;
  }

  try {
    _socket = getSocketIO();

    _socket.on('connect', () => {
      wsConnected.value = true;
      fetchGuardianStatus();
      sendGuardianMessage('guardian_get_ai_conversation');
    });

    _socket.on('guardian_status', (data: any) => {
      handleGuardianMessage({ type: 'guardian_status', data });
    });

    _socket.on('guardian_log', (data: any) => {
      handleGuardianMessage({ type: 'guardian_log', data });
    });

    _socket.on('guardian_crash_detected', (data: any) => {
      handleGuardianMessage({ type: 'guardian_crash_detected', data });
    });

    _socket.on('guardian_ai_analysis', (data: any) => {
      handleGuardianMessage({ type: 'guardian_ai_analysis', data });
    });

    _socket.on('guardian_actions_required', (data: any) => {
      handleGuardianMessage({ type: 'guardian_actions_required', data });
    });

    _socket.on('guardian_action_executed', (data: any) => {
      handleGuardianMessage({ type: 'guardian_action_executed', data });
    });

    _socket.on('guardian_give_up', (data: any) => {
      handleGuardianMessage({ type: 'guardian_give_up', data });
    });

    _socket.on('guardian_metrics', (data: any) => {
      handleGuardianMessage({ type: 'guardian_metrics', data });
    });

    _socket.on('guardian_report', (data: any) => {
      handleGuardianMessage({ type: 'guardian_report', data });
    });

    _socket.on('guardian_test_ai_result', (data: any) => {
      handleGuardianMessage({ type: 'guardian_test_ai_result', data });
    });

    _socket.on('guardian_ai_conversation', (data: any) => {
      handleGuardianMessage({ type: 'guardian_ai_conversation', data });
    });

    _socket.on('disconnect', () => {
      wsConnected.value = false;
      _socket = null;
    });

    _socket.on('connect_error', (err: Error) => {
      console.error('Socket.IO 连接失败:', err);
      wsConnected.value = false;
    });
  } catch (err) {
    console.error('Socket.IO 初始化失败:', err);
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
      if (logLines.value.length > 200) {
        logLines.value = logLines.value.slice(-200);
      }
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
        message: t('guardian.crash_detected'),
        description: `${t('guardian.crash_type')}: ${crash.classification?.type || t('guardian.crash_unknown')}\n${crash.classification?.reason || ''}`,
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
        message: t('guardian.actions_need_confirm'),
        description: t('guardian.actions_need_confirm_desc', { count: (data.data || []).length }),
        duration: 0,
        placement: 'topRight'
      });
      break;

    case 'guardian_action_executed':
      actionResults.value.push(data.data);
      if (data.data.success) {
        message.success(t('guardian.actions_success', { id: data.data.actionId }));
      } else {
        message.error(t('guardian.actions_failed', { error: data.data.error }));
      }
      break;

    case 'guardian_give_up':
      Modal.warning({
        title: t('guardian.give_up_title'),
        content: `${t('guardian.give_up_content', { reason: data.data?.reason || t('guardian.give_up_default_reason') })}\n${t('guardian.give_up_suggestion')}`,
        okText: t('guardian.give_up_ok')
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

function sendGuardianMessage(type: string, data?: any) {
  if (_socket && _socket.connected) {
    _socket.emit(type, data);
  } else {
    message.error(t('guardian.ws_not_connected'));
  }
}

let dirInputEl: HTMLInputElement | null = null;

function openDirPicker() {
  if (!dirInputEl) {
    dirInputEl = document.createElement('input');
    dirInputEl.type = 'file';
    dirInputEl.setAttribute('webkitdirectory', '');
    dirInputEl.setAttribute('directory', '');
    dirInputEl.style.display = 'none';
    dirInputEl.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        message.info(t('guardian.browser_path_limit'));
      }
    });
    document.body.appendChild(dirInputEl);
  }
  dirInputEl.click();
}

function startGuardian() {
  if (aiProvider.value === 'openai' && !aiApiKey.value.trim()) {
    message.warning(t('guardian.settings_need_ai_key'));
    return;
  }
  if (aiProvider.value === 'ollama' && !aiBaseUrl.value.trim()) {
    message.warning(t('guardian.settings_need_ollama_url'));
    return;
  }
  launchModalVisible.value = true;
}

function confirmLaunch() {
  if (!launchWorkDir.value.trim()) {
    message.warning(t('guardian.launch_need_workdir'));
    return;
  }
  if (aiProvider.value === 'openai' && !aiApiKey.value.trim()) {
    message.warning(t('guardian.settings_need_openai_key'));
    return;
  }
  if (aiProvider.value === 'ollama' && !aiBaseUrl.value.trim()) {
    message.warning(t('guardian.settings_need_ollama_url2'));
    return;
  }
  sendGuardianMessage('guardian_start', {
    workDir: launchWorkDir.value,
    javaCommand: launchJavaCmd.value,
    serverType: launchServerType.value
  });
  message.loading(t('guardian.launch_starting'));
  launchModalVisible.value = false;
}

function stopGuardian() {
  Modal.confirm({
    title: t('guardian.stop_title'),
    content: t('guardian.stop_content'),
    okText: t('guardian.stop_ok'),
    cancelText: t('guardian.stop_cancel'),
    okType: 'danger',
    onOk: () => {
      sendGuardianMessage('guardian_stop');
      message.info(t('guardian.stop_success'));
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
  message.info(t('guardian.restart_restarting'));
}

function rollbackLastFix() {
  Modal.confirm({
    title: t('guardian.rollback_title'),
    content: t('guardian.rollback_content'),
    okText: t('guardian.rollback_ok'),
    cancelText: t('guardian.rollback_cancel'),
    onOk: () => {
      sendGuardianMessage('guardian_rollback');
      message.info(t('guardian.rollback_info'));
    }
  });
}

function saveSettings() {
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
  message.success(t('guardian.settings_saved'));
  showSettings.value = false;
}

function testAIConnection() {
  testAIResult.value = null;
  testingAI.value = true;
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
  setTimeout(() => {
    sendGuardianMessage('guardian_test_ai');
    setTimeout(() => {
      if (testingAI.value) {
        testingAI.value = false;
        testAIResult.value = {
          success: false,
          message: t('guardian.settings_test_timeout')
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
    message.success(t('guardian.log_copied', { count: logLines.value.length }));
  }).catch(() => {
    message.error(t('guardian.log_copy_failed'));
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
  message.success(t('guardian.log_exported'));
}

function exportFullReport() {
  const now = new Date().toISOString();
  const logText = logLines.value.map(l => l.line).join('\n');
  const convText = aiConversations.value.map(c =>
    `### ${c.type === 'diagnosis' ? t('guardian.ai_conv_type_diagnosis') : c.type === 'test' ? t('guardian.ai_conv_type_test') : t('guardian.ai_conv_type_fallback')} (${formatTime(c.timestamp)})\n\n` +
    `**${t('guardian.ai_conv_sent')}:**\n\`\`\`\n${c.prompt.slice(0, 1000)}\n\`\`\`\n\n` +
    `**${t('guardian.ai_conv_received')}:**\n\`\`\`json\n${c.rawResponse.slice(0, 2000)}\n\`\`\`\n\n`
  ).join('---\n');

  const report = `# ServerGuardian ${t('guardian.report_exported')}\n\n` +
    `**${t('guardian.log_export')}:** ${now}\n` +
    `**${t('guardian.title')}:** ${statusTextMap[guardianStatus.value] || guardianStatus.value}\n` +
    `**${t('guardian.process_running')}:** ${processRunning.value ? t('guardian.process_running') : t('guardian.process_stopped')}\n` +
    `**${t('guardian.stats_crash_count')}:** ${stats.value.crashCount}\n` +
    `**${t('guardian.stats_restart_count')}:** ${stats.value.restartCount}\n\n` +
    `## ${t('guardian.crash_title')}\n\n` +
    (crashDiagnosis.value
      ? `- **${t('guardian.crash_cause_analysis')}:** ${crashDiagnosis.value.diagnosis}\n- **${t('guardian.crash_confidence', { percent: Math.round(crashDiagnosis.value.confidence * 100) })}**\n- **${t('guardian.crash_type')}:**\n${crashDiagnosis.value.causes.map(c => `  - ${c}`).join('\n')}\n\n`
      : `${t('guardian.crash_no_diagnosis')}\n\n`) +
    `## ${t('guardian.log_title')}\n\n\`\`\`\n${logText.slice(0, 10000)}${logText.length > 10000 ? '\n' + t('guardian.log_truncated') : ''}\n\`\`\`\n\n` +
    `## ${t('guardian.ai_conv_title')}\n\n${convText || t('guardian.ai_conv_empty')}\n\n` +
    `## ${t('guardian.log_export')}\n\n${t('guardian.title')} ${t('guardian.log_exported')}\n`;

  const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `guardian-report-${now.slice(0, 19).replace(/:/g, '-')}.md`;
  a.click();
  URL.revokeObjectURL(url);
  message.success(t('guardian.report_exported'));
}

function resetAIConversations() {
  aiConversations.value = [];
  sendGuardianMessage('guardian_reset_ai_conversation');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const statusTextMap: Record<string, string> = {
  idle: t('guardian.status_idle'),
  starting: t('guardian.status_starting'),
  monitoring: t('guardian.status_monitoring'),
  crash_detected: t('guardian.status_crash_detected'),
  analyzing: t('guardian.status_analyzing'),
  awaiting_user: t('guardian.status_awaiting_user'),
  fixing: t('guardian.status_fixing'),
  restarting: t('guardian.status_restarting'),
  stopped: t('guardian.status_stopped'),
  give_up: t('guardian.status_give_up')
};

const statusColorMap: Record<string, 'success' | 'error' | 'default' | 'processing' | 'warning'> = {
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

const guardianActive = computed(() => 
  ['starting', 'monitoring', 'crash_detected', 'analyzing', 'awaiting_user', 'fixing', 'restarting'].includes(guardianStatus.value)
);

const riskColorMap: Record<string, string> = {
  low: 'green',
  medium: 'orange',
  high: 'red',
  critical: 'red'
};

async function checkJavaAndLaunch() {
  checkingJava.value = true;
  javaCheckResult.value = null;
  try {
    const apiHost = import.meta.env.VITE_API_HOST || 'localhost';
    const apiPort = import.meta.env.VITE_API_PORT || '37019';
    const response = await fetch(`http://${apiHost}:${apiPort}/java/status`);
    const result = await response.json();
    if (result.status === 200 && result.data) {
      if (result.data.installed) {
        javaCheckResult.value = { available: true };
        launchModalVisible.value = true;
      } else if (result.data.installing) {
        javaCheckResult.value = { available: false, error: 'Java 正在安装中，请稍候...' };
        // 轮询等待 Java 安装完成
        const pollInterval = setInterval(async () => {
          try {
            const pollResponse = await fetch(`http://${apiHost}:${apiPort}/java/status`);
            const pollResult = await pollResponse.json();
            if (pollResult.status === 200 && pollResult.data) {
              if (pollResult.data.installed) {
                clearInterval(pollInterval);
                javaCheckResult.value = { available: true };
                launchModalVisible.value = true;
              } else if (!pollResult.data.installing) {
                clearInterval(pollInterval);
                javaCheckResult.value = { available: false, error: pollResult.data.error || 'Java 安装失败' };
              }
            }
          } catch {
            clearInterval(pollInterval);
          }
        }, 3000);
      } else {
        javaCheckResult.value = { available: false, error: result.data.error || 'Java 未安装' };
      }
    } else {
      javaCheckResult.value = { available: false, error: '无法获取 Java 状态' };
    }
  } catch {
    javaCheckResult.value = { available: false, error: '无法连接后端服务' };
  } finally {
    checkingJava.value = false;
  }
}

onMounted(() => {
  connectSocketIO();
  if (!_statusRefreshTimer) {
    _statusRefreshTimer = window.setInterval(fetchGuardianStatus, 5000);
  }
  
  // 从首页打包完成后跳转，自动填充工作目录
  const queryWorkDir = route.query.workDir as string;
  if (queryWorkDir) {
    launchWorkDir.value = queryWorkDir;
    launchJavaCmd.value = 'java';
    // 自动检查 Java 并打开启动对话框
    checkJavaAndLaunch();
  }
});

onUnmounted(() => {
  if (_statusRefreshTimer) {
    clearInterval(_statusRefreshTimer);
    _statusRefreshTimer = null;
  }
  disconnectSocket();
});
</script>

<template>
  <div class="guardian-container">
    <div class="status-bar">
      <div class="status-left">
        <span class="status-icon">
          <Badge :status="statusColorMap[guardianStatus] || 'default'" />
        </span>
        <span class="status-text">
          <strong>{{ t('guardian.title') }}</strong>
          <span class="status-detail">— {{ statusTextMap[guardianStatus] || t('guardian.status_unknown') }}</span>
        </span>
        <Tag v-if="processRunning" color="green">{{ t('guardian.process_running') }}</Tag>
        <Tag v-else color="default">{{ t('guardian.process_stopped') }}</Tag>
        <span v-if="processRunning" class="metrics-display">
          <Tag>CPU {{ currentMetrics.cpuPercent }}%</Tag>
          <Tag>{{ t('guardian.stats_memory') }} {{ currentMetrics.memPercent }}%</Tag>
        </span>
      </div>
      <div class="status-right">
        <Tag v-if="wsConnected" color="green">{{ t('guardian.connected') }}</Tag>
        <Tag v-else color="red">{{ t('guardian.disconnected') }}</Tag>

        <Tooltip :title="t('guardian.btn_start')">
          <Button type="primary" shape="circle"
                  @click="startGuardian" :disabled="guardianActive">
            <template #icon><PlayCircleOutlined /></template>
          </Button>
        </Tooltip>
        <Tooltip :title="t('guardian.btn_stop')">
          <Button danger shape="circle"
                  @click="stopGuardian" :disabled="!guardianActive">
            <template #icon><PauseCircleOutlined /></template>
          </Button>
        </Tooltip>
        <Tooltip :title="t('guardian.btn_rollback')">
          <Button shape="circle"
                  @click="rollbackLastFix" :disabled="!guardianActive">
            <template #icon><UndoOutlined /></template>
          </Button>
        </Tooltip>
        <Tooltip :title="t('guardian.btn_settings')">
          <Button shape="circle" @click="showSettings = !showSettings"
                  :type="showSettings ? 'primary' : 'default'">
            <template #icon><SettingOutlined /></template>
          </Button>
        </Tooltip>
      </div>
    </div>

    <Collapse :activeKey="activeSettingsKey" ghost>
      <CollapsePanel key="settings" :showArrow="false">
        <Card :title="t('guardian.settings_title')" size="small" class="settings-card">
          <div class="settings-grid">
            <div class="setting-item">
              <label>{{ t('guardian.settings_provider') }}</label>
              <Select v-model:value="aiProvider" style="width: 100%">
                <SelectOption value="openai">{{ t('guardian.settings_provider_openai') }}</SelectOption>
                <SelectOption value="ollama">{{ t('guardian.settings_provider_ollama') }}</SelectOption>
                <SelectOption value="none">{{ t('guardian.settings_provider_none') }}</SelectOption>
              </Select>
            </div>
            <div class="setting-item">
              <label>{{ t('guardian.settings_api_key') }}</label>
              <Input v-model:value="aiApiKey" type="password" :placeholder="t('guardian.settings_api_key_placeholder')" />
            </div>
            <div class="setting-item">
              <label>{{ t('guardian.settings_model') }}</label>
              <Input v-model:value="aiModel" :placeholder="t('guardian.settings_model_placeholder')" />
            </div>
            <div class="setting-item">
              <label>{{ t('guardian.settings_api_url') }}</label>
              <Input v-model:value="aiBaseUrl" :placeholder="t('guardian.settings_api_url_placeholder')" />
            </div>
            <div class="setting-item setting-item-row">
              <label>{{ t('guardian.settings_auto_accept') }}</label>
              <Switch v-model:checked="autoAcceptLowRisk" style="flex-shrink: 0" />
            </div>
            <div class="setting-item">
              <label>{{ t('guardian.settings_max_crashes') }}</label>
              <Input v-model:value="maxCrashes" type="number" min="1" max="20" />
            </div>
          </div>
          <div class="settings-actions">
            <Button :loading="testingAI" @click="testAIConnection" :disabled="aiProvider === 'none'" :icon="h(ApiOutlined)">
              {{ t('guardian.settings_btn_test_ai') }}
            </Button>
            <Button type="primary" @click="saveSettings">{{ t('guardian.settings_btn_save') }}</Button>
          </div>
          <div v-if="testAIResult" class="test-ai-result">
            <Alert
              :type="testAIResult.success ? 'success' : 'error'"
              :message="testAIResult.success ? t('guardian.settings_test_success') : t('guardian.settings_test_failed')"
              :description="testAIResult.message + (testAIResult.latency ? ` (${t('guardian.settings_test_latency', { latency: testAIResult.latency })})` : '')"
              showIcon
              closable
              @close="testAIResult = null"
            />
          </div>
        </Card>
      </CollapsePanel>
    </Collapse>

    <Modal v-model:visible="launchModalVisible"
           :title="t('guardian.launch_title')"
           :okText="t('guardian.launch_ok')"
           :cancelText="t('guardian.launch_cancel')"
           @ok="confirmLaunch">
      <div class="launch-form">
        <div class="launch-field">
          <label class="launch-label">{{ t('guardian.launch_workdir') }} <span class="required">*</span></label>
          <div class="launch-dir-row">
            <Input v-model:value="launchWorkDir" :placeholder="t('guardian.launch_workdir_placeholder')" />
            <Button @click="openDirPicker" :disabled="true" :title="t('guardian.browser_path_limit')">
              {{ t('guardian.launch_browse') }}
            </Button>
          </div>
          <div class="launch-hint">{{ t('guardian.launch_workdir_hint') }}</div>
        </div>
        <div class="launch-field">
          <label class="launch-label">{{ t('guardian.launch_cmd') }}</label>
          <Input v-model:value="launchJavaCmd" :placeholder="t('guardian.launch_cmd_placeholder')" />
          <div class="launch-hint">{{ t('guardian.launch_cmd_hint1') }}</div>
          <div class="launch-hint">{{ t('guardian.launch_cmd_hint2') }}</div>
        </div>
        <div class="launch-field">
          <label class="launch-label">{{ t('guardian.launch_server_type') }}</label>
          <Select v-model:value="launchServerType" style="width: 100%">
            <SelectOption value="forge">{{ t('guardian.launch_server_type_forge') }}</SelectOption>
            <SelectOption value="neoforge">{{ t('guardian.launch_server_type_neoforge') }}</SelectOption>
            <SelectOption value="fabric">{{ t('guardian.launch_server_type_fabric') }}</SelectOption>
            <SelectOption value="vanilla">{{ t('guardian.launch_server_type_vanilla') }}</SelectOption>
          </Select>
        </div>
      </div>
    </Modal>

    <div class="main-content">
      <div class="log-panel">
        <div class="panel-header">
          <span><ConsoleSqlOutlined /> {{ t('guardian.log_title') }}</span>
          <div class="panel-actions">
            <Button size="small" @click="copyLog" :disabled="logLines.length === 0">{{ t('guardian.log_copy') }}</Button>
            <Button size="small" @click="exportLog" :disabled="logLines.length === 0">{{ t('guardian.log_export') }}</Button>
            <Button size="small" @click="exportFullReport">{{ t('guardian.log_full_report') }}</Button>
            <Button size="small" @click="clearLog">{{ t('guardian.log_clear') }}</Button>
            <Tag>{{ t('guardian.log_lines', { count: logLines.length }) }}</Tag>
          </div>
        </div>
        <div class="log-output" ref="logContainer">
          <div v-for="log in logLines" :key="log.id"
               :class="['log-line', { 'log-error': log.isError }]">
            <span class="log-prefix">{{ log.isError ? '⚠' : '▶' }}</span>
            <span class="log-text">{{ log.line }}</span>
          </div>
          <div v-if="logLines.length === 0" class="log-empty">
            {{ t('guardian.log_empty') }}
          </div>
        </div>
      </div>

      <div class="diagnostic-panel">
        <Card :title="t('guardian.crash_title')" size="small" class="diagnostic-card"
              v-if="crashDiagnosis">
          <div class="diagnosis-content">
            <Alert type="error" :message="crashDiagnosis.diagnosis" show-icon />
            <Divider>{{ t('guardian.crash_cause_analysis') }}</Divider>
            <ul class="cause-list">
              <li v-for="(cause, i) in crashDiagnosis.causes" :key="i">
                <BugOutlined /> {{ cause }}
              </li>
            </ul>
            <div class="confidence">
              {{ t('guardian.crash_confidence', { percent: Math.round(crashDiagnosis.confidence * 100) }) }}
            </div>
          </div>
        </Card>

        <Card :title="`🔧 ${t('guardian.actions_title')}`" size="small" class="actions-card"
              v-if="pendingActions.length > 0">
          <div v-for="action in pendingActions" :key="action.id" class="action-item">
            <div class="action-header">
              <Tag :color="riskColorMap[action.riskLevel] || 'default'">
                {{ action.riskLevel === 'low' ? t('guardian.actions_risk_low') : action.riskLevel === 'medium' ? t('guardian.actions_risk_medium') : t('guardian.actions_risk_high') }}
              </Tag>
              <Tag>{{ action.type }}</Tag>
            </div>
            <div class="action-target">{{ action.target }}</div>
            <div class="action-reason">{{ action.reason }}</div>
            <div class="action-buttons">
              <Button size="small" type="primary" @click="approveAction(action.id)">
                <CheckCircleOutlined /> {{ t('guardian.actions_approve') }}
              </Button>
              <Button size="small" danger @click="rejectAction(action.id)">
                <CloseCircleOutlined /> {{ t('guardian.actions_reject') }}
              </Button>
            </div>
          </div>
          <div class="action-bulk">
            <Button type="primary" block @click="approveAllActions">
              <ThunderboltOutlined /> {{ t('guardian.actions_approve_all') }}
            </Button>
          </div>
        </Card>

        <Card v-if="restartNeeded && pendingActions.length === 0"
              :title="`🚀 ${t('guardian.restart_title')}`" size="small"
              class="restart-card">
          <div class="restart-info">
            <Alert type="info" show-icon :message="t('guardian.restart_all_done')" />
            <div class="restart-hint">{{ t('guardian.restart_hint') }}</div>
          </div>
          <div class="restart-buttons">
            <Button type="primary" size="large" block @click="confirmRestart">
              <ReloadOutlined /> {{ t('guardian.restart_btn') }}
            </Button>
          </div>
        </Card>

        <Card :title="t('guardian.stats_title')" size="small" class="stats-card">
          <div v-if="guardianStatus === 'idle' || guardianStatus === 'stopped'" class="stats-placeholder">
            <PlayCircleOutlined />
            <span>{{ t('guardian.stats_placeholder') }}</span>
          </div>
          <div v-else class="stats-grid">
            <div class="stat-item">
              <div class="stat-value">{{ stats.crashCount }}</div>
              <div class="stat-label">{{ t('guardian.stats_crash_count') }}</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ stats.restartCount }}</div>
              <div class="stat-label">{{ t('guardian.stats_restart_count') }}</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ stats.maxCrashes }}</div>
              <div class="stat-label">{{ t('guardian.stats_max_crashes') }}</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">{{ stats.reportsCount }}</div>
              <div class="stat-label">{{ t('guardian.stats_reports_count') }}</div>
            </div>
          </div>
        </Card>

        <Collapse :activeKey="aiConvActiveKey" @change="(keys) => showAIConversation = (Array.isArray(keys) ? (keys as (string | number)[]).map(String) : [String(keys)]).includes('ai-conv')">
          <CollapsePanel key="ai-conv" :header="t('guardian.ai_conv_title')">
            <div v-if="aiConversations.length" style="display:flex;justify-content:flex-end;margin-bottom:8px">
              <Button size="small" @click="resetAIConversations">{{ t('guardian.ai_conv_reset') }}</Button>
            </div>
            <div v-if="aiConversations.length === 0" style="color:#999;text-align:center;padding:16px">
              {{ t('guardian.ai_conv_empty') }}<br/>
              <small>{{ t('guardian.ai_conv_empty_hint') }}</small>
            </div>
            <div v-else class="ai-conv-list">
              <div v-for="conv in [...aiConversations].reverse()" :key="conv.id" class="ai-conv-entry">
                <div class="conv-header">
                  <Tag :color="conv.type === 'fallback' ? 'orange' : 'blue'">
                    {{ conv.type === 'diagnosis' ? t('guardian.ai_conv_type_diagnosis') : conv.type === 'test' ? t('guardian.ai_conv_type_test') : t('guardian.ai_conv_type_fallback') }}
                  </Tag>
                  <span class="conv-time">{{ formatTime(conv.timestamp) }}</span>
                  <span v-if="conv.latencyMs" class="conv-latency">{{ conv.latencyMs }}ms</span>
                </div>
                <div class="conv-bubble conv-bubble-sent">
                  <div class="bubble-label">{{ t('guardian.ai_conv_sent') }}</div>
                  <pre class="conv-code">{{ conv.prompt.slice(0, 600) }}{{ conv.prompt.length > 600 ? '...' : '' }}</pre>
                </div>
                <div class="conv-bubble conv-bubble-received">
                  <div class="bubble-label">{{ t('guardian.ai_conv_received') }}</div>
                  <div class="conv-diagnosis" v-if="conv.diagnosis">
                    <div class="diag-text">{{ conv.diagnosis.diagnosis }}</div>
                    <div v-if="conv.diagnosis.causes?.length" class="diag-causes">
                      <div v-for="(cause, ci) in conv.diagnosis.causes" :key="ci" class="diag-cause">• {{ cause }}</div>
                    </div>
                  </div>
                  <pre class="conv-code">{{ conv.rawResponse.slice(0, 500) }}{{ conv.rawResponse.length > 500 ? '...' : '' }}</pre>
                </div>
                <div v-if="conv.diagnosis?.actions?.length" class="conv-tools">
                  <div class="bubble-label">{{ t('guardian.ai_conv_tools') }}</div>
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
