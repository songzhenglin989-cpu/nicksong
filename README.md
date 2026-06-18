# 原材料扫码进出库系统（升级版）

基于 React + Vite 的手机端优先原材料扫码进出库系统。系统保留扫码登记，新增员工工号、员工姓名、产品型号、工序联动、老板后台、Supabase 云同步、库存统计、报废统计、员工 KPI 和 Excel CSV 导出。

## 功能

- 首页大按钮入口：扫码入库、扫码出库、扫码报废、库存统计、报废统计、员工 KPI、操作记录、老板后台
- 支持摄像头扫码（浏览器支持 `BarcodeDetector` 时）和手动输入扫码编号
- 登记字段：操作类型、扫码编号、原材料名称、数量、单位、员工工号、员工姓名、产品型号、工序、备注、自动时间
- 产品型号和工序联动：切换产品型号后自动刷新可选工序
- 本机 `localStorage` 离线保存，配置 Supabase 后同步到云端
- 同一浏览器多页面通过 `BroadcastChannel` 实时同步，云端数据每 15 秒自动刷新
- 老板后台可查看所有记录、员工数、配置 Supabase、刷新云端数据、导出 Excel CSV
- 库存统计：当前库存 = 总入库 - 总出库 - 总报废
- 报废统计：按产品型号、工序、原材料、单位汇总
- 员工 KPI：按员工统计操作单数、入库数量、出库数量、报废数量

## 本地运行

```bash
npm install
npm run dev
```

然后在浏览器打开终端显示的本地地址。手机测试时，请让手机和电脑连接同一局域网，并访问 Vite 显示的 Network 地址。

## 生产构建

```bash
npm run build
npm run preview
```

## Supabase 配置

### 1. 创建数据表

在 Supabase SQL Editor 执行：

```sql
create table if not exists material_records (
  id uuid primary key,
  type text not null,
  code text not null,
  material text not null,
  quantity numeric not null,
  unit text not null,
  employee_id text not null,
  employee_name text not null,
  product_model text not null,
  process text not null,
  note text,
  created_at timestamptz not null
);

alter table material_records enable row level security;

create policy "material_records_select_all"
  on material_records for select
  using (true);

create policy "material_records_insert_all"
  on material_records for insert
  with check (true);
```

### 2. 配置连接信息

方式一：在老板后台填写 Supabase URL、anon key、表名。

方式二：创建 `.env` 文件：

```bash
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=你的 anon public key
VITE_SUPABASE_TABLE=material_records
```

> 第一版云同步使用 Supabase REST API 写入和读取，并保留本机离线数据；后续可替换为 Supabase Realtime channel 实现数据库推送级实时同步。
