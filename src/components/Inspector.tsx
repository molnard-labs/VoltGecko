import { t, getLanguage, getLocale } from '../i18n';
import { Camera, Check, ChevronRight, MapPin, RotateCw, Trash2, X, Zap } from 'lucide-react';
import type { Asset, Device, ProjectData } from '../types';
import { deviceLabel } from '../catalog';
import { ElectricalDeviceFields } from './ElectricalDeviceFields';
import { PlanImageFields } from './PlanImageFields';
import { placeBoardDevice } from '../data/boardPlacement';
import { setDeviceCircuit } from '../data/floorRouteCircuit';
interface Props { data:ProjectData; assets:Record<string,Asset>; device:Device|null; boardId?:string; onChange:(data:ProjectData)=>void; onNotify:(message:string)=>void; onClose:()=>void; onDelete:(id:string)=>void; onPhoto:(files:FileList)=>void; onPlanImage:(file:File)=>void; onLocate:(id:string)=>void }
export function Inspector({data,assets,device,boardId,onChange,onNotify,onClose,onDelete,onPhoto,onPlanImage,onLocate}:Props) {
  const update = (patch:Partial<Device>) => { if(!device)return;onChange({...data,devices:data.devices.map(d=>d.id===device.id?{...d,...patch}:d)}); };
  if(!device)return <aside className="inspector empty-inspector"><div className="panel-title"><span>{t("Tervadatok")}</span><span className="small-tag">{t("HELYI")}</span></div><div className="inspector-intro"><div className="inspector-illustration"><Zap size={30}/></div><h3>{t("Minden pontnak helye van.")}</h3><p>{t("Válassz egy eszközt a rajzon vagy az elosztóban a részletek szerkesztéséhez.")}</p></div><div className="project-summary"><span className="eyebrow">{t("A PROJEKT SZÁMOKBAN")}</span><dl><div><dt>{t("Eszköz")}</dt><dd>{data.devices.length}</dd></div><div><dt>{t("Áramkör")}</dt><dd>{data.circuits.length}</dd></div><div><dt>{t("Tervlap")}</dt><dd>{data.sheets.length}</dd></div><div><dt>{t("Elosztó")}</dt><dd>{data.boards.length}</dd></div></dl></div><div className="field-note"><Check size={17}/><p><strong>{t("A munka nálad marad.")}</strong><br/>{t("A módosításokat ez a böngésző menti. Készíts projektfájlt is, hogy másik eszközön folytathasd.")}</p></div></aside>;
  const circuit = data.circuits.find(c=>c.id===device.circuitId);
  const placement = data.sheets.flatMap(s=>s.placements).find(p=>p.deviceId===device.id);
  const duplicate = data.devices.some(d=>d.id!==device.id&&d.code===device.code);
  const board = boardId === undefined ? undefined : data.boards.find(item=>item.id===boardId) ?? data.boards[0];
  const boardRow = board?.rows.find(row=>row.placements.some(placement=>placement.deviceId===device.id));
  const boardPlacement = boardRow?.placements.find(placement=>placement.deviceId===device.id);
  const place = (rowId:string,start?:number) => {
    if(!board)return;
    try { onChange(placeBoardDevice(data,board.id,rowId,device.id,start)); }
    catch(error) { onNotify(error instanceof Error ? error.message : String(error)); }
  };
  return <aside className="inspector has-selection"><div className="panel-title"><span>{t("Eszköz részletei")}</span><button className="icon-button" aria-label={t("Kijelölés bezárása")} onClick={onClose}><X size={17}/></button></div><div className="selected-device-heading"><span className="device-badge" style={{background:circuit?.color??'#145b4b'}}>{device.code}</span><div><span className="eyebrow">{deviceLabel(device)}</span><h3>{device.name}</h3></div></div><div className="inspector-fields">
    {board&&device.moduleWidth!==undefined&&<div className="placement-editor">
      <strong>{t("Kijelölt készülék helye")}</strong>
      <div className="row-actions">
        <select aria-label={t("Készülék sora")} value={boardRow?.id??''} onChange={event=>{if(event.target.value)place(event.target.value);}}>
          <option value="">{t("Nincs elhelyezve")}</option>
          {board.rows.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <label>{t("Kezdőhely")} <input aria-label={t("Kezdő modulhely")} type="number" min="1" step="0.5" value={(boardPlacement?.start??0)+1} onChange={event=>{const start=Number(event.target.value);if(boardRow&&start>=1)place(boardRow.id,start-1);}}/></label>
        <button className="quiet" onClick={()=>{
          const next=structuredClone(data),target=next.boards.find(item=>item.id===board.id)!;
          target.rows.forEach(row=>{row.placements=row.placements.filter(placement=>placement.deviceId!==device.id);});
          onChange(next);
          onNotify(t("A készülék lekerült az elosztóról."));
        }}>{t("Levétel a sínről")}</button>
      </div>
    </div>}
    {device.product&&<div className="manufacturer-details"><span className="eyebrow">{t('Gyártói termékadatok')}</span><strong>{device.product.reference}</strong><span>{device.product.manufacturer} · {device.product.range}</span>{device.product.description?.[getLanguage()]&&<p>{device.product.description[getLanguage()]}</p>}{device.product.moduleWidth!==undefined&&<span>{t('Gyártói modulszélesség: {width} M',{width:device.product.moduleWidth.toLocaleString(getLocale())})}</span>}{device.product.moduleWidth!==undefined&&device.moduleWidth!==device.product.moduleWidth&&<p className="input-warning">{t('A modulszélesség eltér a gyártói adatból átvett értéktől.')}</p>}<a href={device.product.sourceUrl} target="_blank" rel="noreferrer noopener">{t('Gyártói forrás')} · {device.product.sourcePage}</a>{device.product.supplementalSourceUrl&&<a href={device.product.supplementalSourceUrl} target="_blank" rel="noreferrer noopener">{t('Kiegészítő gyártói adatlap')}</a>}</div>}
    {device.product?.mounting==='accessory'&&<label>{t('Mennyiség (db)')}<input type="number" min="1" max="1000000" step="1" value={device.quantity??1} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=1000000)update({quantity:n});}}/></label>}
    <div className="field-row"><label>{t("Azonosító")}<input aria-label={t("Eszköz azonosítója")} value={device.code} onChange={e=>update({code:e.target.value})}/></label><label>{t("Állapot")}<select aria-label={t("Eszköz állapota")} value={device.status} onChange={e=>update({status:e.target.value as Device['status']})}><option value="planned">{t("Tervezett")}</option><option value="installed">{t("Felszerelt")}</option><option value="verified">{t("Ellenőrzött")}</option></select></label></div>{duplicate&&<p className="input-warning">{t("Ez az azonosító már másik eszköznél is szerepel.")}</p>}
    <label>{t("Megnevezés")}<input aria-label={t("Eszköz neve")} value={device.name} onChange={e=>update({name:e.target.value})}/></label>
    <label>{t("Helyiség")}<input aria-label={t("Helyiség")} list="room-list" placeholder={t("Pl. nappali")} value={device.room} onChange={e=>update({room:e.target.value})}/><datalist id="room-list">{[...new Set(data.devices.map(d=>d.room).filter(Boolean))].map(r=><option key={r} value={r}/>)}</datalist></label>
    <label>{t("Áramkör")}<select aria-label={t("Eszköz áramköre")} value={device.circuitId??''} onChange={e=>onChange(setDeviceCircuit(data,device.id,e.target.value||undefined))}><option value="">{t("Nincs hozzárendelve")}</option>{data.circuits.map(c=><option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
    <div className="field-row"><label>{t("Magasság (mm)")}<input aria-label={t("Szerelési magasság")} type="number" min="0" value={device.heightMm} onChange={e=>update({heightMm:Math.max(0,Number(e.target.value))})}/></label>{device.moduleWidth!==undefined?<label>{t("Szélesség (modul)")}<input aria-label={t("Modulszélesség")} type="number" min="0.5" max="144" step="0.5" value={device.moduleWidth} onChange={e=>{const n=Number(e.target.value);if(n>=.5&&n<=144)update({moduleWidth:n});}}/></label>:<label>{t("Forgatás")}<button className="rotation-button" onClick={()=>{const next=structuredClone(data);next.sheets.forEach(s=>s.placements.forEach(p=>{if(p.deviceId===device.id)p.rotation=(p.rotation+90)%360;}));onChange(next);}}><RotateCw size={14}/>{placement?.rotation??0}°</button></label>}</div>
    <label>{t("Típus / gyártó")}<input aria-label={t("Eszköz típusa")} placeholder={t("Gyártó és cikkszám")} value={device.model} onChange={e=>update({model:e.target.value})}/></label>
    {device.moduleWidth!==undefined&&<label>{t("Névleges adatok")}<input aria-label={t("Névleges adatok")} value={device.rating??''} onChange={e=>update({rating:e.target.value})}/></label>}
    {device.moduleWidth!==undefined&&device.kind!=='blank'&&<ElectricalDeviceFields key={device.id} data={data} device={device} onChange={electrical=>update({electrical})}/>}
    <label>{t("Megjegyzés")}<textarea aria-label={t("Eszköz megjegyzése")} rows={3} placeholder={t("Amit a helyszínen is tudni kell…")} value={device.notes} onChange={e=>update({notes:e.target.value})}/></label>
    <PlanImageFields device={device} assets={assets} onChange={planImage=>update({planImage})} onUpload={onPlanImage}/>
    <div className="photo-section"><div className="section-label"><span>{t("Helyszíni fotók")}</span><label className="icon-button photo-upload" title={t("Fotó hozzáadása")}><Camera size={18}/><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>{if(e.target.files)onPhoto(e.target.files);e.target.value='';}}/></label></div><div className="photo-grid">{device.photoIds.map(id=>assets[id]&&<div key={id}><a href={assets[id].data} target="_blank" rel="noreferrer"><img src={assets[id].data} alt={assets[id].name}/></a><button aria-label={t("Fotó eltávolítása")} onClick={()=>update({photoIds:device.photoIds.filter(p=>p!==id)})}><X size={12}/></button></div>)}</div>{!device.photoIds.length&&<p className="subtle">{t("A fotók a projektfájlba is bekerülnek.")}</p>}</div>
    {placement&&<button className="quiet full" onClick={()=>onLocate(device.id)}><MapPin size={15}/>{t("Mutasd az alaprajzon")}<ChevronRight size={14}/></button>}
    <button className="danger-button full" onClick={()=>onDelete(device.id)}><Trash2 size={15}/>{t("Eszköz törlése")}</button>
  </div></aside>;
}
