import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, ExternalLink, Download, RefreshCw, X, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";


interface Announcement {
  id: string;
  title: string;
  link: string | null;
  attachment_url: string | null;
  published_date: string | null;
  fetched_at: string;
}

interface AnnouncementsPanelProps {
  open: boolean;
  onClose: () => void;
}

async function fetchKtuAnnouncements(): Promise<Announcement[]> {
  try {
    const { data, error } = await supabase.functions.invoke("ktu-announcements", {
      body: { action: "refresh" }
    });

    if (error) {
      console.error("Supabase KTU announcements proxy error:", error);
      return [];
    }

    // The edge function returns { success: true, count: X, announcements: [...] }
    if (data && data.announcements && Array.isArray(data.announcements)) {
      return data.announcements.map((item: any, i: number) => {
        let title = item.title || "Announcement";

        let published_date = "";
        if (item.published_date) {
          published_date = item.published_date;
        }

        const link = item.link || null;
        const attachment = item.attachment_url || null;

        return {
          id: item.id || `ktu-${i}`,
          title,
          link,
          attachment_url: attachment,
          published_date,
          fetched_at: item.fetched_at || new Date().toISOString(),
        };
      });
    }

    return [];
  } catch (e) {
    console.error("Failed to fetch KTU announcements via proxy:", e);
    return [];
  }
}

export function AnnouncementsPanel({ open, onClose }: AnnouncementsPanelProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<string>("");
  const [fetchError, setFetchError] = useState<string>("");

  const fetchAnnouncements = async () => {
    setIsLoading(true);
    setFetchError("");
    try {
      // 1. Fetch live KTU announcements using client-side ReCaptcha
      let ktuAnnouncements: Announcement[] = [];
      try {
        ktuAnnouncements = await fetchKtuAnnouncements();
      } catch (e) {
        console.warn("KTU live fetch failed:", e);
      }

      // 2. Fetch the nearest 5 upcoming exams from our timetable DB
      const today = new Date().toISOString().split("T")[0];
      const { data: exams, error: timetableError } = await supabase
        .from("exam_timetable")
        .select("id, date, day, session, slot, semester")
        .gte("date", today)
        .order("date", { ascending: true })
        .limit(5);

      let examNotifications: Announcement[] = [];
      if (!timetableError && exams && exams.length > 0) {
        const header: Announcement = {
          id: "timetable-header",
          title: "📢 Upcoming Exam Timetable",
          link: null,
          attachment_url: null,
          published_date: `Next ${exams.length} exams`,
          fetched_at: new Date().toISOString(),
        };
        examNotifications = [
          header,
          ...exams.map((exam: any) => {
            const d = new Date(exam.date);
            const dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            const sessionLabel = exam.session === "FN" ? "🌅 Forenoon" : exam.session === "AN" ? "🌆 Afternoon" : (exam.session || "");
            const subjectLabel = exam.semester ? `${exam.semester} Exam` : "Exam";
            return {
              id: `exam-${exam.id}`,
              title: `📋 ${subjectLabel}`,
              link: null,
              attachment_url: null,
              published_date: `${dateStr} • ${exam.day || ""} • ${sessionLabel}${exam.slot ? ` • ${exam.slot}` : ""}`,
              fetched_at: new Date().toISOString(),
            };
          }),
        ];
      }

      // 3. Combine: exams first, then KTU announcements
      const allAnnouncements = [...examNotifications, ...ktuAnnouncements];

      if (allAnnouncements.length === 0) {
        setFetchError("Could not fetch announcements. Try visiting KTU website directly.");
      }

      setAnnouncements(allAnnouncements);
      setLastFetched(new Date().toISOString());
    } catch (e) {
      console.error("Failed to fetch announcements:", e);
      setFetchError("An error occurred while fetching announcements.");
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (open) fetchAnnouncements();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-hidden border-0 shadow-2xl flex flex-col">
        <CardHeader className="pb-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-5 w-5 text-primary" />
              Notifications
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={fetchAnnouncements}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {lastFetched && (
            <p className="text-[10px] text-muted-foreground">
              Last updated: {new Date(lastFetched).toLocaleString()}
            </p>
          )}
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 pb-4">
          {isLoading && announcements.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading announcements...</span>
            </div>
          ) : announcements.length === 0 ? (
            <div className="text-center py-8 px-4">
              <Bell className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-foreground font-medium mb-1">No announcements found</p>
              {fetchError && (
                <p className="text-xs text-muted-foreground">{fetchError}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={fetchAnnouncements}
              >
                Try Again
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {announcements.map((a, i) => (
                <div
                  key={a.id || i}
                  className="p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors space-y-1.5"
                >
                  <p className="text-sm font-medium leading-snug">{a.title}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.published_date && (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {a.published_date}
                      </Badge>
                    )}
                    {a.link && (
                      <a
                        href={a.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View
                      </a>
                    )}
                    {a.attachment_url && (
                      <a
                        href={a.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t">
            <a
              href="https://ktu.edu.in/Menu/announcements"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-xs text-primary hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              View all on ktu.edu.in
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
