import type { GateAdapter, GateCapabilities, InboundEvent, CanonicalMessage, RenderedPart, ExternalDestination, DeliveryOutcome } from '@vian/core';
import { MockLanguageModelV4 } from 'ai/test';
export class FakeClock { constructor(private value = new Date('2026-01-01T00:00:00Z')) {} now(): Date { return new Date(this.value); } advance(ms: number): void { this.value = new Date(+this.value + ms); } }
export class Barrier { private releasePromise!: () => void; readonly promise = new Promise<void>(resolve => { this.releasePromise = resolve; }); release(): void { this.releasePromise(); } }
export class FakeGate implements GateAdapter {
  readonly type = 'telegram';
  private inbound?: (event: InboundEvent) => Promise<void>;
  readonly deliveries: { part: RenderedPart; destination: ExternalDestination }[] = [];
  capabilities(): GateCapabilities { return { text:true, formatting:['plain'], streaming:true, stopGeneration:true, buttons:true, attachments:true, replies:true, groups:true, threads:true }; }
  async validate(): Promise<void> {}
  async start(onInbound: (event: InboundEvent) => Promise<void>): Promise<void> { this.inbound = onInbound; }
  async stop(): Promise<void> { this.inbound = undefined; }
  async emit(event: InboundEvent): Promise<void> { if (!this.inbound) throw new Error('Gate not started'); await this.inbound(event); }
  async render(message: CanonicalMessage): Promise<RenderedPart[]> { return message.parts.map((p, partIndex) => p.type==='text' ? {partIndex,kind:'text',text:p.text} : {partIndex,kind:'file',attachment:{id:p.attachmentId,name:p.name??'file',mimeType:p.mimeType??'application/octet-stream',size:0}}); }
  async deliver(part: RenderedPart, destination: ExternalDestination): Promise<DeliveryOutcome> { this.deliveries.push({part,destination}); return {kind:'succeeded',receipt:{externalId:String(this.deliveries.length),sentAt:new Date().toISOString()}}; }
}
export { MockLanguageModelV4 };
