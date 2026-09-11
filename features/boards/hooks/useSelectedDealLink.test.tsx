import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectedDealLink } from './useSelectedDealLink';
const navigation = vi.hoisted(() => ({ params: null as URLSearchParams | null, replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => navigation.params, useRouter: () => ({ replace: navigation.replace }) }));
beforeEach(() => { navigation.params = new URLSearchParams('deal=amanda&board=mpl&status=open'); navigation.replace.mockReset(); });
describe('Link direto do relatório para o lead', () => {
  it('abre Amanda na primeira renderização e nunca apaga o link durante a montagem', () => {
    const rendered: (string | null)[] = [];
    const {result}=renderHook(()=>{const state=useSelectedDealLink();rendered.push(state[0]);return state;}, {wrapper: ({children})=><React.StrictMode>{children}</React.StrictMode>});
    expect(rendered[0]).toBe('amanda');
    expect(result.current[0]).toBe('amanda');
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it('fecha o modal preservando os outros parâmetros e permite reabrir outro lead', () => {
    const {result,rerender}=renderHook(()=>useSelectedDealLink());
    navigation.replace.mockClear();
    act(()=>result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(navigation.replace).toHaveBeenLastCalledWith('/boards?board=mpl&status=open',{scroll:false});
    navigation.params=new URLSearchParams('board=mpl&status=open');rerender();
    act(()=>result.current[1]('paola'));
    expect(navigation.replace).toHaveBeenLastCalledWith('/boards?board=mpl&status=open&deal=paola',{scroll:false});
  });
  it('acompanha navegação para outro link e voltar/avançar do navegador', () => {
    const {result,rerender}=renderHook(()=>useSelectedDealLink());
    navigation.params=new URLSearchParams('deal=paola');rerender();
    expect(result.current[0]).toBe('paola');
    navigation.params=new URLSearchParams();rerender();
    expect(result.current[0]).toBeNull();
    navigation.params=new URLSearchParams('deal=amanda');rerender();
    expect(result.current[0]).toBe('amanda');
  });
  it('aguarda a URL quando os parâmetros só ficam disponíveis depois da montagem', () => {
    navigation.params=null;
    const {result,rerender}=renderHook(()=>useSelectedDealLink());
    navigation.params=new URLSearchParams('deal=amanda');rerender();
    expect(result.current[0]).toBe('amanda');
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
