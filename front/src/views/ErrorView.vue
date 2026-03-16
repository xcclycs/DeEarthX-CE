<template>
    <div class="tw:h-full tw:w-full tw:flex tw:flex-col tw:justify-center tw:items-center">
        <div class="tw:w-32 tw:h-32 tw:mb-8">
            <svg class="w-32 h-32 mb-4" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="#ef4444" />
                <path d="M40,40 L80,80 M80,40 L40,80" stroke="white" stroke-width="10" stroke-linecap="round" />
            </svg>
        </div>
        <p class="tw:text-2xl tw:font-bold tw:text-center tw:mb-6 tw:text-red-500">Error</p>
        <div class="tw:w-1/2 tw:max-w-md tw:bg-white tw:p-6 tw:rounded-lg tw:shadow-lg">
            <p class="tw:text-sm tw:text-center tw:text-gray-500 mb-4">
                {{ errorMessage }}
            </p>
            <div v-if="errorCode" class="tw:text-sm tw:text-center tw:text-gray-500 mb-6">
                错误码：{{ errorCode }}
            </div>
            <div v-if="suggestions.length > 0" class="tw:mt-6">
                <p class="tw:text-sm tw:font-medium tw:text-gray-700 mb-2">建议解决方案：</p>
                <ul class="tw:text-xs tw:text-gray-600 tw:list-disc tw:pl-5">
                    <li v-for="(suggestion, index) in suggestions" :key="index" class="tw:mb-1">
                        {{ suggestion }}
                    </li>
                </ul>
            </div>
            <div class="tw:mt-6 tw:flex tw:justify-center tw:gap-4">
                <button 
                    class="tw:px-4 tw:py-2 tw:bg-[#67eac3] tw:text-gray-800 tw:rounded-md tw:hover:bg-[#56d9b0] tw:transition-colors"
                    @click="goBack"
                >
                    返回首页
                </button>
                <button 
                    v-if="errorCode"
                    class="tw:px-4 tw:py-2 tw:bg-[#67eac3] tw:text-gray-800 tw:rounded-md tw:hover:bg-[#56d9b0] tw:transition-colors"
                    @click="openErrorDoc"
                >
                    文档帮助
                </button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { useRoute, useRouter } from 'vue-router';
import { ErrorCode, getErrorSuggestions } from '../utils/errorCodes';
import { open } from '@tauri-apps/plugin-shell';

const route = useRoute();
const router = useRouter();
const errorReason = route.query.e as string;
const errorCodeStr = route.query.code as string;
const errorCode = errorCodeStr ? parseInt(errorCodeStr) as ErrorCode : undefined;
const errorMessage = errorReason ? errorReason : 'DeEarthX.Core 启动失败！';
const suggestions = errorCode ? getErrorSuggestions(errorCode) : [];

function goBack() {
    router.push('/');
}

function openErrorDoc() {
    if (errorCode) {
        const url = `https://dex.xcclyc.cn/api/error-codes.html#_${errorCode}`;
        open(url);
    }
}
</script>
