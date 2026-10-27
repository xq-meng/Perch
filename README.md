# 栖页 · A quiet new tab

一个轻量、无构建依赖的 Chrome 新标签页扩展。中文界面、居中搜索框、可自定义快捷方式。

## 安装到 Chrome

1. 打开 `chrome://extensions`。
2. 开启右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择当前 `new-tab` 文件夹（包含 `manifest.json` 的这一层）。
4. 打开一个新标签页。如果 Chrome 询问是否保留新标签页更改，选择保留。

修改代码后，在扩展管理页点击本扩展的刷新按钮，然后重新打开新标签页。

## 使用

- 搜索框支持 Google、Bing、百度和 DuckDuckGo，也可以直接输入网址。空白处按 `/` 聚焦搜索框（Chrome 新标签页最初会把焦点放在地址栏，需先切换到页面）。
- 点击快捷方式区域右上角的「+」，填写名称、网址、图标底色。图标优先使用网站提供的 Apple Touch Icon，其次使用网站 favicon，获取失败时显示名称首字符。
- 点击铅笔图标进入整理模式，可以点击快捷方式编辑或拖动排序，点击对勾图标退出。编辑窗口的「排列位置」也支持键盘操作。
- 删除后可在 10 秒内撤销。最多保存 48 个快捷方式。
- 页面采用参考 [GitHub Primer](https://primer.style/product/primitives/color/) 的中性灰、蓝色交互色和绿色主按钮配色。
- 点击右下角的设置图标，可以设置浅色/深色/跟随系统、是否在新标签页打开链接。

## 本地预览

在当前目录运行：

```sh
python3 scripts/preview.py
```

然后打开 `http://127.0.0.1:5173`。预览使用该站点的 `localStorage`，数据与安装后的扩展独立。正式扩展使用 `chrome.storage.local`，同一浏览器中的已打开页面会同步更新；卸载扩展会清除其设置。

预览脚本仅监听 `127.0.0.1`，提供本机图标读取接口，让预览也能发现网站声明的高清图标。Chrome 扩展直接使用网站访问权限读取图标，不依赖这个预览服务。若使用普通 `http.server`，跨域网站只能尝试根目录图标，清晰度可能受限。

## 网站图标

遵循 [Apple 官方的 Apple Touch Icon 规范](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)：先读取站点首页中 `rel="apple-touch-icon"` / `apple-touch-icon-precomposed` 声明，优先选择合适大小的高清图标，再尝试根目录的 Apple 图标。如果没有可用的 Apple 图标，继续尝试页面声明的普通 favicon 和 `/favicon.ico`。

图标由对应网站及其 CDN 提供，未接入第三方图标聚合服务。优先选取至少 64px 的真实图标，避免将 16px favicon 当作高清图标长期缓存。图片缓存的最长边为 96px，高清缓存有效期 7 天；低清回退和失败请求仅缓存 15 分钟，离线时保留已有图片。最多同时读取 3 个网站。名称首字符会立即显示，搜索及快捷方式操作不会等待图标下载。

## 打包

在完整源代码目录运行 `python3 scripts/package.py`，生成 `artifacts/qipage-1.2.1.zip`。归档包含扩展运行资源、本机预览脚本和说明，不含测试及预览截图。解压到独立文件夹后，按上述步骤加载其中的扩展。

## 测试

在完整源代码目录安装 Node.js 20 或以上版本后运行 `npm test`，无需安装依赖。运行 `python3 -m unittest discover -s tests -p '*_test.py'` 可检查预览接口的来源限制、请求匿名性和资源大小限制。测试覆盖搜索、网址校验、数据清洗、排序、存储，以及图标优先级、高清选择、回退、缓存、并发限制和请求边界。浏览器内需另外验证交互、HTML 声明解析、图片解码和扩展加载。

## 权限与资源

申请 `storage` 权限保存设置与图标缓存，并申请 HTTP/HTTPS 网站访问权限以读取用户添加的网站及其图标 CDN。Chrome 在加载或更新时可能提示这一权限。没有内容脚本，不读取浏览记录或书签，不包含分析统计、远程脚本、外部字体或后台服务。可选的本机预览脚本只服务本机同源请求，禁止读取私网地址，不向网站转发浏览器 Cookie。

正式扩展仅请求站点首页和图标，请求使用 `credentials: 'omit'` 与 `referrerPolicy: 'no-referrer'`，不携带登录 Cookie 或快捷方式中的路径、查询参数、片段。远程 HTML 仅在未挂载的惰性模板中解析图标链接，不执行其中的脚本。搜索内容仅在提交后发送至所选搜索引擎。

采用 Manifest V3 的 `chrome_url_overrides.newtab` 替换新标签页，参见 [Chrome 官方文档](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)。
