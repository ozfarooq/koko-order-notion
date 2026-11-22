-- 016: the studio staff as of 23 Nov 2026 (owner): Master Sarfaraz, tailor Abdur Rahman, embroidery Jhangir.
-- Master Iftikhar has left (kept, inactive, for history). Other spellings let bank screenshots and
-- sticker notes match a person (e.g. "Abdur Rehman" on the BAF transfer of 22 Nov 2026).

ALTER TABLE fin_staff ADD COLUMN aliases TEXT[] NOT NULL DEFAULT '{}';

UPDATE fin_staff SET name = 'Abdur Rahman', aliases = ARRAY['Abdur Rehman', 'Abdul Rahman', 'Abdul Rehman'] WHERE name = 'Abdur Rehman';
UPDATE fin_staff SET name = 'Jhangir', aliases = ARRAY['Jahangir'] WHERE name = 'Jahangir';
UPDATE fin_staff SET is_active = false, notes = 'Left the studio (Nov 2026)' WHERE name = 'Master Iftikhar';
INSERT INTO fin_staff (name, role_title, pay_type, is_production, hours_per_day, notes)
SELECT 'Master Sarfaraz', 'cutting master', 'weekly_salary', true, 4, 'Weekly salary to be confirmed'
WHERE NOT EXISTS (SELECT 1 FROM fin_staff WHERE lower(name) = 'master sarfaraz');
UPDATE fin_staff SET notes = 'Per piece, not paid by Koko; the studio earns commission on his output' WHERE name = 'Manaf';
