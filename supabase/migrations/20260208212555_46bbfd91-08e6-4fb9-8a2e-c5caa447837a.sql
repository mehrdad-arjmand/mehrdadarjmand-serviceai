-- Add missing DELETE policy for documents table
CREATE POLICY "Users with repository delete can delete documents"
ON public.documents
FOR DELETE
USING (has_permission('repository'::text, 'delete'::text, auth.uid()));

-- Create table to persist dropdown options
CREATE TABLE IF NOT EXISTS public.dropdown_options (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  value text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(category, value)
);

-- Enable RLS
ALTER TABLE public.dropdown_options ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read dropdown options
CREATE POLICY "Authenticated users can read dropdown options"
ON public.dropdown_options
FOR SELECT
USING (true);

-- Users with repository write can add new options
CREATE POLICY "Users with repository write can insert dropdown options"
ON public.dropdown_options
FOR INSERT
WITH CHECK (has_permission('repository'::text, 'write'::text, auth.uid()));

-- Insert default options
INSERT INTO public.dropdown_options (category, value) VALUES
  ('docType', 'Manual'),
  ('docType', 'Daily / shift report'),
  ('docType', 'Procedure / SOP'),
  ('docType', 'Project document'),
  ('equipmentType', 'Inverter'),
  ('equipmentType', 'Battery'),
  ('equipmentType', 'Converter'),
  ('equipmentType', 'PCS')
ON CONFLICT (category, value) DO NOTHING;