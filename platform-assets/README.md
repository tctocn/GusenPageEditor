# 谷神平台静态资源快照

来源：谷神平台设计器静态资源（`<GUSHEN_PLATFORM_BASE>/guthon/index.html#/gdpaas/dev/modules`）。实际域名通过环境变量 `GUSHEN_PLATFORM_BASE` 提供，不写入仓库。

2026-10-19 下载；109 个文件，14,842,219 字节。除入口主程序 `guthon/js/app.a42d4efa.js` 的内网域名与 IP 已脱敏（哈希同步更新）外，其余原始文件保留原内容；snapshot.json 记录来源、SHA-256、大小与引用。包含 107 个静态依赖，以及原版 Monaco 编辑器运行时需要的 editor.worker.js、ts.worker.js。

此目录由 0.2.0 插件的 native-designer 适配器加载；原始 index.html 使用绝对路径和在线接口，不能直接用 file:// 打开。不要将此目录当作 basic 模式的 designer-assets 协议资源包。

离线适配与原始资源分离，文件不做落盘补丁。更换资源须同时更新 snapshot.json，并关闭后重开页面；启动结构不兼容时需要升级适配器。未包含业务接口响应和未发现的动态资源。完整说明见插件根 README.md。
