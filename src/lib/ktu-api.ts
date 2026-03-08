const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://usyuijszhqjibkizuwmj.supabase.co';
const PROXY_BASE = `${SUPABASE_URL}/functions/v1/ktu-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export interface KtuLoginResult {
  success: boolean;
  sessionCookie?: string;
  error?: string;
}

export interface ParsedResult {
  courseName: string;
  code: string;
  grade: string;
  credits: string;
  earnedCredit?: string;
  examDetails?: string;
}

export interface SemesterData {
  courses: ParsedResult[];
  sgpa: string;
}

export interface StudentInfo {
  name?: string;
  registerNumber?: string;
  branch?: string;
  program?: string;
  currentSemester?: string;
  cgpa?: string;
}

export interface KtuStudentDataResult {
  success: boolean;
  studentInfo?: StudentInfo;
  semesters?: Record<string, SemesterData>;
  error?: string;
}

export interface KtuHealthResult {
  success: boolean;
  status?: "online" | "offline";
  timestamp?: string;
  error?: string;
}

async function invokeKtuProxy<T>(body: Record<string, unknown>, timeoutMs = 25000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(PROXY_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }

    return await res.json() as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('KTU request timed out. Please try again.');
    }
    if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
      throw new Error('Cannot reach backend. Try changing DNS to 1.1.1.1 or 8.8.8.8.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function ktuLogin(username: string, password: string): Promise<KtuLoginResult> {
  try {
    return await invokeKtuProxy<KtuLoginResult>({ action: 'login', username, password });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}

export async function ktuGetStudentData(sessionCookie: string): Promise<KtuStudentDataResult> {
  try {
    return await invokeKtuProxy<KtuStudentDataResult>({ action: 'getStudentData', sessionCookie });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}

export async function ktuHealthCheck(): Promise<KtuHealthResult> {
  try {
    return await invokeKtuProxy<KtuHealthResult>({ action: 'health' }, 8000);
  } catch (error) {
    return {
      success: false,
      status: 'offline',
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export async function ktuServerHealthCheck(): Promise<KtuHealthResult> {
  try {
    return await invokeKtuProxy<KtuHealthResult>({ action: 'ktu_health' }, 12000);
  } catch (error) {
    return {
      success: false,
      status: 'offline',
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

// Legacy exports for backward compatibility
export type ExamOption = { id: string; name: string };
export type ParsedExamInfo = {
  name: string; registerNumber: string; college: string;
  branch: string; semester: string; examName: string;
  examType: string; monthYear: string;
};

export function parseResultsFromHtml(_html: string): { info: Partial<ParsedExamInfo>; results: ParsedResult[] } {
  return { info: {}, results: [] };
}
