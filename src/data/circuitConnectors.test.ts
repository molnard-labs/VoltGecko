import { describe, expect, it } from 'vitest';
import type { Circuit, Conductor } from '../types';
import { visibleCircuitConnectors } from './circuitConnectors';

const circuit: Circuit = {id:'c',code:'ÁK1',name:'',color:'#123456',notes:''};
const legacy:Conductor[]=['L1','L2','L3','N','PE'];

describe('circuit connectors on the board',()=>{
  it('retains legacy options, including previously stored connectors outside the supply',()=>{
    expect(visibleCircuitConnectors(circuit,legacy,[{conductor:'PEN'}])).toEqual(['L1','L2','L3','N','PE','PEN']);
  });
  it('uses the explicit conductor list and preserves all existing connections without inventing others',()=>{
    const selected:Circuit={...circuit,conductors:['L2','N']};
    const before=structuredClone(selected);
    expect(visibleCircuitConnectors(selected,legacy,[{conductor:'PE'}])).toEqual(['L2','N','PE']);
    expect(selected).toEqual(before);
  });
  it('distinguishes explicit empty selection from legacy while retaining connected terminals',()=>{
    const selected:Circuit={...circuit,conductors:[]};
    expect(visibleCircuitConnectors(selected,legacy,[])).toEqual([]);
    expect(visibleCircuitConnectors(selected,legacy,[{conductor:'L1'},{conductor:'L1'}])).toEqual(['L1']);
  });
});
