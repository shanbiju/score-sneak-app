import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, ArrowUpDown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ExamEntry {
    id: string;
    date: string;
    day: string;
    session: string;
    slot: string;
    subject_code?: string;
    semester: string;
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

export function ExamTimetable() {
    const [exams, setExams] = useState<ExamEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSemester, setSelectedSemester] = useState<string>("all");
    const [sortMode, setSortMode] = useState<SortMode>("date");

    useEffect(() => {
        const fetchExams = async () => {
            setIsLoading(true);
            const { data, error } = await supabase
                .from("exam_timetable")
                .select("id, date, day, session, slot, semester, subject_code")
                .order("date", { ascending: true });

            if (!error && data) {
                setExams(data as ExamEntry[]);
            }
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

    // Filtered + sorted exams
    const displayedExams = useMemo(() => {
        let filtered = exams;
        if (selectedSemester !== "all") {
            filtered = exams.filter((e) => e.semester === selectedSemester);
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
    }, [exams, selectedSemester, sortMode]);

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
