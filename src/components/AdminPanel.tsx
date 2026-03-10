import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, Upload, Mail, Key, FileSpreadsheet, Info, X, Trash2, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  TIMETABLE_REQUIRED_HEADERS,
  isValidSemester,
  isValidSession,
  isValidSlot,
  normalizeSemester,
  normalizeSession,
  normalizeSlot,
  parseTimetableCsv,
} from "@/lib/timetable";

interface TimetableEntry {
  id: string;
  date: string;
  day: string;
  semester: string;
  scheme?: string;
  session: string;
  slot: string;
}

interface AdminPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AdminPanel({ open, onClose }: AdminPanelProps) {
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string>("");
  const [showCsvGuide, setShowCsvGuide] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);

  // Custom Announcements State
  const [customAnnouncements, setCustomAnnouncements] = useState<any[]>([]);
  const [isLoadingAnnouncements, setIsLoadingAnnouncements] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLink, setNewLink] = useState("");
  const [newDate, setNewDate] = useState("");

  const fetchCustomAnnouncements = async () => {
    setIsLoadingAnnouncements(true);
    const { data, error } = await supabase
      .from("admin_announcements")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setCustomAnnouncements(data);
    }
    setIsLoadingAnnouncements(false);
  };

  const handleAddAnnouncement = async () => {
    if (!newTitle) return toast({ title: "Title is required", variant: "destructive" });
    setIsLoadingAnnouncements(true);
    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action: "add_announcement", password, title: newTitle, link: newLink, published_date: newDate },
    });
    if (!error && data?.success) {
      toast({ title: "Announcement added" });
      setNewTitle(""); setNewLink(""); setNewDate("");
      fetchCustomAnnouncements();
    } else {
      toast({ title: "Failed to add", variant: "destructive" });
    }
    setIsLoadingAnnouncements(false);
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;
    setIsLoadingAnnouncements(true);
    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action: "delete_announcement", password, id },
    });
    if (!error && data?.success) {
      toast({ title: "Announcement deleted" });
      fetchCustomAnnouncements();
    } else {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
    setIsLoadingAnnouncements(false);
  };

  const fetchTimetableEntries = async () => {
    setIsLoadingEntries(true);
    const { data, error } = await supabase
      .from('exam_timetable')
      .select('id, date, day, semester, scheme, session, slot')
      .order('date', { ascending: true });
    if (!error && data) {
      const normalized = (data as TimetableEntry[]).map((row) => ({
        ...row,
        semester: normalizeSemester(row.semester),
        slot: normalizeSlot(row.slot),
        session: normalizeSession(row.session),
      }));
      setTimetableEntries(normalized);
    }
    setIsLoadingEntries(false);
  };

  const deleteEntry = async (id: string) => {
    const { error } = await supabase.from('exam_timetable').delete().eq('id', id);
    if (!error) {
      setTimetableEntries(prev => prev.filter(e => e.id !== id));
      toast({ title: 'Entry deleted' });
    } else {
      toast({ title: 'Failed to delete', variant: 'destructive' });
    }
  };

  const clearAllEntries = async () => {
    const { error } = await supabase
      .from('exam_timetable')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (!error) {
      setTimetableEntries([]);
      toast({ title: 'All timetable entries cleared' });
    } else {
      toast({ title: 'Failed to clear entries', variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchTimetableEntries();
      fetchCustomAnnouncements();
    }
  }, [isAuthenticated]);

  const verifyPassword = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-api', {
        body: { action: 'verify', password },
      });
      if (error) throw error;
      if (data.success) {
        setIsAuthenticated(true);
        // Load settings
        const { data: settingsData } = await supabase.functions.invoke('admin-api', {
          body: { action: 'get_settings', password },
        });
        if (settingsData?.settings) {
          setAdminEmail(settingsData.settings.admin_email || '');
        }
        toast({ title: "Admin access granted" });
      } else {
        toast({ title: "Wrong password", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error verifying password", variant: "destructive" });
    }
    setIsLoading(false);
  };

  const handleCsvUpload = async () => {
    if (!csvFile) return;
    setIsLoading(true);
    setUploadResult("");
    try {
      const text = await csvFile.text();
      const parsed = parseTimetableCsv(text);
      const missingHeaders = TIMETABLE_REQUIRED_HEADERS.filter((h) => parsed.headerIndex[h] === undefined);

      if (missingHeaders.length > 0) {
        toast({
          title: "Invalid CSV format",
          description: `Missing columns: ${missingHeaders.join(", ")}`,
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      const rows: Array<{
        date: string;
        day: string;
        semester: string;
        scheme: string;
        subject_code: string;
        slot: string;
        session: string;
      }> = [];
      let skippedCount = 0;

      for (const row of parsed.rows) {
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(row.date);
        const validSemester = isValidSemester(row.semester);
        const validSlot = isValidSlot(row.slot);
        const validSession = isValidSession(row.session);

        if (!validDate || !validSemester || !validSlot || !validSession) {
          skippedCount += 1;
          continue;
        }

        rows.push({
          date: row.date,
          day: row.day || "",
          semester: normalizeSemester(row.semester),
          scheme: row.scheme || "2019",
          subject_code: "",
          slot: normalizeSlot(row.slot),
          session: normalizeSession(row.session),
        });
      }

      if (rows.length === 0) {
        toast({
          title: "No valid rows found",
          description: "Use date, day, semester, scheme, slot, session with valid S1-S8 and FN/AN values.",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('admin-api', {
        body: { action: 'upload_timetable', password, rows },
      });
      if (error) throw error;
      if (data.success) {
        const skippedMessage = skippedCount > 0 ? ` (${skippedCount} invalid row(s) skipped)` : "";
        setUploadResult(`Uploaded ${data.count} exam entries${skippedMessage}`);
        toast({ title: `Uploaded ${data.count} entries!` });
        setCsvFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchTimetableEntries();
      } else {
        setUploadResult(`Upload failed: ${data.error}`);
      }
    } catch {
      setUploadResult("Upload failed");
      toast({ title: "Upload failed", variant: "destructive" });
    }
    setIsLoading(false);
  };

  const saveSettings = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-api', {
        body: { action: 'update_settings', password, email: adminEmail, newPassword: newPassword || undefined },
      });
      if (error) throw error;
      if (data.success) {
        if (newPassword) setPassword(newPassword);
        setNewPassword("");
        toast({ title: "Settings saved" });
      }
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    }
    setIsLoading(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto border-0 shadow-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-5 w-5 text-primary" />
              Admin Panel
            </CardTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isAuthenticated ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Enter admin password to continue</p>
              <Input
                type="password"
                placeholder="Admin password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && verifyPassword()}
              />
              <Button onClick={verifyPassword} disabled={isLoading || !password} className="w-full">
                {isLoading ? "Verifying..." : "Login"}
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* CSV Upload */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Upload Exam Timetable (CSV)
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowCsvGuide(!showCsvGuide)}
                  >
                    <Info className="h-3.5 w-3.5 mr-1" />
                    CSV Format
                  </Button>
                </div>

                {showCsvGuide && (
                  <Card className="bg-secondary border-0">
                    <CardContent className="p-3 space-y-2">
                      <p className="text-xs font-semibold">CSV Format Guide</p>
                      <pre className="text-[10px] bg-background rounded p-2 overflow-x-auto font-mono">
                        {`date,day,semester,scheme,slot,session
2026-04-17,Fri,S1,2019,A,FN
2026-04-18,Sat,S3,2019,C,AN
2026-04-20,Mon,S6,2019,F,FN`}
                      </pre>
                      <div className="text-[10px] text-muted-foreground space-y-1">
                        <p><strong>date</strong>: YYYY-MM-DD format (Required)</p>
                        <p><strong>day</strong>: Mon, Tue, Wed, etc.</p>
                        <p><strong>semester</strong>: S1-S8 (Required)</p>
                        <p><strong>scheme</strong>: 2019 (or your scheme value)</p>
                        <p><strong>slot</strong>: A, B, C, D, E, F (or - if not assigned)</p>
                        <p><strong>session</strong>: FN (Forenoon) / AN (Afternoon)</p>
                      </div>
                      <div className="pt-1 border-t">
                        <p className="text-[10px] font-semibold text-primary">Converting Calendar to CSV</p>
                        <p className="text-[10px] text-muted-foreground">
                          1. Open the KTU exam calendar PDF/image<br />
                          2. For each exam date, note the semester, slot & session<br />
                          3. Create rows in the format above<br />
                          4. Use any text editor or Google Sheets to download as CSV
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="text-xs w-full file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                  onChange={e => setCsvFile(e.target.files?.[0] || null)}
                />
                {csvFile && (
                  <Button onClick={handleCsvUpload} disabled={isLoading} size="sm" className="w-full">
                    <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                    {isLoading ? "Uploading..." : `Upload ${csvFile.name}`}
                  </Button>
                )}
                {uploadResult && (
                  <p className="text-xs font-medium">{uploadResult}</p>
                )}
              </div>

              {/* Manage Custom Announcements */}
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Custom Announcements ({customAnnouncements.length})
                  </h3>
                </div>

                <div className="space-y-2 mb-3 bg-muted/30 p-2 rounded-md border border-border/50">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Deploy New Announcement</p>
                  <Input
                    placeholder="Announcement Title"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    className="text-xs h-8"
                  />
                  <Input
                    placeholder="Optional Link (ex: https://ktu.edu.in/...)"
                    value={newLink}
                    onChange={e => setNewLink(e.target.value)}
                    className="text-xs h-8"
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="Optional Date (ex: 2026-03-08)"
                      value={newDate}
                      onChange={e => setNewDate(e.target.value)}
                      className="text-xs h-8"
                    />
                    <Button
                      size="sm"
                      className="h-8 whitespace-nowrap"
                      onClick={handleAddAnnouncement}
                      disabled={isLoadingAnnouncements || !newTitle}
                    >
                      Publish
                    </Button>
                  </div>
                </div>

                {isLoadingAnnouncements ? (
                  <p className="text-xs text-muted-foreground">Loading announcements...</p>
                ) : customAnnouncements.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No custom announcements deployed.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {customAnnouncements.map(a => (
                      <div key={a.id} className="flex flex-col gap-1.5 p-2 rounded-md bg-muted/50 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium leading-tight">{a.title}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:bg-destructive/10 flex-shrink-0"
                            onClick={() => handleDeleteAnnouncement(a.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        {(a.link || a.published_date) && (
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {a.published_date && <span>{a.published_date}</span>}
                            {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate max-w-[200px]">{a.link}</a>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Manage Timetable Entries */}
              <div className="space-y-3 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Manage Timetable ({timetableEntries.length})
                  </h3>
                  {timetableEntries.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={clearAllEntries}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Clear All
                    </Button>
                  )}
                </div>

                {isLoadingEntries ? (
                  <p className="text-xs text-muted-foreground">Loading...</p>
                ) : timetableEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No timetable entries uploaded yet.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {timetableEntries.map(entry => {
                      const d = new Date(entry.date);
                      const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                      return (
                        <div key={entry.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50 text-xs">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{entry.semester}</span>
                            <span className="text-muted-foreground"> - {dateStr}</span>
                            {entry.slot && <span className="text-muted-foreground"> - Slot {entry.slot}</span>}
                            {entry.session && <span className="text-muted-foreground"> - {entry.session}</span>}
                            {entry.scheme && <span className="text-muted-foreground"> - Scheme {entry.scheme}</span>}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:bg-destructive/10 flex-shrink-0"
                            onClick={() => deleteEntry(entry.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Email Settings */}
              <div className="space-y-3 pt-2 border-t">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Notification Email
                </h3>
                <p className="text-xs text-muted-foreground">
                  Results will be sent to this email when published (admin only).
                </p>
                <Input
                  type="email"
                  placeholder="admin@example.com"
                  value={adminEmail}
                  onChange={e => setAdminEmail(e.target.value)}
                />
              </div>

              {/* Change Password */}
              <div className="space-y-3 pt-2 border-t">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  Change Admin Password
                </h3>
                <Input
                  type="password"
                  placeholder="New password (leave blank to keep)"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                />
              </div>

              <Button onClick={saveSettings} disabled={isLoading} className="w-full">
                {isLoading ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

