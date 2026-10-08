CREATE OR REPLACE FUNCTION public.normalize_spec_text(t text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE prev text;
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;
  t := regexp_replace(t, '\mEner X\M', 'EnerX', 'g');
  t := regexp_replace(t, '(\d)\.\s+(\d)', '\1.\2', 'g');
  LOOP prev := t; t := regexp_replace(t, '(\d\.\d+) (\d)(?=\s*[A-Za-z%)~/]| ?P\M)', '\1\2', 'g'); EXIT WHEN t = prev; END LOOP;
  t := regexp_replace(t, '(^|[\s~])(\d) (\d{3})(?=\s*(~|VDC|V\M|kWh|kW|A\M|mm|kg))', '\1\2\3', 'g');
  t := regexp_replace(t, '(\d\.\d+)\s+P\M', '\1P', 'g');
  t := regexp_replace(t, '(^|[\s(])\.(\d+)\s*P\M', '\10.\2P', 'g');
  t := regexp_replace(t, '\m([A-Z]) ([a-z]) ([a-z]{2,})', '\1\2\3', 'g');
  t := regexp_replace(t, '\m([B-HJ-Z]) ([a-z]{2,}) ([b-hj-z])\M(?!\.)', '\1\2\3', 'g');
  LOOP prev := t; t := regexp_replace(t, '([A-Za-z]{2,}) ([b-hj-z])\M(?!\.)', '\1\2', 'g'); EXIT WHEN t = prev; END LOOP;
  RETURN t;
END $$;