// Types mirror backend/app/schemas/offer.py exactly. All money fields are
// plain numbers (dollars); estimated_tax_rate is a fraction (0.22 = 22%),
// col_index is a multiplier relative to a baseline (1.15 = 15% more
// expensive) — both are echoed back by the API, never re-derived here.

export interface Offer {
  id: number
  company: string
  role_title: string
  application_id: number | null
  base_salary: number
  annual_bonus: number
  signing_bonus: number
  equity_value_annual: number
  location: string | null
  is_remote: boolean
  notes: string | null

  // Computed server-side.
  total_first_year: number
  recurring_annual: number
  estimated_tax_rate: number | null
  col_index: number | null
  net_adjusted_comp: number
  is_adjusted: boolean

  created_at: string | null
  updated_at: string | null
}

export interface OfferListResponse {
  offers: Offer[]
  count: number
}

// What the create/edit form collects. Percent/plain-number fields the user
// types get converted to the API's fraction/multiplier shape at submit time.
export interface OfferFormValues {
  company: string
  role_title: string
  base_salary: string
  annual_bonus: string
  signing_bonus: string
  equity_value_annual: string
  location: string
  is_remote: boolean
  notes: string
  estimated_tax_rate_percent: string
  col_index: string
}

export interface OfferCreatePayload {
  company: string
  role_title: string
  application_id?: number | null
  base_salary: number
  annual_bonus?: number
  signing_bonus?: number
  equity_value_annual?: number
  location?: string | null
  is_remote?: boolean
  notes?: string | null
  estimated_tax_rate?: number | null
  col_index?: number | null
}

export type OfferUpdatePayload = Partial<OfferCreatePayload>
