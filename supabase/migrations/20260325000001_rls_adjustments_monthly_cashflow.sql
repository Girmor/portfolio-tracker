-- Enable RLS on tables that were missing it (flagged by Supabase security advisor)

-- adjustments: policy already existed, just enable RLS
ALTER TABLE public.adjustments ENABLE ROW LEVEL SECURITY;

-- monthly_cashflow: enable RLS + policy for authenticated users
ALTER TABLE public.monthly_cashflow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage cashflow"
  ON public.monthly_cashflow
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
