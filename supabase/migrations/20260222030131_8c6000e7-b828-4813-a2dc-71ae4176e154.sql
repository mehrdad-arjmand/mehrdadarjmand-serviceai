-- Assign all orphan documents (no project_id) to the Industrial Batteries project
UPDATE public.documents SET project_id = 'ca9e3f65-0de8-4f28-a9a2-9be4ba0cf812' WHERE project_id IS NULL;