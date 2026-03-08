
-- Admin settings table (key-value store for admin password, email, etc.)
CREATE TABLE public.admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Exam timetable table (uploaded via CSV by admin)
CREATE TABLE public.exam_timetable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  day TEXT NOT NULL,
  semester TEXT NOT NULL,
  scheme TEXT NOT NULL DEFAULT '2019',
  slot TEXT NOT NULL,
  session TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- KTU announcements cache table
CREATE TABLE public.ktu_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  link TEXT,
  attachment_url TEXT,
  published_date TEXT,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Public read access for timetable and announcements (no auth needed)
ALTER TABLE public.exam_timetable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ktu_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- Anyone can read exam timetable
CREATE POLICY "Public read exam_timetable" ON public.exam_timetable FOR SELECT USING (true);

-- Anyone can read announcements
CREATE POLICY "Public read ktu_announcements" ON public.ktu_announcements FOR SELECT USING (true);

-- No direct write access via client (admin writes go through edge function)
-- Admin settings: no public read (accessed via edge function only)

-- Insert default admin password
INSERT INTO public.admin_settings (key, value) VALUES ('admin_password', 'admin123');
INSERT INTO public.admin_settings (key, value) VALUES ('admin_email', '');
