import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "online_reservation": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "walkin_reservation": return "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300";
    case "pending_payment": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "partial": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    case "paid": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "refunded": return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    case "pending": return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
    case "processing": return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    case "ready": return "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300";
    case "out_for_delivery": return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300";
    case "completed": return "bg-green-200 text-green-900 dark:bg-green-900/50 dark:text-green-200";
    case "cancelled": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    case "online_delivery": return "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300";
    case "online_pickup": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "walkin_delivery": return "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300";
    case "walkin_pickup": return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    case "cash": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "gcash": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "cod": return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    default: return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}
