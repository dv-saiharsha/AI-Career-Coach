import { http } from '@/lib/http'
import {
  Offer,
  OfferCreatePayload,
  OfferListResponse,
  OfferUpdatePayload,
} from '@/types/offers'

export const offersService = {
  list: async (): Promise<OfferListResponse> => {
    const { data } = await http.get<OfferListResponse>('/offers')
    return data
  },

  create: async (payload: OfferCreatePayload): Promise<Offer> => {
    const { data } = await http.post<Offer>('/offers', payload)
    return data
  },

  update: async (offerId: number, payload: OfferUpdatePayload): Promise<Offer> => {
    const { data } = await http.patch<Offer>(`/offers/${offerId}`, payload)
    return data
  },

  remove: async (offerId: number): Promise<void> => {
    await http.delete(`/offers/${offerId}`)
  },
}
