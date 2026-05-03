import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

const SHARED_STALE = 5 * 60 * 1000; // 5 minutes

export function useUnits() {
  return useQuery({
    queryKey: ['units'],
    queryFn: () => apiFetch<{ units: any[] }>('/api/units'),
    staleTime: SHARED_STALE,
    select: (data) => data.units || [],
  });
}

export function useUsers(role?: string) {
  return useQuery({
    queryKey: ['users', role],
    queryFn: () => apiFetch<{ users: any[] }>(`/api/users${role ? `?role=${role}` : ''}`),
    staleTime: SHARED_STALE,
    select: (data) => data.users || [],
  });
}

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<{ products: any[] }>('/api/products?activeOnly=true'),
    staleTime: 2 * 60 * 1000,
    select: (data) => data.products || [],
  });
}

export function useAppSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ settings: Record<string, string> }>('/api/settings'),
    staleTime: 10 * 60 * 1000,
    select: (data) => data.settings || {},
  });
}
