import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const STORAGE_KEY = 'material_inventory_records_v1';
const MATERIALS = ['塑料粒子', 'PU原料', 'ABS', 'PP', '回料', '色粉'];
const UNITS = ['kg', '包', '桶'];
const ACTIONS = {
  inbound: { label: '入库', sign: 1, color: 'green' },
  outbound: { label: '出库', sign: -1, color: 'orange' },
};

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function formatDate(iso) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

function makeCsv(records) {
  const headers = ['时间', '操作类型', '扫码编号', '原材料名称', '数量', '单位', '操作人', '备注'];
  const rows = records.map((r) => [
    formatDate(r.createdAt),
    ACTIONS[r.type]?.label || r.type,
    r.code,
    r.material,
    r.quantity,
    r.unit,
    r.operator,
    r.note,
  ]);
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `\uFEFF${[headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')}`;
}

function downloadCsv(records) {
  const blob = new Blob([makeCsv(records)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `原材料进出库记录-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function App() {
  const [page, setPage] = useState('home');
  const [scanType, setScanType] = useState('inbound');
  const [scanCode, setScanCode] = useState('');
  const [records, setRecords] = useState(loadRecords);

  useEffect(() => saveRecords(records), [records]);

  const goScan = (type) => {
    setScanType(type);
    setScanCode('');
    setPage('scan');
  };

  const startRegister = (code) => {
    setScanCode(code || `MANUAL-${Date.now()}`);
    setPage('register');
  };

  const addRecord = (record) => {
    setRecords((prev) => [{ id: crypto.randomUUID(), ...record }, ...prev]);
    setPage('records');
  };

  return (
    <main className="app-shell">
      <Header page={page} onBack={() => setPage('home')} />
      {page === 'home' && <Home onScan={goScan} onNavigate={setPage} records={records} />}
      {page === 'scan' && <ScanPage type={scanType} onSubmit={startRegister} />}
      {page === 'register' && <RegisterPage type={scanType} code={scanCode} onSubmit={addRecord} />}
      {page === 'stats' && <StatsPage records={records} />}
      {page === 'records' && <RecordsPage records={records} onExport={() => downloadCsv(records)} onClear={() => setRecords([])} />}
    </main>
  );
}

function Header({ page, onBack }) {
  return (
    <header className="header">
      {page !== 'home' && <button className="back-btn" onClick={onBack}>返回</button>}
      <div>
        <p className="eyebrow">车间移动端</p>
        <h1>原材料扫码进出库</h1>
      </div>
    </header>
  );
}

function Home({ onScan, onNavigate, records }) {
  return (
    <section className="home-grid">
      <ActionCard className="green" title="扫码入库" desc="原料到货、退回入库" onClick={() => onScan('inbound')} />
      <ActionCard className="orange" title="扫码出库" desc="生产领料、消耗出库" onClick={() => onScan('outbound')} />
      <ActionCard title="库存统计" desc="自动计算当前库存" onClick={() => onNavigate('stats')} />
      <ActionCard title="操作记录" desc={`查看与导出 ${records.length} 条记录`} onClick={() => onNavigate('records')} />
    </section>
  );
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

  return (
    <section className="panel">
      <h2>{ACTIONS[type].label}扫码</h2>
      <video ref={videoRef} className="scanner-video" muted playsInline />
      <button className="primary-btn" onClick={startCamera}>打开摄像头扫码</button>
      <p className="hint">{cameraMsg}</p>
      <label className="field"><span>扫码编号 / 批次号</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="请扫描或输入编号" /></label>
      <button className="primary-btn dark" onClick={() => onSubmit(code)} disabled={!code.trim()}>进入登记页面</button>
    </section>
  );
}

function RegisterPage({ type, code, onSubmit }) {
  const [form, setForm] = useState({ material: MATERIALS[0], quantity: '', unit: UNITS[0], operator: '', note: '' });
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ type, code, ...form, quantity: Number(form.quantity), createdAt: new Date().toISOString() });
  };
  return (
    <form className="panel form" onSubmit={submit}>
      <h2>{ACTIONS[type].label}登记</h2>
      <div className={`type-badge ${ACTIONS[type].color}`}>操作类型：{ACTIONS[type].label}</div>
      <label className="field"><span>扫码编号</span><input value={code} readOnly /></label>
      <label className="field"><span>原材料名称</span><select value={form.material} onChange={(e) => update('material', e.target.value)}>{MATERIALS.map((m) => <option key={m}>{m}</option>)}</select></label>
      <label className="field"><span>数量</span><input type="number" min="0.01" step="0.01" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} required placeholder="请输入数量" /></label>
      <label className="field"><span>单位</span><select value={form.unit} onChange={(e) => update('unit', e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
      <label className="field"><span>操作人</span><input value={form.operator} onChange={(e) => update('operator', e.target.value)} required placeholder="请输入姓名" /></label>
      <label className="field"><span>备注</span><textarea value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="可填写供应商、用途等" /></label>
      <p className="hint">时间将自动生成：{formatDate(new Date().toISOString())}</p>
      <button className="primary-btn dark" type="submit">提交保存</button>
    </form>
  );
}

function StatsPage({ records }) {
  const stats = useMemo(() => {
    const map = new Map();
    records.forEach((r) => {
      const key = `${r.material}-${r.unit}`;
      const current = map.get(key) || { material: r.material, unit: r.unit, inbound: 0, outbound: 0 };
      current[r.type] += Number(r.quantity || 0);
      map.set(key, current);
    });
    return [...map.values()].map((s) => ({ ...s, stock: s.inbound - s.outbound }));
  }, [records]);
  return <section className="panel"><h2>库存统计</h2>{stats.length === 0 ? <Empty /> : <div className="list">{stats.map((s) => <article className="stat-card" key={`${s.material}-${s.unit}`}><strong>{s.material}</strong><b>{s.stock} {s.unit}</b><span>入库 {s.inbound} / 出库 {s.outbound}</span></article>)}</div>}</section>;
}

function RecordsPage({ records, onExport, onClear }) {
  return <section className="panel"><div className="row"><h2>操作记录</h2><button className="small-btn" onClick={onExport} disabled={!records.length}>导出 CSV</button></div>{records.length === 0 ? <Empty /> : <div className="list">{records.map((r) => <article className="record-card" key={r.id}><div><b className={r.type}>{ACTIONS[r.type].label}</b><strong>{r.material} {r.quantity}{r.unit}</strong></div><p>编号：{r.code}</p><p>操作人：{r.operator} · {formatDate(r.createdAt)}</p>{r.note && <p>备注：{r.note}</p>}</article>)}</div>}<button className="danger-btn" onClick={onClear} disabled={!records.length}>清空本机记录</button></section>;
}

function Empty() {
  return <p className="empty">暂无数据，请先扫码登记。</p>;
}

createRoot(document.getElementById('root')).render(<App />);
