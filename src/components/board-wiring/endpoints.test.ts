import { describe, expect, it } from 'vitest';
import { createProject } from '../../data/project';
import type { WiringEndpoint, BoardWire } from '../../types';
import { wireEndpointError } from './endpoints';

describe('wire endpoint validation', () => {
  it('rejects missing, same and duplicate connections while allowing the existing wire to remain', () => {
    const data = createProject('wire').data;
    data.boards[0].wiring = { buses: [], infeeds: [{ id:'source', name:'Input', kind:'supply', poles:['L','N','PE'] }], wires:[] };
    const endpoint = (pole:number):WiringEndpoint => ({ kind:'infeed', infeedId:'source', pole });
    const wires:BoardWire[] = [{ id:'one', from:endpoint(0), to:endpoint(1) }, { id:'two', from:endpoint(0), to:endpoint(2) }];
    expect(wireEndpointError(data, wires, endpoint(0), endpoint(1), 'one')).toBeUndefined();
    expect(wireEndpointError(data, wires, endpoint(0), endpoint(0), 'one')).toMatch(/különböző/);
    expect(wireEndpointError(data, wires, endpoint(2), endpoint(0), 'one')).toMatch(/már szerepel/);
    expect(wireEndpointError(data, wires, endpoint(0), endpoint(9), 'one')).toMatch(/megváltozott/);
    expect(wireEndpointError(data, wires, endpoint(1), endpoint(2), 'one')).toBeUndefined();
  });
});
