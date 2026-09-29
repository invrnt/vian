import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseManifest, ConfigError } from './config.ts';
const input = { schemaVersion:1, id:'019c8b60-7a2b-7f20-a8d6-4c7f584a30cb', name:'count', model:{provider:'google',id:'fixture-model',credential:'env:GOOGLE_KEY'}, gate:{type:'telegram',credential:'env:TELEGRAM_TOKEN'} };
describe('C01 manifest',()=>{
  test('defaults to steer and preserves queue',()=>{ expect(parseManifest(input,'/tmp/bot').runtime.sameSessionPolicy).toBe('steer'); expect(parseManifest({...input,runtime:{sameSessionPolicy:'queue'}},'/tmp/bot').runtime.sameSessionPolicy).toBe('queue'); });
  test('accepts an explicit ChatGPT OAuth profile reference',()=>{ const manifest=parseManifest({...input,model:{provider:'openai-chatgpt',id:'fixture-model',credential:'oauth:openai-chatgpt:default'}},'/tmp/bot'); expect(manifest.model.credential).toBe('oauth:openai-chatgpt:default'); expect(()=>parseManifest({...input,model:{provider:'openai-chatgpt',id:'fixture-model',credential:'oauth:other:default'}},'/tmp/bot')).toThrow(ConfigError); });
  test('rejects future schema and unknown fields with path',()=>{ expect(()=>parseManifest({...input,schemaVersion:2},'/tmp/bot')).toThrow(ConfigError); expect(()=>parseManifest({...input,extra:true},'/tmp/bot')).toThrow('/tmp/bot'); });
  test('generated schema has the same required authority',()=>{ const schema=JSON.parse(readFileSync('schema/v1.json','utf8')); expect(schema.properties.schemaVersion.const).toBe(1); expect(schema.properties.runtime.properties.sameSessionPolicy.default).toBe('steer'); });
});

test('Telegram UI language defaults to Spanish and validates English', () => {
  expect(parseManifest(input, '/tmp/bot').gate.telegram.language).toBe('es');
  expect(parseManifest({ ...input, gate: { ...input.gate, telegram: { language: 'en' } } }, '/tmp/bot').gate.telegram.language).toBe('en');
  expect(() => parseManifest({ ...input, gate: { ...input.gate, telegram: { language: 'fr' } } }, '/tmp/bot')).toThrow(ConfigError);
  const schema = JSON.parse(readFileSync('schema/v1.json', 'utf8'));
  expect(schema.properties.gate.properties.telegram.properties.language.default).toBe('es');
});

test('Telegram local server must be explicit and cannot point at the cloud API', () => {
  expect(() => parseManifest({ ...input, gate: { ...input.gate, telegram: { localApi: true } } }, '/tmp/bot')).toThrow(ConfigError);
  expect(parseManifest({ ...input, gate: { ...input.gate, telegram: { localApi: true, apiRoot: 'http://127.0.0.1:8081' } } }, '/tmp/bot').gate.telegram.localApi).toBe(true);
  expect(() => parseManifest({ ...input, gate: { ...input.gate, telegram: { apiRoot: 'http://public.example.org' } } }, '/tmp/bot')).toThrow(ConfigError);
});
