# 万卷图 · Campura Map Studio

CampuraOne_School_CamapComposer 是独立的二维校园地图桌面编辑器，使用 **Tauri 2 + React + TypeScript + Konva**。Windows 为发布目标，macOS 支持本机预览。没有 3D、室内定位或楼层内自动导航。

## 先试用

1. 启动万卷图，内置地图明确标为演示，尚未绑定真实地理位置。
2. 选择「建筑」或「商户」，拖出矩形。选择工具下可拖动、缩放、旋转或调整顶点。
3. 选择建筑管理楼层；底部手动切换楼层。
4. 选择「门」点击放置，设置所属建筑/商户、门宽和是否通向室外。
5. 选择「楼梯」点击放置，选择所属建筑，勾选实际可达楼层。
6. 选择「路点」放置室外节点，再用「道路」依次连接；门可创建关联入口路点。右侧可试算室外路线。
7. 连接高德时无需输入原点：新地图尝试定位到当前位置，确认校园后开始绘制；已有地图回到保存的校园。
8. 「导出 .camap」保存文件，在学校端「控制台 → 校园地图」上传，检查差异，再发布。
9. 后续修改优先从学校端下载当前主地图后打开，以保留合并所需的基准版本。

浏览器预览使用下载；桌面版使用系统打开/保存对话框。自动恢复副本只保留当前工程，重要工程请导出备份。撤销/重做使用 Ctrl/Cmd+Z 与 Shift+Ctrl/Cmd+Z，保存 Ctrl/Cmd+S，V 选择，H 漫游，Esc 结束连线。

## 开发启动

将 SDK 仓库放在旁边：

```text
Web-学校端/
  CampuraOne_Camap/                 # 独立格式规范仓库
  CampuraOne_Camap_SDK/             # 独立 SDK 仓库
  CampuraOne_School_CamapComposer/  # 本仓库
  CampuraOne_School_Web/
```

Node 22.18+、Rust stable，以及 Tauri 对应平台的系统依赖：

```sh
cd ../CampuraOne_Camap_SDK/typescript
npm ci
npm run build
cd ../../CampuraOne_School_CamapComposer
npm ci
npm test
npm run desktop
```

只预览界面：`npm run dev`，地址 http://127.0.0.1:1420 。网页预览不代替原生安装测试。

## 安装包

`npm run desktop:build` 在当前平台生成安装包。Windows 需要 Visual Studio C++ Build Tools 与 WebView2；请在 Windows 构建、安装并复验打开/保存、缩放和导出，macOS 构建不证明 Windows 已通过。安装产物在 `src-tauri/target/release/bundle/`，不要提交构建目录。当前本机版本未做 Apple 公证或 Windows 代码签名。

学校端下载入口由 `VITE_CAMAP_EDITOR_DOWNLOAD_URL`（演示）或 `CAMPURA_CAMAP_EDITOR_URL`（服务端）指定。将核验后的对应平台安装包放在自己的发布地址；源代码不会自动向生产站点部署。

## 外观主题

顶部「外观」可选跟随系统、浅色、深色，默认跟随系统。选择仅保存在当前电脑，重启后恢复，不会写入 .camap 或产生地图修改记录。界面、网格、地标、选中框及高德底图同步换色；切换时保留地图中心和缩放。系统打开/保存对话框的外观由平台控制。

## macOS 与 Windows 启动

- **macOS 已构建版本**：在 Finder 打开本项目的 `src-tauri/target/release/bundle/macos/万卷图.app`（调试构建在 `target/debug/bundle/macos/`），双击启动。可复制到「应用程序」，不需要 Vite 服务。
- **macOS 源码开发**：安装 Node.js 22.18+、Rust stable、Xcode Command Line Tools；按上文构建相邻 SDK 后，在本项目运行 `npm run desktop`。
- **Windows 源码开发**：安装 Node.js 22.18+、Rust stable（MSVC）、Visual Studio Build Tools 的「使用 C++ 的桌面开发」和 WebView2。将 SDK 和编辑器放在同一级目录，然后在本项目的 PowerShell 中执行上文「开发启动」命令。系统依赖见 [Tauri 官方说明](https://v2.tauri.app/start/prerequisites/#windows)。
- **Windows 安装包**：在 Windows 本项目目录运行 `npm run desktop:build -- --bundles nsis`，双击 `src-tauri/target/release/bundle/nsis/` 中的安装程序，安装后从开始菜单启动。不需要为使用者安装 Node 或 Rust。打包不会自动上传或发布。

两台电脑分别配置本机凭据；下载源码不会自动带入另一台电脑的 Key、主题偏好或自动恢复工程。要继续编辑同一张地图，请导出 .camap，再在另一台的「打开」中选择文件。当前 Windows 原生授权、打开/保存和安装流程仍需在 Windows 实机验收。

## 真实底图

1. 在高德开放平台创建应用，添加服务平台为 **Web 端（JS API）** 的 Key，并取得配套安全密钥，参见 [高德准备说明](https://lbs.amap.com/api/javascript-api-v2/prerequisites)。不是 Android、iOS 或 Web 服务 Key。
2. 打开 App 的「设置底图」，填写 Key 和安全密钥，点「保存并连接」。本机试用不需要代理；已有 HTTPS 安全代理时可填写代理地址。
3. **新地图/未绑定的本地地图**：底图加载后会尝试定位到当前位置，系统可能询问定位权限。电脑定位不保证与手机一样准确，只有大致位置时界面会明确提示。
4. 将校园放到地图十字中心、放大到能看清建筑后，点「从这里开始绘制」。定位失败或不愿授权时，点「手动找校园」后拖动、缩放即可。无需输入经纬度；确认前不会绑定位置或显示本地地标，以免误认已对齐。已有本地绘图会保留相对位置，绑定后仍需核对建筑与门的位置。
5. 原点由 App 从高德地图中心自动保存进 .camap。**已有绑定的地图**直接使用保存的位置与旋转，不再次定位或改变原点；从另一台电脑打开也不会把校园移动到那台电脑所在地。
6. 桌面端使用 macOS Core Location / Windows WinRT Geolocator，在主线程申请系统授权。系统返回 WGS-84 坐标，再通过高德 `convertFrom(..., "gps")` 转换一次。只有浏览器预览沿用高德 Geolocation（convert=true），不重复转换。原始定位轨迹、定位误差和凭据不写入 .camap；文件只保存用户确认的地图区域绑定。
7. Key、安全密钥和代理地址保存到本机系统凭据库（macOS 钥匙串 / Windows 凭据管理器）。重启会自动回填，点击连接即可；不写进源码、localStorage 自动恢复工程或 .camap。同一组配置可先用于 Mac 和 Windows 联调，但两端原生 WebView 的实际授权必须分别验证。

系统定位最多等待 45 秒（界面有 50 秒保护），高德坐标转换最多等待 10 秒；浏览器预览定位最多等待 12 秒。取消会停止原生请求并忽略迟到结果，失败后仍可手动选校园。脚本加载超过 15 秒、底图等待超过 25 秒会提示超时并返回本地网格；可取消连接，或重新打开「设置底图」重试。错误提示不显示带凭据的请求 URL。修改凭据后点击「保存到本机」或「保存并连接」。若已经加载过高德，App 会先保存当前地图恢复副本并重载界面，随后重新连接；不会继续使用旧凭据。「清除本机配置」删除系统凭据项并断开底图，不删除地图。若自动恢复存储不可用，界面会提示先导出地图再重启，避免丢失编辑。

未提供可用 Key 时可完整编辑本地米制平面，但不能声称已与真实校园对齐。用户已反馈 macOS 底图可以连接，Windows 实机授权仍待验证。若遇到域名限制，应记录脱敏错误码及平台，再决定适配方式。正式使用可另行配置高德安全代理，本轮不包含代理部署。MapKit 仅保留独立绑定的数据接口，编辑器没有加载 MapKit 底图。

## 系统定位权限（macOS / Windows）

- macOS：从 Finder 启动构建后的 `.app`，在定位提示中允许「万卷图」。已拒绝或关闭全局定位时，点「系统定位设置」，在「隐私与安全性 → 定位服务」开启定位服务及万卷图，再返回 App 点「重新定位」。不要只运行裸 Rust 可执行文件验收权限；权限说明在 App 的 Info.plist 中。当前原生定位要求 macOS 11+。
- Windows 11：「设置 → 隐私和安全性 → 位置」；Windows 10：「设置 → 隐私 → 位置」。开启位置服务及可用的桌面应用访问开关，在系统弹窗允许应用访问。「系统定位设置」直接打开对应页面。当前 NSIS / 普通 exe 为非 MSIX 桌面应用；若未来改用 MSIX，须在包清单声明 location capability。[Microsoft 原生桌面定位说明](https://learn.microsoft.com/en-us/windows/apps/develop/maps-and-location/get-location)。
- 电脑通常依赖 Wi-Fi / 网络估算位置，不保证有 GPS 硬件或手机级精度。保持 Wi-Fi 开启，误差较大时界面提示大致位置，仍须确认校园。
- 系统定位超时或失败时，高德可能仍显示自己的初始视角；这不是已确认的当前位置。误差超过 2 公里的定位结果也不会自动移动地图。可手动找校园并放大后确认。
- 拒绝权限不会自动修改系统设置，也不会偷偷以 IP 定位当作精确位置。可手动找校园；已有地图的原点不受影响。

## 本机保存与正式发布

每台电脑、每个系统用户分别保存一份配置；系统凭据库拒绝访问时会明确报错，不回退到明文文件。网页预览不提供持久保存。原生凭据项的 service 为 `com.campura.camapcomposer.amap`、account 为 `map-settings-v1`，只保存这三个配置字段。清除不存在的配置也可安全完成。应用更新后 macOS 可能再次询问钥匙串访问权限。

当前属于开发者/学校自行配置的模式。正式面向学校发布时，建议由运营方配置 Web JS Key、服务端安全代理及访问控制，将 securityJsCode 留在服务器，使用者无需申请 Key。客户端 Key 并非不可提取的秘密，不能把安全密钥直接打包进发布应用；具体授权、域名和额度需在正式发布时联调。本轮不部署代理。

Android SDK Key 采用应用包名与签名证书 SHA-1 校验，不绑定某一台手机。不同开发电脑的调试证书可能不同。正式版本应使用稳定的发布签名，并在高德控制台配置相应 SHA-1；同一签名的安装包可分发到多台手机。与这里的 Web JS Key 是两类配置。[高德 Android 说明](https://lbs.amap.com/api/android-location-sdk/guide/create-project/get-key/)；[JS 安全代理说明](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)。

## 双平台验收清单

- [ ] 顶部依次选浅色、深色、跟随系统；检查工具栏、属性、弹窗、网格、文字及选中框。跟随系统时改变系统外观会同步，手动模式不受影响；重启恢复选择。
- [ ] 两种主题下画建筑、商户、门和楼梯，关联所属建筑/商户与可达楼层，导出再打开，确认数据与坐标一致。
- [ ] 在 macOS、Windows 各自填入有效高德配置，记录 App 原生窗口加载结果；浏览器预览成功不能代替该项。
- [ ] 漫游、缩放后切换主题，视角不跳变；建筑边缘与门/楼梯始终贴合底图，重开文件校园位置与旋转仍一致，且不会重新定位覆盖原位置。
- [ ] 填写缺失配置、断网/授权失败或取消加载：工程保留，可回本地网格继续编辑及导出，再重试。
- [ ] 保存配置并重启，确认自动回填；修改后保存，确认使用新配置；清除后重启确认不再回填。系统凭据库拒绝访问时应显示失败，不误报保存成功。
- [ ] 检查导出的 .camap 仅含地图数据和区域绑定，不含凭据或主题设置。
- [ ] 原生定位：首次授权、拒绝后打开设置并重试、关闭全局定位、超时、取消后立即重试，均不丢工程；转换后落在正确校园，已有地图不重新绑定。Windows 必须在实机验证。

自动化适配器测试使用模拟高德对象，覆盖加载重试、错误清理、取消连接、精确/粗略定位、拒绝授权、取消定位、自动原点、旋转坐标往返以及主题切换不重建地图；不代表真实高德授权已经通过。

## 源码入口

- `src/App.tsx`：工具、画布、楼层、属性编辑与撤销
- `src/model.ts`：新增、移动、级联删除与入口路点同步
- `src/amap.ts`：二维底图与坐标适配
- `src/location.ts`：原生定位调用、取消及高德坐标转换
- `src-tauri/src/location.rs` / `location_macos.m`：Windows / macOS 系统授权、单次定位与停止
- `src/files.ts`：浏览器与桌面文件接口
- `src-tauri/src/main.rs`：系统文件选择器、大小限制、同目录临时文件保存

首版用于小范围校园编辑。大批量地标尚未做空间索引、视口裁剪和大图性能验收；超过 10 km 的区域应创建独立坐标框架。多框架没有默认连通路线。
