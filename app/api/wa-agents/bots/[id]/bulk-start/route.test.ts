import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ guard: vi.fn(), prepare: vi.fn(), rpc: vi.fn(), after: vi.fn() }));
vi.mock('../../../_shared', () => ({ getErrorMessage: (e: Error) => e.message, guardRoute: mock.guard, readJsonBody: (r: Request) => r.json(), validationError: () => new Response('{}',{status:400}) }));
vi.mock('@/lib/whatsapp/api', () => ({ json: (b: unknown, s=200) => Response.json(b,{status:s}) }));
vi.mock('@/lib/wa-agents/bulkBots', () => ({ MAX_BULK_LEADS: 500, prepareBulkBot: mock.prepare }));
vi.mock('@/lib/wa-agents/bots', () => ({ processDueBotRuns: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: vi.fn() }));
vi.mock('next/server', () => ({ after: mock.after }));
import { POST } from './route';
const id='12345678-1234-4123-8123-123456789012';
const req=(body: unknown) => new Request('https://crm.test/api', {method:'POST',body:JSON.stringify(body)});
const ctx={params:Promise.resolve({id})};
beforeEach(() => { vi.clearAllMocks(); mock.guard.mockResolvedValue({ok:true,user:{organizationId:'org'},admin:{rpc:mock.rpc}}); mock.prepare.mockResolvedValue({botName:'Robô',recipients:[{dealId:id,contactId:id,phone:'+5511999990000',eligible:true}]}); mock.rpc.mockResolvedValue({data:[{dealId:id,status:'queued',runId:id}],error:null}); });
describe('bulk start authorization and queue', () => {
 it('rejects unauthorized requests before reading recipients', async () => { mock.guard.mockResolvedValue({ok:false,response:new Response('',{status:403})}); expect((await POST(req({}),ctx)).status).toBe(403); expect(mock.prepare).not.toHaveBeenCalled(); });
 it('preview never creates executions', async () => { expect((await POST(req({dealIds:[id],batchId:id,preview:true}),ctx)).status).toBe(200); expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.after).not.toHaveBeenCalled(); });
 it('queues only eligible recipients with the same request id and authenticated organization', async () => { expect((await POST(req({dealIds:[id],batchId:id}),ctx)).status).toBe(202); expect(mock.rpc).toHaveBeenCalledWith('enqueue_bulk_bot_runs',expect.objectContaining({p_org:'org',p_batch:id,p_bot:id})); expect(mock.after).toHaveBeenCalledOnce(); });
 it('rejects empty and oversized selections', async () => { for(const dealIds of [[],Array(501).fill(id)]) expect((await POST(req({dealIds,batchId:id}),ctx)).status).toBe(400); expect(mock.prepare).not.toHaveBeenCalled(); });
});
