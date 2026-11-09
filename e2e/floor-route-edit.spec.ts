import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument, Route } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function documentData(page:Page):Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id=localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve,reject)=>{
      const open=indexedDB.open('villamos-tervezo-local');open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{const db=open.result,get=db.transaction('projects','readonly').objectStore('projects').get(id);
        get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{const doc=get.result.document;db.close();resolve(doc);};};
    });
  });
}
async function clickDevice(page:Page, code:string) {
  const device=page.locator('.floor-device').filter({has:page.locator('text',{hasText:new RegExp(`^${code}$`)})});
  const pos=await device.evaluate(element=>{const matrix=(element as SVGGElement).getScreenCTM()!;const p=new DOMPoint(0,0).matrixTransform(matrix);return {x:p.x,y:p.y};});
  await page.mouse.click(pos.x,pos.y);
}
function orthogonal(route:Route) {
  return route.points.every((p,i)=>!i||p.x===route.points[i-1].x||p.y===route.points[i-1].y);
}
async function lastRoute(page:Page):Promise<Route>{ return (await documentData(page)).data.sheets[0].routes.at(-1)!; }

for (const [tool,kind] of [['Kapcsolat / nyomvonal','power'],['Vezérlési kapcsolat','control']] as const) {
  test(`${kind} floor routes add/delete bends and move segments orthogonally`, async ({page})=>{
    await page.goto('/');await chooseSample(page);
    await page.getByRole('button',{name:tool,exact:true}).click();
    await clickDevice(page,'D1');await clickDevice(page,'D2');
    await expect.poll(async()=>(await lastRoute(page)).kind).toBe(kind);
    const initial=await lastRoute(page), beforeCount=await page.locator('.floor-bend').count();
    await page.getByRole('button',{name:'Töréspont hozzáadása',exact:true}).click();
    await expect(page.locator('.floor-bend')).toHaveCount(beforeCount+1);
    const added=await lastRoute(page);
    const addedIndex=added.points.findIndex((point,index)=>index>0&&index<added.points.length-1&&!initial.points.some(p=>p.x===point.x&&p.y===point.y));
    expect(addedIndex).toBeGreaterThan(0);
    await page.getByTestId(`floor-route-bend-${addedIndex-1}`).click();
    await page.keyboard.press('Delete');
    await expect.poll(async()=>(await lastRoute(page)).points.length).toBeLessThan(added.points.length);
    let current=await lastRoute(page);
    expect(orthogonal(current)).toBe(true);expect(current.points[0]).toEqual(initial.points[0]);expect(current.points.at(-1)).toEqual(initial.points.at(-1));
    const segment=page.getByTestId('floor-route-segment-1');
    const position=await segment.evaluate(element=>{const line=element as SVGLineElement,m=line.ownerSVGElement!.getScreenCTM()!;
      const a=new DOMPoint(line.x1.baseVal.value,line.y1.baseVal.value).matrixTransform(m),b=new DOMPoint(line.x2.baseVal.value,line.y2.baseVal.value).matrixTransform(m);
      return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,horizontal:Math.abs(a.y-b.y)<1};});
    const old=current.points;
    await page.mouse.move(position.x,position.y);await page.mouse.down();
    await page.mouse.move(position.x+(position.horizontal?0:24),position.y+(position.horizontal?24:0),{steps:5});await page.mouse.up();
    await expect.poll(async()=>(await lastRoute(page)).points).not.toEqual(old);
    current=await lastRoute(page);expect(orthogonal(current)).toBe(true);expect(current.points[0]).toEqual(initial.points[0]);expect(current.points.at(-1)).toEqual(initial.points.at(-1));
    const bend=page.getByTestId('floor-route-bend-0'), box=await bend.boundingBox();
    if (!box) throw new Error('Missing route bend');
    const beforeMove=current.points;
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+18,box.y+box.height/2+15,{steps:5});await page.mouse.up();
    await expect.poll(async()=>(await lastRoute(page)).points).not.toEqual(beforeMove);
    current=await lastRoute(page);expect(orthogonal(current)).toBe(true);expect(current.points[0]).toEqual(initial.points[0]);expect(current.points.at(-1)).toEqual(initial.points.at(-1));
    await page.reload();await reopenRecentProject(page);
    expect((await lastRoute(page)).points).toEqual(current.points);
  });
}
