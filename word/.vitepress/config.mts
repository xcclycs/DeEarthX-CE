import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "DeEarthX-CE",
  description: "DeEarthX-CE 项目文档",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '首页', link: '/' },
      { text: '文档', link: '/guide/introduction' },
      { text: 'API', link: '/api/core' },
      { text: '贡献', link: '/contributing' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '项目介绍', link: '/guide/introduction' },
            { text: '安装指南', link: '/guide/installation' },
            { text: '使用教程', link: '/guide/usage' },
            { text: '模板编写教程', link: '/guide/template-tutorial' },
            { text: '常见问题', link: '/guide/faq' },
            { text: '开发者指南', link: '/guide/developer' }
          ]
        }
      ],
      '/api/': [
        {
          text: 'API 文档',
          items: [
            { text: '核心模块', link: '/api/core' },
            { text: '后端 API', link: '/api/backend' },
            { text: '前端 API', link: '/api/frontend' },
            { text: '错误码说明', link: '/api/error-codes' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'gitea', link: 'https://git.xcclyc.com.cn/xcclyc/DeEarthX-CE' }
    ]
  }
})
