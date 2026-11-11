import { describe, expect, it } from 'vitest';
import type { Device } from '../types';
import { drawSingleLineDeviceSymbol, drawSingleLineGroundSymbol, drawSingleLineLoadSymbol, getSingleLineDeviceRole, getSingleLinePoleLabel } from './singleLineSymbols';

const device = (overrides: Partial<Device> = {}): Device => ({
  id:'d',code:'D1',name:'Device',kind:'custom',room:'',heightMm:0,model:'',notes:'',status:'planned',photoIds:[], ...overrides,
});

describe('single line device symbols', () => {
  it('uses the electrical role rather than rendering all custom catalog devices as the same symbol', () => {
    const terminal = device({electrical:{role:'terminal',poles:['PE']}});
    const motor = device({electrical:{role:'mpcb',poles:['L1','L2','L3']}});
    const meter = device({electrical:{role:'meter',poles:['L1','L2','L3','N']}});
    expect([terminal,motor,meter].map(getSingleLineDeviceRole)).toEqual(['terminal','mpcb','meter']);
    expect(new Set([terminal,motor,meter].map(item => drawSingleLineDeviceSymbol(item))).size).toBe(3);
    expect(getSingleLineDeviceRole(device({variant:'board-terminal'}))).toBe('terminal');
    expect(getSingleLineDeviceRole(device({variant:'board-mpcb'}))).toBe('mpcb');
    expect(getSingleLineDeviceRole(device({variant:'board-meter'}))).toBe('meter');
  });

  it('distinguishes protective, isolating and unknown functions with fixed connection anchors', () => {
    const roles = [
      device({kind:'main'}),device({kind:'breaker'}),device({kind:'rcd'}),
      device({kind:'rcbo'}),device({kind:'spd'}),device({kind:'relay'}),device(),
    ];
    expect(roles.map(getSingleLineDeviceRole)).toEqual(['main','mcb','rccb','rcbo','spd','relay','unknown']);
    expect(new Set(roles.map(item => drawSingleLineDeviceSymbol(item))).size).toBe(roles.length);
    for (const item of roles) {
      const svg = drawSingleLineDeviceSymbol(item,{x:12,y:25,height:90});
      expect(svg).toContain('translate(12 25) scale(1 1.5)');
      expect(svg).toContain('M0 0V8M0 52V60');
    }
  });

  it('never guesses pole count from module width and prefers the actual declared pole list', () => {
    expect(getSingleLinePoleLabel(device({moduleWidth:4}))).toBeUndefined();
    expect(getSingleLinePoleLabel(device({electrical:{role:'rccb',poles:['N','L']}}))).toBe('N / L');
    const product = {poles:'1P+N'} as Device['product'];
    expect(getSingleLinePoleLabel(device({product,electrical:{role:'rcbo',poles:['L','N']}}))).toBe('1P+N · L / N');
    expect(getSingleLinePoleLabel(device({product,electrical:{role:'rcbo',poles:['L']}}))).toBe('L');
  });

  it('draws earth only when explicitly requested and has distinct load annotations', () => {
    const spd = drawSingleLineDeviceSymbol(device({kind:'spd'}));
    expect(spd).not.toContain('data-sld-role="earth"');
    expect(drawSingleLineGroundSymbol(10,20)).toContain('translate(10 20)');
    expect(new Set(['socket','lamp','motor','other'].map(type => drawSingleLineLoadSymbol(type as 'socket'|'lamp'|'motor'|'other'))).size).toBe(4);
    for (const type of ['socket','lamp','other'] as const) expect(drawSingleLineLoadSymbol(type)).toContain('M0 0V9');
    expect(drawSingleLineLoadSymbol('motor')).toContain('M0 0V8');
    expect(drawSingleLineDeviceSymbol(device(),{x:NaN})).toBe('');
  });

  it('does not insert an invalid imported electrical role into the SVG', () => {
    const injected = device({electrical:{role:'" onload="bad()' as NonNullable<Device['electrical']>['role'],poles:['L']}});
    const svg = drawSingleLineDeviceSymbol(injected);
    expect(svg).toContain('data-sld-role="unknown"');
    expect(svg).not.toContain('onload');
  });
});
