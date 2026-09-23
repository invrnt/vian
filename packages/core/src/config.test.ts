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
