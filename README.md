# BG Sites — Google Drive 图片展示库

一个将 Google Drive 云端文件夹中的图片展示在网站上的轻量级图片画廊，支持按子文件夹（分类）筛选。

## 功能特性

- 📁 **自动分类** — 读取 Google Drive 根文件夹下的子文件夹作为图片分类
- 🔍 **实时搜索** — 按图片名称或分类名称搜索
- 🏷️ **分类筛选** — 点击分类标签快速筛选图片
- 🖼️ **灯箱预览** — 点击图片全屏预览，支持键盘导航
- 💾 **本地缓存** — 配置信息保存在浏览器中，无需重复输入
- 📱 **响应式布局** — 适配手机、平板、桌面端

## 使用方法

1. 在 Google Cloud Console 开启 Google Drive API
2. 创建 API Key（限制 HTTP referer 以提高安全性）
3. 将需要展示的图片放在 Google Drive 文件夹中，按子文件夹分类
4. 将根文件夹设为"任何人可查看"
5. 打开网站，点击右上角设置按钮，输入文件夹 ID 和 API Key

## 项目结构

```
BGsites/
├── index.html    # 主页面
├── style.css     # 样式表
├── app.js        # 应用逻辑
└── README.md     # 说明文档
```

## 技术栈

- 原生 HTML / CSS / JavaScript
- Google Drive API v3
- 无需任何构建工具或依赖
