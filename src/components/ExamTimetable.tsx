import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, ArrowUpDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
    normalizeSemester,
    normalizeSession,
    normalizeSlot,
    parseTimetableCsv,
    type TimetableExamEntry,
} from "@/lib/timetable";

type ExamEntry = TimetableExamEntry;

const BUNDLED_TIMETABLE_CSV_PATH = "/data/ktu_btech_exam_schedule_2019_scheme.csv";

function mergeExamEntries(primary: ExamEntry[], fallback: ExamEntry[]): ExamEntry[] {
    // Fallback rows first, then DB rows override same date+semester+slot+session key.
    const merged = new Map<string, ExamEntry>();

    const put = (entry: ExamEntry) => {
        const key = `${entry.date}|${entry.semester}|${entry.slot}|${entry.session}`;
        merged.set(key, entry);
    };

    fallback.forEach(put);
    primary.forEach(put);

    return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// KTU Civil (CET) & Common 2019 Scheme: subject_code → slot mapping
const KTU_SLOT_SUBJECTS: Record<string, Record<string, { code: string; name: string }>> = {
    S1: {
        A: { code: "MAT101", name: "Linear Algebra and Calculus" },
        B: { code: "PHT110 / CYT100", name: "Engg. Physics B / Engg. Chemistry" },
        C: { code: "EST100 / EST110", name: "Engg. Mechanics / Engg. Graphics" },
        D: { code: "EST120 / EST130", name: "Basics of Civil & Mech / Basics of Electrical & Electronics" },
        E: { code: "HUN101", name: "Life Skills" },
    },
    S2: {
        A: { code: "MAT102", name: "Vector Calculus Differential Equations and Transforms" },
        B: { code: "PHT110 / CYT100", name: "Engg. Physics B / Engg. Chemistry" },
        C: { code: "EST100 / EST110", name: "Engg. Mechanics / Engg. Graphics" },
        D: { code: "EST120 / EST130", name: "Basics of Civil & Mech / Basics of Electrical & Electronics" },
        E: { code: "HUN102", name: "Professional Communication" },
        F: { code: "EST102", name: "Programming in C" },
    },
    S3: {
        A: { code: "MAT201", name: "Partial Differential Equations and Complex Analysis" },
        B: { code: "CET201", name: "Mechanics of Solids" },
        C: { code: "CET203", name: "Fluid Mechanics and Hydraulics" },
        D: { code: "CET205", name: "Surveying and Geomatics" },
        E: { code: "EST200 / HUT200", name: "Design & Engineering / Professional Ethics" },
        F: { code: "MCN201", name: "Sustainable Engineering" },
    },
    S4: {
        A: { code: "MAT202", name: "Probability Statistics and Numerical Methods" },
        B: { code: "CET202", name: "Engineering Geology" },
        C: { code: "CET204", name: "Geotechnical Engineering I" },
        D: { code: "CET206", name: "Transportation Engineering" },
        E: { code: "EST200 / HUT200", name: "Design & Engineering / Professional Ethics" },
        F: { code: "MCN202", name: "Constitution of India" },
    },
    S5: {
        A: { code: "CET301", name: "Structural Analysis I" },
        B: { code: "CET303", name: "Design of Concrete Structures" },
        C: { code: "CET305", name: "Geotechnical Engineering II" },
        D: { code: "CET307", name: "Hydrology and Water Resources Engineering" },
        E: { code: "CET309", name: "Construction Technology and Management" },
        F: { code: "MCN301", name: "Disaster Management" },
    },
    S6: {
        A: { code: "CET302", name: "Structural Analysis II" },
        B: { code: "CET304", name: "Environmental Engineering" },
        C: { code: "CET306", name: "Design of Hydraulic Structures" },
        D: { code: "CETXXX", name: "Program Elective I" },
        E: { code: "HUT300", name: "Industrial Economics and Foreign Trade" },
        F: { code: "CET308", name: "Comprehensive Course Work" },
    },
    S7: {
        A: { code: "CET401", name: "Design of Steel Structures" },
        B: { code: "CETXXX", name: "Program Elective II" },
        C: { code: "CETXXX", name: "Open Elective" },
        D: { code: "MCN401", name: "Industrial Safety Engineering" },
    },
    S8: {
        A: { code: "CET402", name: "Quantity Surveying and Valuation" },
        B: { code: "CETXXX", name: "Program Elective III" },
        C: { code: "CETXXX", name: "Program Elective IV" },
        D: { code: "CETXXX", name: "Program Elective V" },
        E: { code: "CET404", name: "Comprehensive Viva Voce" },
    },
};

type SortMode = "date" | "slot";

function getDaysLeft(dateStr: string): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const exam = new Date(dateStr);
    exam.setHours(0, 0, 0, 0);
    return Math.ceil((exam.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getDaysLeftBadge(days: number) {
    if (days === 0) return <Badge className="bg-red-600 text-white text-[10px]">Today!</Badge>;
    if (days === 1) return <Badge className="bg-orange-500 text-white text-[10px]">Tomorrow</Badge>;
    if (days <= 7) return <Badge className="bg-amber-500 text-white text-[10px]">{days}d left</Badge>;
    if (days <= 30) return <Badge className="bg-sky-500 text-white text-[10px]">{days}d left</Badge>;
    return <Badge variant="secondary" className="text-[10px]">{days}d left</Badge>;
}

export function ExamTimetable({
    studentSemesters
}: {
    studentSemesters?: Record<string, { courses: { code: string; grade: string }[] }>
}) {
    const [exams, setExams] = useState<ExamEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSemester, setSelectedSemester] = useState<string>("all");
    const [sortMode, setSortMode] = useState<SortMode>("date");

    useEffect(() => {
        const fetchExams = async () => {
            setIsLoading(true);
            const [dbResult, fallbackCsvText] = await Promise.all([
                supabase
                    .from("exam_timetable")
                    .select("id, date, day, session, slot, semester, subject_code")
                    .order("date", { ascending: true }),
                fetch(BUNDLED_TIMETABLE_CSV_PATH)
                    .then((r) => (r.ok ? r.text() : ""))
                    .catch(() => ""),
            ]);

            const dbRows: ExamEntry[] =
                !dbResult.error && dbResult.data
                    ? (dbResult.data as ExamEntry[]).map((row) => ({
                          ...row,
                          semester: normalizeSemester(row.semester),
                          slot: normalizeSlot(row.slot),
                          session: normalizeSession(row.session),
                          subject_code: row.subject_code ? row.subject_code.trim().toUpperCase() : "",
                      }))
                    : [];

            const fallbackRows = fallbackCsvText ? parseTimetableCsv(fallbackCsvText).rows : [];
            setExams(mergeExamEntries(dbRows, fallbackRows));
            setIsLoading(false);
        };
        fetchExams();
    }, []);

    // Available semesters extracted from the data
    const semesters = useMemo(() => {
        const semSet = new Set(exams.map((e) => e.semester));
        return Array.from(semSet).sort((a, b) => {
            const na = parseInt(a.replace("S", ""));
            const nb = parseInt(b.replace("S", ""));
            return na - nb;
        });
    }, [exams]);

    // The student's actual subject codes taken
    const studentSubjects = useMemo(() => {
        const subjects = new Set<string>();
        if (studentSemesters) {
            for (const sem of Object.values(studentSemesters)) {
                if (sem.courses) {
                    for (const course of sem.courses) {
                        if (course.code) {
                            subjects.add(course.code.trim().toUpperCase());
                        }
                    }
                }
            }
        }
        return subjects;
    }, [studentSemesters]);

    // Highest semester for which we have published data in result payload
    const highestPublishedSemester = useMemo(() => {
        if (!studentSemesters) return null;
        const nums = Object.keys(studentSemesters)
            .map((s) => parseInt(s.replace("S", ""), 10))
            .filter((n) => Number.isFinite(n));
        if (nums.length === 0) return null;
        return Math.max(...nums);
    }, [studentSemesters]);

    // Most users need upcoming dates for the active semester even before results are published.
    const likelyCurrentSemester = useMemo(() => {
        if (!highestPublishedSemester) return null;
        return `S${Math.min(8, highestPublishedSemester + 1)}`;
    }, [highestPublishedSemester]);

    // Format utility for later filtering mapping
    const getSubjectForSlot = (semester: string, slot: string, subjectCode?: string) => {
        // 1. If the exam entry already has a subject_code, use it
        if (subjectCode && subjectCode.trim()) {
            // Try to find name from dictionary
            const semSlots = KTU_SLOT_SUBJECTS[semester];
            if (semSlots) {
                const entry = Object.values(semSlots).find(
                    (s) => s.code === subjectCode.trim().toUpperCase()
                );
                if (entry) return entry;
            }
            return { code: subjectCode, name: "" };
        }
        // 2. Fallback to slot dictionary
        const semSlots = KTU_SLOT_SUBJECTS[semester];
        if (semSlots && slot && semSlots[slot.trim().toUpperCase()]) {
            return semSlots[slot.trim().toUpperCase()];
        }
        return null;
    };

    // Filtered + sorted exams
    const displayedExams = useMemo(() => {
        let filtered = exams;

        // 1. Filter out exams that do not match the student's actual assumed subjects
        if (studentSubjects.size > 0) {
            filtered = filtered.filter(exam => {
                const currentPublishedLabel = highestPublishedSemester ? `S${highestPublishedSemester}` : null;
                const isResultPendingSem =
                    exam.semester === likelyCurrentSemester || exam.semester === currentPublishedLabel;
                if (isResultPendingSem) return true;

                const resolvedSubject = getSubjectForSlot(exam.semester, exam.slot, exam.subject_code);
                // Keep date row even when slot/subject mapping is unavailable.
                if (!resolvedSubject) return true;

                // Code could be "EST100 / EST110", we split to match against student's subject list
                const possibleCodes = resolvedSubject.code.split("/").map(c => c.trim().toUpperCase());
                // Elective placeholders should not hide date rows.
                if (possibleCodes.some(c => c.includes("XXX"))) return true;

                return possibleCodes.some(c => studentSubjects.has(c));
            });
        }

        // 2. Filter by active semester tab
        if (selectedSemester !== "all") {
            filtered = filtered.filter((e) => e.semester === selectedSemester);
        }

        const sorted = [...filtered];
        if (sortMode === "slot") {
            sorted.sort((a, b) => {
                if (a.semester !== b.semester) return a.semester.localeCompare(b.semester);
                return (a.slot || "").localeCompare(b.slot || "");
            });
        } else {
            sorted.sort((a, b) => a.date.localeCompare(b.date));
        }
        return sorted;
    }, [exams, selectedSemester, sortMode, studentSubjects, highestPublishedSemester, likelyCurrentSemester]);

    if (isLoading) {
        return (
            <Card className="shadow-lg border-0">
                <CardContent className="p-8 flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Loading timetable...</span>
                </CardContent>
            </Card>
        );
    }

    if (exams.length === 0) {
        return (
            <Card className="shadow-lg border-0">
                <CardContent className="p-8 text-center text-muted-foreground">
                    <Calendar className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">No exam timetable available</p>
                    <p className="text-xs mt-1">Admin can upload one from the Admin Panel.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="shadow-lg border-0 overflow-hidden">
            <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Calendar className="h-5 w-5 text-primary" />
                        Exam Timetable
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        <Select value={selectedSemester} onValueChange={setSelectedSemester}>
                            <SelectTrigger className="h-8 text-xs w-[100px]">
                                <SelectValue placeholder="Semester" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Semesters</SelectItem>
                                {semesters.map((s) => (
                                    <SelectItem key={s} value={s}>
                                        {s}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs gap-1"
                            onClick={() => setSortMode(sortMode === "date" ? "slot" : "date")}
                        >
                            <ArrowUpDown className="h-3.5 w-3.5" />
                            {sortMode === "date" ? "By Date" : "By Slot"}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
                <div className="space-y-2">
                    {displayedExams.map((exam) => {
                        const daysLeft = getDaysLeft(exam.date);
                        const subject = getSubjectForSlot(exam.semester, exam.slot, exam.subject_code);
                        const isPast = daysLeft < 0;
                        const formattedDate = new Date(exam.date).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                        });

                        return (
                            <div
                                key={exam.id}
                                className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${isPast
                                    ? "bg-muted/30 opacity-60"
                                    : daysLeft <= 3
                                        ? "bg-red-500/5 border border-red-500/20"
                                        : "bg-muted/50 hover:bg-muted"
                                    }`}
                            >
                                {/* Date column */}
                                <div className="flex-shrink-0 w-14 text-center">
                                    <p className="text-lg font-bold leading-tight">
                                        {new Date(exam.date).getDate()}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground uppercase">
                                        {new Date(exam.date).toLocaleDateString("en-IN", { month: "short" })}
                                    </p>
                                    <p className="text-[9px] text-muted-foreground">{exam.day}</p>
                                </div>

                                {/* Details */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                            {exam.semester}
                                        </Badge>
                                        {exam.slot && (
                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                Slot {exam.slot}
                                            </Badge>
                                        )}
                                        <Badge
                                            className={`text-[10px] px-1.5 py-0 ${exam.session === "FN"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                                : "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
                                                }`}
                                        >
                                            {exam.session === "FN" ? "🌅 FN" : exam.session === "AN" ? "🌆 AN" : exam.session || "—"}
                                        </Badge>
                                    </div>
                                    {subject ? (
                                        <div className="mt-1.5">
                                            <p className="text-sm font-medium leading-tight">{subject.name || subject.code}</p>
                                            {subject.name && (
                                                <p className="text-[11px] text-muted-foreground">{subject.code}</p>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground mt-1.5 italic">
                                            Subject not mapped for Slot {exam.slot}
                                        </p>
                                    )}
                                </div>

                                {/* Days left */}
                                <div className="flex-shrink-0 flex flex-col items-end gap-1">
                                    {isPast ? (
                                        <Badge variant="secondary" className="text-[10px] opacity-60">Done</Badge>
                                    ) : (
                                        getDaysLeftBadge(daysLeft)
                                    )}
                                    <span className="text-[9px] text-muted-foreground">{formattedDate}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
