import { t } from './i18n';
import type { CatalogEntry, Device, DeviceKind, DeviceVariant } from './types';
const CATALOG_DEFINITIONS: CatalogEntry[] = [
  {kind:'outlet',group:'outlets',label:'Dugalj',short:'D',category:'floor',description:'Védőérintkezős dugalj'},
  {kind:'switch',group:'switches',label:'Kapcsoló',short:'K',category:'floor',description:'Egypólusú kapcsoló (101)'},
  {kind:'light',group:'lights',label:'Lámpa',short:'L',category:'floor',description:'Világítási kiállás'},
  {kind:'junction',group:'connections',label:'Kötődoboz',short:'KD',category:'floor',description:'Hozzáférhető kötési pont'},
  {kind:'sensor',group:'control',label:'Érzékelő',short:'É',category:'floor',description:'Egyedi okosotthon-jel'},
  {kind:'relay',group:'control',label:'Relémodul',short:'R',category:'floor',description:'Egyedi vezérlőmodul'},
  {kind:'hub',group:'control',label:'Központ',short:'H',category:'floor',description:'Egyedi okosotthon-központ'},
  {kind:'breaker',label:'Kismegszakító',short:'QF',category:'board',moduleWidth:1,description:'Kézzel megadott névleges adatok'},
  {kind:'rcd',label:'FI-relé',short:'FI',category:'board',moduleWidth:2,description:'Áram-védőkapcsoló'},
  {kind:'rcbo',label:'Kombinált védelem',short:'RC',category:'board',moduleWidth:2,description:'Túláram- és hibaáramvédelem'},
  {kind:'spd',label:'Túlfeszültség-védelem',short:'SPD',category:'board',moduleWidth:4,description:'Egyedi gyártói modulszélesség'},
  {kind:'main',label:'Főkapcsoló',short:'Q',category:'board',moduleWidth:2,description:'Elosztó főkapcsolója'},
  {kind:'blank',label:'Tartalékhely',short:'T',category:'board',moduleWidth:1,description:'Tervezett tartalékhely'},
  {kind:'custom',label:'Egyedi készülék',short:'X',category:'board',moduleWidth:1,description:'Megadható típus és modulszélesség'},
  {kind:'custom',variant:'board-terminal',label:'Sorkapocs',short:'XT',category:'board',moduleWidth:29/18,description:'Egyedi sorkapocs'},
  {kind:'custom',variant:'board-mpcb',label:'Motorvédő',short:'QM',category:'board',moduleWidth:3,description:'Egyedi motorvédő'},
  {kind:'custom',variant:'board-meter',label:'Fogyasztásmérő',short:'EM',category:'board',moduleWidth:4,description:'Egyedi fogyasztásmérő'},
  {kind:'switch',variant:'switch-double-pole',group:'switches',label:'Kétpólusú kapcsoló',short:'K',category:'floor',description:'Kétpólusú kapcsoló (102)'},
  {kind:'switch',variant:'switch-series',group:'switches',label:'Csillárkapcsoló',short:'K',category:'floor',description:'Kétáramkörös kapcsoló (105)'},
  {kind:'switch',variant:'switch-two-way',group:'switches',label:'Váltókapcsoló',short:'K',category:'floor',description:'Váltókapcsoló (106)'},
  {kind:'switch',variant:'switch-intermediate',group:'switches',label:'Keresztkapcsoló',short:'K',category:'floor',description:'Keresztkapcsoló (107)'},
  {kind:'switch',variant:'switch-double-two-way',group:'switches',label:'Kettős váltókapcsoló',short:'K',category:'floor',description:'Kettős váltókapcsoló (106+106)'},
  {kind:'switch',variant:'switch-dimmer',group:'switches',label:'Fényerőszabályzó',short:'K',category:'floor',description:'Fényerőszabályzó'},
  {kind:'switch',variant:'switch-push-button',group:'switches',label:'Nyomógomb',short:'K',category:'floor',description:'Nyomógomb'},
  {kind:'switch',variant:'switch-push-button-lit',group:'switches',label:'Jelzőfényes nyomógomb',short:'K',category:'floor',description:'Jelzőfényes nyomógomb'},
  {kind:'outlet',variant:'outlet-double',group:'outlets',label:'Kettős dugalj',short:'D',category:'floor',description:'Kettős védőérintkezős dugalj'},
  {kind:'outlet',variant:'outlet-weatherproof',group:'outlets',label:'Fröccsenő víz ellen védett dugalj',short:'D',category:'floor',description:'A pontos IP-védettség a kiválasztott terméktől függ.'},
  {kind:'outlet',variant:'outlet-three-phase',group:'outlets',label:'Háromfázisú dugalj',short:'D',category:'floor',description:'Háromfázisú dugalj'},
  {kind:'light',variant:'light-wall',group:'lights',label:'Fali lámpa',short:'L',category:'floor',description:'Fali lámpa'},
  {kind:'light',variant:'light-linear',group:'lights',label:'Vonalas lámpatest',short:'L',category:'floor',description:'Vonalas lámpatest'},
  {kind:'light',variant:'light-led-strip',group:'lights',label:'LED-szalag',short:'L',category:'floor',description:'LED-szalag'},
  {kind:'sensor',variant:'sensor-motion',group:'control',label:'Mozgásérzékelő',short:'É',category:'floor',description:'Mozgásérzékelő'},
  {kind:'sensor',variant:'sensor-thermostat',group:'control',label:'Termosztát',short:'É',category:'floor',description:'Termosztát'},
  {kind:'custom',variant:'custom-tv',group:'connections',label:'TV-csatlakozó',short:'TV',category:'floor',description:'TV-csatlakozó'},
  {kind:'custom',variant:'custom-data',group:'connections',label:'Adatcsatlakozó (RJ45)',short:'LAN',category:'floor',description:'Adatcsatlakozó (RJ45)'},
  {kind:'custom',variant:'custom-phone',group:'connections',label:'Telefoncsatlakozó',short:'TP',category:'floor',description:'Telefoncsatlakozó'},
  {kind:'custom',variant:'custom-bell',group:'connections',label:'Csengő',short:'CS',category:'floor',description:'Csengő'},
];
export const CATALOG: CatalogEntry[] = CATALOG_DEFINITIONS.map(entry => ({
  ...entry,
  get label() { return t(entry.label); },
  get description() { return t(entry.description); },
}));
export const catalogEntryId = (entry: Pick<CatalogEntry, 'kind'|'variant'>): string => entry.variant ?? entry.kind;
export const kindLabel = (kind: DeviceKind) => CATALOG.find(c => c.kind === kind && !c.variant)?.label ?? kind;
export const deviceLabel = (device: Pick<Device, 'kind'|'variant'>): string => CATALOG.find(c => c.kind === device.kind && c.variant === device.variant)?.label ?? kindLabel(device.kind);
export const isDeviceVariantForKind = (value: unknown, kind: unknown): value is DeviceVariant => typeof value === 'string' && CATALOG_DEFINITIONS.some(entry => entry.variant === value && entry.kind === kind);
export const uid = ():string => {
  if(crypto.randomUUID)return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
export function makeDevice(kind: DeviceKind, devices: Device[], variant?: DeviceVariant): Device {
  const e = CATALOG.find(c => c.kind === kind && c.variant === variant);
  if (!e) throw new Error(t('Ismeretlen készülékváltozat.'));
  let n = 1; while (devices.some(d => d.code === `${e.short}${n}`)) n++;
  const electrical = variant==='board-terminal' ? {role:'terminal' as const,poles:['L1','L1'] as const}
    : variant==='board-mpcb' ? {role:'mpcb' as const,poles:['L1','L2','L3'] as const}
    : variant==='board-meter' ? {role:'meter' as const,poles:['L1','L2','L3','N'] as const} : undefined;
  return { id:uid(),code:`${e.short}${n}`,name:e.label,kind,...(variant?{variant}:{}),room:'',heightMm:kind==='outlet'?300:kind==='switch'?1100:0,model:'',notes:'',status:'planned',moduleWidth:e.moduleWidth,photoIds:[],rating:kind==='breaker'?'B16':kind==='rcd'?'40 A / 30 mA':'',...(electrical?{electrical:{...electrical,poles:[...electrical.poles]}}:{}) };
}
