CREATE OR REPLACE FUNCTION public.normalize_spec_text(t text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE prev text;
BEGIN
  IF t IS NULL THEN RETURN NULL; END IF;
  -- decimal split by space: "0. 2" -> "0.2"
  t := regexp_replace(t, '(\d)\.\s+(\d)', '\1.\2', 'g');
  -- digits after a decimal split by spaces: "0.2 5" -> "0.25", "5644.2 9" -> "5644.29"
  LOOP prev := t; t := regexp_replace(t, '(\d\.\d+) (\d)(?=\s*[A-Za-z%)~/]| ?P\M)', '\1\2', 'g'); EXIT WHEN t = prev; END LOOP;
  -- thousands split: "1 040 ~1 500 VDC" -> "1040 ~1500 VDC"
  t := regexp_replace(t, '(^|[\s~])(\d) (\d{3})(?=\s*(~|VDC|V\M|kWh|kW|A\M|mm|kg))', '\1\2\3', 'g');
  -- configuration token: "0.25 P" -> "0.25P", " .25P" -> " 0.25P"
  t := regexp_replace(t, '(\d\.\d+)\s+P\M', '\1P', 'g');
  t := regexp_replace(t, '(^|[\s(])\.(\d+)\s*P\M', '\10.\2P', 'g');
  -- split words: "C o ntinuous" -> "Continuous", "Voltag e" -> "Voltage", "C harg e" -> "Charge"
  t := regexp_replace(t, '\m([A-Z]) ([a-z]) ([a-z]{2,})', '\1\2\3', 'g');
  t := regexp_replace(t, '\m([B-HJ-Z]) ([a-z]{2,})', '\1\2', 'g');
  LOOP prev := t; t := regexp_replace(t, '([A-Za-z]{2,}) ([b-hj-z])\M(?!\.)', '\1\2', 'g'); EXIT WHEN t = prev; END LOOP;
  t := regexp_replace(t, '\mEner X\M', 'EnerX', 'g');
  RETURN t;
END $$;