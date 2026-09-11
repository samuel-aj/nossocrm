import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Adopt navigation; only an explicit open/close action may rewrite the URL. */
export function useSelectedDealLink() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDealId = searchParams?.get('deal') || null;
  const [selectedDealId, setSelected] = useState<string | null>(() => urlDealId);

  useEffect(() => { setSelected(urlDealId); }, [urlDealId]);

  const setSelectedDealId = useCallback((id: string | null) => {
    setSelected(id);
    const params = new URLSearchParams(searchParams?.toString());
    if (id) params.set('deal', id);
    else params.delete('deal');
    const query = params.toString();
    router.replace(query ? `/boards?${query}` : '/boards', { scroll: false });
  }, [router, searchParams]);

  return [selectedDealId, setSelectedDealId] as const;
}
