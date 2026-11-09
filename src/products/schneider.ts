import source from './schneider-source.json';
import type { CatalogProduct } from './types';
import type { DeviceElectrical } from '../types';
import { easy9NeutralPoleCount } from './easy9PoleOrder';

// Left-to-right neutral position is documented for these Easy9 devices:
// https://www.se.com/hu/hu/product/download-pdf/EZ9R49240
// https://shop.borosesfiai.hu/custom/ivill/image/data/srattached/18ca388c406a864b08d438d063098e4c_SCHNEIDER-EZ9R49440-Adatlap.pdf
// https://shop.borosesfiai.hu/custom/ivill/image/data/srattached/482347cde385601410072b3da6b8bf7f_SCHNEIDER-EZ9D55716-Adatlap.pdf
// Do not infer neutral position from pole count for other product families.
function verifiedEasy9Electrical(p: ManufacturerFact): DeviceElectrical | undefined {
  if ((p.category !== 'rccb' && p.category !== 'rcbo') || p.family !== 'Easy9 Pro') return undefined;
  const count = easy9NeutralPoleCount(p.sku);
  const poles = count === 2 ? ['N', 'L'] as const
    : count === 4 ? ['N', 'L1', 'L2', 'L3'] as const : undefined;
  return poles ? { role: p.category, poles: [...poles] } : undefined;
}

// Each bundled image is matched to its exact manufacturer reference. Data URLs
// keep the photos available offline and in exported standalone drawings.
const productImages = import.meta.glob<string>('./schneider-images/*.webp', {
  eager: true,
  query: '?inline',
  import: 'default'
});

/** Catalogue photos are representative and labelled as illustrations in the UI.
 * DIN devices are matched by pole count; cabinet pictures may differ in size. */
function catalogueImage(p: ManufacturerFact): string | undefined {
  const pole = p.poles?.toLowerCase();
  if (['mcb', 'spd', 'rccb', 'rcbo', 'isolator'].includes(p.category)) return `${p.category}-${pole}`;
  if (['shunt_trip', 'aux_contact', 'fault_contact', 'impulse_relay', 'voltage_relay', 'bell', 'busbar_pin_cover', 'locking_accessory'].includes(p.category)) return p.category;
  if (p.category === 'contactor') return `contactor-${p.widthModules18}`;
  if (p.category === 'busbar' && pole === '3p') return 'busbar';
  if (p.category === 'busbar' && (pole === '1p' || pole === '4p')) return `busbar-${pole}`;
  if (p.category === 'busbar_end_cap' && ['1p', '2p', '3p'].includes(pole ?? '')) return `busbar-endcap-${pole}`;
  if (p.category === 'mounting_panel') return p.sku;
  if (p.family === 'PrismaSeT XS' && p.category === 'enclosure') {
    if (p.door === 'opaque') return 'prisma-case-opaque';
    if (p.door === 'smoked') return 'prisma-case-smoked';
  }
  if (p.family === 'PrismaSeT XS' && p.category === 'spare_door' && p.door === 'opaque')
    return 'prisma-door-opaque';
  if (p.category === 'enclosure' && p.family === 'Easy9 EU' && p.rows && p.rows <= 3) {
    const door = p.door === 'opaque' ? 'white' : p.door === 'smoked' ? 'smoke' : undefined;
    if (door && (p.installation === 'surface' || p.installation === 'flush'))
      return `eu-${p.installation}-${p.rows}-${door}`;
  }
  return undefined;
}

interface ManufacturerFact {
  sku:string; family:string; category:string; sourcePages:number[]; sourceEvidence:string;
  mountingType:CatalogProduct['mounting']; widthModules18?:number; widthMm?:number;
  poles?:string; ratedCurrentA?:number; curve?:string; breakingCapacityA?:number;
  residualType?:string; residualCurrentMa?:number; description?:string; descriptionHu?:string; descriptionEn?:string;
  rows?:number; modulesPerRow?:number; totalModules18?:number; installation?:string; door?:string;
  spdType?:string; maxDischargeKA?:number; nominalDischargeKA?:number; voltageProtectionKV?:number;
  coilVoltageAC?:number; ratedVoltageAC?:number; ac7bCurrentA?:number; contacts?:string;
  packQuantity?:number; lengthModules18?:number; pitchMm?:number; cuttable?:boolean; assemblyPosition?:string;
  supplementalSourceUrl?:string;
}
const labels:Record<string,[string,string]> = {
  mcb:['Kismegszakító','Miniature circuit breaker'],rccb:['Áram-védőkapcsoló','Residual current circuit breaker'],rcbo:['Kombinált védelem','Residual current breaker with overcurrent protection'],spd:['Túlfeszültség-védelem','Surge protective device'],
  shunt_trip:['Munkaáramú kioldó MX','Shunt release MX'],aux_contact:['Segédérintkező OF','Auxiliary contact OF'],fault_contact:['Hibajelző érintkező SD','Fault contact SD'],impulse_relay:['Impulzusrelé','Impulse relay'],voltage_relay:['Feszültségfigyelő relé','Voltage monitoring relay'],contactor:['Mágneskapcsoló','Modular contactor'],isolator:['Leválasztó kapcsoló','Switch disconnector'],bell:['Csengő','Modular bell'],spacer:['DIN-sín távtartó','DIN-rail spacer'],
  busbar:['Fésűs gyűjtősín','Comb busbar'],busbar_end_cap:['Gyűjtősín-véglezáró','Busbar end cap'],busbar_pin_cover:['Gyűjtősín-villatakaró','Busbar pin cover'],locking_accessory:['Reteszelő tartozék','Locking accessory'],enclosure:['Elosztószekrény','Distribution enclosure'],spare_door:['Elosztószekrény ajtó','Enclosure door'],terminal_block:['Csatlakozóblokk','Terminal block'],terminal_support:['Csatlakozóblokk-tartó','Terminal block support'],mounting_panel:['Szerelőpanel','Mounting panel'],enclosure_accessory:['Elosztószekrény-tartozék','Enclosure accessory'],
};
const customNames:Record<string,[string,string]> = {
  LVSXX5:['Gipszkarton falba szerelő készlet','Plasterboard mounting kit'],LVSXX7:['Külső rögzítőfülek, 4 db fém fül','External mounting lugs, 4 metal lugs'],R9H13420:['Tervtartó','Document holder'],LVSXF4:['Modultakaró, 1 × 24 modulos készlet','Blanking plates, 1 × 24-module kit'],R9H13387:['Modultakaró, 10 × 5 modulos készlet','Blanking plates, 10 × 5-module kit'],LVS04227:['DIN-sín mélységállító adapter NSXm készülékhez','DIN-rail depth adapter for NSXm'],LVSXS2:['Kulcsos ajtózár 405, 2 kulccsal','Door lock 405 with 2 keys'],LGYT4A01:['Csatlakozóblokk-összekötő jumper, 10 db','Terminal block interconnection jumpers, pack of 10'],
  LVSXK2:['Csatlakozóblokk-tartó, 24 modulos szekrényhez','Terminal block support for 24-module enclosures'],LVSXK1:['Csatlakozóblokk-tartó, 13–18 modulos szekrényhez','Terminal block support for 13–18-module enclosures'],LGYT601R:['DIN-sín tartó, 1 db','DIN-rail support, 1 piece'],LVSXK6:['SPD csatlakozókészlet, 1 × 50 + 2 × 25 mm²','SPD connection kit, 1 × 50 + 2 × 25 mm²'],
  LVSXY1124:['Univerzális rácsos szerelőlemez, 24 modul','Universal perforated mounting plate, 24 modules'],LVSXY624:['Háromfázisú felügyeleti panel, 24 modul','Three-phase monitoring panel, 24 modules'],LVSXY724:['Egyfázisú Linky felügyeleti panel, 24 modul','Single-phase Linky monitoring panel, 24 modules'],LVSXY024:['Vezérlőpanel, 24 modul','Control panel, 24 modules'],
};
const category = (p:ManufacturerFact):CatalogProduct['category'] => {
  if(p.category==='spacer')return 'accessory';
  if(['mcb','rccb','rcbo','spd','enclosure'].includes(p.category))return p.category as CatalogProduct['category'];
  if(p.category==='isolator')return 'switch';
  return p.mountingType==='din'?'control':'accessory';
};
const kind = (p:ManufacturerFact):CatalogProduct['kind'] => ({mcb:'breaker',rccb:'rcd',rcbo:'rcbo',spd:'spd',isolator:'main',shunt_trip:'relay',aux_contact:'relay',fault_contact:'relay',impulse_relay:'relay',voltage_relay:'relay',contactor:'relay',spacer:'blank'} as Record<string,CatalogProduct['kind']>)[p.category]??'custom';
function descriptions(p:ManufacturerFact):{hu:string;en:string} {
  const hu:string[]=[],en:string[]=[];
  if(p.category==='spacer'){if(p.descriptionHu)hu.push(p.descriptionHu);if(p.descriptionEn)en.push(p.descriptionEn);}
  if(p.category==='spd') {const value=`${p.spdType} · Imax ${p.maxDischargeKA} kA · In ${p.nominalDischargeKA} kA · Up ${p.voltageProtectionKV} kV`;hu.push(value);en.push(value);}
  if(p.contacts){hu.push(`Érintkezők: ${p.contacts}`);en.push(`Contacts: ${p.contacts}`);}
  if(p.ac7bCurrentA!==undefined){hu.push(`AC-7a: ${p.ratedCurrentA} A; AC-7b: ${p.ac7bCurrentA} A`);en.push(`AC-7a: ${p.ratedCurrentA} A; AC-7b: ${p.ac7bCurrentA} A`);}
  if(p.coilVoltageAC){hu.push(`Tekercs: ${p.coilVoltageAC} V AC, 50 Hz`);en.push(`Coil: ${p.coilVoltageAC} V AC, 50 Hz`);}
  if(p.lengthModules18){hu.push(`Gyűjtősín hossza: ${p.lengthModules18} × 18 mm; osztás: ${p.pitchMm} mm${p.cuttable?'; darabolható':''}.`);en.push(`Busbar length: ${p.lengthModules18} × 18 mm; pitch: ${p.pitchMm} mm${p.cuttable?'; cuttable':''}.`);}
  if(p.packQuantity){hu.push(`Gyári kiszerelés: ${p.packQuantity} db.`);en.push(`Manufacturer pack: ${p.packQuantity} pieces.`);}
  if(p.assemblyPosition){hu.push('A kompatibilis készülék bal oldalára szerelhető; a készülékpárosítást ellenőrizni kell.');en.push('Mounts to the left of a compatible device; verify the device pairing.');}
  if(p.rows&&p.modulesPerRow){hu.push(`${p.rows} sor × ${p.modulesPerRow} modul (18 mm).`);en.push(`Rows: ${p.rows} × ${p.modulesPerRow} modules (18 mm).`);}
  if(p.installation){hu.push(p.installation==='flush'?'Süllyesztett kivitel.':'Falon kívüli kivitel.');en.push(p.installation==='flush'?'Flush-mounted enclosure.':'Surface-mounted enclosure.');}
  if(p.door){const door:Record<string,[string,string]>={opaque:['Tömör ajtó.','Opaque door.'],smoked:['Füstszínű ajtó.','Smoked door.'],transparent:['Átlátszó ajtó.','Transparent door.']};hu.push(door[p.door]?.[0]??p.door);en.push(door[p.door]?.[1]??p.door);}
  if(p.sku.startsWith('LGYT1')){
    const connections=p.sku.endsWith('05')?'1 × 6/25 + 4 × 1.5/4':p.sku.endsWith('14')?'3 × 6/25 + 11 × 1.5/4':'3 × 6/25 + 21 × 1.5/4';
    hu.push(`${connections} mm², 63 A; csavaros és gyorscsatlakozós bekötés, jumperrel.`);en.push(`${connections} mm², 63 A; screw and quick terminals, with jumper.`);
  }
  if(/^R9H134(05|11)P?$/.test(p.sku)){
    const connections=p.sku.includes('405')?'4 × 16 mm², 63 A':'1 × 35 + 6 × 16 mm², 125 A';const poles=p.sku.endsWith('P')?'P/P':'P/N';hu.push(`${connections}, ${poles}; csavaros, szigetelt csatlakozóblokk.`);en.push(`${connections}, ${poles}; insulated screw terminal block.`);
  }
  if(p.sku.startsWith('LGYT2A')){const n=({LGYT2A04:2,LGYT2A08:4,LGYT2A16:8,LGYT2A22:11,LGYT2A32:16} as Record<string,number>)[p.sku];hu.push(`${n} × 16 + ${n} × 10 mm², 80 A; csavaros bekötés, zöld és kék burkolattal.`);en.push(`${n} × 16 + ${n} × 10 mm², 80 A; screw terminals, green and blue covers.`);}
  if(p.category==='mounting_panel'){const count=p.sku==='LVSXY624'?3:2;hu.push(`${count} DIN-sín helyére telepíthető.`);en.push(`Replaces ${count} DIN rails.`);}
  return {hu:hu.join(' '),en:en.join(' ')};
}
export const SCHNEIDER_SOURCE = source.source;
/** Exactly the explicit order references of the cited HU offer tables, no synthesized variants. */
export const SCHNEIDER_PRODUCTS:CatalogProduct[] = (source.products as ManufacturerFact[]).map(p=>{
  const label=customNames[p.sku]??labels[p.category]??labels.enclosure_accessory;
  const suffix=[p.curve&&p.ratedCurrentA!==undefined?`${p.curve}${p.ratedCurrentA}`:p.ratedCurrentA!==undefined?`${p.ratedCurrentA} A`:'',p.poles??'',p.residualCurrentMa?`${p.residualType} ${p.residualCurrentMa} mA`:''].filter(Boolean).join(' · ');
  const range=p.family.replace(/ compatible accessory$/,'').replace(/^Compatible accessory$/,'Schneider Electric');
  const exactImage=productImages[`./schneider-images/${p.sku}.webp`];
  const illustrationKey=catalogueImage(p);
  const illustration=illustrationKey && productImages[`./schneider-images/${illustrationKey}.webp`];
  return {
    reference:p.sku,manufacturer:'Schneider Electric',range,category:category(p),kind:kind(p),mounting:p.mountingType,
    electrical:verifiedEasy9Electrical(p),
    image:exactImage || illustration,
    imageIllustrative:!exactImage && !!illustration,
    name:{hu:`${label[0]}${suffix?' · '+suffix:''}`,en:`${label[1]}${suffix?' · '+suffix:''}`},description:descriptions(p),
    ...(p.mountingType==='din'?{moduleWidth:p.widthModules18,widthMm:p.widthMm}:{}),
    poles:p.poles,currentA:p.ratedCurrentA,curve:p.curve,breakingCapacityKa:p.breakingCapacityA===undefined?undefined:p.breakingCapacityA/1000,residualType:p.residualType,residualCurrentMa:p.residualCurrentMa,
    voltage:p.coilVoltageAC?`${p.coilVoltageAC} V AC`:p.ratedVoltageAC?`${p.ratedVoltageAC} V AC`:undefined,
    boardRows:p.rows,modulesPerRow:p.modulesPerRow,
    sourceUrl:`${source.source.pdfUrl}#page=${p.sourcePages[0]}`,supplementalSourceUrl:p.supplementalSourceUrl,sourcePage:p.sourcePages[0],sourceDocument:`${source.source.documentReference} · v${source.source.documentVersion}`,verifiedAt:source.source.retrievedDate,
  };
});
