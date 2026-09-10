import { addressRequestPublicSchema, type AddressRequestPublic } from "@shared/account";
import type { Recipient } from "@shared/postcards";
import { apiGet, csrfPost } from "./api";

/** The responder's side of a "send me your address" link. */
export async function fetchAddressRequest(token: string, signal?: AbortSignal): Promise<AddressRequestPublic> {
  return addressRequestPublicSchema.parse(await apiGet<unknown>(`/address-requests/${encodeURIComponent(token)}`, signal));
}

export async function respondToAddressRequest(token: string, recipient: Recipient): Promise<void> {
  await csrfPost<void>(`/address-requests/${encodeURIComponent(token)}`, recipient);
}
