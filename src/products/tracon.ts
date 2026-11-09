import type { Conductor } from '../types';
import type { CatalogProduct } from './types';
// Inline images also survive standalone SVG and raster exports of the board.
import grey from './tracon-images/grey.webp?inline';
import brown from './tracon-images/brown.webp?inline';
import black from './tracon-images/black.webp?inline';
import blue from './tracon-images/blue.webp?inline';
import red from './tracon-images/red.webp?inline';
import greenyellow from './tracon-images/greenyellow.webp?inline';
import fleal from './tracon-images/fleal.webp?inline';
import fleal16Grey from './tracon-images/fleal-16-grey.webp?inline';
import fleal16Blue from './tracon-images/fleal-16-blue.webp?inline';
import fleal16GreenYellow from './tracon-images/fleal-16-greenyellow.webp?inline';

// Width is the manufacturer's actual width divided by the planner's 18 mm module.
const colors: Array<{suffix:string; hu:string; en:string; image:string; conductor:Conductor}> = [
  {suffix:'', hu:'szürke', en:'grey', image:grey, conductor:'L'},
  {suffix:'B', hu:'barna', en:'brown', image:brown, conductor:'L1'},
  {suffix:'F', hu:'fekete', en:'black', image:black, conductor:'L2'},
  {suffix:'K', hu:'kék', en:'blue', image:blue, conductor:'N'},
  {suffix:'P', hu:'piros', en:'red', image:red, conductor:'L'},
  {suffix:'ZS', hu:'zöld/sárga', en:'green/yellow', image:greenyellow, conductor:'PE'},
];
const catalog = 'https://cdn.traconelectric.com/static/attachment/catalogue_2024_2025/hu/tracon_catalogue_2024_2025_A_HU.pdf';
export const TRACON_PRODUCTS: CatalogProduct[] = [
  ...([
    {suffix:'', hu:'szürke', en:'grey', image:fleal16Grey, conductor:'L'},
    {suffix:'K', hu:'kék', en:'blue', image:fleal16Blue, conductor:'N'},
    {suffix:'ZS', hu:'zöld/sárga', en:'green/yellow', image:fleal16GreenYellow, conductor:'PE'},
  ] as Array<{suffix:string; hu:string; en:string; image:string; conductor:Conductor}>).map(({suffix, hu, en, image, conductor}): CatalogProduct => ({
    reference:`FLEAL-16/1${suffix}`, manufacturer:'Tracon Electric', range:'FLEAL',
    category:'terminal', kind:'custom', mounting:'din', image,
    name:{hu:`Főáramköri átmenő kapocs · ${hu}`, en:`Main line feed-through terminal · ${en}`},
    description:{hu:'Alumínium- és rézvezetékhez. Egy pólus, egy bemenet és egy kimenet; a gyártói katalógus tömör vezetékre 25 mm², hajlékonyra 16 mm² maximális keresztmetszetet ad meg.', en:'For aluminium and copper conductors. One pole with one input and one output; the manufacturer catalogue specifies up to 25 mm² solid or 16 mm² flexible conductor.'},
    moduleWidth:13.9/18, widthMm:13.9, poles:'1P', currentA:85,
    electrical:{role:'terminal', poles:[conductor]},
    sourceUrl:`${catalog}#page=36`, sourcePage:36, sourceDocument:'Tracon 2024–2025 · A/35',
    verifiedAt:'2026-11-09',
  })),
  ...colors.map(({suffix, hu, en, image, conductor}): CatalogProduct => ({
    reference:`FLECU-25-16-2${suffix}`, manufacturer:'Tracon Electric', range:'FLECU',
    category:'terminal', kind:'custom', mounting:'din', image,
    name:{hu:`Főáramköri leágazó kapocs · ${hu}`, en:`Main line distribution terminal · ${en}`},
    description:{hu:'Alumínium- és rézvezetékhez. 2 × 25 mm² betáp és 2 × 16 mm² leágazás tömör vezetékhez; hajlékony vezetékhez 2 × 16 és 2 × 10 mm².', en:'For aluminium and copper conductors. Solid: 2 × 25 mm² input and 2 × 16 mm² output; flexible: 2 × 16 and 2 × 10 mm².'},
    moduleWidth:21.3/18, widthMm:21.3, poles:'1P', currentA:101,
    electrical:{role:'terminal', poles:[conductor, conductor], commonPoleGroups:[[0,1]]},
    sourceUrl:`${catalog}#page=39`, sourcePage:39, sourceDocument:'Tracon 2024–2025 · A/38',
    verifiedAt:'2026-11-09',
  })),
  {
    reference:'FLEAL-150/1ZS', manufacturer:'Tracon Electric', range:'FLEAL',
    category:'terminal', kind:'custom', mounting:'din', image:fleal,
    name:{hu:'Főáramköri leágazó kapocs · zöld/sárga', en:'Main line distribution terminal · green/yellow'},
    description:{hu:'Alumínium- és rézvezetékhez, sínre vagy felületre. Be- és kimenet: 1 × 150 mm² tömör vagy 1 × 120 mm² hajlékony vezeték.', en:'For aluminium and copper conductors; DIN rail or surface mounting. Input and output: 1 × 150 mm² solid or 1 × 120 mm² flexible conductor.'},
    moduleWidth:28.9/18, widthMm:28.9, poles:'1P', currentA:320,
    electrical:{role:'terminal', poles:['PE']},
    sourceUrl:'https://shop.traconelectric.com/static/attachment/szorolapok/hu/FLEAL%20-%20A4_print.pdf#page=2',
    sourcePage:2, sourceDocument:'Tracon · FLEAL terméklap', verifiedAt:'2026-11-09',
  },
];
