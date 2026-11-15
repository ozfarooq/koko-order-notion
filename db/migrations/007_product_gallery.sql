-- 007: products keep a few photos (first = image_url) and a one-line description for receipts.
-- Both come from the website; the tagline can be edited in the app and isn't overwritten by later syncs.

ALTER TABLE products ADD COLUMN images  TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE products ADD COLUMN tagline TEXT;
UPDATE products SET images = ARRAY[image_url] WHERE image_url IS NOT NULL;
