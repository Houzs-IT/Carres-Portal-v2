# Carres ERP 用户手册

> **有图的版本：** [`Carres-ERP-Computer-Manual-ZH.html`](Carres-ERP-Computer-Manual-ZH.html)（PDF：`Carres-ERP-Computer-Manual-ZH.pdf`）。The Conts 格式：真实画面截图，红色号码对应下面的步骤，重点讲 Supply Chain。2026-11-14。

**适用对象：** Carres 全体员工（Office、销售、采购、仓库、物流、财务、管理层）

**系统版本：** 依据仓库 `main` 分支 `e2ef8259b`（2026-11-13）的代码整理，写于 2026-11-14

**语言约定：** 说明用简体中文；画面上的英文字（按钮、栏位、页签、状态）**照原样保留**，例如 `Create Sales Order`、`Proceed PO`。

> **怎样读这本手册**
> - 每个模组都按同一个顺序写：**用来干嘛 → 主要画面 → 常用操作 → 弹窗/抽屉 → 规则和注意事项 → 和其他模组的关系**。
> - 文中的规则都来自系统代码（不是口头习惯）。括号里的文件名是给 IT 核对用的，员工可以跳过。
> - 标 **【待确认】** 的地方：代码里没有找到证据，或者代码与实际可能不同。请以 IT / 主管的说明为准。全部待确认项汇总在 [附录 A](#附录-a待确认清单)。
> - 现在数据库里的单据都是**测试资料**。正式上线时数据库会清空重来。

---

## 目录

**第一部分 入门**
1. [系统总览](#1-系统总览)
2. [登入与账号](#2-登入与账号)
3. [角色权限](#3-角色权限)
4. [手机版](#4-手机版)
5. [通用画面操作](#5-通用画面操作)

**第二部分 Workspace**
6. [Overview](#6-overview)
7. [Sales Orders（快捷入口）](#7-sales-orders快捷入口)
8. [Payment Requests](#8-payment-requests)
9. [Workspace（我的任务 / 团队任务）](#9-workspace我的任务--团队任务)
10. [Leave（请假）](#10-leave请假)

**第三部分 Operations**
11. [Service Cases（售后）](#11-service-cases售后)
12. [Projects（项目 / 活动）](#12-projects项目--活动)

**第四部分 Supply Chain**
13. [Product Request](#13-product-request)
14. [Sales Order 模组](#14-sales-order-模组)
15. [Consignment（寄售）](#15-consignment寄售)
16. [Procurement（采购）](#16-procurement采购)
17. [Transportation（运输）](#17-transportation运输)
18. [Warehouse（仓库）](#18-warehouse仓库)

**第五部分 Finance**
19. [Finance（财务）](#19-finance财务)

**第六部分 System**
20. [Team（团队）](#20-team团队)
21. [Mail Center](#21-mail-center)
22. [Announcements（公告）](#22-announcements公告)
23. [IT：System Health / AI Usage](#23-itsystem-health--ai-usage)
24. [Change Log](#24-change-log)
25. [Assistant 与 Agent Console](#25-assistant-与-agent-console)
26. [IT Support](#26-it-support)
27. [OCR](#27-ocr)
28. [Settings](#28-settings)
29. [Finance (old)](#29-finance-old)

**第七部分 附录**
30. [常见问题](#30-常见问题)
- [附录 A：待确认清单](#附录-a待确认清单)
- [附录 B：单号格式](#附录-b单号格式)
- [附录 C：状态对照表](#附录-c状态对照表)

---

# 第一部分 入门

## 1. 系统总览

### 1.1 系统由两部分组成

| 部分 | 网址 | 内容 |
|---|---|---|
| **Carres Portal（门户）** | `erp.carresofficial.com`（内部员工） | 登入、左边菜单、Workspace、Leave、Subscription、Admin、Finance (old) |
| **Engine（引擎）** | 在门户里面以框架打开（独立站点 `carres-scm.pages.dev`） | Service Cases、Projects、整个 Supply Chain、Finance、Team 以及 System 各页 |

- 你只需要登入门户一次。点 Supply Chain / Finance / Team 等菜单时，门户会自动帮你登入 Engine，页面在门户右边打开，不用第二次登入（`engine/backend/src/carres/sso.ts`）。
- Engine 是 Houzs-ERP 的系统，Carres 是它里面唯一的公司。Carres 专用的规则在代码里标为 `// Carres:`，本手册会特别注明「**Carres 规则**」。
- Carres 的单号一律以 **`CR-`** 开头，例如 `CR-SO-2611-001`（2026 年 11 月第 1 张 SO）（`engine/backend/src/scm/lib/companyScope.ts:530-533`）。

### 1.2 主流程：从接单到收钱

```
 ┌─────────────┐  50% 订金 + Processing Date
 │ Sales Order │──────────────────────────────┐
 │   (CR-SO)   │                              ▼
 └─────────────┘                       ┌─────────────┐  Regenerate
        │ 客户付款 → Official receipt    │     MRP     │──► 算出缺货
        │                              └─────────────┘
        │                                     │ Proceed PO（选 main supplier）
        │                                     ▼
        │                              ┌─────────────┐
        │                              │Purchase Order│ (CR-PO)
        │                              └─────────────┘
        │                                     │ Transfer to Goods Received
        │                                     ▼
        │                              ┌─────────────┐  Post → 库存 IN
        │                              │  GRN 收货   │  SO 全部主产品到齐 → READY_TO_SHIP
        │                              └─────────────┘
        │                                     │ Transfer to Purchase Invoice
        │                                     ▼
        │                              ┌─────────────┐  → AP（应付）→ Payment voucher
        │                              │Purchase Inv. │ (CR-PI)
        │                              └─────────────┘
        ▼
 ┌─────────────┐  确认即扣库存；DO 覆盖 SO 全部行 → SO = SHIPPED
 │Delivery Order│ (CR-DO)  送达（POD / 夜间扫描）→ SO = DELIVERED
 └─────────────┘
        │ Transfer to Sales Invoice
        ▼
 ┌─────────────┐  Dr AR / Cr Sales；自动扣掉 SO 已收订金
 │Sales Invoice │ (CR-SI)
 └─────────────┘
        │
        ▼
 ┌─────────────┐  刷卡 → Merchant reports 确认；转账 → Bank statements 配对
 │   Receipt    │  确认后 Draft → FORMAL
 └─────────────┘
```

一句话：**SO 收够订金并设 Processing Date → MRP 算缺货 → 下 PO → 收货 GRN（入库）→ 登记 PI（应付）→ 开 DO 送货（出库）→ 从 DO 开 Sales Invoice → 收款 Receipt 对账。**

### 1.3 Sales Order 的状态怎样自动推进

| 状态（代码） | 画面显示 | 怎么进入 |
|---|---|---|
| `DRAFT` | Draft | `Save as Draft` |
| `CONFIRMED` | Submitted | 建单时没有 Processing Date；或草稿 `Confirm` 时没有日期 |
| `IN_PRODUCTION` | In Production | 有 Processing Date（= 已 Proceed） |
| `READY_TO_SHIP` | Ready to Ship | GRN 入库后，SO **所有主产品行**都已有货（自动） |
| `SHIPPED` | Shipped | DO 覆盖了 SO 的**每一行**并已确认（自动） |
| `DELIVERED` | Delivered | DO 已签收；或夜间扫描（02:00）确认 DO 日期已过且已派司机（自动） |
| `INVOICED` | Invoiced | 开了 Sales Invoice |
| `CLOSED` | Closed | 手动 `Close remaining`（剩下的不再追） |
| `CANCELLED` | Cancelled | 取消申请两级批准后 |

依据：`so-lifecycle-guards.ts:62-70`、`so-proceeded-status.ts`、`so-stock-allocation.ts:1172-1190`、`so-delivery-sync.ts:187,394-412`、`deliver-due-shipped.ts`。

- 状态一般**不能往回走**，只有系统自己的回退（例如 DO 取消后 SO 退回 READY_TO_SHIP，缺货后 READY_TO_SHIP 退回 IN_PRODUCTION）。
- **On Hold 不是状态**，只是一个标记，订单状态不变。

---

## 2. 登入与账号

### 2.1 登入门户
1. 打开 `erp.carresofficial.com`。
2. 填 **Email · ID** 和 **Passphrase**。
3. 需要的话勾 **Stay signed in**。
4. 按 **Enter portal**。

登入后自动去到你角色的首页（`apps/web/src/pages/Login.tsx:55-75`）：

| 角色 | 登入后首页 |
|---|---|
| principal（老板） | `/principal`（Admin） |
| operation | `/operation`，默认打开 Sales Orders |
| hr | Team |
| finance | Finance |

### 2.2 忘记密码
1. 登入页点 **Reset →**。
2. 输入 email，按 **Send link**。画面显示 "If an account exists for …, a reset link has been sent."
3. 打开邮件里的链接（`/update-password`），输入新密码两次，**至少 8 个字符**，按 **Save password**。
4. 系统自动登出，用新密码重新登入。链接过期会显示 "This link has expired"，请重新申请。

### 2.3 账号在哪里开
- **Admin › Accounts**（只有 principal 看得到）：
  - 列表栏位：User、Role、Title、Store、Status、Last seen、Created、Actions。
  - 行操作：**Reset password**（设临时密码，至少 8 位，系统**不会寄出**，要自己告诉对方）、**Disable**、**Re-enable**，以及审批 email 变更申请。
  - **+ New account**：后端现在**只允许开 dealer 和 showroom（门店）账号**（`apps/api/src/routes/principal/accounts.ts:110-119`）。要填店名、地址、Outlet name；dealer 还要 SSM code、Contact person、Contact phone，并设第一位店员和 6 位 PIN。
- **员工账号（operation / finance / hr）**：代码注释写「HR Team 是唯一的开户入口」（`/api/hr/team/accounts`），但这个入口在当前代码里已不存在（Carres HR 区已于 2026-11-11 移除）。**【待确认】员工门户账号目前由谁、在哪里开**。
- **Team（Engine 里）** 保存员工的部门、职称、Role、汇报对象和销售 Showroom（见 [第 20 章](#20-team团队)）。Team 里的 **Invite Member** 只开 Engine 账号，**不会**开门户登入。

### 2.4 门户如何带你进 Engine（SSO）
1. 门户确认你的角色是 operation、principal、hr、finance 之一。
2. 门户签发一张 45 秒有效的登入凭证（email + 角色）。
3. Engine 按 email 找账号，没有就自动建一个（`sso.ts:130`）。
4. Engine 页面在门户框里打开。

- 其他角色会看到 "This account does not have access to supply chain."
- **第一次进 Engine 的起始 Role**（`sso.ts:48-84`）：
  - principal → "Owner"（全部权限）
  - hr → "HR"（只能看 Team）
  - operation、finance → "New member"（**没有任何页面权限**），要等老板在 **Team › 成员 › Role** 给权限。
- Engine 里的账号被 Disable，SSO 会回 "Account is disabled"。
- **Engine 里设的密码不是门户密码**，员工平时只用门户密码。

---

## 3. 角色权限

权限有**两层**：

1. **门户菜单（第一层）**：你的门户角色决定左边菜单看得到哪些组（`apps/web/src/pages/portal/portal-nav.ts`）。
2. **Engine 权限（第二层）**：打开 Engine 页面后，每页还要看你在 **Team › Roles & Permissions** 的 Role。没有权限会看到 Forbidden，或数字显示 0 / "—"。

### 3.1 门户角色 → 菜单

| 门户角色 | 看得到的菜单 |
|---|---|
| **principal** | Operations 全部（Workspace、Operations、Supply Chain、Finance、System）＋ **Admin** ＋ **Finance (old)** |
| **operation** | Operations 全部（含 Finance 与 System）；看不到 Admin、Finance (old) |
| **hr** | 只有 System 行（Team、Mail Center、Announcements、IT、Change Log、Assistant、Agent Console、IT Support、OCR）；有授权时另加 Workspace › Payment Requests |
| **finance** | Operations 里只有 **Finance** 各行；另有 **Finance (old)** |
| dealer / salesperson / showroom | 走 POS（`pos.carresofficial.com`），不在本手册范围 |
| supplier / partner / warehouse | 显示 "This portal moved"（这些门户已移除） |

- hr 或 finance 打开不属于自己的网址，会被送回自己的首页（`OperationApp.tsx:22`）。
- **Payment Requests**（Workspace）除了角色，还要有 "payment-requester" 授权（见 [第 8 章](#8-payment-requests)）。

### 3.2 Engine 里的 Role（第二层）
- 在 **Team › Roles & Permissions** 设定（见 [20.6](#206-roles--permissions)）。
- 常见权限钥匙举例（代码中实际使用）：

| 权限 | 管什么 |
|---|---|
| `scm.grn.post` | GRN 可以直接 `Create Goods Receipt`（入库）；没有的人只能存 Draft |
| `scm.po_amendment.create` / `.approve` | 提 / 批 PO Amendment |
| `scm.payment.backdate` | 看 / 批 Payment Backdate Requests |
| `scm.payment_voucher.write` / `.check` / `.approve` / `.cancel` | 付款单 Prepare / Check / Approve / Cancel |
| `scm.warehouse.adjustments` | 库存调整 |
| `scm.stock_take.supervise` | 盘点大差异 Post、代他人 Post |
| `scm.do.revert` | DO `Undo load` / `Undo dispatch` / `Undo delivered` |
| `service_cases.manage` | Service Maintenance、Lead Time |
| `projects.maintenance` | Project Maintenance |
| `users.manage` / `roles.read` | Team 成员管理 / 看角色 |

---

## 4. 手机版

Engine 自带手机版界面（Houzs 手机 App 的同一套），给销售、司机、仓库在手机上用。

### 4.1 怎样打开
- 系统判断「触屏设备 + 屏幕宽度小于 1024px」就显示手机版（`engine/frontend/src/mobile/useIsMobile.ts`）。
- 电脑上可在网址加 `?mobile=1` 预览手机版，加 `?mobile=0` 回到电脑版。
- 可以安装到手机桌面（PWA，名称 "Carres"）：
  - iPhone：Safari → 分享 → 添加到主屏幕。
  - Android：Chrome → 安装应用。
- 登入画面：Email or phone、Password、`Sign in`。
- **【待确认】** 员工能否直接用 Engine 账号在手机登入（平时门户 SSO 不设 Engine 密码）；在门户框里用手机打开时是否显示手机版。

### 4.2 底部菜单
**Orders**、**Service**、中间 **Menu**、**Calendar**、**Profile**。没有权限的按钮显示锁住。Carres 关掉的模块（HR、AutoCount Sync 等）不会出现。

### 4.3 手机开 Sales Order
1. Orders 页按 `+`。
2. 填 Customer、Emergency Contact。
3. Order info：Sale Type、Showroom（规则同电脑版，见 [14.2](#142-sales-orders)）。
4. 只填 Delivery Date 时，系统会自动推算 Processing Date。
5. 有 Processing Date 时，地址第 1 行和邮编必填。
6. `+ Add line` 加产品；布料搜索至少打 2 个字，只列出该型号允许的布色。
7. `+ Add Payment`：每一笔都必须先上传收据。
8. `Save draft` 或 `Create Sales Order`（同样检查 50% 订金）。

右上角 **Scan slip** 可以拍手写单，系统自动生成草稿。

### 4.4 其他手机功能
- **订单详情**：`Edit` / `Request cancel` / `Copy as new`；订单被锁时变成 `Submit Amendment`。
- **Calendar**：看 Projects 日历。
- **司机**：Menu › Last Mile Delivery (Driver)，逐件勾货、拍 POD 照片（**必拍**）、按 `Confirm delivered →`（见 [17.3](#173-last-mile-delivery-driver)）。
- **收货**：Goods Receipt › Scan delivery order，生成收货**草稿**（不直接入库）。
- Inbox、Mail Center、Announcements、IT Support（`Report a problem`）。
- **【待确认】** Punch In / Out 在 Carres 是否可用。

---

## 5. 通用画面操作

Engine 各列表页的操作方式大致相同：

| 动作 | 结果 |
|---|---|
| **单击一行** | 右侧打开快速查看抽屉（Quick view） |
| **双击一行** / `Open` | 打开整页详情 |
| **右键一行** | 行菜单：`Open`、`Edit`、`Copy as new`、打印、转下一张单据、Hold、取消等 |
| 勾选多行 → 打印 | 选 **One combined PDF**（合成一个文件）或 **Separate files** |
| 详情页 `History` | 这张单所有改动记录 |
| 详情页 `Relationship Map` | 上下游单据关系图（SO ↔ PO ↔ GRN ↔ DO ↔ SI） |
| `Transfer from …` / `Transfer to …` | 从上一张单据挑行，生成下一张单据 |
| 表头 | 可排序、可按栏筛选；栏位可自选显示 |

- 保存失败时，系统会**一次列出所有问题**（例如 "Can't save — N to fix"），不用改一个存一次。
- 注意几个**画面用词不一致**的地方（代码本身如此）：
  - GRN / PI：状态徽章显示 "Submitted"，页签显示 "Confirmed"。
  - Sales Invoice：页签 "Sent"，徽章 "Submitted"。
  - DO：数据库 `LOADED` 显示为 **Confirmed**，`DISPATCHED` 显示为 **Loaded**。
  - Unmatched Payments 页标题是 "Payments not matched yet"。

---

# 第二部分 Workspace

## 6. Overview

**用来干嘛 / 谁用：** 每天早上的首页，汇总「今天要处理什么」。所有能进 Operations 的人都能打开（Engine 页面 `/`，`engine/frontend/src/pages/Overview.tsx`）。

**主要画面**
- 顶部问候语："X items need you today · X SLA risks · X pending review"，旁边按钮 **View tasks**。
- 未读公告卡片、团队待办卡片。
- 期间选择器。
- 五个 KPI：Project sales、PO not received、Open Cases、Runs today、Active Projects。
- **Needs you** 列表，标签 To-do / Review / Urgent / Reminder。
- **Project P&L** 卡片。

**常用操作**
1. 看 **Needs you**，点一行进入对应页面处理。
2. 点 **View tasks** 进入 Service Cases 列表。
3. 点 **Project P&L** 进入 Project Overview。

**规则和注意事项**
- 数字读取失败显示 "—"，不是 0。
- 没有对应权限的 KPI 不读取，副标题写 "Procurement only" 或 "Project finance viewers only"。

**和其他模组的关系：** 数据来自 Service Cases、Projects、Procurement、Logistic Overview、Announcements。

---

## 7. Sales Orders（快捷入口）

Workspace 里的 **Sales Orders** 只是快捷方式，和 Supply Chain › Sales › Sales Orders 是同一页。说明见 [14.2](#142-sales-orders)。

---

## 8. Payment Requests

**用来干嘛 / 谁用：** 员工上传账单，请 Finance 付款。Workspace 这一行和 Finance › Money out › Payment requests 打开的是**同一页**（Engine `/scm/payment-requests`）。

**谁看得到这一行**
- 门户角色 operation、principal、hr，并且要有 "payment-requester" 授权（`portal-nav.ts:385-399`）。
- 授权判断：finance 和 principal 永远可以；其他人需要 Finance 或老板在旧 Finance Settings 的 "May ask" 勾选（迁移 `0645`、`0648`、`0687`）。
- **【待确认】** Engine 自己检查的是 `scm.payment_request.create` 权限或销售身份，不读门户授权表，两边是否一致需要实测。

**主要画面（申请人看到的版本）**
- 筛选：All、Waiting for Finance、Processing、Paid、Returned / withdrawn、Official invoice owed · 欠正式单。
- 按钮：**New request**。

**常用操作 · 提申请**
1. 按 **New request**。
2. 按五步填写：
   - **单据 · The bill**（必须附账单）
   - **付给谁 · Pay to**
   - **付多少 · Amount**
   - **用途 · What for**（活动账单必须选 Event）
   - **备注 · Note**
3. 按 **Send to Finance**。
4. 被退回时按 **Fix and send again**，改好后按 **Send again**。
5. Finance 处理前可以 **Withdraw** 撤回。

**规则和注意事项**
- 申请**没有部门审批人**，由 Finance 直接处理（做付款单、做 AP 账单或退回）。真正的审批在付款单的 Check / Approve 两步（`PaymentRequests.tsx:5-23`）。
- 阶段由系统自动判断：Submitted → Finance processing / Booked, not paid yet → Partly paid / Paid → Bank confirmed；另有 Returned、Withdrawn。
- 没附账单不能做付款单；同号同日期的账单显示 "⚠ same bill" 警告但不阻止。

Finance 处理方式见 [19.11](#1911-payment-requests财务处理)。

---

## 9. Workspace（我的任务 / 团队任务）

**用来干嘛 / 谁用：** Carres 自己的页面（不在 Engine 里），一张表列出「我的任务 / 团队任务」。只读，不在这里写资料；每个动作都在原模块完成（`apps/web/src/pages/operation/tasks/WorkspaceTasks.tsx`）。

**主要画面**
- **左栏 Module**：
  - 标题旁 **+ Task** 按钮。
  - 一周日期条（‹ 周 ›）。
  - 模块列表：All modules、Sales Orders、Payment、Staff tasks（带数量）。采购、仓库、物流的任务已移去 Engine，这里不再出现。
- **工具列**：
  - **My Task / Team Work**
  - **To do / Waiting / Done**（带数量）
  - 搜索、导出
- **表格列**：Due（Done 页叫 Done）、Task（第二行是「模块 · 单号」）、Contact、Last contact、Assigned to（只在 Team Work；Done 页叫 Completed by）、Status。
  - Status 例子：X days late、Broken commitment、Asked …、No answer by …、Answer recorded …

**常用操作**
1. 点一行 → 右边打开任务视图，下方有 **Communication** 卡（WhatsApp、Email、Copy message）。
2. 在任务视图里用按钮完成任务；点 ✕ "Back to all tasks" 回列表。
3. **新建内部任务**：
   1. 点 **+ Task**。
   2. 填 **Task name**（必填）、**Description (optional)**。
   3. **For** 选 Me 或同事。
   4. 选 **Due date**（必填）。
   5. 点 **Add task**。
   6. 做完后按 **Mark done**。

**规则和注意事项**
- 内部任务不取代系统自动生成的任务，也不给接收人任何额外权限。
- 选中的任务会写进网址 `?task=`，可以直接把链接发给同事。
- 读取失败出现红条和 **Try again**，数量不会显示成 0。

---

## 10. Leave（请假）

**用来干嘛 / 谁用：** 员工自己记录 MC、紧急假、计划假。所有在职员工可用（`apps/web/src/pages/operation/OperationLeave.tsx`）。

**主要画面**
- **Record leave**（"MC, Emergency leave or Planned leave. It counts at once; no approval."）
- **Leave I recorded for colleagues**（帮同事记过才出现）
- **My leave**：Upcoming / Past

**常用操作**
1. **Leave for** 选 Me 或同事（只有可以替别人记的人才看到）。
2. **Type** 选 MC / Emergency leave / Planned leave。
3. 选 **From**、**Until**。
4. 按类型补资料：
   - MC：可上传 **MC proof (optional)**，最多 3 个文件、每个 10MB，只收 JPG / PNG / WEBP / PDF。
   - Emergency leave：必须填 **Reason**（最多 200 字）。
   - MC、Planned leave：可填 **Note**。
5. 按 **Submit**，看到 "Leave recorded."。

**取消请假**
- 未开始：**Cancel leave**；已开始：**Cancel remaining days**。
- 系统会再问一次，可选 **Keep leave** 放弃。

**规则和注意事项**
- 只按整天算；**不需要审批**，今天的假立即生效，系统安排代班。
- 替同事记的假只有本人能取消；替同事记时不能上传 MC proof。
- 非在职员工看到 "Only active staff can record leave."；功能未开时显示 "Leave is not switched on yet."

**和其他模组的关系：** 代班安排会读请假记录。司机 / 助手的请假另在 Transportation › Crew Leave 记录（见 [17.7](#177-crew-leave)）。

---

# 第三部分 Operations

## 11. Service Cases（售后）

菜单：**Quality Overview**、**Service Cases**、**Service Maintenance**、**My Cases**（Engine `/assr`、`/my-cases`）。

### 11.1 案件阶段（整个模组通用）

| 阶段 | 意思 | 负责 |
|---|---|---|
| Pending Review | New case — first review | Service Admin |
| Pending Solution | Decide fix & assign supplier | Service Admin |
| Under Verification | Inspect & verify the issue | Service Admin |
| Pickup / Return | Customer pickup · supplier pickup · supplier return | Service Admin |
| Pending Item Ready | Repair done — QC check | Service Admin |
| Pending Delivery / Service | Schedule return delivery | Logistic Admin |
| Completed | Closed & rated | System |

- 另有 **Voided — Not Valid**（终止，不在流程线上）。
- Pickup / Return 的子状态：Pending Customer Pickup、Pending Supplier Pickup、Pending Supplier Return。
- 推进按钮依次：Move to Solution → Start Verification → Hand to Supplier → Mark Item Ready → Arrange Delivery → Close Case。

### 11.2 Service Cases 列表

**用来干嘛 / 谁用：** 售后 / 保修案件从头到尾的管理。Service Admin、Operation 使用。

**主要画面**
- 页头 "Service Cases"，按钮 **New Case**。
- 阶段统计卡：点一张筛选该阶段，再点一次清除。
- 视图：**List / Board / Calendar**。Board 按 SLA 分列：Overdue、Due today、Due soon、On track、No SLA。
- 勾选：**My cases**、**Hide completed**、**Archived**。
- 按钮：**Export All**（CSV）、**Sync DO**。
- 主要列：Stage、ASSR No、Date、SO No、Ref No.、DO No、PO、Customer、Salesperson、Priority · Dwell（On track / Slow / Stuck）、Assigned To、Item、Complaint Issue、Resolution、Supplier、Phone、Location，以及 In stage since、Target、Days in stage、Days overdue、Case age。
- 可多选后批量操作。

**常用操作 · 建案**
1. 点 **New Case**。
2. **Sales Order** 栏输入 SO 号、参考号或客户名，按 **Lookup** 或从下拉选。
   - 如果这张单已经有案件，会显示 "This order already has N service case(s)"——建议打开旧案件补充，不要重复建。
3. **Items** 勾选受影响的商品并改数量；找不到可手动输入 Item code。
4. **Issue Description**（必填）。
5. **Issue Category**（必选；选 Other… 要另填）。
6. 可填 Ref No.、Customer Email、Product Category。
7. **Defect Photos / Videos**：最多 5 个文件，每个 5MB。
8. 点 **Create Case**。缺资料会显示 "Still needed: …"。

**案件详情页**
- 页头按钮：
  - **Print**：Customer Copy / Supplier Copy / Office Copy
  - **Portal Link**：生成给客户、供应商、销售的门户链接
  - **Archive** / **Restore**
  - **Close Case**：弹窗 "Close Case — Customer Satisfaction"，填 1–5 星和备注，按 **Confirm Close**
  - Reopen
- 卡片：Workflow（"Change to" 换阶段）、Issue、Product Info、Review、Solution、Resolution、Verification、Pickup / Return、Pending Item Ready、Delivery、Customer、Assigned to、Customer Satisfaction、备注（可设可见范围）、成本追踪。
- **Void**：填原因后按 **Confirm Void**。

**规则和注意事项**
- Close Case 在任何未结案阶段都能按。
- Archive 只是从默认列表隐藏，资料仍在。
- **Sync DO** 和建案面板的「从 AutoCount 拉资料」依赖 AutoCount；Carres 的 Engine 关掉了 AutoCount（`carres/navOnly.ts`），**【待确认】这两个功能在 Carres 是否可用**。

**和其他模组的关系：** 读取 SO、DO、PO、供应商；送回客户由 Delivery 安排；司机在 POD 上 `Report a problem` 也会开案件；问卷和 SLA 邮件由 Settings › Email 控制。

### 11.3 Quality Overview
- **用途：** 管理层看售后表现。
- **画面：** KPI：Opened、Closed、Average to close · 30 days、Ongoing now、Overdue now；区块：Cases coming in and going out、How fast cases move、Time spent in each stage、Where the open cases are、How old the open cases are、Overdue cases、Whose goods come back（Service case rate）、Monthly trend、Service Issue Categories、Resolution Method Mix、Items / Customers with 2 or more cases、CSAT — 13-week rolling。筛选 Company、Supplier、Issue category。
- **规则：** 表现数字跟随所选期间；"open / overdue" 按今天算。点任何数字可钻取到案件清单。

### 11.4 Service Maintenance（含 Lead Time）
- **谁用：** 只有 `service_cases.manage` 权限的人；没有会看到 "Service Maintenance is limited to people who can manage service cases…"。
- **General 页：**
  - **Default Case Assignees**：最多 2 人，第一个主负责、第二个协助。
  - 下拉清单维护：Issue Categories、Priorities、Product Categories、Resolution Methods、Root-Cause Classifications。
- **Lead Time 页**（"Per-priority stage targets in days"）：
  1. 一张「优先级 × 阶段」的表（Review、Solution、Verification、Pickup / Return、Pending Item Ready、Delivery / Service）。
  2. 点格子改天数，按 Enter 或离开格子即保存。
- **关系：** 列表的 Target、Days overdue、SLA 风险都来自这张表。

### 11.5 My Cases
- **用途：** 销售员看自己经手订单的售后案件（`MyCases.tsx`）。
- **画面：** 搜索框 "Search case · SO · customer · issue · item"、阶段筛选、卡片列表；点卡片看 Overview、Customer、Reported issue 和对话。
- **操作：** 写备注按 **Post**；按 **Nudge office** 催办公室（每小时最多一次）。
- **注意：** 案件按「销售员名字」匹配。Engine 里你的名字必须和 SO 上的销售员名字一致，否则看不到。SSO 首次建账号时名字可能被设成 email（`sso.ts:130`），**【待确认】** 需要在 Team 改名。

---

## 12. Projects（项目 / 活动）

菜单：**Project Overview**、**Project List**、**Calendar**、**Project Maintenance**（Engine `/projects`）。

### 12.1 Project Overview
- **用途 / 谁用：** 项目 / 活动的生意总览（Sales、COGS、GP、NP），只给 project finance viewer。
- **画面：** 筛选 Brand、Event type、Organizer、Stage、State、Venue、Event dates；KPI：Sales、Gross profit %、Net profit、Collected；Trend（月 / 季 / 年）、Where each ringgit of sales goes、Breakdown；项目表。
- **规则：** 活动结算前数字取自该活动的 Sales Orders，结算后取账本，每一行都注明来源。

### 12.2 Project List

**主要画面**
- KPI：Live Now、Upcoming (30d)、Overdue Tasks。
- 筛选：Brand、Organizer、状态；开关 **My pending tasks**、**Archived**；按钮 **Export**、**New Project**。
- 列：Code、Project、Brand、Type、Stage、Progress、Start、End、Venue size、Booth、State、Organizer、PIC、Created By；有财务权限另显示 Sales、COGS、GP、GP %、NP、Rental。

**常用操作 · 建项目**
1. 点 **New Project**。
2. **Basics**：选 Event Type（会带出默认 checklist）、`Brand *`。
3. **Dates**：Start、End。
4. **Venue**：选 `Venue *`，`State *` 自动带出；可选 Organizer。
5. 点 **Create Project**。项目名称由 brand、organizer、venue 自动组成；PIC 由 Sales Director 在详情页指定。

**项目详情页**
- 顶部阶段进度：Floorplan → 3D → Stocks Transfer → Driver Info → Setup/Dismantle → Setup Image → Filled Floorplan → Stock In → Done（每步按开始日期倒数 T- 截止日）。
- 区块：Sales、Tasklist、Setup & Dismantle（crew、照片）、Finance Ledger（director 级）、Team、Chat；页头 Print、Archive。

**规则：** Venue 没有设 State 时不能建项目，系统提示去 Project Maintenance → Venues 补上。

**和 Sales Order 的关系（Carres 规则）：** SO 的「Showroom」下拉里有 **Project** 一组，选了项目，这张 SO 就算在这个项目名下（见 [14.2](#142-sales-orders)）。

### 12.3 Calendar
- 月历显示项目和任务；搜索 "Search venue, organizer, brand…"；筛选 Brand、Organizer、状态（Confirmed / Pending / Cancelled）。
- 可显示马来西亚公共假期；点某天看当天全部项目。

### 12.4 Project Maintenance（含 Venues）
- **谁用：** 需要 `projects.maintenance` full 权限。
- **可折叠区块：**
  - **Brands**（可上传 logo，SO PDF 会用）
  - **Event Types**
  - **Organizers**
  - **Contractors**
  - **Venues**：名称、State、City、Postcode、size——**场地在这里维护**
  - **Cost Rates**（只给 finance viewer）
  - **Default Checklist**：按 Event Type 的任务模板（section、任务、T 偏移天数、"Need review"、"Crew can view"）
- **Carres 规则：** Carres 的展厅名「PJ Showroom」保持原名，不会被改成 Houzs/2990 的场地名（2026-11-13 修正，`canonical-venue.ts`）。

---

# 第四部分 Supply Chain

点菜单的 **Supply Chain** 会打开总入口卡片页；每个子模组（Sales Order、Consignment、Procurement、Transportation、Warehouse）点模组名也会打开该模组的卡片页。

## 13. Product Request

菜单有两处：Supply Chain 顶部的 **Product Request**，和 Consignment 下的 **Product Request**，打开同一页（Engine `/scm/product-requests`）。

**用来干嘛 / 谁用：** 申请新产品（New product）或重新包装（Repack）。销售都能提，采购审批（`backend/src/scm/routes/product-requests.ts`）。

**主要画面**
- 按钮 **New request**；可勾选只看自己的申请。
- 列：No.、Type、For、Deliver to、Expected、Lines、Requested by、Status。
- **For** 的选项：Showroom / Customer order / Sample / Fair exhibition。
- 状态：Requested、Approved、Rejected、Withdrawn、PCO_ISSUED、PO_ISSUED、Closed。

**常用操作**
1. 点 **New request**，填申请类型、For、产品行（选现有 SKU 或写新 Model）、Delivery location、Expected delivery date、Special remarks，可附报价单和照片。
2. 点 **Send to the Purchaser**。
3. 采购处理：
   - **Approve**，或 **Reject…**（必须写 "Why it is rejected"）。
   - 新 Model 的行按 **Create Model + SKU**；已有 SKU 用 **Existing SKU** 关联。
   - 每行都有 SKU 后，才能按 **Raise PC Order**（寄售采购单）或 **Raise PO**。
   - 结束按 **Close request**。
4. 被拒的申请，申请人改好后按 **Send again**。

**和其他模组的关系：** 生成 Purchase Consignment Order 或 Purchase Order；新 SKU 进入 Products。

---

## 14. Sales Order 模组

菜单（Supply Chain › Sales）：**Sales Orders**、**Fair Links to Settle**、**Sales Order Amendment**、**Payment Backdate Requests**、**Delivery Orders**、**Sales Invoices**、**Delivery Returns**、**Subscription**。
Delivery Orders 的说明放在 [17.2](#172-delivery-orders送货单)。

### 14.1 Sales Order 入口页
卡片列出以上各子页。销售员（sales rep）看不到这一组卡片，只看到自己的 Sales Orders。

### 14.2 Sales Orders

**用来干嘛 / 谁用：** 全部客户订单，从草稿到送达。Office 和销售都用；销售员只看得到自己的单。

**列表画面**（`MfgSalesOrdersListV2.tsx`）
- 主按钮 **New Sales Order**，下拉：**New from quotation**（逐步引导开单，主要用于配沙发）、Duplicate（只有 director 看得到）。
- 次按钮：**Scan Order**；有权限的人还有 **SO Maintenance**。
- 状态页签：All / Draft / Submitted / In Production / Ready to Ship / Delivered / Invoiced / Closed / On Hold / Cancelled。
- 栏位可自选，例如 Ref No.、Status、Phone、Address、Payment Method、Paid、Deposit、DO No.、Stock Status、**Sale Type**。
- **右键菜单**：`Open`、`Edit`、`Copy as new`、打印、`Transfer to Delivery Order`（非草稿且有送货权限）、`Confirm`（只限草稿）、`Put On Hold` / `Take Off Hold`、`Close remaining`、`Reopen`、`Discard draft`（只限草稿，整张删除，不占单号）、`Request cancellation`。

**常用操作 · 新建 SO**（`SalesOrderNew.tsx`）
1. 点 **New Sales Order**。
2. **Customer**：`Customer Name *`、`Phone *`、Email、Customer Type、Salesperson、Ref No.。
3. **Order Info**：
   - `Building Type`。
   - **`Sale Type`**（Carres 规则）：**Outright**（默认）或 **Subscription**。其他值后端拒绝（`shared/so-sale-type.ts`）。
   - **`Showroom`**（Carres 规则，取代 Houzs 的 Fair）：下拉分 **Showroom** 和 **Project** 两组（`carres/SalePlacePicker.tsx`、`carres/salePlace.ts`）：
     - 新单**自动带出销售员本人的 Showroom**（在 Team › 成员 › Sales venue › Showroom 设定）。
     - 换 Salesperson 时 Showroom 跟着换——但你已经手动选过就不会再变。
     - 销售员没设 Showroom 时这里是空的，**保存前必须选一个**。
   - `Processing Date`、`Delivery Date`、`Note`（内部备注）。
4. **Emergency Contact**、**Delivery Address**（地址第 1 行、**Postcode**、州）。
5. **Line Items**：`+ Add line item`，选 SKU，填变体（布料、尺寸、脚高等）、数量、价格；可加运费行 TRANSPORTATION CHARGES。
6. **Payments**：加付款行，**每一行都要附收据**；付款日期只能在「今天往前 14 天」到「今天」之间。
7. 按 **Create Sales Order** 或 **Save as Draft**。有问题会显示 "Can't save — N to fix"，点开看全部问题。

**详情页按钮**（`SalesOrderDetailV2.tsx`）
- `History`、`Relationship Map`、`Copy as new`、`Print PDF`。
- **`Collect payment`**：只记一笔付款（草稿、已取消、迁移单不显示）。
- **`Create Invoice`**：只在 Submitted 且没有任何 DO / SI 时出现，用于只收费、不送货的单。
- `Discard draft`（草稿）或 `Request cancellation`（其他状态）。
- `Add line`。
- **`Edit`**：订单被锁时变成 `Submit SO Amendment` 或 `View amendment`（见 14.4）。

**常用操作 · Confirm 草稿**
- 必须有 Salesperson、**Showroom 或 Project**，每行都是真实 SKU、变体选齐（布料颜色 KIV 不挡 Confirm）。
- 没选 Showroom 时提示："Pick the showroom this order was sold from, or a project."（`carres-sale-place.ts:58`）

**常用操作 · Proceed（设 Processing Date）**
- 系统里「设 Processing Date」就等于 **Proceed**，没有两步（`order-rules.ts:45-52`）。
- 设了 Processing Date，SO 变 **In Production**，并放行给采购（MRP 开始计入）。

**常用操作 · 取消**
1. 点 `Request cancellation`，填原因。
2. 等两级批准（Level 1、Level 2），批准人在 Sales Order Amendment / Cancellation Requests 页处理。
3. 最后一级按 `Approve & cancel` 立即取消；批准后也可以按 `Cancel now`。

**规则和注意事项**

| 规则 | 依据 |
|---|---|
| **Carres 规则：已收款不到订单总额 50%，不能设 Processing Date / 不能 Proceed。** 提示："Deposit RM… of RM… needed (50%) before a Processing Date can be set"。适用于新建、改表头、草稿带日期 Confirm、改成 In Production、批准 Amendment。总额 0 的单不挡；同一次保存新加的付款也算进去；付款读不到时一律拒绝 | `scm/lib/carres-deposit-gate.ts` |
| 设 Processing Date / Proceed 前必须有：客户名、地址第 1 行、**Postcode**、Delivery Date（Email 不要求） | `shared/so-save-problems.ts:98-103`、`order-rules.ts` |
| Processing Date 和 Delivery Date 要么都填、要么都不填；Processing Date 不能晚于 Delivery Date | `so-save-problems.ts` |
| 新填或改动的日期不能早于今天（原有、这次没改的旧日期不检查） | `so-save-problems.ts` |
| 变体只在有 Processing Date 时必填；布料颜色还是 KIV 时不能设 Processing Date | `so-save-problems.ts` |
| **Carres 规则：** Confirm / 建正式单必须有 Showroom 或 Project | `carres-sale-place.ts` |
| 草稿不能收款；多收（超过订单总额）是允许的 | `SalesOrderDetailV2.tsx` |
| 已有 DO / SI 的单不能取消；非迁移单取消后是最终状态，要重做只能开新单 | `mfg-sales-orders.ts:5203-5221` |
| CLOSED 不能改回；Hold 只是标记（不是状态） | `use-hold-action.ts` |
| 取消后订金转为客户 credit，库存释放 | `mfg-sales-orders.ts:5194-5201` |
| AutoCount 迁移过来的旧单只能看，菜单只剩 `Open`、`Copy as new`、打印 | `so-detail-gates.ts` |

**和其他模组的关系：** Processing Date → MRP / PO；GRN 入库后自动 Ready to Ship；往下 DO → SI → Delivery Return；付款记在 SO 上并自动生成 Official receipt（见 [19.3](#193-receipts)）。

### 14.3 Fair Links to Settle
- **用途：** Houzs 用来处理「没挂到展会」的订单（分组：Pick one、Brand has no booth、Waiting for the fair、Marked No fair、Keyed before the fair picker、To check — venue differs、Waiting for Sales Attending）。
- **画面：** 列 SO No.、SO date、Venue、Brand、Amount、Fair；每行有 Fair 下拉、Link、Put aside；放到一边的可 `Bring back`。
- **Carres 注意：** Carres 不办展会。Showroom 单在系统里存为 "No fair"，所以**所有 Showroom 单都会出现在 "Marked No fair" 组**（`carres-sale-place.ts:9-10`、`fair-pending.ts:32,62`）。这一页 Carres 平时不需要处理。**【待确认】是否隐藏这个菜单。**

### 14.4 Sales Order Amendment（改单）

**用来干嘛：** 订单被锁之后，改单要走申请和审批；取消申请也在这个列表。

**什么时候会锁**（`mfg-sales-orders.ts:1698-1724`）：Processing Date 已到或已有 PO，且还没被 DO / SI 完全锁住，且状态不是 Shipped / Delivered / Invoiced / Closed / Cancelled。

**主要画面**
- 状态筛选：Requested / Approved / Rejected / All。
- 列：Amendment No.、SO No.、Ref No.、Type、Approver、Reason、Requested by、Status、Approval Remarks、Created、Actions。
- 取消申请行上直接操作：`Approve…` / `Approve & cancel` / `Cancel now` / `Reject` / `Withdraw`。

**常用操作**
1. SO 详情页点 **Submit SO Amendment**。
2. 改内容，**填原因（必填）**。
3. 系统按改动类型自动拆单，分给不同的人批（`shared/amendment-lane.ts`）：
   - **LINES（产品行、Processing Date）→ 采购批**；批准后会自动生成 PO Amendment。
   - **DELIVERY（送货日期、地址、服务费行）→ Logistics 批**。
   - **PRICE（只改单价 / 折扣）→ Sales Director 批**。
4. 批准人打开详情：`Approve product changes` / `Approve delivery changes` / `Approve price change` → 弹窗 `Approve & apply`（立即生效，不能撤回）。
5. 其他按钮：`Reject amendment`、`Withdraw request`（申请人）、`Print amendment`；**`Purchaser OK`**：送货日期提前而 PO 还没收齐时，要采购先按，Logistics 才能批。

**规则**
- 同一类改单同一时间只能有一张在等（`amendment_already_open`）。
- 日期规则同 SO；已有 DO / SI 时客户、地址类字段不能改。
- 批准时同样检查 **50% 订金**。

### 14.5 Payment Backdate Requests
- **用途：** 收据日期早于 14 天前的付款不能直接记，要提申请。只有 `scm.payment.backdate` 权限的人能看、能批。
- **画面：** 筛选 Open / All；列 Sales Order、Slip Date、Amount、Method、Requested by、Reason、Status、Decided、Requested、Actions；每行 `Approve` / `Reject`。
- **规则**（`shared/payment-slip-date.ts`）：
  - 可直接记的日期范围：今天往前 14 天 ~ 今天。
  - 未来日期一律拒绝（不能申请）。
  - 批准前，这笔钱不算进订单已付金额（所以也不算进 50% 订金）。
  - 申请人可以自己撤回。

### 14.6 Sales Invoices

**用来干嘛：** 开给客户的发票，开票即记收入（Dr Accounts Receivable / Cr Sales Revenue）。

**主要画面**
- 按钮：**Transfer from Delivery Order**、**New Sales Invoice**；次按钮 Delivery Orders、Outstanding Ledger。
- 页签：All / Draft / Sent / Partial / Paid / Cancelled。
- 列：SI No.、Date、Due、Source PO、Customer、Ref No.、SO deposit、Paid、Outstanding 等（成本、毛利列需要权限）。

**常用操作 · 从 DO 开发票**
1. 点 **Transfer from Delivery Order**，进入 "Pick Delivery Order lines to invoice"。
2. 勾选要开票的行，填 **Qty to Invoice**（列：DO No、Customer、Item Code、Delivered、Invoiced、Remaining、Qty to Invoice）。
3. 点 **Continue with N lines**。
4. 在预填好的表单按 **Create Sales Invoice**（或 Save as Draft）。
5. 不送货的单：在 SO 详情按 `Create Invoice`。

另外，DO 详情页的主按钮 **Transfer to Sales Invoice** 也是同一流程。

**规则**（`routes/sales-invoices.ts`）
- DO 只要不是 Draft / Cancelled 就可以开票。
- 一张发票只能一个客户；开票数量不能超过 DO 剩余可开数量（`over_remaining`）。
- 一张 SO 只能有一张有效发票（`so_already_invoiced`）。
- Draft 只能变成 Sent（已出）或取消；已出不能退回草稿、不能改行（要先取消再重开）；已取消只能重开成 Sent。
- 草稿发票不能收款。
- 发票金额会自动扣掉 SO 已收订金（"deposit applied"，见 [19.4](#194-invoices)）。

### 14.7 Delivery Returns
- **用途：** 客户退回已送达的货，保存即加回库存。销售员看不到。
- **画面：** 按钮 **Transfer from Delivery Order**、**New Delivery Return**；页签 All / Open / Inspected / Refunded / Cancelled；状态 Pending、Received、Inspected、Refunded、Credit noted、Rejected、Cancelled；详情页有 **Create credit note**。
- **规则：** 每行退货都必须对应一张 DO 的行（`do_link_required`）；不能超过可退数量；一张退货单只能一个客户；已取消的不能重开。
- **关系：** DO → Delivery Return → Credit note（Finance）。

### 14.8 Subscription（Carres 自有页面）
- 菜单 Sales › **Subscription** 打开门户自己的 **Rental** 页（`apps/web/src/pages/operation/OperationRental.tsx`），不在 Engine。
- **画面：** 两个数字 Active agreements、Units in rental；Agreements 表（Agreement、Customer、SKU、Monthly、Start、Status、Money），状态 Awaiting approval / Rejected / Active / Buyout / Completed / Owned / Defaulted / Repossessed / Cancelled；Units 表（Unit、SKU、Status、Deployed、Warranty until、Agreement）；按 **Collections** 看每月账单（`Record transfer`、`Charge interest` / `Update interest`、`Settle early`——提前结清必须附文件）。
- **现状：** 代码注明此页**尚未启用**，没有流程写入这些表，所以是空的。SO 上选 Sale Type = Subscription **不会**自动生成租约；订阅计费**尚未建置**（commit `e1ae7a245`）。**【待确认】订阅单的实际操作流程。**

---

## 15. Consignment（寄售）

两条流程，寄售货不开 Sales Invoice：

```
对客户 / 展厅：  Consignment Order (CS-) → Consignment Note (CN-) → Consignment Return (CRN-)
对供应商：      Purchase Consignment Order (PCO-) → Receive (PCR-) → Return (PCT-)
```

入口：Supply Chain › Consignment（销售员看不到）。

### 15.1 Consignment Order
- **用途：** 寄售订单，**不动库存**。
- **操作：** 新建填 Customer、Order Info、Emergency Contact、Delivery Address、Line Items → **Create Consignment Order**（状态直接 CONFIRMED）。右键：`Create Consignment Note`、`Copy to new Consignment Order`、`Cancel Order`、`Reopen SO`。
- **规则：** 客户名、电话必填；日期规则同 SO；沙发不能和其他主产品放同一张单；已有 CN 时不能改行、不能取消。`Delete permanently` 实际未实现。

### 15.2 Consignment Note
- **用途：** 寄售货真正送出时开，**开单即扣库存**，取消会加回。
- **操作：** 整张 CO 转，或用 `Transfer from Consignment Order` 按行挑。一张 CN 只能一个客户。
- **注意：** 新建后状态是 DISPATCHED，画面显示 "Loaded"；界面没有推进到 Delivered 的按钮。已有退货时不能取消。`Reopen` 对已取消的 CN 会被拒（`note_cancelled_final`）。

### 15.3 Consignment Return
- **用途：** 寄售货退回仓库，记入库。挑行时选 Condition：NEW / OPENED / DAMAGED / DEFECTIVE。新建后状态 RECEIVED。
- **规则：** 不能超过剩余可退数量；已取消的不能重开（`Reopen` 按了会报错）。

### 15.4 Purchase Consignment Order
- **用途：** 向供应商下寄售订单，不动库存。可以从 Product Request 生成。
- **状态：** SUBMITTED → PARTIALLY_RECEIVED / RECEIVED（按收货自动更新）→ CANCELLED。
- **规则：** 取消必须填 `Why it is cancelled`；已收货或有收货单时不能取消。

### 15.5 Purchase Consignment Receive
- 在 PCO 上按 **Receive Goods**，保存即入库，状态 POSTED。不能超收；已有退货单时不能取消。

### 15.6 Purchase Consignment Return
- 在 PCR 上按 **Raise Return**，保存即出库。不能超退。**【待确认】** COMPLETED 状态的操作。

---

## 16. Procurement（采购）

菜单（Supply Chain › Procurement）：**Procurement Overview**、**Products & Maintenance**、**Suppliers**、**MRP · Stock Status**、**Purchase Orders**、**PO Amendments**、**Cancellation Requests**、**Goods Receipt**、**Purchase Invoices**、**Purchase Returns**。

```
SO（有 Processing Date）→ MRP → Proceed PO → PO → Transfer to Goods Received → GRN（Post 入库）
                                                  → Transfer to Purchase Invoice → PI → Payment voucher
                                                  → Transfer to Purchase Return → PR（退货出库）
```

### 16.1 Procurement Overview
- **用途：** 采购主管总览（取代以前的 PO CHASING LIST），只能看。
- **画面：** 期间（本月 / 本季 / 本年 / 指定月）；`By category` / `By supplier`；筛选 Category、Supplier、Locations；指标 `POs`、`Overdue`、`Total outstanding`、`Not yet due`；卡片 `Which supplier delays most`、`Lead time`（`Supplier takes · average`、`On time`、`Late by · average`、`MRP setting`、`Suggested` 等）、`Excess stock · dead and buffer`（库龄 90 天 / 91–180 / 181–365 / 超过一年）。
- **操作：** 选期间 → 切视图 → 点数字看明细（PO、金额、迟到天数）。
- **规则：** 数字跟随期间；供应商评分永远只看最近 90 天。

### 16.2 Products & Maintenance（产品主档）

**页签**（`Products.tsx`）：**SKU Master** · **Modular** · **Maintenance** · **Combo Pricing** · **Variants** · **Fabric Converter** · **Categories**。

**SKU Master**
- 类别页签（All + 各类别）；价位 `P1` / `P2` / `P3 (HL)` / `P4 (FL)`；可筛选「还没绑定供应商的 SKU」。
- 按钮：`Export SKUs`、`Import SKUs`、`Merge codes`、`New SKU`、`Edit Prices` → `Save (n)` / `Cancel`；勾选后 `Set inactive (n)` / `Set active`。
- 列：`Product Code`、`Description`、`Model`、`Branding`、`Size`、`Price`、`Category`、`Price 1/2`、`Unit (m³)` 等。

**常用操作**
- 改价：`Edit Prices` → 在表格直接改 → `Save (n)`。
- 新增 SKU：`New SKU` → 抽屉里先选 `Category *` → 填资料 → 提交。
- 合并重复代码：`Merge codes`。

**Maintenance**：维护规格选项——
- Bedframe：Divan Heights、Total Heights、Gaps、Leg Heights、Specials
- Sofa：Sizes、Leg Heights、Specials
- Common：Fabrics
- Products Maintenance：Bedframe Sizes、Mattress Sizes、Sofa Compartments、Brandings、Supplier Categories（留空 = 默认五类）

**Combo Pricing / Variants / Fabric Converter / Categories**：分别维护沙发组合价、变体、供应商布料代码对照、产品类别。**【待确认】** 这几页的详细校验规则。

**规则和关系：** Maintenance 的选项会出现在 SO、PO、GRN 的规格下拉里；SKU 是 SO / PO / GRN 每一行的基础；供应商绑定在 Suppliers 页设定。

### 16.3 Suppliers

**列表**
- 页签 `All/Active/Inactive/Blocked`；筛选 `All supply categories`；搜索 "Search by code / name / contact…"。
- 列：`Code`、`Name`、`Supply Category`、`Contact`、`Phone`、`State`、`Payment Terms`、`Status`。
- 按钮：`New Supplier`、`Batch edit (n)`（只能批量改 Payment Terms 和 Status）。

**供应商详情页签**：`Overview`（On-Time Rate、Defect Rate、Avg Lead Days、Last 10 Purchase Orders）、`SKU Pricing`、`Maintenance`、`Combo Pricing`（沙发类供应商）、`Fabric Converter`（Sofa / Bedframe / Mixed 供应商）、`Lead Times`。

**常用操作 · 绑定 SKU**
1. 打开供应商 → `SKU Pricing`。
2. 按 `Add SKU Mappings`。
3. 填 Supplier SKU、Unit price；需要时设为 main supplier（星号 `Set as main`）。
4. 保存。也可用 `Import Bindings` / `Export Bindings` 批量处理。

**规则**
- **同一个 SKU 只能有一个 Main supplier**；设新的 main，旧的自动取消（`routes/suppliers.ts:843-851`）。
- 重复绑定会被拒（`duplicate_binding`）。
- **Lead Times 页**：按「供应商 × 类别」设提前几天下单，**优先于** MRP 的类别默认值；留空 = 用默认；0 = 当天下单。

**关系：** Main supplier 决定 MRP / PO 默认供应商；绑定价格用于 PO 自动定价。

### 16.4 MRP · Stock Status

**用来干嘛：** 算出「还要买多少」，一键生成 PO。采购每天使用。

**主要画面**
- 页头 `MRP · Stock Status Report`。
- 类别页签：`Sofa` · `Bedframe` · `Mattress` · `Accessories` · `Others`。
- 工具栏：模式 `Combined`（一家供应商一张 PO）/ `Per SO`（一张 SO 一张 PO）；`Collapse` / `Expand`；**`Regenerate`**（旁边显示「as of 时间」）；`Lead Times`；`Re-bind WH`（管理员）。
- 筛选：`Date`（Delivery date / Order-by date / Processing date / SO date，加 From–To、`Clear window`）、`Show no-date`、`Only shortages`、`Warehouse`。
- SKU 行列：`Sales Order`、`Description`、`Qty Needed`、`Stock`、`PO Outstanding`、`Shortage`、`Processing Date`、`SO Date`、`Delivery Date`。
- 展开的 SO 行：`SO No`、`Warehouse`、`Customer`、`State`、`Processing Date`、`Delivery Date`、`Qty`、`Coverage`（`stock` / PO 号含 ETA / `SHORT ×n`）、`Supplier`。
- 主按钮：**`Proceed PO (n)`**。

**常用操作 · 从 MRP 下 PO**
1. **先按 `Regenerate`**，确保计划是最新的。
2. 选类别，可开 `Only shortages`。
3. 勾选要下单的行（或用日期窗口一次处理）。
4. 需要时在 `Supplier` 下拉换供应商（默认是 main，带 ★）。
5. 按 **`Proceed PO`**；弹窗可填 `Expected Delivery`（留空 = 用每张 SO 自己的日期）→ `Confirm`。
6. 成功后选 `Open Purchase Orders` 或 `Stay here`。

**弹窗：** `Proceed PO`、`Use more than one supplier?`（沙发分两家时，按 `Yes, proceed`）、`Lead Times`（Warehouse / Global Defaults）、`Nothing to order`。

**规则和注意事项**
- **只计入已 Proceed 的 SO**：SO 没有 Processing Date 就不算需求（「没有 Processing date 的单子就不进来」，`routes/mrp.ts:671-688`）。On Hold、已结束、已取消行也不计入。所以 **SO 要先收够 50% 订金并设 Processing Date**，MRP 才会出现。
- **默认画面读的是存储的快照**：系统约每 15 分钟自动刷新；**按 `Regenerate` 立即重算**（`mrp.ts:1934-1949`、`lib/mrp-snapshot.ts`）。刚 Proceed 的 SO 没出现时，先按 Regenerate。
- 用了类别 / 仓库 / 无日期筛选的视图是即时计算。
- Proceed 后页面自动重算；计划已过期时服务器拒绝（`mrp_plan_stale`），避免重复下单。
- Draft PO 不算供应。
- 生成的 PO 默认 `SUBMITTED`；没有仓库时强制 `DRAFT`。

### 16.5 Purchase Orders

**主要画面**
- 页签：`All` · `Outstanding`（Submitted + Partial）· `Draft` · `Submitted` · `Partial` · `Received` · `Cancelled` · `On Hold`。
- 统计卡：`Total POs` · `Committed` · `Outstanding` · `Received`。
- 按钮：`Transfer from Sales Order`、`New Purchase Order`（下拉 From SO / Import / Duplicate）、`Suppliers`、`Goods Received`。
- 默认列（同 AutoCount）：`Doc No`、`Creditor Code`、`Creditor Name`、`Doc Date`、`Expected`、`Purchase Location`、`Currency`、`Assigned SO`、`GRN No`、`GRN Date`、`Delivered`、`Status`、`Total`。
- 右键：`Open` / `Edit` / `Copy as new` / 打印 / `Transfer to Goods Received` / `Put On Hold`、`Take Off Hold` / 取消。

**常用操作**
- **从 SO 下单**：`Transfer from Sales Order` → 勾 SO 行（可改 `Pick Qty`，有 `Main Supplier` 列）→ `Add n lines to PO` → 新建表单。
- **手动新建**：`New Purchase Order` → 填 `Creditor *`、`Date *`、**`Purchase Location *`**、明细 → `Create Purchase Order`（直接 Submitted）或 `Save as Draft`。
- **详情页按钮**：`Confirm PO`（Draft → Submitted）、`Send to supplier`（发邮件）、`Transfer to Goods Received`、`Raise amendment`、`Raise Return`（部分/全部收货后）、`Add line`、`Edit`、`Cancel PO`、`Reopen`、`Print PDF`、`History`、`Relationship Map`、`Copy as new`。

**规则和注意事项**
- **从 MRP 下单选的是 SKU 的 main supplier**。优先顺序：行上手动选的供应商 > 指定覆盖 > main 绑定 > 第一个有效绑定（`routes/mfg-purchase-orders.ts:1776-1830`）。没有绑定的 SKU 也能下单，价格到 PI 时再填。
- 下 PO 时 SO 必须是已确认的订单。
- Confirm 前必须有沙发 / 床架的核心规格和收货仓库；只有 Draft 能 Confirm。
- `Send to supplier`：Draft / Cancelled 不能发，且邮件渠道要开启（Settings › Email）。
- **取消不需要审批**，但必须写原因（至少 5 个字）。已 Received 的不能取消；有未取消的 GRN 要先取消 GRN。（右键菜单写 "Request cancellation"，实际是直接取消。）
- `Reopen` 只用于 Cancelled 的 PO。
- On Hold 的 PO 不能收货。
- 收货后状态由 GRN 自动计算：全收 = Received，部分 = Partially Received。

### 16.6 PO Amendments
- **用途：** 修改已确认的 PO，一层审批。列表同时包含直接的 PO 修改，和 SO Amendment 连带生成的 PO 修改。
- **画面：** 筛选 Requested / Approved / Rejected / All；列 `Approver`、`Requested by`、`Reason`、`Status`、`Created`。
- **操作：**
  1. PO 详情页 → `Raise amendment`。
  2. 改 Qty、`Unit cost (RM)`、`Delivery date`、`Notes`，填 `Reason (optional)` → 提交。
  3. 审批人按 `Approve amendment`（SO 连带的显示 `Confirm PO revision`）或 `Reject amendment`。
  4. 提出人可按 `Withdraw this request`。
- **规则：** 提出要 `scm.po_amendment.create`，批准要 `scm.po_amendment.approve`；一张 PO 同时只能有一个进行中的修改；Cancelled 的 PO 不能改；批准后旧版存档、revision +1、打印单号加 `_R`，**不能撤销**；数量不能改到低于已收货数量。

### 16.7 Cancellation Requests
- **用途：** SO 和 PO 共用的取消申请收件箱。
- **画面：** 筛选 `Open` / `All`；列 `Document`、`Ref No.`、`Requested by`、`Reason`、`Status`、`Level 1 / Approval`、`Level 2`、`Approval Remarks`、`Requested`、`Actions`。
- **操作：** 打开 Open → 看原因 → 批准或 `Reject`；已 APPROVED 但取消没执行成功时按 `Cancel now` 重试。
- **规则：** 申请状态 REQUESTED → L1_APPROVED → APPROVED → EXECUTED（另有 REJECTED / WITHDRAWN）。**SO 要两层签核；PO、DO 是 0 层**（所以 PO 在这里只是已取消的记录）。

### 16.8 Goods Receipt（GRN 收货）

**主要画面**
- 列表页签 `All` / `Draft` / `Confirmed` / `Cancelled` / `On Hold`；统计卡 `Total GRNs`、`Received Value`、`Awaiting PI`、`Draft`。
- 按钮：`Transfer from Purchase Order`、`New GRN`、`Scan Delivery Order`、`Purchase Orders`、`Suppliers`。
- 新建表单：`Receive against PO`（或 `— Manual receipt (no PO) —`）、`Supplier *`、`Received Date`、`Delivery Note Ref`、`Notes`、`Charge allocation`（By quantity / By value / By volume (CBM)）；每行 `Outstanding`、`Received`、`Rack`。
- 详情页：`Post`、`Transfer to Purchase Invoice`、`Transfer to Purchase Return`、`Add line`、`Edit`、`Cancel GRN`、`Print PDF`、`History`、`Relationship Map`。

**常用操作**
1. PO 列表 / 详情按 `Transfer to Goods Received`，或 GRN 页按 `Transfer from Purchase Order`。
2. 勾选 PO 行（单张 PO 自动带出未收数量）→ `Add n lines to GRN`。
3. 核对数量和 Rack。
4. 按 **`Create Goods Receipt`**（马上入库），或先 `Save as Draft`，之后在详情页按 **`Post`**。
5. 分到多个货架：Draft 编辑模式下，Rack 栏 "Add a rack" → 填数量 → `Add`。

**规则和注意事项**
- **Post 才入库**：状态变 POSTED，按收货日期写库存 IN（用 accepted 数量），重新计算 PO 已收数量和状态，运费等服务行按所选方式分摊进成本（`routes/grns.ts:401-579`）。服务行不进库存。
- **SO 自动变 READY_TO_SHIP（有条件）**：Post 后系统重新分配库存，只有 SO **所有主产品行都有货**、且状态是 Submitted 或 In Production，才自动变 Ready to Ship；之后如果缺货会退回 In Production（`lib/so-stock-allocation.ts:1172-1190`）。
- 没有 `scm.grn.post` 权限的人只能存 Draft。
- 只能收 Submitted / Partially Received 的 PO（Hold 不行）；**不能超收**（`qty_exceeds_remaining`）。
- 一张 GRN 只能收进一个仓库。
- 单价为 0 可能被零成本检查拦下。
- 拆货架只能在 Draft 做；库存已被下游用掉的 GRN 不能取消。
- 只有 POSTED 且没 Hold 的 GRN 才能开 PI 或 PR。

### 16.9 Purchase Invoices（PI）

**主要画面**
- 页签：`All`、`Draft`、`Confirmed`、`Partial`、`Paid`、`Cancelled`、`On Hold`。
- 按钮：`Transfer from Goods Received`、`New Purchase Invoice`、`Scan Invoice`、`Goods Received`、`Suppliers`。
- 列：`Invoice Amount`、`PO No`、`PO Amount`、`Due`、`Source`、`Assigned SO`、`Delivered`、`Status`、`Owed`、`vs PO price` 等。

**常用操作**
1. `Transfer from Goods Received`，进入 "Bill a Goods-Received Note"。
2. 在 `Outstanding GRN Lines` 勾选、填 `Bill Qty`。
3. `Continue with n lines` → 核对 → 保存。

**规则**
- PI 主要从 GRN 来，也可以**手动新建**（不带 GRN）。
- 批量从 GRN 开：按「供应商 + 币种 + 汇率」分组，一组一张 PI，自动 Post。
- **PI 不动库存**（库存在 GRN 已入）；确认时记 Dr INVENTORY / Cr AP。
- 不能超开；已付款的 PI 不能取消。
- **付款不在这里登记**，到 Finance › Money out › Payment vouchers 开 AP payment（见 [19.9](#199-payment-vouchers)）。

### 16.10 Purchase Returns（退货给供应商）
- **画面：** 页签 `All`、`Draft`、`Confirmed`、`Completed`、`Cancelled`；统计 `Total Returns`、`Credit Value`、`Pending`、`Settled`；新建表单：供应商、**`Reason *`**（Damaged / Wrong colour / Wrong item / Over-supply / Quality not acceptable / Send for repair / Other）、`Remark`、`Items to Return`（`Qty Returned`、`Reason`、`Refund`）。选 Send for repair 时要填 `Repair warehouse *`、`Supplier sends a replacement? *`。
- **操作：**
  1. 从 GRN / PO（`Raise Return`）开始，或 `New Purchase Return`。
  2. 选原因、填数量 → 保存。
  3. 收到供应商 Credit Note 后，详情页按 `Complete`（可填 CN 号）。
- **规则：** 一建立就是 POSTED 并**马上扣库存**（所以 Draft 页签基本是空的）；库存不够会提醒，可确认后继续；Completed 的不能取消。

---

## 17. Transportation（运输）

菜单（Supply Chain › Transportation）：**Logistic Overview**、**Delivery Planning**、**Last Mile Delivery (Driver)**、**DP Orders**、**Last Mile Delivery**（Fleet day）、**Crew Leave**，以及维护组 **Coverage & Fleet**、**Delivery Zones**、**Carriers & Rates**、**Fleet Health**。
**Delivery Orders** 的菜单行在 Sales 组，但内容属于送货，所以写在本章。

### DO 状态对照（培训重点）

| 数据库值 | 画面显示 | 库存 |
|---|---|---|
| DRAFT | Draft | 不扣 |
| **LOADED** | **Confirmed** | **此刻扣库存** |
| **DISPATCHED** | **Loaded** | 不动 |
| IN_TRANSIT | In transit | 不动 |
| SIGNED / DELIVERED | Delivered | 不动 |
| INVOICED | Invoiced | 不动 |
| CANCELLED | Cancelled | 加回 |

依据：`vendor/scm/lib/do-line-export-columns.ts:103-113`、`shared/do-shipped-states.ts:113-118`。

### 17.1 Logistic Overview
- **用途：** 物流主管总览：送了多少、还剩多少、流程哪里有漏洞。只读。
- **画面：** `Deliveries` / `Lorry capacity`；仓库筛选；**Outstanding delivery, by when it is due**（Past delivery date / Within 3 days / 4 – 7 days / 8 – 14 days / 15 – 30 days / After 30 days / No date yet）；Order status breakdown；Monthly delivery volume；**Process gaps**（`DO loaded, never closed as delivered`、`Delivered, still owing after 30 days`、`DO without cost · last 90 days`、`Open orders without a phone number`、`Open delivery orders`）；On-time delivery（On time / Early / Late / Late, not delivered，可按司机、罗厘、地区）。
- **操作：** 选仓库 → 看 Process gaps → 点 `See these orders`；点罗厘打开抽屉看每一单。

### 17.2 Delivery Orders（送货单）

**主要画面**
- KPI：`Total DOs / Revenue / In transit / Delivered`。
- 页签：`All · Draft · Confirmed · Loaded · In transit · Delivered · Invoiced · On Hold · Cancelled`。
- 搜索 "Search DO no, customer, phone, driver, ref…"；日期筛选。
- 列：`Doc No · Doc Date · Transfer From (SO) · Source PO · Invoiced to · Debtor Name · Delivery date · Driver · Ref No. · Status`（另有 Amount、Vehicle、Phone、Address 等可开）。
- 按钮：`Transfer from Sales Order`、`New Delivery Order`（下拉 `New from Sales Order` / `Duplicate last DO`）、`Sales Orders`、`Delivery Planning`；多选可批量下载 PDF。

**常用操作 · 从 SO 开 DO**
1. 点 `Transfer from Sales Order`（标题 "Pick Sales Order lines to deliver"）。
2. 勾 SO 行，在 `Qty to Deliver` 填本次数量（列：SO No · Customer · Item Code · Stock · SO Qty · Delivered · Remaining · Qty to Deliver）。
3. `Continue with N lines`（这一步还没建单，只把行带入表单）。
4. 表单核对：`Customer info`（客户名必填）、`Delivery address`、`Emergency contact`、`Delivery info`（`Pick driver…`、车牌、楼型 `Landed / High-rise (lift) / High-rise (no lift)`）、内部备注、行项目。
5. 按 **`Create Delivery Order`**（直接 Confirmed、**立即扣库存**）或 `Save as Draft`（不扣库存）。
- SO 列表右键 `Transfer to Delivery Order`、Delivery Planning 的 `Transfer N to Delivery Order` 也能开 DO（后者每张 SO 一张 DO，直接 Confirmed）。

**DO 详情页**
- 按钮：`History`、`Relationship Map`、`Print PDF`、`Cancel DO`、`Confirm`（只在 Draft）、**`Transfer to Sales Invoice`**（主按钮；Draft / Cancelled 时灰掉）、`Edit`。
- 主管撤回（要 `scm.do.revert` 权限并填原因）：`Undo load`（Confirmed → Draft，库存退回）、`Undo dispatch`（Loaded → Confirmed）、`Undo delivered`（已有发票、退货或送货问题时拒绝）。
- 卡片：Customer info、Delivery address、Delivery info、Key dates、People、**Proof of delivery**（On the way / Arrived / Delivered 时间、照片、签名）。

**规则和注意事项**
- 一张 DO 只能一个客户（`mixed_customers`）；数量不能超过 SO 剩余（`over_remaining`）。
- 没客户名："Customer name is required."；没行："Add at least one line item before saving."
- SO 行还没 Ready 时系统提醒；库存不足会问 "ship anyway?"（软检查，可继续）。
- **SO 变 SHIPPED 的条件**：这张 DO 覆盖 SO 的**每一行**，且 SO 状态在 Submitted / In Production / Ready to Ship 之内。只覆盖部分行不改 SO 状态。DO 已签收或有实际送达日期时，SO 直接变 **Delivered**（`lib/so-delivery-sync.ts:187,394-412`）。
- **SHIPPED → DELIVERED（夜间）**：每天 02:00 扫描，SO 已 Shipped、DO 日期已过、已派司机，三条都满足就变 Delivered（`lib/deliver-due-shipped.ts`）。
- 取消 DO 加回库存、必须填原因；Cancelled 是最终状态，不能重开，要重开新 DO。取消后 SO 不再全覆盖时自动退回 Ready to Ship。
- 确认 DO 时，按 Settings › Email 的设定给客户发 DO 邮件。

**DO 扫码（`/scm/do-load` 与 DO 纸上的二维码）**——每扫一次只推进一步：

| 当前状态 | 按钮 | 推进到 |
|---|---|---|
| Draft | `Confirm loading` | Confirmed（扣库存） |
| Confirmed | `Confirm Loaded` | Loaded |
| Loaded | `Confirm Departure` | In transit |
| In transit | `Confirm Delivered` | Delivered |

- 公开扫码页 `/d/<token>` **不用登入**，只显示 DO 号、客户名、地区、行数和状态，不显示价格、地址、电话；它的 `Confirm Delivered` 不收集签名照片，正式签收请走 POD。
- `/d/scan` 可以连扫一叠同状态的 DO 一次确认（不提供 Draft → Confirmed 这一步）。

**和其他模组的关系：** SO → DO → Sales Invoice / Delivery Return；Logistic Overview、Service Case 读 DO。

### 17.3 Last Mile Delivery (Driver)
- **用途：** 司机的行程表（手机宽度），只列登入者自己的工作。
- **画面：** `Today / Tomorrow / History`；每站 `Mark arrived`、`Create DO`（这站还没 DO 时）。
- **签收（POD）步骤**（`mobile/MobilePOD.tsx`）：
  1. 逐项勾 "Tick each item as it comes off the lorry"。
  2. 拍 `Delivery photos`（**必拍**；签好的送货单照片也可以）。
  3. 可选 `Customer signature`、`Capture GPS`。
  4. 按 `Confirm delivered →`。
  5. 有问题：`Report a problem` → `Confirm delivered with issue →`，系统自动开售后案件。
- 签收后自动跳到下一站。

### 17.4 Delivery Planning
- **用途：** 调度员排车看板，列出所有没送完的 SO 和 DP 工作单。
- **画面：** 状态 `Pending Delivery / Pending Schedule / Overdue / Delivered`；地区 `All · KL/SEL · Northern · Southern · East Coast · East Malaysia`；列 `Job Type · SO No. · Customer Name · Salesperson · Phone · Send Status · POD · Address · State · SO Date · Processing Date · Delivery Date · Customer Request Date · Stock · Delivery Message Status`（东马 / 新加坡另有 Ship-out Date、ETA Port、Consignment No）；按钮 `Send Message (N)`、`New DP Order`、`Manage regions`。
- **常用操作：**
  1. 选地区和状态。
  2. 勾订单 → `Actions` → `Schedule`，在抽屉设 `Trip date`、`Driver`、`Lorry`，可用建议路线、拖动排序。
  3. 勾订单 → `Transfer N to Delivery Order`（每张 SO 一张 DO，直接 Confirmed 并扣库存）。
  4. `Send Message` 选 WhatsApp 模板：`Postpone`、`Driver Info`、`Balance Reminder`、`Reminder 1/2/3`、`Postage Confirm`、`Delivery Completed` 等。
  5. 右键：`Move to Pending Schedule`、`Back to Pending Delivery`、`Edit HC fields…`、`Send WhatsApp…`、`Transfer to Delivery Order`、`Open Sales Order`、`Mark colour…`。
- **状态怎么算**（`routes/delivery-planning.ts`）：已送达 → Delivered；全部主行 Ready → Pending Schedule；未 Ready 且已到 / 过了日期 → Overdue；其他 → Pending Delivery。人工改过的状态优先（但「已送达」最优先）。
- 排期只写「改后送货日期」，**永不覆盖客户原日期**。

### 17.5 DP Orders
- **用途：** 所有 DP 工作单（非 SO 的运输任务）总登记表。
- **画面：** 筛选 `Pending Schedule / Scheduled / Completed / Cancelled`；列 `DP No · Status · Type · From · To (Party) · Contact · Phone · Requested · Processing Date · Source · Total Amount · Trip`；按钮 `New DP order`；右键 `Edit… / Schedule… / Cancel job`。
- **类型：** `Delivery / Pickup / Service / Setup / Dismantle / Supplier Pickup / Inspection / Transfer Item / Lorry Service`。新建时选来源（供应商、项目、服务单、仓库、调拨单、SO），系统自动带入对方资料。
- **规则：** 排期后才生成 DP 号，状态变 SCHEDULED。

### 17.6 Last Mile Delivery（Fleet day）
- **用途：** Office 的当天执行看板，每辆罗厘一张卡。
- **画面：** 前一天 / 后一天；统计 `Lorries · Drops · On the way · Delivered · Late · Total value`；页签 `Lorries / To arrange / All orders / History`；筛选（电话、客户名、SO / DO 号、时段、状态、销售员）；`Own fleet` / `Outsourced`；`Show map`。
- **操作：** `To arrange` 页给订单选 `Driver`（必选）、`Helper 1/2`、`Lorry`、`Time slot` → `Assign to lorry`；罗厘卡 `Crew` 弹窗设 `Driver 1/2`、`Planned departure`（`Propose crew` / `Apply crew`）；订单抽屉 `Change lorry`（已送达不能改）、`Add remark`、看 POD。
- **【待确认】** 代码注释说部分功能（计划出发、备注、换车、历史）属于后续阶段，但界面已有按钮，实际是否可用需测试。

### 17.7 Crew Leave
- **用途：** 登记司机 / 助手请假（MC、年假等），自动排车会跳过请假的人。
- **画面：** `Who`（Driver / Helper）、`From`、`To`、`Reason (optional)`；列表 `Type · Name · From · To · Reason`，可 `Remove`。
- **验证：** "Pick a driver" / "Pick a helper" / "Check the dates"。

### 17.8 Coverage & Fleet
- **页签：** `Lorries · Drivers · Helpers · Live map · Residence rules · Regions · Places`。
- **Lorries：** `New lorry`；`Plate`、`Home warehouse`、`Box size (feet)`、`Max sets per trip`、`Max order value per trip`、`Own fleet`；服务记录 `Add record`（`Odometer (km)`、`Next service date`）。
- **Drivers / Helpers：** `Who employs them`（`In-house` / `Outsource, 3PL company`）、`IC number`、`Vehicle`；in-house 司机可在这里 `Add leave`。
- **关系：** 罗厘载量影响排车和 Logistic Overview 的载量数据。

### 17.9 Delivery Zones
- **用途：** 维护「邮编前两位 → 送货区」规则，系统建议送货日期时使用；没有启用规则时用内置马来西亚区划。（这也是 SO 为什么要填 Postcode。）
- **按钮：** `Add rule`、`Propose delivery dates`、`Export`、`Load the default map as editable rules`；另有 `Zone map`、每区 `Places`、`Locked days`（`Lock a day` / `Unlock`）。
- **注意：** 锁定日只是标记，服务器不会因此拒绝修改。

### 17.10 Carriers & Rates
- **用途：** 每个承运商（自有车队或 3PL）一张费率卡，用来**核对 3PL 账单成本**（不是向客户收费）。
- **页签：** `Rate Cards / 3PL invoices / Reconciliation`。
- **Rate Cards：** `New 3PL Company`、`New Card`、`Create rate card`、`Move to carrier`；分类 `Delivery / Outstation / Setup & dismantle / Service calls`；`Price check` 试算。
- **Reconciliation：** 列 `DO · 3PL · Invoice · Billed · Rate card · Difference`；`Off the card` 找出不在卡上的单。

### 17.11 Fleet Health
- **用途：** 自有罗厘健康和合规（权限 `fleet.read`）。
- **总览：** `Cannot dispatch`、`Documents`、`Breakdowns & service`、`Repairs this month`；**Compliance reminders**（Road tax / Insurance / PUSPAKOM——**证件过期会让罗厘停用**）；罗厘表 `Lorry · Status · Health · Mileage · Next service · Open problem · Downtime`；`New lorry`、`Live map`。
- **单车页：** `Needs attention`、`Service plans`、`Work orders`（`New work order`）、`Breakdowns`（`Report a breakdown`，严重度 `Minor / Major / Critical (grounds lorry)`）、`Tyres and components`、`Mileage`、`Off the road`、`Repair spend`、`Vehicle & purchase`、`Where it is today`。

---

## 18. Warehouse（仓库）

菜单（Supply Chain › Warehouse）：**Loading List**、**Warehouses**、**Racks & Bins**、**Inventory**、**Adjustments**、**Transfers**、**Stock Take**。

**库存什么时候变动**

| 动作 | 库存 |
|---|---|
| GRN Post | IN（入库） |
| DO 确认（Draft → Confirmed，或建单时直接 Confirmed） | OUT（出库） |
| DO 取消 / Undo load | 加回 |
| Delivery Return 保存 | IN |
| Purchase Return 建立 | OUT |
| Consignment Note / Return、Purchase Consignment Receive / Return | OUT / IN |
| Adjustment、Transfer、Stock Take Post | 按单据 |
| **Racks & Bins 的入架 / 出架** | **不动库存数量**（只记货架位置） |

### 18.1 Loading List
- **用途：** 仓管看今天要装哪些 DO；**页面不显示价格**。
- **画面：** 页签 `To load`（= Draft DO）、`Loaded`（= Confirmed DO）、`All`；搜索 "Search DO, customer, lorry, destination…"；卡片显示 DO 号、客户、城市 / 州、送货日期、车牌 / 司机、物品数量。
- **操作：** Draft DO 上点 `Scan to load` → 跳到扫码页 → 确认后 DO 变 Confirmed 并扣库存。
- **注意：** 这里的 `Loaded` 页签对应 DO 列表的 "Confirmed"（用词不一致）。DO 通常建单时已 Confirmed，只有草稿 DO 才出现在 `To load`。

### 18.2 Warehouses
- **列：** `Code · Name · Type · Country · State · Address · Default · Status`；按钮 `New Warehouse`、`Racks & Bins`、`Show inactive`。
- **类型：** `Warehouse / Showroom / Display / Service / Others`；字段 `Closing stock bucket`（月结时库存分类）。
- **规则：** 不用的仓库设为停用，不要删除（保留历史）。
- **Carres 关系：** 类型为 **Showroom** 的仓库就是 SO 的 Showroom 下拉选项，也是 Team 成员 "Sales venue › Showroom" 的选项。

### 18.3 Racks & Bins
- **页签：** `Rack Overview / Stock In/Out / Movement History`。
- **Rack Overview：** `Total slots · Occupied · Empty · Reserved · Occupancy`；新建货架（`Position`、`Zone`、`Reserve this rack (hold empty)`）、`Seed Racks`（批量建，填 `Prefix`）、打印货架二维码。
- **Stock In/Out：** 入架填货架、产品码、数量（可选客户、单号）；出架必须写原因。
- **⚠ 重要：** 这里只记录货架位置，**不改变系统库存数量**（`routes/warehouse.ts:484-534`）。要改数量请用 Adjustments。

### 18.4 Inventory
- **页签：** `Balances / Batches / Reservations / Warehouses / Analytics`；类别 `All · Accessory · Bedframe · Sofa · Mattress · Service`；仓库筛选；搜索 "Search code / barcode / description…"。
- **Balances 列：** `Product Code · Description · Barcode · Category · Stock · Consignment · Incoming · Scheduled · Available · Unscheduled · Spare · Dead stock · Value · Unit Cost · Age`。
  - Incoming：约 30 天内会到的 PO 数量。
  - Scheduled：有送货日期的 SO 需求。
  - **Available = Stock + Incoming − Scheduled**
  - Unscheduled：没有日期的 SO 需求。
  - **Spare = Available − Unscheduled**
- **Reservations：** `Assigned to SO (MRP) / Free (no order) / Dead stock`。
- 双击一行打开 **Stock Breakdown** 抽屉。寄售库存不计入库存价值。
- **As of date：** 选日期看当天的数量和价值，`Back to live` 回到当前（与月结同一套计算）。
- **Stock Card**（点产品码或 `Open Stock Card`）：`Current Qty · Warehouses · Last Movement · Owned Value`；`Per-Warehouse Balance`；流水列 `Date · Type · Source Doc · Warehouse · Qty · Unit Cost · Running Balance · Reason`（可按 `Source doc` 筛选，例如 `CR-DO-`）；FIFO 批次。
- 成本按 FIFO 计算。

### 18.5 Adjustments（库存调整）
- **列表：** `Adjustments · 30d / Net qty delta / Damage / loss / Supplier returns`；列 `Adjustment No · Date · Warehouse · Items · Net Qty · Reason · Notes · Performed By`；按钮 `New Adjustment`。
- **新建步骤：**
  1. 选 `Warehouse`（整张单共用）。
  2. 逐行加 SKU、数量——**正数增加，负数减少**。
  3. 选原因：`Damage / Loss / Theft / Found / Count Correction / Sample / Free Gift / Write-off / Other`。
  4. 保存。
- **规则：** 沙发、床架增加库存时必须填规格和批次；减少时选扣哪个批次，会扣成负数时警告；需要 `scm.warehouse.adjustments` 权限（会改变库存价值）。

### 18.6 Transfers（调拨）
- **列表：** 状态 `All · Confirmed · Cancelled`；列 `Transfer No. · Date · From · To · Lines · Status · Notes · Created By`；按钮 `New Transfer`。
- **新建：** 选来源仓、目的仓、日期，逐行加 SKU（显示来源仓 `Available`）和数量 → 保存。**保存即生效，没有草稿**。
- **规则：** 来源仓和目的仓不能相同（`same_warehouse`）；出入库在同一笔完成，成本沿用来源批次 FIFO；仓库建后不能改；库存不足拒绝（`insufficient_stock`）；取消会冲回。
- 详情页 `Delivery run · proof of delivery` 显示运送调拨货的 POD。

### 18.7 Stock Take（盘点）
- **列表：** 状态 `All · Open · Confirmed · Cancelled`；列 `Take No. · Date · Warehouse · Scope · Assignee · Lines · Variance · Status`；按钮 `New Take`。
- **新建：** 选仓库；范围 `All SKUs in warehouse / By category / By code prefix`；可勾 `Only SKUs with stock`；**必须指定 Assignee**；可选 `Blind count`（盲盘）。建单时记下当时系统数量。
- **盘点步骤：**
  1. 录入 `Counted Qty`（或 `Upload counted sheet` 上传照片）。
  2. 按 `Save Counts`。
  3. 按 `Post`。
  - 其他：`Undo`、`Cancel`、`Delete`（只限 Open）、`Print PDF`、`Export Excel`。
- **规则**（`routes/stock-takes.ts`）：必须先保存再 Post；Post 时每行差异写一笔调整流水；只有 Assignee 或有 `scm.stock_take.supervise` 权限的人能 Post；**单行差异超过 5 件或 RM500 需要 supervise 权限**；盲盘时普通人看不到系统数量；`Undo` 冲回差异，单据变 Cancelled。

---

# 第五部分 Finance

## 19. Finance（财务）

**谁看得到：** 门户角色 operation、principal、finance（`FINANCE_ROLES`）。每页能不能打开、能按什么按钮，再看 Engine 的 Role 权限。
**菜单：** To do、Money today；**Money in**（Receipts、Invoices、Debtor maintenance、Credit / debit notes、Outstanding、Not yet billed）；**Money out**（Payment vouchers、Payment listing、Payment requests、Supplier bills、Supplier maintenance、Official invoices owed、Supplier & other creditor CN / DN）；**Bank & cards**（Merchant reports、Bank statements、Daily Bank、Unmatched Payments）；**Books**（Journal entries、General ledger、Trial balance、Self-check、Stock close）；**Reports**；**Setup**（Chart of accounts、Opening balance、Item groups、Recon setup、Currencies、Deposit invoices、To do rules）。

### 19.0 钱怎样流动（先读这里）

**客户的钱（Money in）**
1. 销售在 **Sales Order 记付款**（附收据）→ 系统**自动生成 Official receipt**（`scm/lib/so-payment-row.ts:131-140`），记 Dr 银行/现金/在途、Cr AR。
2. 收据状态：
   - **现金**：当场转 FORMAL。
   - **刷卡**：先 Draft，等 **Merchant reports** 确认后转 FORMAL。
   - **转账**：先 Draft，等 **Bank statements** 配对后转 FORMAL。
   - 也可以手动按 **Confirm money**（`acc/receipts.ts:5-18`）。
3. 开 **Sales Invoice**（从 DO）→ Dr AR / Cr Sales。系统自动把 SO 已收订金从最早的发票开始抵扣（"deposit applied"，`scm/lib/si-order-deposit.ts`）。不需要逐张手动冲销。

**付给供应商的钱（Money out）**
1. GRN → **Purchase Invoice** 确认（Dr Inventory / Cr AP）；或直接开 **AP bill**。
2. 在 Supplier bills 按 **Make voucher** → 新 AP payment（账单已勾好）。
3. 付款单走 **Prepare → Check → Approve & post**，过账时才冲销账单、钱才算出去。

**员工报销 / 杂项付款**：员工提 **Payment request** → Finance 做付款单或 AP bill → 同样三步审批。

### 19.1 To do
- **用途：** 财务首页，系统按规则自动列出待办（`finance/FinanceTodo.tsx`）。
- **画面：** `List` / `Calendar`；"x of y done today"；`Rules`、`Add task`；左栏 "Waiting on you"（分 Merchant reports & bank statements、Payments、Receipts & books、Others）、"Waiting on others"、"Done today"（可 `Reopen`）；右栏 "Can move today" 卡片和月度 checklist。标签 New、Waiting N days、Overdue、Due today、Due tomorrow。
- **操作：**
  1. 按任务行上的按钮（Upload / Confirm / Match / Approve 等）跳到处理页面。
  2. `Add task`：填 Task、Assign to、Due、Repeat、Put it under、Remark → 保存。
  3. 自建任务做完按 `Mark done`。日历视图可以拖动任务改期。
- **规则：** 内置 11 条规则；发票逾期超过 30 天会提醒；PV 的 Check / Approve 待办只出现在有对应权限的人那里。

### 19.2 Money today
- 今天能动用的钱：Yesterday → + In today → − Out today → Bank & cash now → − Awaiting approval → **Can move today**。每个户口一张卡，点开看进出。它是 Daily Bank 的 Board 视图（见 19.18）。

### 19.3 Receipts
- **画面：** 按钮 `New receipt`；种类 All、Official receipts、Sundry income、Other debtor，以及 Customer payments（只读镜像，不计入 All）；月份导航；搜索 "Find a receipt · no., payer, order, amount"；列 Kind、No.、Date、From、For、Method / into、Amount、Status。
- **状态：** Official：Draft · money not confirmed / Formal / Cancelled；Sundry：Posted / Voided；Other debtor：Draft → Prepared → Checked → Approved。
- **对账框**（选定月份时）："Customer payments − Official receipts = Difference"，差异分三组：Payments without a receipt（可按 `Issue receipt ›` 补开）、Receipts whose amount is not the payment's、Receipts whose payment is gone。
- **常用操作：**
  1. **确认到账**：Draft 行按 `Confirm money`；或多选后 `Confirm money · N`（按付款日期顺序编号）。
  2. **杂项收入**：`New receipt` → Sundry income → 填 Date、Received from、Received into，每行 Account (credit)、Description、Amount (RM) → `Save & post`（F3 / Ctrl+S）。
  3. **其他债务人**：`New receipt` → Other debtor → 选 Debtor、Received into → 打勾（整张收齐）或填金额（部分）→ `Save & post`（立即过账并冲销 bill）。
  4. 行菜单 ⋯：Open、Print、Edit、Copy as new、`Void…`。
- **规则：** 客户货款收据**不在这里开**（在 SO 记付款自动生成）；`New receipt` 只开 Sundry income 和 Other debtor；表单右侧会预显示分录；改 Sundry 收据 = 冲销旧分录再记新分录。

### 19.4 Invoices
- **用途：** 看客户和其他债务人欠的钱。Sales invoice 在这里只读（开立在 Sales 模组）。
- **画面：** `New debtor bill`；种类 All、Sales invoices、Deposit invoices、Debtor bills；状态 Any status、Open、Not posted、Settled、Cancelled；列 No.、Kind、Date、Bill to、For、Total、Credit notes、Outstanding、Status。
- **操作：** Deposit invoice 未过账时按 `Post to ledger`；Debtor bill 行菜单 Edit、Copy as new、`Cancel bill…`。从 DO 开 Sales Invoice 见 [14.6](#146-sales-invoices)。
- **规则：** 已收款的 bill 不能取消；一张发票只能一个客户；一行 DO 可以分多张发票开。

### 19.5 Debtor maintenance
- **用途：** 管理非客户的债务人（总账控制科目 305-0000）。
- **画面：** `New debtor`、`New receipt`、`New bill`；分段 Debtors / Receipts；列 Name、Account code、Registration、Phone、Open bills、Outstanding、Status。
- **操作：** `New debtor`（系统建议 Account code，例如 305-A001）→ `Save debtor`；`New bill` 开 bill。
- **规则：** **从本页开的收据要走四步**：`Save draft` / `Save & prepare` → `Check`（可 Withdraw）→ `Approve & post`（此时才过账），可 `Reject…`；而从 Receipts 页开的 Other debtor 收据立即过账。

### 19.6 Credit / debit notes（客户）
- **画面：** `New note`；All、Credit notes、Debit notes；状态 Draft、Posted、Cancelled；列 Number、Kind、Date、Party、Reference、Total、Knocks off、Status。
- **操作：** `New note` → 选 Credit / Debit、Customer / Other debtor → 填 Reference、Reason、明细（客户 note 默认科目 510-0000）→ `Post to ledger`；客户 CN 按 `Knock off` → 打勾或填金额 → `Save knock-off`。
- **规则：** Knock off 本身不产生分录；取消已过账的 note 要先退回已冲销部分再冲回。Delivery Return 详情页也能 `Create credit note`。

### 19.7 Outstanding
- 跨模组未结清单：卡片 SI、SO、DO、PO、GRN、PI、PR、PO chasing；模式 Outstanding / Completed / All，加日期范围。
- SI 列：Invoice No、Date、Due、Customer、Total、Paid、SO deposit、Credit notes、Outstanding、Status。SI 金额已扣除 SO deposit 和 CN；DO 卡只有数量没有金额。

### 19.8 Not yet billed
- 只读：已出货但未开票的金额（按行算）。卡片 Over 12 months、Not billed、Partly billed、Oldest；账龄筛选 All ages、**Aged 31+（默认）**、Over 90 days、Over 12 months；列 DO No.、Delivered、Age、Customer、Salesperson、SO No.、Not billed、Delivered value、Already billed。
- 处理：去 Sales Invoices 用 `Transfer from Delivery Order` 开票。

### 19.9 Payment vouchers
- **用途：** 所有出款单据（PV）。
- **画面：** 按钮 `Scan bills`、`New customer refund`、`New payment voucher`、`New AP payment`；有申请在等时显示 "N payment requests waiting for Finance" + `Open them ›`；阶段 All / Draft / Prepared / Checked / Approved / Advance open / Cancelled；列 Voucher、Date、Payee、Description、Bank、Account no.、Pay from、Amount、Stage；行上显示下一步按钮；⋯ 菜单 Open、Edit、Edit text & bank、Print、Print + files、Copy as new、`Cancel…`。
- **常用操作：**
  1. `New payment voucher` → 填 `Pay to *`、`Voucher date *`、`Pay from *`、收款方 Bank / Account no. / Account name，明细 `Account (debit) *`。
  2. `Save draft` 或 `Save & prepare`。
  3. **`Check`**：单据锁定、取得正式编号，Daily Bank 预留这笔钱。
  4. **`Approve & post`**：过账，钱此时才算出去。
  5. 批量：`Prepare N` / `Check N` / `Approve & post N`（按单据日期顺序编号）。
- **弹窗：** "Check …?"、"Approve & post …?" 确认框；`Reject…` 必须写原因（"Why does it go back?"）。
- **规则：** Prepare / Check / Approve / Cancel 各需 `scm.payment_voucher.write` / `.check` / `.approve` / `.cancel`；Check 和 Approve 可以是同一人；已批准只能 Cancel（反向分录，原编号保留）；`Retry posting` 表示过账失败可重试；没有批准权的人看到 `Remind approver`（每单每小时最多一次）。

### 19.10 Payment listing
- 只读付款清单：筛选 From、To、Stage、Payee、Pay from（默认 Prepared + Checked，截至今天）；列 PV No.、Date、Payee、Description、Bank、Account no.、Amount (RM)、Stage；可 Print、导出 Excel。

### 19.11 Payment requests（财务处理）
- **Finance 版画面**（有 `scm.payment_voucher.create` 的人）：页签 To do、Turned into vouchers、Sent back、Paid、Official invoice owed、All；勾选 Only my requests；行按钮 `Send back`、`Make voucher ›`；⋯ 菜单 `Make AP invoice`、`Request the balance`、`Withdraw…`。
- **操作：**
  1. 马上付：`Make voucher ›` → 打开预填好的 PV，补借方科目。
  2. 先入账、以后付：`Make AP invoice`。
  3. 有问题：`Send back`（必须写原因）。
  4. 多张合并：`Make ONE voucher · N ›`（最多 30 张）。
- **规则：** 付款单被取消时申请显示 "Cancelled — Finance makes the next"；**退款申请**由 SO 的 `Refund` 按钮发起，Finance 用 `Make refund voucher` 处理或拒绝，退款申请不能编辑。员工提申请的步骤见 [第 8 章](#8-payment-requests)。

### 19.12 Supplier bills
- **用途：** AP bill、Purchase invoice、供应商 CN 合在一张表。
- **画面：** `Duplicate supplier bills`、`Scan bills`、`Scan credit note`、`New credit note`、`New AP bill`；页签 All / AP bills / Purchase invoices / Credit notes；供应商筛选 "All trade creditors · 400"、"All other creditors · 405"；状态 All / Unpaid / Overdue / Draft / Paid / Cancelled；列 No.、Supplier、Control、Ref、Description、Due、Planned、Outstanding、Status；行按钮 `Post`、`Make voucher`、`Knock off`、`Print`。
- **操作：**
  1. `New AP bill`（可先 `Scan bill (OCR)` 读取）→ 填 `Supplier *`、`Invoice date *`、明细 → `Save as draft` 或 `Save & post`。
  2. 还欠钱时按 `Make voucher` → AP payment（账单已选好）。
  3. Purchase invoice：GRN → PI → `Confirm invoice` → 在这里显示 → `Make voucher`。
- **规则：** Post = 借明细科目、贷 AP 控制科目；On hold 的账单不能 `Make voucher`；已有付款的不能取消；PI 要等付款单批准时才冲销。

### 19.13 Supplier maintenance
- 筛选 All、Trade 400、Other creditor 405、Missing TIN / reg. no.、Finance only、Inactive；列 Code、Name、Control、Terms、TIN / reg. no.、Bank、Owed、Advance open、Open bills、Status；按钮 `New supplier`。
- **注意：** Finance 新建的供应商默认只有 Finance 看得到，要设成共享采购才看得到；这里的银行资料会带入 AP payment。

### 19.14 Official invoices owed
- 跟进「凭 proforma / 报价单先付款、还欠正式发票」的单据。页签 Owed、To check、All；列 Paid by、Pay to、Amount、Paid、Asked by、Waiting、Official invoice。
- 流程：PV 上勾 "Official invoice owed" → 申请人上传正式发票 → Finance 按 `Checked ✓`。其他：`Add a remark`、`Clear the mark`。

### 19.15 Supplier & other creditor CN / DN
- 页签 Credit notes、Debit notes、Opening 31/08；按钮 `Scan supplier CN · 扫描 CN`、`New note`。
- 流程：新建 → `Knock off` 勾选要冲销的发票 → `Post to ledger`。单据页有 Edit、Cancel note、Add task、Trail。DN 要用 AP payment 付；已过账只能取消。

### 19.16 Merchant reports
- **用途：** 把卡机报告和刷卡付款对上；确认时只记手续费（Dr 卡费 / Cr 在途）。
- **画面：** 每个收单行一张卡（`Upload`，PBB 另有 `Advices`）；行页签 To confirm、To choose、No sale found、Confirmed、Set aside；首页列表 "Card payments no merchant report has reported yet"。
- **操作：**
  1. `Upload` → 选 Acquirer → 传文件 → `Upload & match`。
  2. `Confirm all N matched`。
  3. "To choose" 的行用 `Find the sale` 手动选；配错按 `Not this`。
  4. 全部完成后 `Match the bank statement →`。
- **规则：** 格式错的文件被拒；没有唯一参考号的行不会自动确认；完成后 320-0000 应清零；已确认可 `Undo`。

### 19.17 Bank statements
- **视图：** Statements、Files、Money to come in、Still with the merchants；月份进度 Statement in → Matched → Tallied → Locked；"Statement closes at − Per the ledger = Difference"；行页签 To match、To choose、No entry found、Not on the bank yet、Matched、Set aside。
- **操作：**
  1. 上传月结单（CSV / PDF）→ `Upload & match`。
  2. `Match the obvious ones now`。
  3. 剩下的逐条 `Match`、`Money received`、`Record journal`，或 `Not ours to reconcile` → `Leave it out`。
  4. 差额为 0 后按 `Lock <月>`。
- **规则：** 重叠日期自动跳过；锁定后不能再匹配、不能上传该月文件；`Unlock…` 要填原因并需要 approve 权限。【待确认】有差额时能否写原因锁定（前后端不一致）。

### 19.18 Daily Bank
- 视图 Board、Accounts、Daily close；按钮 Print、Export image。
- 日终：Daily close 填现金点数 → `Save counts` → `Confirm close`。只有现金差额会记账（946-0000）；刷卡和转账的差额属于时间差，不在这里记。

### 19.19 Unmatched Payments
- 页面标题 "Payments not matched yet"。筛选 "Dated from … to"；三个列表 Merchant report lines、Bank money in、Payments（有 "Where it is stuck" 列），另有 Previous records；每行链接到处理页面；`Export all · Excel / PDF`。

### 19.20 Books
- **Journal entries**：筛选 Journal、Source；`New manual journal`、Excel、PDF、Print；手工分录可 Post、Edit、Copy、Reverse。改已过账分录 = 冲销后用新号重记；单据生成的分录要回单据去改。
- **General ledger**：Balance b/f 和滚动余额；Accounts 选择器；`Show reversed`（冲销分录默认隐藏，打开也不计入余额）。
- **Trial balance**：Σ Debit、Σ Credit、"Difference (must be 0.00)"，按五大类分段。【待确认】两列金额的期间。
- **Self-check**：三组检查，结果 Clean / N findings / Not checked；补记未入账付款先 `Why? (dry run)` 再 `Book them`；补开收据 `Create N receipts`。
- **Stock close**：每晚 00:05 自动重查最近两个月（No change / Re-posted）；可手动 `Run now`（手动不锁月份）。

### 19.21 Reports
- P&L：视图 Single / Compare / By month；Layout、Excel、PDF；点数字跳到总账明细。
- 目录：

| 分组 | 报表 |
|---|---|
| Statements | P&L、Balance sheet、Cash flow、Trial balance |
| Who owes whom | AR aging、AP aging |
| Sales & collection | Collection、Sales report · fairs、Performance P&L、Product profit |
| Events & logistics | Event costs、Event commission、Logistics cost |
| Card money | Merchant charges |
| Plan | Forecast P&L、Dashboard |
| Audit | Corrections |

每张报表能否打开由各自权限控制。

### 19.22 Setup
- **Chart of accounts**：`Add account`、`Upload AutoCount chart`；只有没交易、没引用的科目才能删。
- **Opening balance**：页签 Accounts、Creditors、Other debtors、Stock；清账科目为零才能 `Lock the opening`，锁定后整页不能改。
- **Item groups**：每个产品组配 Purchase、Sales、Sales return、Purchase return 四个科目；按 `Save` 才生效；`Turn off` 是停用不是删除。
- **Recon setup**：Merchants、Banks、Voucher numbering、Default bank、银行文件格式、识别规则（规则只能停用）。
- **Currencies**：MYR 汇率固定 1，其他币种必须大于 0；保存后 GRN、PI、PV 可选用。
- **Deposit invoices**：开关 "Issue a deposit invoice for every customer payment"，打开时必须填 "from" 日期。代码注释写本公司暂时关闭（`acc/deposit-invoices.ts:17-20`）。【待确认】现在是否已开启。
- **To do rules**：11 条内置规则 + `New rule`、Routines、Groups；规则不能删，只能关闭。

---

# 第六部分 System

System 各行给门户角色 operation、principal、hr 看（`SYSTEM_ROLES`）；页面里的功能再看 Engine 权限。

## 20. Team（团队）

菜单：**Directory**、**Org Chart**、**Departments**、**Mailboxes**、**Roles & Permissions**（Engine `/team`）。Team 页上方分页条另有 **Titles**（菜单没有单独一行）。

| 分页 | 用途 | 需要权限 |
|---|---|---|
| Directory | 左边部门树，右边员工名单；按钮 **Invite Member** | users.read |
| Org Chart | 汇报线，可拖动、缩放、打印 | users.read |
| Departments | Name、Code、Colour、Department lead、Headcount target；**New Department** | 新建要 users.manage |
| Titles | 建立、改名、移动、删除职称 | users.manage |
| Mailboxes | 个人 / 部门邮箱；Orphaned、Unassigned；New Mailbox | mail_center.manage |
| Roles & Permissions | 子页 Roles / Matrix / Titles / Actions | roles.read |

### 20.1 Directory
- 列：Member、Status（Active / Pending / Disabled）、Title、Role、Company、Team、Reports to、Email、Phone、Employee ID、Mail alias、Joined、Last login。
- 行操作：**Log in as**、**Resend invite**、**Open profile**。

### 20.2 成员资料（Member profile）
- 页签：**Details & Assignment**、**Permissions**、**Activity Log**。
- **Assignment**：Name、Company、Department、Title、Role、Team、Reports to。
- **Sales venue › Showroom**（Carres 规则）：选 None 或任一启用中的 Showroom，提示 "New sales orders by this member start with this showroom."。和 Assignment 一起按 **Save** 保存（`team/TeamMemberProfile.tsx`，2026-11-13 新增）。
- **Account access**：Set a new password（只影响 Engine 密码）、**Disable account / Enable account**。

**常用操作 · 设定销售员的默认 Showroom**
1. Team › Directory，找到销售员，点 **Open profile**。
2. 在 Details & Assignment 找到 **Sales venue** 卡片。
3. **Showroom** 下拉选他所属的展厅。
4. 按 **Save**。之后他开的新 SO 会自动带出这个 Showroom。

**常用操作 · 给新员工 Engine 权限**
1. 员工先从门户登入一次（SSO 会自动建 Engine 账号，起始 Role 为 "New member"，没有页面权限）。
2. 老板 / 管理员在 Team › Directory 打开他的资料。
3. 在 Assignment 设 Department、Title、**Role**、Reports to。
4. 按 Save。员工重新打开页面即生效。

### 20.3 Org Chart
- 显示汇报线（来自成员的 Reports to），可拖动、缩放、打印。

### 20.4 Departments / Titles
- Departments：建部门、设部门主管、人数目标。
- Titles：职称；在 Roles & Permissions › Titles 设定职称能**看**什么。

### 20.5 Mailboxes
- 管理个人 / 部门邮箱（Mail Center 用）；列出没人管的（Orphaned）和未分配的（Unassigned）。

### 20.6 Roles & Permissions
- **Roles**：角色能**做**什么（权限钥匙）。可 New Role、Duplicate、"Copy permissions from another role…"。
- **Matrix**：角色 × 权限总表。
- **Titles**：职称能**看**什么。
- **Actions**：送货线动作（load、dispatch、revert、invoice）。
- 常用权限钥匙见 [3.2](#32-engine-里的-role第二层)。

---

## 21. Mail Center
- 三栏邮箱：左栏 New email、文件夹（Inbox / Starred / Sent / Archive / Drafts / Trash / All）、Labels、邮箱切换（个人 / 部门）；分类 Primary / Notifications。
- 写信：From、收件人、CC/BCC、Subject；附件最多 10 个、合计 5MB。
- 邮箱在 Team › Mailboxes 分配。

## 22. Announcements（公告）
- 类型：Notice、Memo、Warning、Standard operating procedure。
- 可设 Audience（按部门）、Read receipts（Ack rate）、Notify their supervisors、导出回执 CSV。
- 需要确认的公告会在页面顶部出现确认条；逾期没确认会自动通知上司。
- 发公告要 `announcements.write`，批准要 `announcements.approve`。

## 23. IT：System Health / AI Usage
- **System Health**：只给老板（全部权限）。数据库 / KV 状态、请求 p50/p95/p99、审计事件。
- **AI Usage**：IT 专用，按月、功能显示 AI 费用（Calls、Input/Output tokens、Cost）。

## 24. Change Log
- 谁改了哪张单据。筛选 People / The system / Both、Every type；列 Document、Type、Changed by、Changes；范围 SO、DO、PO、GRN。

## 25. Assistant 与 Agent Console
- **Assistant**：全页 AI 对话。没有设定 AI key 时会回答需要 key。
- **Agent Console**：AI agent 管理（Fleet scorecard、Approve、Reject、Dismiss、Retire 等）。【待确认】Carres 的实际用法。

## 26. IT Support
- 每人只看到自己的请求；列表 Active / Resolved。
- **Report a problem**：填 Kind of request、Which part of the system、How urgent、Details、Screenshots → 提交。
- 可以回复 IT、确认修好。门户的「Report a problem to IT」也打开这里。

## 27. OCR
- IT 专用：本月扫描准确率（Scans、Accuracy、Awaiting review、Recent problem scans）。扫描功能本身在各页（Scan Order、Scan Invoice、Scan bills、Scan Delivery Order）。

## 28. Settings
- 打开方式：菜单的 **Settings 齿轮**（Engine `/settings`），没有单独菜单行。
- 页签：**Connection、Email、Branding、Documents、Activity Log**（Carres 隐藏了 Sync）。
  - **Email**：Master switch 和各渠道开关（ASSR survey、SLA alerts、Delivery Order 邮件等）。
  - **Branding**：公司名、SSM、地址、logo（单据抬头、客户追踪页都读这里）；修改要 `settings.manage`。
  - **Connection**：检查 AutoCount 中间件。【待确认】对 Carres 是否有意义（Carres 未接 AutoCount）。
- 旧的 Carres Settings 网址都会自动转到这里。

## 29. Finance (old)
- 旧的 Carres 财务区，2026-11-11 移到菜单最底部并改名，**内容没有删除**。只有 finance、principal 角色可见。
- operation 只能进 Monitor 和 Payment Records；hr、bd 只能进 Payment Requests（`apps/web/src/pages/finance/FinanceApp.tsx:91-127`）。
- 主要页面：Dashboard；Receivables（Monitor、Payment Records、Sales Invoices、Other receipts、Other Debtors、Outstanding、Not Yet Billed、Customer Credit Notes、Cancelled orders holding money）；Payables（Payment Vouchers、AP Invoices、Payment Requests、Supplier Maintenance、Credit / Debit Notes、Notes to follow up、AP · Payables）；Bank & Cards（Daily Bank、Merchant Recon、Card money waiting、Money moves）；Ledger；Reports（含 Dealer commission、Stock value、Project money）；Forecast P&L；Opening Balance；**Rental Approver**、**Subscriptions**、**Dealers**（Carres 独有）。
- **建议：** 日常财务一律用 Operations › **Finance**（第 19 章）。Finance (old) 用来查历史，以及设定 Payment Requests 的 "May ask" 授权。【待确认】老板是否同意这个分工。

---

# 第七部分 附录

## 30. 常见问题

**Q1. 为什么我不能设 Processing Date（或按不了 Proceed）？**
系统会一次列出全部原因，常见的有：
1. **订金不够 50%**："Deposit RM… of RM… needed (50%) before a Processing Date can be set"。先在 SO 记付款（附收据），付款日期超过 14 天前的要先走 Payment Backdate Requests 并获批准。
2. 缺客户名、地址第 1 行、**Postcode** 或 Delivery Date。
3. Processing Date 晚于 Delivery Date，或日期早于今天。
4. 有产品行变体没选齐，或布料颜色还是 KIV。

**Q2. 开 SO 时 Showroom 是空的，存不了？**
你的销售员资料没有设定默认 Showroom。请在下拉自己选 Showroom 或 Project；长期解决请主管到 Team › 成员 › Sales venue › Showroom 设定（[20.2](#202-成员资料member-profile)）。

**Q3. SO 已经 Proceed，为什么 MRP 里看不到？**
MRP 默认显示快照（约每 15 分钟刷新）。按 **Regenerate** 立即重算。另外确认 SO 不是 On Hold、产品行没有被取消。

**Q4. Proceed PO 用的是哪家供应商？**
默认是该 SKU 的 **main supplier**（Suppliers › SKU Pricing 的星号）。可以在 MRP 行上的 `Supplier` 下拉改。

**Q5. 收了货，SO 为什么还不是 Ready to Ship？**
GRN 必须 **Post**（Draft 不入库）；而且 SO 的**所有主产品行**都要有货，才会自动变 Ready to Ship。

**Q6. 开了 DO，SO 为什么还不是 Shipped？**
DO 必须覆盖 SO 的**每一行**并已确认（不是 Draft）。只送了一部分时 SO 状态不变。

**Q7. Racks & Bins 入了货架，库存数量为什么没变？**
货架页只记录位置，不改库存数量。要改数量用 **Adjustments**；正常入库走 GRN。

**Q8. 客户付了钱，收据去哪里开？**
不用另开。在 SO 记付款就自动生成 Official receipt。刷卡 / 转账的收据在 Merchant reports / Bank statements 对上后才转为 FORMAL。

**Q9. 付款日期是 3 星期前，系统不让记？**
超过 14 天的要在 SO 上提 Backdate 申请，由有 `scm.payment.backdate` 权限的人在 Payment Backdate Requests 批准。批准前这笔钱不算已付。

**Q10. 订单要改，但 Edit 变成了 Submit SO Amendment？**
订单已锁（Processing Date 已到或已有 PO）。提 Amendment 并填原因，系统按改动内容分给采购 / Logistics / Sales Director 审批。

**Q11. 我打开 Supply Chain 页看到 Forbidden 或全部是 0？**
你的门户角色能看到菜单，但 Engine 里的 Role 还没给权限（新员工默认 "New member" 没有页面权限）。请主管在 Team › 成员 › Role 设定。

**Q12. Fair Links to Settle 里有很多单，要处理吗？**
Carres 不办展会，Showroom 单都会出现在 "Marked No fair" 组，平时不需要处理。

**Q13. SO 选了 Sale Type = Subscription，租约在哪里？**
目前订阅计费还没建置，Subscription（Rental）页是空的；Sale Type 只是标记在 SO、列表和 PDF 上。

**Q14. 手机怎样用？**
用手机浏览器打开 Engine（或在门户里打开），屏幕小于 1024px 会自动显示手机版；可以「添加到主屏幕」。详见 [第 4 章](#4-手机版)。

**Q15. 单据取消了想恢复？**
- SO：取消后是最终状态，用 `Copy as new` 重开。
- PO：`Reopen`（只限 Cancelled）。
- DO、Delivery Return、Consignment Note / Return：不能重开，要重开新单。

**Q16. 忘记密码？**
登入页点 **Reset →** 收邮件重设；或请老板在 Admin › Accounts 按 Reset password（临时密码要当面告诉你）。

---

## 附录 A：待确认清单

以下内容在代码里没有找到证据，或代码与实际可能不同，请 IT / 老板确认后更新本手册：

1. **员工门户账号由谁、在哪里开。** Admin › Accounts 的 `+ New account` 后端只允许 dealer / showroom；代码注释说的 HR Team 开户入口（`/api/hr/team/accounts`）已不存在。
2. **Payment Requests 权限两边是否一致**：门户看 "May ask" 授权，Engine 看 `scm.payment_request.create` 或销售身份。
3. **Fair Links to Settle** 菜单是否对 Carres 隐藏（所有 Showroom 单都会列在 "Marked No fair"）。
4. **Subscription（Rental）** 页尚未启用；Sale Type = Subscription 的订单后续怎样处理。
5. **手机版**：员工能否用 Engine 账号直接在手机登入；在门户框里用手机打开是否显示手机版；Punch In / Out 是否可用。
6. **My Cases**：SSO 首次建账号时名字可能是 email，是否需要统一在 Team 改名，才能匹配 SO 上的销售员名字。
7. **Service Cases 的 Sync DO / 从 AutoCount 拉资料**：Carres 没接 AutoCount，是否可用；Settings › Connection 同理。
8. **Fleet day（Last Mile Delivery）** 中标为「后续阶段」的功能（计划出发、备注、换车、历史）是否已可用。
9. **Deposit invoices** 开关现在是否已开启。
10. **Bank statements** 有差额时能否写原因锁定（前端按钮灰、后端允许）。
11. **Trial balance** 两列金额的期间。
12. **Products** 的 Combo Pricing / Variants / Fabric Converter / Categories 详细校验规则。
13. **Purchase Consignment Return** 的 COMPLETED 状态操作；**GRN** 何时变 CLOSED。
14. **Agent Console** 在 Carres 的实际用途。
15. **Finance (old)** 与新 Finance 的分工（建议新 Finance 为准、旧区查历史）。
16. SSO 登入时没有带 `settingsEditor` 资料，Engine 可能每次登入都同步 Settings 编辑名单——是否会把人移出名单。
17. `/new/from-products`（从产品目录开 SO）列表页没有入口，员工是否会用到。

---

## 附录 B：单号格式

Carres 所有 Engine 单据以 `CR-` 开头，按月重新编号（`YYMM` = 年月）：

| 单据 | 格式 | 例子 |
|---|---|---|
| Sales Order | `CR-SO-YYMM-NNN` | CR-SO-2611-001 |
| Purchase Order | `CR-PO-YYMM-NNN` | CR-PO-2611-001 |
| Goods Receipt | `CR-GRN-YYMM-NNN` | CR-GRN-2611-001 |
| Purchase Invoice | `CR-PI-YYMM-NNN` | CR-PI-2611-001 |
| Purchase Return | `CR-PRT-YYMM-NNN` | CR-PRT-2611-001 |
| Delivery Order | `CR-DO-YYMM-NNN` | CR-DO-2611-001 |
| Sales Invoice | `CR-SI-YYMM-NNN` | CR-SI-2611-001 |
| Stock Adjustment | `CR-SA-YYMM-NNN` | CR-SA-2611-001 |
| Stock Take | `CR-STK-YYMM-NNN` | CR-STK-2611-001 |
| Consignment | `CR-CS-` / `CR-CN-` / `CR-CRN-` / `CR-PCO-` / `CR-PCR-` / `CR-PCT-` + `YYMM-NNN` | CR-CS-2611-001 |

依据：`companyScope.ts:530-533`、`mfg-purchase-orders.ts:1117`、`grns.ts:1751`、`purchase-invoices.ts:782`、`purchase-returns.ts:84`、`delivery-orders-mfg.ts:431`、`inventory-adjustments.ts:83`、`stock-takes.ts:115`、consignment 各路由。

---

## 附录 C：状态对照表

| 单据 | 代码状态 → 画面显示 |
|---|---|
| Sales Order | DRAFT→Draft · CONFIRMED→Submitted · IN_PRODUCTION→In Production · READY_TO_SHIP→Ready to Ship · SHIPPED→Shipped · DELIVERED→Delivered · INVOICED→Invoiced · CLOSED→Closed · CANCELLED→Cancelled（On Hold 是标记） |
| Purchase Order | DRAFT · SUBMITTED→Submitted · PARTIALLY_RECEIVED→Partially Received · RECEIVED · CANCELLED · ON_HOLD |
| GRN | DRAFT · POSTED→Submitted（页签 Confirmed）· CLOSED · CANCELLED · ON_HOLD |
| Purchase Invoice | DRAFT · POSTED→Submitted（页签 Confirmed）· PARTIALLY_PAID · PAID · VOID · CANCELLED · ON_HOLD |
| Purchase Return | POSTED→Confirmed · COMPLETED→Completed · CANCELLED |
| Delivery Order | DRAFT→Draft · LOADED→**Confirmed** · DISPATCHED→**Loaded** · IN_TRANSIT→In transit · SIGNED/DELIVERED→Delivered · INVOICED · CANCELLED |
| Sales Invoice | DRAFT · SENT（页签 Sent，徽章 Submitted）· Partial · Paid · CANCELLED |
| Cancellation request | REQUESTED → L1_APPROVED → APPROVED → EXECUTED；REJECTED / WITHDRAWN |
| Service Case | Pending Review → Pending Solution → Under Verification → Pickup / Return → Pending Item Ready → Pending Delivery / Service → Completed；Voided — Not Valid |
| Payment voucher | Draft → Prepared → Checked → Approved（Advance open、Cancelled） |

---

*本手册依据代码整理。系统更新后请同步修改本文件（`docs/user-manual/Carres-User-Manual.md`）。*
