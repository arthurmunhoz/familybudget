export type EntryType = 'expense' | 'income'

export interface Profile {
  email: string
  display_name: string
}

export interface Budget {
  id: string
  name: string
  created_at: string
}

export interface Month {
  id: string
  budget_id: string
  year: number
  month: number
  created_at: string
}

export interface Entry {
  id: string
  month_id: string
  type: EntryType
  label: string
  amount: number
  category: string
  entry_date: string
  person_email: string
  recurring: boolean
  created_at: string
}

export interface CategoryRule {
  keyword: string
  category: string
}
