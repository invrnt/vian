import { test, expect } from 'bun:test';
import { generateText, jsonSchema, stepCountIs, tool } from 'ai';
import { MockLanguageModelV4 } from './index.ts';
import type { ModelMessage } from 'ai';
const usage = { inputTokens:{total:1,noCache:1,cacheRead:0,cacheWrite:0},outputTokens:{total:1,text:1,reasoning:0} };
test('C09 SDK prepareStep appends follow-up after settled tool result without replay', async()=>{
  let calls=0, executions=0;
  const model = new MockLanguageModelV4({ doGenerate: async()=> ++calls===1 ? { content:[{type:'tool-call',toolCallId:'call-1',toolName:'lookup',input:'{}'}], finishReason:{unified:'tool-calls',raw:undefined}, warnings:[], usage } : {content:[{type:'text',text:'done'}],finishReason:{unified:'stop',raw:undefined},warnings:[],usage} });
  const result = await generateText({ model, messages:[{role:'user',content:'first'}], tools:{lookup:tool({description:'fixture',inputSchema:jsonSchema({type:'object',properties:{},additionalProperties:false}),execute:async()=>{executions++;return 'result';}})},stopWhen:stepCountIs(2),prepareStep:({stepNumber,messages})=>{ if(stepNumber===1) { expect(messages.some((m:ModelMessage)=>m.role==='tool')).toBe(true); return {messages:[...messages,{role:'user',content:'follow-up'}]}; } return {}; }});
  expect(result.text).toBe('done'); expect(executions).toBe(1); expect(calls).toBe(2);
  const second = model.doGenerateCalls[1]!; expect(JSON.stringify(second.prompt)).toContain('follow-up'); expect(JSON.stringify(second.prompt)).toContain('call-1');
});
