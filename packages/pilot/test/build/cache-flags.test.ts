import { describe, it, expect, vi } from 'vitest';
import { buildApps } from '../../src/build/index.js';
vi.mock('../../src/model/loader.js', () => ({ loadProjectModel: vi.fn(() => ({ kind: 'ok', model: { apps: new Map([['a',{ app_id:'a', source_path:'src/a', builder:'b', depends_on:[] }]]), build_configs: new Map([['a',{ build_config:{} }]]), resources: new Map(), env_requirements: new Map(), depends_on_graph: { topologicalOrder:['a'], adjacency:new Map() } } })) }));
vi.mock('../../src/build-env/index.js', () => ({ prepareBuildEnv: vi.fn(() => ({ kind:'ok', resolvedEnv:{} })) }));
vi.mock('../../src/registry/index.js', () => ({ loadRegistry: vi.fn(async () => ({ kind:'ok', registry:{ records:new Map([['b',{ id:'b', packageName:'pkg', module:{ build: async()=>({type:'t', value:{}})}}]])}})), validateBuilders: vi.fn(()=>({kind:'ok'})) }));
vi.mock('../../src/registry/shape.js', () => ({ getBuilder: vi.fn((m)=>m) }));
describe('flags',()=>{it('noCache all miss', async()=>{const r=await buildApps('/root',{noCache:true}); expect(r.kind).toBe('ok');})});
