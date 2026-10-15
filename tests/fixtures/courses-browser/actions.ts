import type { CourseActionState } from "@/modules/courses/actions";

declare global {
  interface Window {
    courseFailure?: string;
    courseCalls: {
      operation: string;
      values: Record<string, FormDataEntryValue | FormDataEntryValue[]>;
    }[];
    refreshCourse: () => void;
  }
}

function action(operation: string) {
  return async (_: CourseActionState, form: FormData) => {
    const values: Record<string, FormDataEntryValue | FormDataEntryValue[]> =
      Object.fromEntries(form);
    if (form.has("starts")) values.starts = form.getAll("starts");
    window.courseCalls ||= [];
    window.courseCalls.push({ operation, values });
    if (window.courseFailure) return { error: window.courseFailure };
    return {
      success: "Zapisano dane testowe.",
      version: Number(form.get("expected_version") || 0) + 1,
    };
  };
}

export const createCourse = action("create");
export const requestEnrollment = action("enroll");
export const rescheduleSession = action("reschedule");
export const recordAttendance = action("attendance");
export const editCourse = action("settings");
export const correctAttendance = action("correct");
export const reopenEnrollment = action("reopen");
export const changeCourse = action("change");
export const decideEnrollment = action("decide");
export const changeSession = action("session");
export const settleEnrollment = action("settle");
export const refundCoursePayment = action("refund");
export const recordPayment = action("payment");
export const randomUUID = () => crypto.randomUUID();
