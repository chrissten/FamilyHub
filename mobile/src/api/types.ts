export interface User {
  id: number;
  username: string;
  display_name: string;
  color_hex: string;
  is_admin: boolean;
}

export interface CalendarEvent {
  id: number;
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  owner_id: number;
  owner: User;
  attendees: User[];
  series_id?: string | null;
}

export interface GroceryList {
  id: number;
  name: string;
  is_public: boolean;
  owner: User;
}

export interface GroceryCategory {
  id: number;
  name: string;
  sort_order: number;
  list_id: number;
}

export interface GroceryItem {
  id: number;
  name: string;
  quantity?: string;
  checked: boolean;
  category_id: number;
  added_by: User;
  checked_by?: User | null;
}

export interface TodoList {
  id: number;
  name: string;
  is_public: boolean;
  owner: User;
}

export interface TodoItem {
  id: number;
  text: string;
  checked: boolean;
  list_id: number;
  added_by: User;
  checked_by?: User | null;
}

export interface Freezer {
  id: number;
  name: string;
}

export interface FreezerItem {
  id: number;
  name: string;
  quantity?: string | null;
  date_purchased?: string | null;
  expiration_date?: string | null;
  freezer_id: number;
  added_by: User;
}
