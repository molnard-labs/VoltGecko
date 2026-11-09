import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { createDeviceFromProduct } from '../products/factory';
import { SCHNEIDER_PRODUCTS } from '../products/schneider';
import { assignConnectedPhase, devicePhysicalPoleOrder, effectiveDevicePoles, endpointConductor, preservedPhysicalPoleOrder, wiringEndpointLabel } from './boardWiring';
import { checkpoint, createProject, restoreRevision } from './project';
import { decodeProject, encodeProject } from './archive';
import type { WiringEndpoint } from '../types';

const endpoint = (deviceId:string,pole:number):WiringEndpoint => ({kind:'device',deviceId,side:'top',pole});

describe('physical pole positions and persisted wire identities', () => {
  it('keeps legacy wire identities and revision data while placing neutral first', async () => {
    let doc = createProject('Legacy poles');
    const product = SCHNEIDER_PRODUCTS.find(item => item.reference === 'EZ9R49240')!;
    const device = createDeviceFromProduct(product, []);
    delete device.electrical; // Existing project, created before manufacturer pole metadata.
    doc.data.devices.push(device);
    const board=doc.data.boards[0];
    board.rows[0].placements.push({deviceId:device.id,start:0});
    const live=endpoint(device.id,0),neutral=endpoint(device.id,1);
    board.wiring={buses:[{id:'bus',name:'L1',conductor:'L1',capacity:1,position:'bottom',terminalLabels:[]}],
      infeeds:[{id:'neutral',name:'N',kind:'supply',poles:['N']}],wires:[
        {id:'live-wire',from:live,to:{kind:'bus',busId:'bus',terminal:0}},
        {id:'neutral-wire',from:neutral,to:{kind:'infeed',infeedId:'neutral',pole:0}}
      ]};
    const unchanged=structuredClone(doc.data);
    expect(effectiveDevicePoles(device)).toEqual(['L','N']);
    expect(devicePhysicalPoleOrder(device)).toEqual([1,0]);
    expect(endpointConductor(doc.data,live)).toBe('L');
    expect(endpointConductor(doc.data,neutral)).toBe('N');
    expect(wiringEndpointLabel(doc.data,live)).toContain('2 (L)');
    expect(wiringEndpointLabel(doc.data,neutral)).toContain('1 (N)');
    expect(doc.data).toEqual(unchanged);
    doc=checkpoint(doc,'Before');
    const decoded=await decodeProject(await encodeProject(doc));
    expect(decoded.data).toEqual(unchanged);
    const restored=restoreRevision(decoded,decoded.revisions[0].id);
    expect(restored.data).toEqual(unchanged);
    expect(devicePhysicalPoleOrder(restored.data.devices[0])).toEqual([1,0]);

    // Recording phase must persist the visual permutation instead of flipping it.
    assignConnectedPhase(restored.data,live,{kind:'bus',busId:'bus',terminal:0});
    expect(restored.data.devices[0].electrical).toMatchObject({poles:['L','N'],phase:'L1',physicalPoleOrder:[1,0]});
    expect(devicePhysicalPoleOrder(restored.data.devices[0])).toEqual([1,0]);
    expect(endpointConductor(restored.data,live)).toBe('L1');
    expect(endpointConductor(restored.data,neutral)).toBe('N');
    const saved=await decodeProject(await encodeProject(restored));
    expect(devicePhysicalPoleOrder(saved.data.devices[0])).toEqual([1,0]);
    expect(saved.data.boards[0].wiring?.wires).toEqual(unchanged.boards[0].wiring?.wires);
  });

  it('respects explicit user settings and does not assume another manufacturer\'s order', () => {
    const generic=makeDevice('rcd',[]);
    expect(devicePhysicalPoleOrder(generic)).toEqual([1,0]);
    generic.electrical={poles:['L','N']};
    expect(devicePhysicalPoleOrder(generic)).toEqual([0,1]);
    const external=makeDevice('rcd',[]);external.model='Other manufacturer';
    expect(devicePhysicalPoleOrder(external)).toEqual([0,1]);
    const product=SCHNEIDER_PRODUCTS.find(item=>item.reference==='EZ9R49240')!;
    const known=createDeviceFromProduct(product,[]);
    known.electrical={poles:['L','N'],currentA:40};
    const doc=createProject();doc.data.devices.push(known);
    expect(devicePhysicalPoleOrder(known)).toEqual([1,0]);
    expect(endpointConductor(doc.data,endpoint(known.id,0))).toBe('L');
    expect(endpointConductor(doc.data,endpoint(known.id,1))).toBe('N');
    known.electrical.physicalPoleOrder=[0,1];
    expect(devicePhysicalPoleOrder(known)).toEqual([0,1]);
    expect(preservedPhysicalPoleOrder(known)).toEqual([0,1]);
  });

  it('rejects invalid saved physical orders, including in revisions', async () => {
    const doc=createProject();const device=makeDevice('rcd',[]);
    device.electrical={poles:['L','N'],physicalPoleOrder:[1,0]};doc.data.devices.push(device);
    const saved=checkpoint(doc);
    saved.revisions[0].data.devices[0].electrical!.physicalPoleOrder=[0,0];
    await expect(encodeProject(saved)).rejects.toThrow('Érvénytelen projektfájl');
  });
});
