import { t, getLocale } from '../i18n';
import { Plus, Trash2, AlertTriangle, LayoutGrid, ArrowRight } from 'lucide-react';
import type { Board, Device, ProjectData } from '../types';
import { uid } from '../catalog';
import { BoardConnections } from './BoardConnections';
import { BoardWiringEditor } from './BoardWiringEditor';
import { getAvailableBoardDevices, getBoardIssues, placeBoardDevice } from '../data/boardPlacement';
import { deleteBoard } from '../data/project';

interface Props { data: ProjectData; boardId:string; onBoardChange:(id:string)=>void; selectedId: string | null; onSelect: (id: string | null) => void; onChange: (data: ProjectData) => void; onNotify: (text: string) => void }
export function BoardEditor({ data, boardId:active, onBoardChange:setActive, selectedId, onSelect, onChange, onNotify }: Props) {
  const formatNumber = (value: number) => value.toLocaleString(getLocale());
  const board = data.boards.find(b => b.id === active) ?? data.boards[0];
  const update = (fn: (board: Board) => void) => { const next = structuredClone(data); const target = next.boards.find(b => b.id === board.id)!; fn(target); onChange(next); };
  const issues = board ? getBoardIssues(board, data.devices) : [];
  const available = getAvailableBoardDevices(data);
  const addBoard = () => {
    const name = prompt(t("Az elosztó neve:"), t('Elosztó {number}', {number:data.boards.length + 1})); if (!name?.trim()) return;
    const id = uid(); onChange({ ...data, boards: [...data.boards, { id, name: name.trim(), rows: [{id:uid(),name:t('{number}. sor', {number:1}),capacity:12,placements:[]}] }] }); setActive(id);
  };
  const removeBoard = () => {
    if (!board || !confirm(t('Törlöd a(z) „{name}” elosztót? A készülékek megmaradnak, de az elosztó sorai, sínjei, betáplálásai és vezetékei, valamint a törölt sínekhez vagy betáplálásokhoz kapcsolódó más elosztók vezetékei törlődnek.', {name: board.name}))) return;
    const next = deleteBoard(data, board.id);
    onChange(next);
    setActive(next.boards[0]?.id ?? '');
    onSelect(null);
    onNotify(t('Az elosztó törölve.'));
  };
  const place = (device: Device, rowId: string, start?: number) => {
    try { onChange(placeBoardDevice(data, board.id, rowId, device.id, start)); onSelect(device.id); }
    catch (error) { onNotify(error instanceof Error ? error.message : String(error)); }
  };
  if (!board) return <div className="empty"><LayoutGrid size={40}/><h2>{t("Kezdj egy elosztóval")}</h2><p>{t("Add meg a sorokat, majd helyezd el a készülékeket.")}</p><button className="primary" onClick={addBoard}><Plus size={16}/>{t("Elosztó létrehozása")}</button></div>;
  const total = board.rows.reduce((sum, r) => sum + r.capacity, 0);
  const used = board.rows.flatMap(r=>r.placements).reduce((sum,p)=>sum+(data.devices.find(d=>d.id===p.deviceId)?.moduleWidth??1),0);
  return <div className="board-editor">
    <div className="section-heading"><div><span className="eyebrow">{t("ELOSZTÓTERVEZŐ")}</span><h2>{board.name}</h2><p>{t("Készülékek és modulhelyek, egy helyen.")}</p></div><div className="row-actions"><select aria-label={t("Aktív elosztó")} value={board.id} onChange={e=>setActive(e.target.value)}>{data.boards.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select><button className="icon-button" title={t("Új elosztó")} onClick={addBoard}><Plus size={18}/></button><button className="icon-button danger-hover" title={t('Elosztó törlése')} aria-label={t('Elosztó törlése')} onClick={removeBoard}><Trash2 size={18}/></button></div></div>
    <div className="board-stats"><div><span>{t("Összes modulhely")}</span><strong>{formatNumber(total)}<small>M</small></strong></div><div><span>{t("Tervezett foglaltság")}</span><strong>{formatNumber(used)}<small>M</small></strong></div><div><span>{t("Szabad kapacitás")}</span><strong className={used>total?'danger-text':'green-text'}>{formatNumber(total-used)}<small>M</small></strong></div><div><span>{t("Tervezési jelzések")}</span><strong className={issues.length?'amber-text':''}>{issues.length}</strong></div></div>
    {board.product&&<div className="board-manufacturer"><strong>{board.product.manufacturer} · {board.product.reference}</strong><span>{board.product.range}</span><a href={board.product.sourceUrl} target="_blank" rel="noreferrer noopener">{t('Gyártói forrás')} · {board.product.sourcePage}</a></div>}
    <div className="board-surface board-row-controls">
      <div className="cabinet-label"><span>{t("DIN / MODULKIOSZTÁS")}</span><span>{t('{count} sor · {total} M', {count:board.rows.length,total:formatNumber(total)})}</span></div>
      {board.rows.map((row, rowIndex) => {
        return <div className="board-row-control" key={row.id}>
          <div className="board-row-control-heading"><input aria-label={t('{number}. sor neve', {number:rowIndex+1})} value={row.name} onChange={e=>update(b=>{b.rows[rowIndex].name=e.target.value;})}/><label>{t("Kapacitás")} <input aria-label={t('{number}. sor kapacitása', {number:rowIndex+1})} type="number" min="1" max="144" value={row.capacity} onChange={e=>{const n=Number(e.target.value);if(n>=1&&n<=144) update(b=>{b.rows[rowIndex].capacity=n;});}}/> M</label><button className="icon-button danger-hover" title={t("Sor törlése")} onClick={()=>{if(confirm(t("Törlöd a sort? A készülékek a projektben megmaradnak."))) update(b=>{b.rows.splice(rowIndex,1);b.wiring?.buses.forEach(bus=>{if(bus.rowId===row.id)bus.rowId=undefined;});});}}><Trash2 size={15}/></button></div>
          <div className="board-row-control-footer"><span>{t('{count} készülék', {count:row.placements.length})}</span><div className="row-actions"><select aria-label={t('{name}: készülék elhelyezése', {name:row.name})} defaultValue="" onChange={e=>{const d=available.find(d=>d.id===e.target.value);if(d)place(d,row.id);e.target.value='';}}><option value="">{t("+ Készülék elhelyezése")}</option>{available.map(d=><option value={d.id} key={d.id}>{d.code} · {d.name} ({formatNumber(d.moduleWidth??1)} M)</option>)}</select></div></div>
        </div>;
      })}
      <button className="add-row" onClick={()=>update(b=>b.rows.push({id:uid(),name:t('{number}. sor', {number:b.rows.length+1}),capacity:12,placements:[]}))}><Plus size={17}/>{t("Új DIN-sor")}</button>
    </div>
    {issues.length>0&&<div className="validation-box"><h3><AlertTriangle size={16}/>{t("Ellenőrizendő kiosztás")}</h3>{issues.map((i,n)=><p key={n}>{i.message}</p>)}</div>}
    {data.devices.some(d=>d.boardId===board.id&&d.product?.mounting==='accessory')&&<section className="board-accessories"><h3>{t('Elosztó tartozékai')}</h3><p className="subtle">{t('Tartozékok az anyaglistában, DIN-modulhely foglalása nélkül.')}</p>{data.devices.filter(d=>d.boardId===board.id&&d.product?.mounting==='accessory').map(d=><button key={d.id} className={selectedId===d.id?'selected':''} onClick={()=>onSelect(d.id)}><strong>{d.product!.reference}</strong><span>{d.name}</span><small>{d.quantity??1} {t('db')}</small></button>)}</section>}
    <BoardWiringEditor key={board.id} data={data} board={board} selectedId={selectedId} onChange={onChange} onNotify={onNotify} onSelect={onSelect} onPlaceDevice={(deviceId,rowId,start)=>{const device=data.devices.find(item=>item.id===deviceId);if(device)place(device,rowId,start);}}/>
    <BoardConnections data={data} board={board} onChange={onChange} onNotify={onNotify} onSelect={id=>onSelect(id)}/>
    <p className="subtle board-hint"><ArrowRight size={15}/>{t("A bal oldali készüléktárból adj hozzá elemeket. A sor alatti listából érintéssel is elhelyezhetők.")}</p>
  </div>;
}
