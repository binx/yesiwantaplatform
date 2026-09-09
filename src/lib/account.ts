import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AddressInput,
  CustomerAddress,
  CustomerLoginInput,
  CustomerProfile,
  CustomerProfileUpdateInput,
  CustomerRegisterInput,
  CustomerSession,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "@shared/account";
import type { Order } from "@shared/orders";
import { apiGet, clearCsrfToken, csrfDelete, csrfPost, csrfPut, setCsrfToken } from "./api";

/**
 * The storefront customer, mirroring `@/lib/session`'s admin equivalent.
 *
 * `GET /api/account` answers 200 with a null customer when nobody is signed
 * in, like the admin `/api/session`. It used to answer 401, which this file
 * caught and turned into `null` — right, but it also meant every page load on
 * a working store printed a red failed request in the console. Every other
 * `/api/account/*` route still answers 401, because there it is a refusal.
 */
export const customerQueryKey = ["account"] as const;
const ordersQueryKey = ["account", "orders"] as const;
const addressesQueryKey = ["account", "addresses"] as const;

async function fetchCustomer(signal?: AbortSignal): Promise<CustomerProfile | null> {
  const session = await apiGet<CustomerSession>("/account", signal);
  return session.customer;
}

export function useCustomer(): UseQueryResult<CustomerProfile | null> {
  return useQuery({
    queryKey: customerQueryKey,
    queryFn: ({ signal }) => fetchCustomer(signal),
    staleTime: 30_000,
    retry: false,
  });
}

/** Both a fresh sign-in and a fresh verification hand back a new CSRF token
 * — the server regenerates the session either way, which is what defeats
 * fixation — so both mutations share this. */
function onSignedIn(queryClient: ReturnType<typeof useQueryClient>, csrfToken: string): void {
  setCsrfToken(csrfToken);
  void queryClient.invalidateQueries({ queryKey: customerQueryKey });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: CustomerRegisterInput) => csrfPost<void>("/account/register", input),
  });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) =>
      csrfPost<{ csrfToken: string }>("/account/verify", { token }),
    onSuccess: (result) => onSignedIn(queryClient, result.csrfToken),
  });
}

export function useCustomerLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CustomerLoginInput) =>
      csrfPost<{ csrfToken: string }>("/account/session", input),
    onSuccess: (result) => onSignedIn(queryClient, result.csrfToken),
  });
}

export function useCustomerLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => csrfDelete<void>("/account/session"),
    onSuccess: async () => {
      clearCsrfToken();
      // Just this customer's own data — the storefront's product and store
      // caches belong to nobody in particular and stay put.
      queryClient.removeQueries({ queryKey: ordersQueryKey });
      queryClient.removeQueries({ queryKey: addressesQueryKey });
      await queryClient.invalidateQueries({ queryKey: customerQueryKey });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CustomerProfileUpdateInput) => csrfPut<void>("/account", input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: customerQueryKey }),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) =>
      csrfPost<void>("/account/password/forgot", input),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => csrfPost<void>("/account/password/reset", input),
  });
}

export function useCustomerOrders(enabled = true): UseQueryResult<Order[]> {
  return useQuery({
    queryKey: ordersQueryKey,
    queryFn: ({ signal }) => apiGet<Order[]>("/account/orders", signal),
    enabled,
  });
}

export function useCustomerOrder(id: string | undefined): UseQueryResult<Order> {
  return useQuery({
    queryKey: [...ordersQueryKey, id],
    queryFn: ({ signal }) => apiGet<Order>(`/account/orders/${id ?? ""}`, signal),
    enabled: Boolean(id),
  });
}

export function useAddresses(enabled = true): UseQueryResult<CustomerAddress[]> {
  return useQuery({
    queryKey: addressesQueryKey,
    queryFn: ({ signal }) => apiGet<CustomerAddress[]>("/account/addresses", signal),
    enabled,
  });
}

export function useCreateAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AddressInput) => csrfPost<CustomerAddress>("/account/addresses", input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: addressesQueryKey }),
  });
}

export function useUpdateAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AddressInput }) =>
      csrfPut<CustomerAddress>(`/account/addresses/${id}`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: addressesQueryKey }),
  });
}

export function useDeleteAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => csrfDelete<void>(`/account/addresses/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: addressesQueryKey }),
  });
}
