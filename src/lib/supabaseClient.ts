import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bxtubgadqbairjkainja.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_gD5rkLU6caUFjO_fv2ffhw_YakrUB4B";

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);
