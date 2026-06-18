import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const STORAGE_KEY = 'material_inventory_records_v2';
const SETTINGS_KEY = 'material_inventory_settings_v2';
const CHANNEL_NAME = 'material_inventory_sync';
const MATERIALS = ['塑料粒子', 'PU原料', 'ABS', 'PP', '回料', '色粉'];
const UNITS = ['kg', '包', '桶'];
const PRODUCT_PROCESS_MAP = {
  '外壳-A100': ['注塑', '修边', '检验', '包装'],
  '底座-B200': ['混料', '注塑', '喷涂', '组装'],
  '面板-C300': ['注塑', '丝印', '检验', '包装'],
  '通用原料': ['来料入库', '生产领料', '退料', '报废'],
};
const ACTIONS = {
  inbound: { label: '入库', stockSign: 1, color: 'green' },
  outbound: { label: '出库', stockSign: -1, color: 'orange' },
  scrap: { label: '报废', stockSign: -1, color: 'red' },
};

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSupabaseSettings() {
  const saved = loadJson(SETTINGS_KEY, {});
  return {
    url: saved.url || import.meta.env.VITE_SUPABASE_URL || '',
    anonKey: saved.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    table: saved.table || import.meta.env.VITE_SUPABASE_TABLE || 'material_records',
  };
}

function mapFromDb(row) {
  return {
    id: row.id,
    type: row.type,
    code: row.code,
    material: row.material,
    quantity: Number(row.quantity),
    unit: row.unit,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    productModel: row.product_model,
    process: row.process,
    note: row.note || '',
    createdAt: row.created_at,
  };
}

function mapToDb(record) {
  return {
    id: record.id,
    type: record.type,
    code: record.code,
    material: record.material,
    quantity: record.quantity,
    unit: record.unit,
    employee_id: record.employeeId,
    employee_name: record.employeeName,
    product_model: record.productModel,
    process: record.process,
    note: record.note,
    created_at: record.createdAt,
  };
}

async function fetchSupabaseRecords(settings) {
  if (!settings.url || !settings.anonKey) return null;
  const res = await fetch(`${settings.url}/rest/v1/${settings.table}?select=*&order=created_at.desc`, {
    headers: { apikey: settings.anonKey, Authorization: `Bearer ${settings.anonKey}` },
  });
  if (!res.ok) throw new Error('Supabase 查询失败');
  return (await res.json()).map(mapFromDb);
}

async function insertSupabaseRecord(settings, record) {
  if (!settings.url || !settings.anonKey) return false;
  const res = await fetch(`${settings.url}/rest/v1/${settings.table}`, {
    method: 'POST',
    headers: {
      apikey: settings.anonKey,
      Authorization: `Bearer ${settings.anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(mapToDb(record)),
  });
  if (!res.ok) throw new Error('Supabase 保存失败');
  return true;
}

function formatDate(iso) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(iso));
}

function makeCsv(records) {
  const headers = ['时间', '操作类型', '扫码编号', '原材料名称', '数量', '单位', '员工工号', '员工姓名', '产品型号', '工序', '备注'];
  const rows = records.map((r) => [formatDate(r.createdAt), ACTIONS[r.type]?.label || r.type, r.code, r.material, r.quantity, r.unit, r.employeeId, r.employeeName, r.productModel, r.process, r.note]);
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')}`;
}

function downloadCsv(records, name = '原材料进出库记录') {
  const blob = new Blob([makeCsv(records)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function App() {
  const [page, setPage] = useState('home');
  const [scanType, setScanType] = useState('inbound');
  const [scanCode, setScanCode] = useState('');
  const [records, setRecords] = useState(() => loadJson(STORAGE_KEY, []));
  const [settings, setSettings] = useState(getSupabaseSettings);
  const [syncStatus, setSyncStatus] = useState(settings.url ? 'Supabase 已配置' : '本机模式');

  useEffect(() => saveJson(STORAGE_KEY, records), [records]);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => event.data?.type === 'records' && setRecords(event.data.records);
    return () => channel.close();
  }, []);

  const syncFromCloud = async () => {
    try {
      const cloudRecords = await fetchSupabaseRecords(settings);
      if (cloudRecords) {
        setRecords(cloudRecords);
        setSyncStatus(`已同步 ${cloudRecords.length} 条云端数据`);
      }
    } catch (error) {
      setSyncStatus(`${error.message}，已使用本机数据`);
    }
  };

  useEffect(() => {
    syncFromCloud();
    const timer = setInterval(syncFromCloud, 15000);
    return () => clearInterval(timer);
  }, [settings.url, settings.anonKey, settings.table]);

  const publishRecords = (nextRecords) => {
    setRecords(nextRecords);
    new BroadcastChannel(CHANNEL_NAME).postMessage({ type: 'records', records: nextRecords });
  };

  const goScan = (type) => {
    setScanType(type);
    setScanCode('');
    setPage('scan');
  };

  const startRegister = (code) => {
    setScanCode(code || `MANUAL-${Date.now()}`);
    setPage('register');
  };

  const addRecord = async (record) => {
    const fullRecord = { id: crypto.randomUUID(), ...record };
    publishRecords([fullRecord, ...records]);
    try {
      const saved = await insertSupabaseRecord(settings, fullRecord);
      setSyncStatus(saved ? '已保存到 Supabase，并同步给所有员工' : '已保存到本机');
      if (saved) await syncFromCloud();
    } catch (error) {
      setSyncStatus(`${error.message}，记录已暂存在本机`);
    }
    setPage('records');
  };

  const saveSettings = (nextSettings) => {
    saveJson(SETTINGS_KEY, nextSettings);
    setSettings(nextSettings);
    setSyncStatus(nextSettings.url ? 'Supabase 已配置，正在同步' : '本机模式');
  };

  return (
    <main className="app-shell">
      <Header page={page} onBack={() => setPage('home')} syncStatus={syncStatus} />
      {page === 'home' && <Home onScan={goScan} onNavigate={setPage} records={records} />}
      {page === 'scan' && <ScanPage type={scanType} onSubmit={startRegister} />}
      {page === 'register' && <RegisterPage type={scanType} code={scanCode} onSubmit={addRecord} />}
      {page === 'stats' && <StatsPage records={records} />}
      {page === 'scrap' && <ScrapStatsPage records={records} />}
      {page === 'kpi' && <KpiPage records={records} />}
      {page === 'admin' && <AdminPage records={records} settings={settings} onSaveSettings={saveSettings} onExport={() => downloadCsv(records, '老板后台全量数据')} onRefresh={syncFromCloud} />}
      {page === 'records' && <RecordsPage records={records} onExport={() => downloadCsv(records)} onClear={() => publishRecords([])} />}
    </main>
  );
}

function Header({ page, onBack, syncStatus }) {
  return <header className="header">{page !== 'home' && <button className="back-btn" onClick={onBack}>返回</button>}<div><p className="eyebrow">车间移动端 · {syncStatus}</p><h1>原材料扫码进出库</h1></div></header>;
}

function Home({ onScan, onNavigate, records }) {
  return <section className="home-grid"><ActionCard className="green" title="扫码入库" desc="原料到货、退回入库" onClick={() => onScan('inbound')} /><ActionCard className="orange" title="扫码出库" desc="生产领料、消耗出库" onClick={() => onScan('outbound')} /><ActionCard className="red" title="扫码报废" desc="报废登记并进入统计" onClick={() => onScan('scrap')} /><ActionCard title="库存统计" desc="自动计算当前库存" onClick={() => onNavigate('stats')} /><ActionCard title="报废统计" desc="按型号、工序、员工汇总" onClick={() => onNavigate('scrap')} /><ActionCard title="员工KPI" desc="统计员工操作量和数量" onClick={() => onNavigate('kpi')} /><ActionCard title="操作记录" desc={`查看与导出 ${records.length} 条记录`} onClick={() => onNavigate('records')} /><ActionCard title="老板后台" desc="查看全量数据与配置云同步" onClick={() => onNavigate('admin')} /></section>;
}

function ActionCard({ title, desc, onClick, className = '' }) {
  return <button className={`action-card ${className}`} onClick={onClick}><strong>{title}</strong><span>{desc}</span></button>;
}

function ScanPage({ type, onSubmit }) {
  const [code, setCode] = useState('');
  const videoRef = useRef(null);
  const [cameraMsg, setCameraMsg] = useState('可手动输入，也可使用支持 BarcodeDetector 的浏览器扫码。');

  const startCamera = async () => {
    if (!('BarcodeDetector' in window)) {
      setCameraMsg('当前浏览器不支持摄像头识别，请手动输入条码。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'ean_8'] });
      const tick = async () => {
        if (!videoRef.current?.srcObject) return;
        const codes = await detector.detect(videoRef.current);
        if (codes[0]?.rawValue) {
          videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
          onSubmit(codes[0].rawValue);
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
      setCameraMsg('摄像头已打开，请对准条码或二维码。');
    } catch {
      setCameraMsg('无法打开摄像头，请检查权限或手动输入。');
    }
  };

  return <section className="panel"><h2>{ACTIONS[type].label}扫码</h2><video ref={videoRef} className="scanner-video" muted playsInline /><button className="primary-btn" onClick={startCamera}>打开摄像头扫码</button><p className="hint">{cameraMsg}</p><label className="field"><span>扫码编号 / 批次号</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="请扫描或输入编号" /></label><button className="primary-btn dark" onClick={() => onSubmit(code)} disabled={!code.trim()}>进入登记页面</button></section>;
}

function RegisterPage({ type, code, onSubmit }) {
  const firstModel = Object.keys(PRODUCT_PROCESS_MAP)[0];
  const [form, setForm] = useState({ material: MATERIALS[0], quantity: '', unit: UNITS[0], employeeId: '', employeeName: '', productModel: firstModel, process: PRODUCT_PROCESS_MAP[firstModel][0], note: '' });
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateModel = (productModel) => setForm((prev) => ({ ...prev, productModel, process: PRODUCT_PROCESS_MAP[productModel][0] }));
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ type, code, ...form, quantity: Number(form.quantity), createdAt: new Date().toISOString() });
  };
  return <form className="panel form" onSubmit={submit}><h2>{ACTIONS[type].label}登记</h2><div className={`type-badge ${ACTIONS[type].color}`}>操作类型：{ACTIONS[type].label}</div><label className="field"><span>扫码编号</span><input value={code} readOnly /></label><label className="field"><span>员工工号</span><input value={form.employeeId} onChange={(e) => update('employeeId', e.target.value)} required placeholder="例如 E001" /></label><label className="field"><span>员工姓名</span><input value={form.employeeName} onChange={(e) => update('employeeName', e.target.value)} required placeholder="请输入姓名" /></label><label className="field"><span>产品型号</span><select value={form.productModel} onChange={(e) => updateModel(e.target.value)}>{Object.keys(PRODUCT_PROCESS_MAP).map((m) => <option key={m}>{m}</option>)}</select></label><label className="field"><span>工序</span><select value={form.process} onChange={(e) => update('process', e.target.value)}>{PRODUCT_PROCESS_MAP[form.productModel].map((p) => <option key={p}>{p}</option>)}</select></label><label className="field"><span>原材料名称</span><select value={form.material} onChange={(e) => update('material', e.target.value)}>{MATERIALS.map((m) => <option key={m}>{m}</option>)}</select></label><label className="field"><span>数量</span><input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} required placeholder="请输入数量" /></label><label className="field"><span>单位</span><select value={form.unit} onChange={(e) => update('unit', e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label><label className="field"><span>备注</span><textarea value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="可填写供应商、用途、报废原因等" /></label><p className="hint">时间将自动生成：{formatDate(new Date().toISOString())}</p><button className="primary-btn dark" type="submit">提交保存</button></form>;
}

function StatsPage({ records }) {
  const stats = useMemo(() => aggregate(records, (r) => `${r.material}-${r.unit}`, (r) => ({ material: r.material, unit: r.unit, inbound: 0, outbound: 0, scrap: 0 })), [records]);
  return <section className="panel"><h2>库存统计</h2>{stats.length === 0 ? <Empty /> : <div className="list">{stats.map((s) => <article className="stat-card" key={`${s.material}-${s.unit}`}><strong>{s.material}</strong><b>{s.inbound - s.outbound - s.scrap} {s.unit}</b><span>入库 {s.inbound} / 出库 {s.outbound} / 报废 {s.scrap}</span></article>)}</div>}</section>;
}

function ScrapStatsPage({ records }) {
  const scrap = records.filter((r) => r.type === 'scrap');
  const stats = useMemo(() => aggregate(scrap, (r) => `${r.productModel}-${r.process}-${r.material}-${r.unit}`, (r) => ({ productModel: r.productModel, process: r.process, material: r.material, unit: r.unit, scrap: 0 })), [records]);
  return <section className="panel"><h2>报废统计</h2>{stats.length === 0 ? <Empty /> : <div className="list">{stats.map((s) => <article className="stat-card" key={`${s.productModel}-${s.process}-${s.material}-${s.unit}`}><strong>{s.productModel} · {s.process}</strong><b>{s.scrap} {s.unit}</b><span>{s.material}</span></article>)}</div>}</section>;
}

function KpiPage({ records }) {
  const stats = useMemo(() => aggregate(records, (r) => `${r.employeeId}-${r.employeeName}`, (r) => ({ employeeId: r.employeeId, employeeName: r.employeeName, count: 0, inbound: 0, outbound: 0, scrap: 0 })), [records]);
  return <section className="panel"><h2>员工KPI统计</h2>{stats.length === 0 ? <Empty /> : <div className="list">{stats.map((s) => <article className="stat-card" key={`${s.employeeId}-${s.employeeName}`}><strong>{s.employeeName}（{s.employeeId}）</strong><b>{s.count} 单</b><span>入库 {s.inbound} / 出库 {s.outbound} / 报废 {s.scrap}</span></article>)}</div>}</section>;
}

function aggregate(records, keyFn, initFn) {
  const map = new Map();
  records.forEach((r) => {
    const key = keyFn(r);
    const item = map.get(key) || initFn(r);
    item.count = (item.count || 0) + 1;
    item[r.type] = (item[r.type] || 0) + Number(r.quantity || 0);
    map.set(key, item);
  });
  return [...map.values()];
}

function AdminPage({ records, settings, onSaveSettings, onExport, onRefresh }) {
  const [form, setForm] = useState(settings);
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return <section className="panel form"><div className="row"><h2>老板后台</h2><button className="small-btn" onClick={onRefresh}>刷新</button></div><div className="admin-metrics"><strong>{records.length}</strong><span>全量记录</span><strong>{new Set(records.map((r) => r.employeeId)).size}</strong><span>员工数</span></div><label className="field"><span>Supabase URL</span><input value={form.url} onChange={(e) => update('url', e.target.value)} placeholder="https://xxxx.supabase.co" /></label><label className="field"><span>Supabase anon key</span><input value={form.anonKey} onChange={(e) => update('anonKey', e.target.value)} placeholder="粘贴 anon public key" /></label><label className="field"><span>数据表名</span><input value={form.table} onChange={(e) => update('table', e.target.value)} placeholder="material_records" /></label><button className="primary-btn" onClick={() => onSaveSettings(form)}>保存云同步配置</button><button className="primary-btn dark" onClick={onExport} disabled={!records.length}>导出 Excel CSV</button><div className="list">{records.slice(0, 20).map((r) => <RecordCard record={r} key={r.id} />)}</div></section>;
}

function RecordsPage({ records, onExport, onClear }) {
  return <section className="panel"><div className="row"><h2>操作记录</h2><button className="small-btn" onClick={onExport} disabled={!records.length}>导出 Excel CSV</button></div>{records.length === 0 ? <Empty /> : <div className="list">{records.map((r) => <RecordCard record={r} key={r.id} />)}</div>}<button className="danger-btn" onClick={onClear} disabled={!records.length}>清空本机记录</button></section>;
}

function RecordCard({ record: r }) {
  return <article className="record-card"><div><b className={r.type}>{ACTIONS[r.type].label}</b><strong>{r.material} {r.quantity}{r.unit}</strong></div><p>员工：{r.employeeName}（{r.employeeId}）</p><p>型号/工序：{r.productModel} · {r.process}</p><p>编号：{r.code}</p><p>{formatDate(r.createdAt)}</p>{r.note && <p>备注：{r.note}</p>}</article>;
}

function Empty() {
  return <p className="empty">暂无数据，请先扫码登记。</p>;
}

createRoot(document.getElementById('root')).render(<App />);
