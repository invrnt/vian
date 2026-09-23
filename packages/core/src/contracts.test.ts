import { expect, test } from 'bun:test';
import { encodeControl, CONTROL_MAX_BYTES, CONTROL_VERSION } from './control.ts';
import type { BotStore, GateAdapter, ProviderAdapter, NativeToolSet, AttachmentPort, StorageOutcome } from './index.ts';
import { FakeGate } from '../../testing/src/index.ts';
test('C02-C08 conformance fixture: ports and safe wire framing', async()=>{
  const gate: GateAdapter = new FakeGate();
  expect(gate.type).toBe('telegram');
  expect(gate.capabilities().attachments).toBe(true);
  const encoded=encodeControl({version:CONTROL_VERSION,requestId:'r1',operation:'status'});
  expect(encoded.length).toBeLessThan(CONTROL_MAX_BYTES);
  expect(JSON.parse(new TextDecoder().decode(encoded)).requestId).toBe('r1');
  const outcome: StorageOutcome<void>={kind:'lease-busy',reason:'occupied'};
  expect(outcome.kind).toBe('lease-busy');
  const _typeCheck: [BotStore?, ProviderAdapter?, NativeToolSet?, AttachmentPort?] = [];
  expect(_typeCheck.length).toBe(0);
});
