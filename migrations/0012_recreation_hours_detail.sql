-- Makes the existing "Recreation" knowledge article's hours explicit
-- (was vaguely "during permitted hours on Friday").
UPDATE knowledge_articles
SET content = 'Recreational/sports facilities (table tennis, foosball, the gym corner) are available after office hours on weekdays, and from 5:00 PM onward on Fridays.'
WHERE title = 'Recreation';
