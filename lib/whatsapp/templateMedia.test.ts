import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateTemplateMedia, parseTemplateHeader } from '@/lib/templateMedia';
import { getTemplateMedia, readTemplateMedia, resolveTemplateComponents, uploadMetaTemplateSample, verifyMediaBytes, type TemplateMediaRow } from './templateMedia';
import type { WaConnectionRow } from './service';
const media: TemplateMediaRow = { id: 'asset', organization_id: 'org', connection_id: 'conn', storage_path: 'org/conn/asset/a.pdf', header_type: 'document', mime_type: 'application/pdf', byte_size: 5, file_name: 'a.pdf', verified_at: 'now', meta_handle: null };
function mockDb(row: TemplateMediaRow | null = media) {
  const filters: Record<string, unknown> = {};
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn((k: string, v: unknown) => { filters[k] = v; return query; }), maybeSingle: vi.fn(async () => ({ data: row && Object.entries(filters).every(([k,v]) => row[k as keyof TemplateMediaRow] === v) ? row : null })) };
  const signed = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.example/fresh?token=1' } });
  const download = vi.fn().mockResolvedValue({ data: new Blob(['%PDF-'], { type: 'application/pdf' }) });
  const admin = { from: vi.fn(() => query), storage: { from: vi.fn(() => ({ createSignedUrl: signed, download })) } } as unknown as SupabaseClient;
  return { admin, query, signed, download };
}
beforeEach(() => { vi.unstubAllGlobals(); });
describe('template media boundaries', () => {
  it.each([['image','image/png',5*1024*1024],['image','image/jpeg',1],['video','video/mp4',16*1024*1024],['document','application/pdf',16*1024*1024]] as const)('accepts %s %s', (type,mime,size) => expect(() => validateTemplateMedia(type,mime,size)).not.toThrow());
  it.each([['image','text/html',20],['image','image/svg+xml',20],['image','image/png',5*1024*1024+1],['video','video/mp4',16*1024*1024+1],['document','application/pdf',0],['document','application/pdf',NaN],['document','application/msword',20]] as const)('rejects invalid MIME/size %s %s %s',(type,mime,size) => expect(() => validateTemplateMedia(type,mime,size)).toThrow());
  it('checks file signature', () => { expect(() => verifyMediaBytes(new TextEncoder().encode('<html>'), 'application/pdf')).toThrow(); expect(() => verifyMediaBytes(new Uint8Array([137,80,78,71,13,10,26,10]), 'image/png')).not.toThrow(); });
  it.each(['other-org','https://169.254.169.254/latest/meta-data'])('rejects cross tenant or arbitrary reference %s before fetching', async org => {
    const { admin, download, signed } = mockDb(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(getTemplateMedia(admin, org, 'conn', 'asset')).rejects.toThrow();
    expect(download).not.toHaveBeenCalled(); expect(signed).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects another connection and header mismatch', async () => { const { admin } = mockDb(); await expect(getTemplateMedia(admin,'org','other','asset')).rejects.toThrow(); await expect(getTemplateMedia(admin,'org','conn','asset','image')).rejects.toThrow(); });
  it('rejects forged storage path even with scoped row', async () => { const { admin } = mockDb({ ...media, storage_path: 'org/conn/../secret.pdf' }); await expect(getTemplateMedia(admin,'org','conn','asset')).rejects.toThrow(); });
  it('revalidates actual size and MIME', async () => { const { admin, download } = mockDb(); await expect(readTemplateMedia(admin, media)).resolves.toHaveLength(5); download.mockResolvedValue({ data: new Blob(['%PDF-extra'], { type: 'application/pdf' }) }); await expect(readTemplateMedia(admin, media)).rejects.toThrow('diferente'); });
  it('does not change text-only components or touch storage', async () => { const { admin, signed } = mockDb(); expect(await resolveTemplateComponents(admin,'org','conn',{},[])).toBeUndefined(); expect(await resolveTemplateComponents(admin,'org','conn',{},['Maria'])).toEqual([{ type:'body', parameters:[{type:'text',text:'Maria'}] }]); expect(signed).not.toHaveBeenCalled(); });
  it('blocks missing and unfinished media', async () => { const { admin } = mockDb({...media, verified_at:null}); await expect(resolveTemplateComponents(admin,'org','conn',{header_type:'document'},[])).rejects.toThrow('precisa de mídia'); await expect(resolveTemplateComponents(admin,'org','conn',{header_type:'document',media_id:'asset'},[])).rejects.toThrow('não concluído'); });
  it.each(['image','video','document'] as const)('resolves %s with new signed URL each send', async type => { const { admin, signed } = mockDb({...media,header_type:type,mime_type: type==='image'?'image/png':type==='video'?'video/mp4':'application/pdf'}); const template={header_type:type,media_id:'asset'}; const a=await resolveTemplateComponents(admin,'org','conn',template,['Maria']); signed.mockResolvedValue({data:{signedUrl:'https://storage.example/fresh?token=2'}}); const b=await resolveTemplateComponents(admin,'org','conn',template,[]); expect(a?.[0]).toMatchObject({type:'header',parameters:[{type,[type]:{link:'https://storage.example/fresh?token=1'}}]}); expect(b?.[0]).toMatchObject({parameters:[{[type]:{link:'https://storage.example/fresh?token=2'}}]}); expect(signed).toHaveBeenCalledTimes(2); expect(signed).toHaveBeenCalledWith(media.storage_path,600); });
  it('preserves synced media header types',()=> { for(const type of ['IMAGE','VIDEO','DOCUMENT']) expect(parseTemplateHeader([{type:'HEADER',format:type}])).toBe(type.toLowerCase()); expect(parseTemplateHeader([{type:'BODY',text:'Hi'}])).toBeNull(); });
  it('uploads sample via fixed Graph host, OAuth binary and session signature intact',async()=> {
    const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({id:'upload:abc==?sig=test'})}).mockResolvedValueOnce({ok:true,json:async()=>({h:'sample-handle'})}); vi.stubGlobal('fetch',fetcher);
    expect(await uploadMetaTemplateSample({provider:'meta_cloud',meta_app_id:'123',instance_token:'secret'} as WaConnectionRow,media,new TextEncoder().encode('%PDF-'))).toBe('sample-handle');
    expect(fetcher.mock.calls[0][0]).toContain('https://graph.facebook.com/'); expect(fetcher.mock.calls[1][0]).toContain('/upload:abc==?sig=test'); expect(fetcher.mock.calls[1][1].headers).toMatchObject({authorization:'OAuth secret',file_offset:'0'});
  });
  it('rejects unsupported provider before calling Meta',async()=> { const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher); await expect(uploadMetaTemplateSample({provider:'evolution_business'} as WaConnectionRow,media,new Uint8Array())).rejects.toThrow('Meta Cloud'); expect(fetcher).not.toHaveBeenCalled(); });
});
