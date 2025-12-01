-- Add new metadata columns to documents table
ALTER TABLE public.documents 
ADD COLUMN upload_date DATE,
ADD COLUMN site TEXT,
ADD COLUMN equipment_make TEXT,
ADD COLUMN equipment_model TEXT;